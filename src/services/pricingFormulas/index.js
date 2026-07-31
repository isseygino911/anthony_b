const flat = require('./flat');
const linearPerUnit = require('./linearPerUnit');

// Registry of fixed base-price formula shapes, each driven by numeric params
// an admin fills in. These stay because they are the better UX for the common
// cases, and existing products depend on their exact arithmetic.
//
// A product may instead set formulaType 'custom' and supply admin-authored
// expressions — see expression.js (the safe evaluator) and validateConfig.js.
// Custom formulas are handled directly in pricing.service.js, not here, since
// they need the resolved option choices as variables.
const REGISTRY = {
  flat,
  linear_per_unit: linearPerUnit,
};

function computeBase(formulaType, params, input) {
  const formula = REGISTRY[formulaType];
  if (!formula) throw new Error(`Unknown pricing formula_type: ${formulaType}`);
  return formula.computeBase({ params, input });
}

module.exports = { computeBase, REGISTRY };
