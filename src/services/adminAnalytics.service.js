// Orchestrator for the admin AI Insights agent, tying the three stages
// together: classify+extract (Stage 1) -> deterministic tool (Stage 2) ->
// narrate (Stage 3). Fully stateless — nothing is persisted between
// requests, matching the "transient chat history" design decision.
const adminAnalyticsGuardService = require('./adminAnalyticsGuard.service');
const adminAnalyticsToolsService = require('./adminAnalyticsTools.service');
const adminAnalyticsPromptService = require('./adminAnalyticsPrompt.service');
const { genAI } = require('../config/gemini');

const NARRATION_FAILURE_REPLY = "Here's the data — I couldn't put together a written summary just now.";

const TOOLS = {
  revenue_trend: adminAnalyticsToolsService.runRevenueTrend,
  top_products: adminAnalyticsToolsService.runTopProducts,
  sales_projection: adminAnalyticsToolsService.runSalesProjection,
};

function parseNarration(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed.reply === 'string' && parsed.reply ? parsed.reply : NARRATION_FAILURE_REPLY;
  } catch (err) {
    console.error('[adminAnalytics.service] failed to parse Gemini JSON response', err);
    return NARRATION_FAILURE_REPLY;
  }
}

// Narration can fail for reasons entirely outside our control (upstream
// quota/rate limits, transient network errors, missing API key). Degrade to
// a generic reply rather than a raw 500 — the already-computed `data` is
// still returned either way, same philosophy as assistant.service.js#generateReply.
async function narrate({ message, history, intent, data }) {
  try {
    const request = adminAnalyticsPromptService.buildRequest({ message, history, intent, data });
    const response = await genAI.models.generateContent(request);
    return parseNarration(response.text || '');
  } catch (err) {
    console.error('[adminAnalytics.service] narrate failed', err);
    return NARRATION_FAILURE_REPLY;
  }
}

async function query({ message, history = [] }) {
  const { intent, params } = await adminAnalyticsGuardService.classifyAndExtract(message, history);

  if (intent === 'out_of_scope') {
    return { intent: 'out_of_scope', reply: adminAnalyticsGuardService.declineMessage(), data: null };
  }

  const data = await TOOLS[intent](params);
  const reply = await narrate({ message, history, intent, data });

  return { intent, reply, data };
}

module.exports = { query };
