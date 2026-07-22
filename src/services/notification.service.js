const notificationModel = require('../models/notification.model');
const customNeonDesignModel = require('../models/customNeonDesign.model');
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

// Called inside the same transaction as order creation (order.service.js),
// right alongside checkAndNotifyLowStock — fires only once a custom neon
// design is actually paid for/ordered, not merely previewed, so admins know
// exactly when a design needs manufacturing.
async function checkAndNotifyCustomDesignOrdered(product, trx) {
  const design = await customNeonDesignModel.findByProductId(product.id, trx);
  if (!design) return;

  await notificationModel.insertNotification(
    {
      type: 'custom_design_ordered',
      productId: product.id,
      message: `${product.name} was ordered and is ready to manufacture.`,
    },
    trx
  );
}

module.exports = { checkAndNotifyLowStock, checkAndNotifyCustomDesignOrdered };
