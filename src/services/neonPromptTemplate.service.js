// Builds the Gemini image-generation request that turns a user's uploaded
// photo, freehand drawing, or typed text into a photorealistic preview of a
// custom neon sign. Single source of truth for the prompt wording — both
// scripts/neon-design-worker.js (production) and scripts/tune-neon-prompt.js
// (the manual prompt-tuning loop) call buildRequest() so refinements never
// have to be duplicated between the two.
const { Modality } = require('@google/genai');
const { imageModel } = require('../config/gemini');

const SIZE_LABELS = {
  small: '12 inches by 12 inches',
  medium: '24 inches by 24 inches',
  large: '36 inches by 36 inches',
};

// Phrased the way real neon tubing is described rather than as bare colour
// names — "electric blue" reads to the model as neon, "blue" reads as paint.
// Must stay in sync with NEON_COLORS in customNeonDesign.service.js, which is
// the validation whitelist; describeColor() falls back to the raw value, so a
// missing entry here degrades quietly instead of erroring.
const COLOR_LABELS = {
  amber: 'warm amber/gold',
  pink: 'hot pink/magenta',
  blue: 'electric blue',
  white: 'cool white',
  red: 'deep ruby red',
  green: 'vivid emerald green',
  purple: 'rich violet/purple',
  orange: 'bright tangerine orange',
  'ice-blue': 'pale icy blue',
  'warm-white': 'soft warm white',
};

// Customer-picked colours arrive as "custom:#rrggbb" (validated by
// CUSTOM_COLOR_RE in customNeonDesign.service.js). They are deliberately not in
// COLOR_LABELS — there are 16 million of them — so describeColor() routes them
// through describeHex() instead, which produces the same style of phrase from
// the hex. A bare hex must never reach the prompt: an image model renders
// "#ff2d95" as literal text on the sign rather than as a tube colour, which is
// exactly what the instruction's "no text added outside the sign" clause fights.
const CUSTOM_HEX_RE = /^custom:#([0-9a-f]{6})$/;

function hexToHsl(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

// Ordered, non-overlapping hue windows, phrased as neon tubing rather than as
// bare colour names for the same reason COLOR_LABELS is — see the note above it.
const HUE_BUCKETS = [
  { max: 12, name: 'red' },
  { max: 25, name: 'red-orange' },
  { max: 42, name: 'tangerine orange' },
  { max: 58, name: 'amber/gold' },
  { max: 70, name: 'yellow' },
  { max: 90, name: 'lime green' },
  { max: 150, name: 'emerald green' },
  { max: 175, name: 'spring green/teal' },
  { max: 195, name: 'cyan/turquoise' },
  { max: 215, name: 'azure blue' },
  { max: 250, name: 'electric blue' },
  { max: 275, name: 'indigo/violet-blue' },
  { max: 295, name: 'violet/purple' },
  { max: 320, name: 'magenta' },
  { max: 345, name: 'hot pink' },
  { max: 360, name: 'red' },
];

function hueName(h) {
  return (HUE_BUCKETS.find((bucket) => h < bucket.max) || HUE_BUCKETS[0]).name;
}

// Below ~10% saturation hue is noise, so branch on lightness instead and reuse
// the exact wording of the white presets — a custom near-white should generate
// the same way picking 'white'/'warm-white' does.
function neutralName(h, l) {
  if (l >= 0.88) return h >= 20 && h <= 70 ? 'soft warm white' : 'cool white';
  if (l >= 0.6) return 'pale silvery white';
  if (l >= 0.3) return 'dim smoky grey-white';
  return 'very dim grey-white';
}

// Qualifiers stack the way the presets read: "pale icy blue", "deep ruby red",
// "vivid emerald green".
function describeHex(hex) {
  const { h, s, l } = hexToHsl(hex);
  // Very light tints read as white to the eye however saturated the maths says
  // they are (#fff8e7 is 100% saturated but is plainly an off-white), so the
  // lightness test has to come before the saturation one.
  if (l >= 0.93) return neutralName(h, l);
  if (s <= 0.1) return neutralName(h, l);

  const base = hueName(h);
  if (l >= 0.82) return `pale ${base}`;
  if (l <= 0.3) return `deep ${base}`;
  if (s >= 0.85 && l >= 0.4 && l <= 0.65) return `vivid ${base}`;
  if (s <= 0.35) return `muted ${base}`;
  return base;
}

// The custom size has no fixed label — the customer typed the dimensions, so
// they are described literally. Aspect ratio matters more than absolute size
// to the generated image: a 60x12 sign is a long banner and a 30x30 is a
// square panel, and without saying so the model composes everything roughly
// square regardless of the numbers.
function describeSize(size, customWidthIn, customHeightIn) {
  if (SIZE_LABELS[size]) return SIZE_LABELS[size];
  if (customWidthIn == null || customHeightIn == null) return 'medium-sized';

  const width = Number(customWidthIn);
  const height = Number(customHeightIn);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'medium-sized';
  }

  const literal = `${trimNumber(width)} inches wide by ${trimNumber(height)} inches tall`;
  const ratio = width / height;
  if (ratio >= 1.6) return `${literal}, a wide landscape-format sign noticeably wider than it is tall`;
  if (ratio <= 0.625) return `${literal}, a tall portrait-format sign noticeably taller than it is wide`;
  return `${literal}, roughly square in proportion`;
}

// DECIMAL(6,2) arrives as "30.00"; Number() drops the trailing zeros so the
// prompt reads "30 inches" rather than "30.00 inches".
function trimNumber(value) {
  return String(Number(value));
}

