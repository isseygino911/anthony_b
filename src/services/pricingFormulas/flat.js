// params: { basePrice }
// No size input — every unit costs the same flat basePrice. The trivial
// formula type: exists so a configurable product with no size dimension
// (only option-group add-ons) doesn't need a special case in pricing.service.js.
function computeBase({ params }) {
  return { units: 1, basePrice: Number(params.basePrice), totalWatts: 0 };
}

module.exports = { computeBase };
