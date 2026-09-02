const customerNotificationModel = require('../models/customerNotification.model');
const ApiError = require('../utils/apiError');

// Read side of the customer notification bell. The write side lives with the
// flows that generate them (order.service.js), same as the admin
// notifications are written by the flows that raise them.
async function listMine(userId, { unreadOnly, page, pageSize }) {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const [items, countRow, unreadRow] = await Promise.all([
    customerNotificationModel.list(userId, { unreadOnly, limit, offset }),
    customerNotificationModel.count(userId, { unreadOnly }),
    customerNotificationModel.countUnread(userId),
  ]);

  return {
    items: items.map((row) => ({
      id: row.id,
      type: row.type,
      orderId: row.order_id,
      message: row.message,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
    })),
    total: Number(countRow.count),
    unreadCount: Number(unreadRow.count),
    page,
    pageSize,
  };
}

// The model scopes its UPDATE by user_id, so a mismatched id updates nothing
// and reads back undefined — reported as 404 rather than 403 so one customer
// cannot probe for another's notification ids.
async function markRead(id, userId) {
  const notification = await customerNotificationModel.markRead(id, userId);
  if (!notification) throw ApiError.notFound('Notification not found');
  return {
    id: notification.id,
    type: notification.type,
    orderId: notification.order_id,
    message: notification.message,
    isRead: Boolean(notification.is_read),
    createdAt: notification.created_at,
  };
}

function markAllRead(userId) {
  return customerNotificationModel.markAllRead(userId);
}

module.exports = { listMine, markRead, markAllRead };
