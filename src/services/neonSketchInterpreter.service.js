// Vision pass that runs before image generation for hand-drawn ("draw") designs.
//
// The image model receives one image and one instruction, and the pixels in
// front of it always win: told to "reinterpret rather than trace", it still
// traces, because it never established what the sketch was meant to be. A
// customer's Mickey-Mouse-shaped scribble came back as an unrecognisable
// tangle of tubes for exactly that reason — the wobble had been smoothed, but
// nothing in the pipeline had ever asked what the drawing depicts.
//
// So ask. A text model looks at the sketch first and names the subject; the
// answer is injected into the image prompt, which turns an impossible task
// ("infer intent while copying") into a solvable one ("draw a mouse mascot
// head, using this sketch for layout"). Recognition has to happen before
// generation, not during it.
const { Type } = require('@google/genai');
const { genAI, chatModel } = require('../config/gemini');

// Free-text `subject` rather than a fixed enum: customers draw anything, and a
// closed list would force every unlisted subject into a wrong neighbour.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    // What the sketch depicts, phrased as a neon-sign brief.
    subject: { type: Type.STRING },
    // Drives the confidence gate below. A genuinely ambiguous scribble must be
    // allowed to say so — a confident wrong guess is worse than no guess,
    // because it replaces the customer's shape with something unrelated.
    confidence: { type: Type.NUMBER },
    // Layout notes worth preserving even when the subject is recognised, so
    // the customer still sees *their* composition rather than generic clip art.
    composition: { type: Type.STRING },
  },
  required: ['subject', 'confidence', 'composition'],
};

const SYSTEM_INSTRUCTION = `You identify what a customer's rough freehand sketch is meant to depict, so it can be redrawn as a neon sign.

The sketches are drawn with a mouse or a fingertip in a few seconds. They are shaky, crude, badly proportioned, and often incomplete. Judge intent, not execution: a lopsided circle with two smaller circles on top is a mouse mascot head, not "three overlapping circles". Read it the way a friendly human would guess a Pictionary drawing.

Return:
- subject: what it is meant to be, as a short neon-sign brief (e.g. "a cartoon mouse mascot head with two large round ears", "a heart with an arrow through it", "a coffee cup with steam rising"). Describe the visual form in generic terms. If the drawing resembles a recognisable branded or copyrighted character, do NOT name that character, any franchise, or its owner — describe only the generic visual form it takes (e.g. "a round-faced cartoon mouse head with two large circular ears"), so the result is an original design rather than a reproduction.
- composition: the layout actually drawn — orientation, what sits where, rough proportions, which elements touch or overlap. This is what keeps the output the customer's own design rather than generic clip art.
- confidence: 0 to 1, how sure you are of the subject. Be honest. Use below 0.4 for a scribble you genuinely cannot read, and reserve above 0.8 for sketches whose subject is unmistakable.

Never describe the drawing's quality, the shakiness of its lines, or that it is a sketch. Describe only what it depicts.`;

// Below this the interpretation is discarded rather than used. A wrong-but-
// confident subject actively harms the result: it replaces the customer's shape
// with an unrelated object. Under the gate the pipeline falls back to the
// unguided prompt, which is exactly the pre-existing behaviour — so a failed
// interpretation can only be neutral, never worse.
const MIN_CONFIDENCE = 0.4;

function buildRequest({ imageBase64, imageMimeType }) {
  return {
    model: chatModel,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
          { text: 'Identify what this sketch is meant to depict.' },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
}

function parseResponse(response) {
  const text = response?.text
    ?? response?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // responseSchema makes this unlikely, but a malformed body must degrade to
    // "no interpretation" rather than throw and fail the whole generation.
    return null;
  }

  const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
  const composition = typeof parsed.composition === 'string' ? parsed.composition.trim() : '';
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  if (!subject || confidence < MIN_CONFIDENCE) return null;

  return { subject, composition, confidence };
}

// Returns null — never throws — whenever interpretation is unavailable,
// unreadable, or not confident enough. Every caller treats null as "generate
// the way it did before", so this stage can degrade but cannot break.
async function interpretSketch({ imageBase64, imageMimeType }) {
  if (!genAI) return null;
  try {
    const response = await genAI.models.generateContent(buildRequest({ imageBase64, imageMimeType }));
    return parseResponse(response);
  } catch {
    return null;
  }
}

module.exports = { interpretSketch, buildRequest, parseResponse, MIN_CONFIDENCE };
