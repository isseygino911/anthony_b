const db = require('../config/db');
const productModel = require('../models/product.model');
const productOptionGroupModel = require('../models/productOptionGroup.model');
const productOptionChoiceModel = require('../models/productOptionChoice.model');
const ApiError = require('../utils/apiError');

function parseJsonColumn(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function shapeChoice(row) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    priceDelta: Number(row.price_delta),
    extra: parseJsonColumn(row.extra),
    sortOrder: row.sort_order,
  };
}

function shapeGroup(row, choices) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    sortOrder: row.sort_order,
    choices: choices.map(shapeChoice),
  };
}

// Returns the product's option groups + choices, shaped for both the admin
// product form (editing) and the storefront product detail page (customer
// selection) — same shape serves both, per-field access control isn't
// needed here since price deltas are not sensitive.
async function getOptionsForProduct(productId, trx = db) {
  const groups = await productOptionGroupModel.listByProductId(productId, trx);
  if (!groups.length) return [];
  const groupIds = groups.map((g) => g.id);
  const choices = await productOptionChoiceModel.listByGroupIds(groupIds, trx);
  const choicesByGroupId = new Map();
  choices.forEach((choice) => {
    const list = choicesByGroupId.get(choice.option_group_id) || [];
    list.push(choice);
    choicesByGroupId.set(choice.option_group_id, list);
  });
  return groups.map((group) => shapeGroup(group, choicesByGroupId.get(group.id) || []));
}

// Full replace, mirrors productGroupItem.model.js's setGroupsForProduct
// pattern — admin submits the complete desired option-group list each save,
// we delete-and-reinsert inside one transaction rather than diffing.
async function setOptionsForProduct(productId, groups) {
  const product = await productModel.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  await db.transaction(async (trx) => {
    // ON DELETE CASCADE on product_option_choices.option_group_id (see
    // migrations/032) removes the choices automatically when groups are deleted.
    await productOptionGroupModel.deleteByProductId(productId, trx);
    if (!groups.length) return;

    const groupIds = await productOptionGroupModel.insertGroups(productId, groups, trx);
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < groups.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await productOptionChoiceModel.insertChoices(groupIds[i], groups[i].choices || [], trx);
    }
  });

  return getOptionsForProduct(productId);
}

module.exports = {
  getOptionsForProduct,
  setOptionsForProduct,
};