function describeColor(neonColor) {
  if (COLOR_LABELS[neonColor]) return COLOR_LABELS[neonColor];
  const match = typeof neonColor === 'string' ? CUSTOM_HEX_RE.exec(neonColor) : null;
  if (match) return describeHex(match[1]);
  // Unchanged legacy fallback: an unknown preset still degrades to the raw
  // value rather than erroring the worker mid-generation.
  return neonColor || 'warm amber/gold';
}

function buildInstruction({ designType, size, neonColor, sketch, customWidthIn, customHeightIn }) {
  const sizeText = describeSize(size, customWidthIn, customHeightIn);
  const colorText = describeColor(neonColor);

  const shared = `Turn the attached image into a single photorealistic product photo of a real, physically-manufactured LED neon sign, ${sizeText}, using ${colorText} neon tubing. Mount it on a plain indoor wall, photographed straight-on in a dim room so the glow, soft light falloff onto the wall, and a subtle reflection below are visible, matching how real neon sign product photography looks. Render the tubing as continuous glowing tube shapes (rounded line thickness, soft bloom/halo around each tube, slight uneven brightness like real neon) mounted on a thin clear acrylic backing, not as a flat vector illustration or a screen/drawing. Keep the output to exactly one image, no text or borders added outside the sign itself.`;

  if (designType === 'text') {
    return `${shared} The sign's design is the exact text and lettering shown in the attached image — preserve the exact characters and their layout/style, do not alter the wording.`;
  }
  if (designType === 'draw') {
    // With an interpretation in hand the task changes shape entirely. Without
    // one the model is asked to infer intent from pixels while copying them,
    // which it resolves by copying — the failure that produced an
    // unrecognisable tangle from a Mickey-Mouse-shaped sketch. Naming the
    // subject up front turns it into an ordinary drawing task: render *this*,
    // and use the sketch for layout only.
    if (sketch?.subject) {
      const composition = sketch.composition
        ? ` The customer's layout, which you should follow: ${sketch.composition}.`
        : '';
      return `${shared} The attached image is a rough freehand sketch, drawn in seconds with a mouse or fingertip, of the following subject: ${sketch.subject}.${composition} Draw that subject properly as a bold cartoon-style neon sign with real personality — the way a professional sign artist would reinterpret a customer's napkin sketch. Use the sketch only for layout, orientation and proportion; do NOT trace its lines, reproduce its wobble, or preserve its mistakes. The finished sign must be a clean, confident, instantly recognisable rendering of ${sketch.subject}, drawn correctly even where the sketch is crude, incomplete or badly proportioned. Render it with confident sweeping curves and lively line weight, exaggerated and simplified shapes, chunky readable forms, playful slightly-oversized proportions on expressive features such as eyes, smiles, ears or flourishes, and clean negative space that lets the shape read instantly from across a room. Use the minimum number of elegant continuous tube runs a real neon fabricator would bend. For this sketch-based sign, stage it more dramatically than a plain product shot: darken the room further so the sign is the single vivid light source, let it throw a rich saturated pool of coloured glow across the wall with deep shadow falloff beyond it, and push the contrast so the tube cores read almost white-hot against the dark. The result must look like a bold, characterful piece of neon art a customer would be excited to hang, never like an amateur doodle traced in light.`;
    }

    // Unrecognised sketch: the interpreter was unavailable or not confident
    // enough, so fall back to cleaning up what was actually drawn rather than
    // inventing a subject the customer never asked for.
    return `${shared} The attached image is a rough freehand sketch drawn with a mouse or fingertip, so treat it as a guide to the intended subject and composition, not as artwork to copy stroke for stroke. Redraw it as a bold cartoon-style neon sign with real personality — the way a professional sign artist would reinterpret a customer's napkin sketch. Keep the same subject, silhouette, orientation and layout the sketch is clearly aiming at, but smooth every wobbly or jittery line into a confident continuous curve, straighten lines meant to be straight, even out circles and arcs, close accidental gaps, merge doubled or overshooting strokes into one tube, correct lopsided proportions and symmetry, and drop stray marks or smudges. Interpret ambiguous scribbles as the nearest sensible version of what the drawing depicts. Push the result toward stylised cartoon character rather than literal realism: confident sweeping curves with lively line weight, exaggerated and simplified shapes, chunky readable forms, playful slightly-oversized proportions on any expressive feature such as eyes, smiles, ears or flourishes, and clean negative space that lets the shape read instantly from across a room. Simplify fussy detail into the minimum number of elegant tube runs a real neon fabricator would bend, since neon tubing is bent on a jig in smooth continuous sections and physically cannot look shaky or hand-jittered. For this sketch-based sign, stage it more dramatically than a plain product shot: darken the room further so the sign is the single vivid light source, let it throw a rich saturated pool of coloured glow across the wall with deep shadow falloff beyond it, and push the contrast so the tube cores read almost white-hot against the dark. The finished sign must look like a bold, characterful piece of neon art a customer would be excited to hang, never like an amateur doodle traced in light.`;
  }
  return `${shared} The attached image is the reference design/logo/artwork — preserve its recognizable silhouette and proportions as the sign's shape.`;
}

function buildRequest({ designType, size, neonColor, imageBase64, imageMimeType, sketch, customWidthIn, customHeightIn }) {
  return {
    model: imageModel,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
          { text: buildInstruction({ designType, size, neonColor, sketch, customWidthIn, customHeightIn }) },
        ],
      },
    ],
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  };
}

module.exports = { buildRequest, buildInstruction, describeColor, describeHex };
