const notificationModel = require('../models/notification.model');
const { resolveLowStockThreshold } = require('../utils/stockThreshold');

// architecture.md §7.2 — threshold-cross detection + insert, called inside
// the same transaction as the stock decrement in order.service.js.
async function checkAndNotifyLowStock(product, oldQuantity, newQuantity, trx) {
  const threshold = resolveLowStockThreshold(product);

  const crossedDown = newQuantity <= threshold && oldQuantity > threshold;
  if (!crossedDown) return;

  await notificationModel.insertNotification(
    {
      type: 'low_stock',
      productId: product.id,
      message: `${product.name} is low on stock (${newQuantity} remaining).`,
    },
    trx
  );
}

module.exports = { checkAndNotifyLowStock };
