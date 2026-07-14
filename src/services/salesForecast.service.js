// Pure ordinary-least-squares forecast — no I/O, no Gemini. This is the one
// piece of real algorithmic logic behind the "sales_projection" intent; the
// LLM never sees or produces these numbers (adminAnalyticsTools.service.js
// calls this directly and hands the result to the narration step as
// reference-only data).
function linearForecast(values, horizon) {
  const n = values.length;
  if (n < 3) {
    return { insufficientData: true, projection: [], slope: null, intercept: null, r2: null };
  }

  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = slope * xs[i] + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  const projection = [];
  for (let step = 1; step <= horizon; step += 1) {
    const x = n - 1 + step;
    const predicted = slope * x + intercept;
    projection.push(Math.max(0, predicted)); // revenue can't be negative
  }

  return { insufficientData: false, slope, intercept, r2, projection };
}

module.exports = { linearForecast };
