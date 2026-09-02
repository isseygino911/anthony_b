const customerNotificationService = require('../services/customerNotification.service');
const asyncHandler = require('../utils/asyncHandler');

const listMine = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await customerNotificationService.listMine(req.user.id, {
    unreadOnly: req.query.unreadOnly === 'true',
    page,
    pageSize,
  });
  res.status(200).json(result);
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await customerNotificationService.markRead(Number(req.params.id), req.user.id);
  res.status(200).json(notification);
});

const markAllRead = asyncHandler(async (req, res) => {
  await customerNotificationService.markAllRead(req.user.id);
  res.status(204).send();
});

module.exports = { listMine, markRead, markAllRead };
