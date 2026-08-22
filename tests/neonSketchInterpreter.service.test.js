// The interpreter sits in front of image generation, so its contract is as
// much about failing safely as about succeeding: every unusable answer has to
// become null, because null means "generate the way it did before" while a
// half-parsed or low-confidence answer would replace the customer's drawing
// with the wrong subject entirely.
import { describe, it, expect } from 'vitest';
import {
  parseResponse,
  buildRequest,
  MIN_CONFIDENCE,
} from '../src/services/neonSketchInterpreter.service.js';

function responseWith(payload) {
  return { text: JSON.stringify(payload) };
}

const GOOD = {
  subject: 'a cartoon mouse mascot head with two large round ears',
  composition: 'head centred, two large circular ears at the top',
  confidence: 0.9,
};

describe('parseResponse', () => {
  it('returns the interpretation for a confident read', () => {
    expect(parseResponse(responseWith(GOOD))).toEqual({
      subject: GOOD.subject,
      composition: GOOD.composition,
      confidence: 0.9,
    });
  });

  it('reads the answer out of a candidates-shaped response', () => {
    const nested = {
      candidates: [{ content: { parts: [{ text: JSON.stringify(GOOD) }] } }],
    };
    expect(parseResponse(nested)?.subject).toBe(GOOD.subject);
  });

  it('discards a read below the confidence gate', () => {
    expect(parseResponse(responseWith({ ...GOOD, confidence: MIN_CONFIDENCE - 0.01 }))).toBeNull();
  });

  it('keeps a read exactly at the gate', () => {
    expect(parseResponse(responseWith({ ...GOOD, confidence: MIN_CONFIDENCE }))).not.toBeNull();
  });

  it('discards an empty or whitespace-only subject', () => {
    expect(parseResponse(responseWith({ ...GOOD, subject: '   ' }))).toBeNull();
  });

  it('treats a missing confidence as no confidence', () => {
    const { confidence, ...withoutConfidence } = GOOD;
    expect(parseResponse(responseWith(withoutConfidence))).toBeNull();
  });

  it('survives malformed JSON, empty and missing bodies', () => {
    expect(parseResponse({ text: 'not json at all' })).toBeNull();
    expect(parseResponse({})).toBeNull();
    expect(parseResponse(null)).toBeNull();
  });

  it('tolerates a composition the model left blank', () => {
    const result = parseResponse(responseWith({ ...GOOD, composition: '' }));
    expect(result?.subject).toBe(GOOD.subject);
    expect(result?.composition).toBe('');
  });
});

describe('buildRequest', () => {
  it('sends the image alongside a JSON-schema-constrained instruction', () => {
    const request = buildRequest({ imageBase64: 'AAAA', imageMimeType: 'image/png' });
    const parts = request.contents[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: 'image/png', data: 'AAAA' });
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.responseSchema.required).toContain('subject');
  });

  // Naming a trademarked character in the subject would push the image model
  // toward reproducing it; the brief has to stay a generic visual description.
  it('instructs the model not to name branded characters', () => {
    const { systemInstruction } = buildRequest({ imageBase64: 'A', imageMimeType: 'image/png' }).config;
    expect(systemInstruction).toMatch(/do NOT name that character/);
  });
});
