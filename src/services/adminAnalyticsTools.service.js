// Stage 2 of the admin analytics agent: the trust boundary. Every param
// coming out of adminAnalyticsGuard.service.js is raw model output and is
// never trusted directly — each function here clamps its own inputs before
// they touch a query, same discipline as assistant.service.js#resolveProducts
// re-fetching rather than trusting a model-returned ID.
const orderModel = require('../models/order.model');
const orderItemModel = require('../models/orderItem.model');
const salesForecastService = require('./salesForecast.service');

const PROJECTION_LOOKBACK_MONTHS = 12;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function monthsAgo(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

function nextMonthPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function runRevenueTrend(params = {}) {
  const granularity = params.granularity === 'daily' ? 'daily' : 'monthly';
  const rangeMonths = clampInt(params.rangeMonths, 1, 24, 12);
  const to = new Date();
  const from = monthsAgo(to, rangeMonths);

  const rows = await orderModel.getRevenueSeries(granularity, from, to);
  const series = rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue) || 0,
    orderCount: Number(row.orderCount) || 0,
  }));

  return { granularity, from: from.toISOString(), to: to.toISOString(), series };
}

async function runTopProducts(params = {}) {
  const metric = params.metric === 'revenue' ? 'revenue' : 'units';
  const limit = clampInt(params.limit, 1, 20, 5);
  const rangeMonths = clampInt(params.rangeMonths, 1, 24, 12);
  const to = new Date();
  const from = monthsAgo(to, rangeMonths);

  const rows = await orderItemModel.getTopProducts({ from, to, metric, limit });
  const items = rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    unitsSold: Number(row.unitsSold) || 0,
    revenue: Number(row.revenue) || 0,
  }));

  return { metric, limit, from: from.toISOString(), to: to.toISOString(), items };
}

async function runSalesProjection(params = {}) {
  const horizonMonths = clampInt(params.horizonMonths, 1, 6, 1);
  const to = new Date();
  const from = monthsAgo(to, PROJECTION_LOOKBACK_MONTHS);

  const rows = await orderModel.getRevenueSeries('monthly', from, to);
  const history = rows.map((row) => ({ period: row.period, revenue: Number(row.revenue) || 0 }));

  const forecast = salesForecastService.linearForecast(
    history.map((h) => h.revenue),
    horizonMonths
  );

  let projection = [];
  if (!forecast.insufficientData && history.length) {
    let period = history[history.length - 1].period;
    projection = forecast.projection.map((projectedRevenue) => {
      period = nextMonthPeriod(period);
      return { period, projectedRevenue };
    });
  }

  return {
    history,
    projection,
    model: { slope: forecast.slope, intercept: forecast.intercept, r2: forecast.r2 },
    insufficientData: forecast.insufficientData,
  };
}

module.exports = { runRevenueTrend, runTopProducts, runSalesProjection };
