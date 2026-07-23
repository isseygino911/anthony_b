const newsletterService = require('../services/newsletter.service');
const asyncHandler = require('../utils/asyncHandler');

const subscribe = asyncHandler(async (req, res) => {
  const result = await newsletterService.subscribe(req.body.email);
  res.status(201).json(result);
});

const listSubscribers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const result = await newsletterService.listSubscribers({ page, pageSize });
  res.status(200).json(result);
});

module.exports = { subscribe, listSubscribers };
