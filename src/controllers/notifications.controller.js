const notificationModel = require('../models/notification.model');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const listNotifications = asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  const [items, countRow, unreadRow] = await Promise.all([
    notificationModel.list({ unreadOnly, limit: pageSize, offset: (page - 1) * pageSize }),
    notificationModel.count({ unreadOnly }),
    notificationModel.countUnread(),
  ]);

  res.status(200).json({ items, total: Number(countRow.count), unreadCount: Number(unreadRow.count) });
});

const markRead = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await notificationModel.findById(id);
  if (!existing) throw ApiError.notFound('Notification not found');
  const notification = await notificationModel.markRead(id);
  res.status(200).json(notification);
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationModel.markAllRead();
  res.status(204).end();
});

module.exports = { listNotifications, markRead, markAllRead };
