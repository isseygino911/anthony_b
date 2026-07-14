// assistantGuard.service.classifyIntent — the pre-generation scope gate.
// config/gemini.js is stubbed the same way tests/helpers/isolateDb.js stubs
// config/db.js: pre-populating Node's require.cache for its exact resolved
// path before assistantGuard.service.js requires it, so no real network call
// to Gemini can happen in this suite.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const Module = require('module');

const GEMINI_CONFIG_PATH = require.resolve(path.join(__dirname, '..', 'src', 'config', 'gemini.js'));

const generateContent = vi.fn();
const fakeGeminiModule = new Module(GEMINI_CONFIG_PATH, module);
fakeGeminiModule.filename = GEMINI_CONFIG_PATH;
fakeGeminiModule.loaded = true;
fakeGeminiModule.exports = {
  genAI: { models: { generateContent } },
  isConfigured: true,
  embeddingModel: 'gemini-embedding-001',
  chatModel: 'gemini-2.5-flash',
};
require.cache[GEMINI_CONFIG_PATH] = fakeGeminiModule;

const assistantGuardService = require('../src/services/assistantGuard.service');

beforeEach(() => {
  generateContent.mockReset();
});

describe('assistantGuard.service.classifyIntent', () => {
  it('returns true for a clear YES response', async () => {
    generateContent.mockResolvedValue({ text: 'YES' });

    expect(await assistantGuardService.classifyIntent('I need an LED light for my bedroom')).toBe(true);
  });

  it('returns false for a clear NO response', async () => {
    generateContent.mockResolvedValue({ text: 'NO' });

    expect(await assistantGuardService.classifyIntent('write me a poem about the ocean')).toBe(false);
  });

  it('fails closed (false) for an ambiguous/garbage response', async () => {
    generateContent.mockResolvedValue({ text: "I'm not sure, maybe?" });

    expect(await assistantGuardService.classifyIntent('hmm')).toBe(false);
  });

  it('fails closed (false) when the Gemini call throws', async () => {
    generateContent.mockRejectedValue(new Error('network error'));

    expect(await assistantGuardService.classifyIntent('anything')).toBe(false);
  });
});

describe('assistantGuard.service.declineMessage', () => {
  it('returns a fixed, non-empty redirect string with no Gemini call', () => {
    const message = assistantGuardService.declineMessage();

    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
