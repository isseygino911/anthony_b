const flat = require('./flat');
const linearPerUnit = require('./linearPerUnit');

// Registry of known base-price formula types. New formula shapes are added
// here (one small module + one entry) — never as admin-editable expressions,
// per the pricing design: admins configure params/options, not formulas.
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
