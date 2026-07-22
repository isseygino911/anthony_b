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

const COLOR_LABELS = {
  amber: 'warm amber/gold',
  pink: 'hot pink/magenta',
  blue: 'electric blue',
  white: 'cool white',
};

function describeSize(size) {
  return SIZE_LABELS[size] || 'medium-sized';
}

function describeColor(neonColor) {
  return COLOR_LABELS[neonColor] || neonColor || 'warm amber/gold';
}

function buildInstruction({ designType, size, neonColor }) {
  const sizeText = describeSize(size);
  const colorText = describeColor(neonColor);

  const shared = `Turn the attached image into a single photorealistic product photo of a real, physically-manufactured LED neon sign, ${sizeText}, using ${colorText} neon tubing. Mount it on a plain indoor wall, photographed straight-on in a dim room so the glow, soft light falloff onto the wall, and a subtle reflection below are visible, matching how real neon sign product photography looks. Render the tubing as continuous glowing tube shapes (rounded line thickness, soft bloom/halo around each tube, slight uneven brightness like real neon) mounted on a thin clear acrylic backing, not as a flat vector illustration or a screen/drawing. Keep the output to exactly one image, no text or borders added outside the sign itself.`;

  if (designType === 'text') {
    return `${shared} The sign's design is the exact text and lettering shown in the attached image — preserve the exact characters and their layout/style, do not alter the wording.`;
  }
  if (designType === 'draw') {
    return `${shared} The attached image is a hand-drawn sketch — trace its outline faithfully as the sign's shape rather than inventing new details, while still converting the flat sketch lines into realistic glowing neon tubing.`;
  }
  return `${shared} The attached image is the reference design/logo/artwork — preserve its recognizable silhouette and proportions as the sign's shape.`;
}

function buildRequest({ designType, size, neonColor, imageBase64, imageMimeType }) {
  return {
    model: imageModel,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
          { text: buildInstruction({ designType, size, neonColor }) },
        ],
      },
    ],
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  };
}

module.exports = { buildRequest, buildInstruction };
