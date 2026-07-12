const orderModel = require('../models/order.model');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const getRevenue = asyncHandler(async (req, res) => {
  const { granularity = 'daily', from, to } = req.query;
  if (!['daily', 'monthly'].includes(granularity)) {
    throw ApiError.badRequest('granularity must be "daily" or "monthly"');
  }

  const rows = await orderModel.getRevenueSeries(granularity, from, to);
  const series = rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue) || 0,
    orderCount: Number(row.orderCount),
  }));

  res.status(200).json({ series });
});

module.exports = { getRevenue };
