// params: { basePrice, unitSizeInches, pricePerExtraUnit, wattsPerUnit }
// input:  { sizeInches }
// Base price covers the first unitSizeInches (minimum length); each
// additional whole-or-partial unit adds pricePerExtraUnit. wattsPerUnit
// feeds power-supply wattage gating (pricing.service.js) — it does not
// affect price directly.
function computeBase({ params, input }) {
  const unitSizeInches = Number(params.unitSizeInches);
  if (!(unitSizeInches > 0)) throw new Error('linearPerUnit: unitSizeInches must be > 0');

  const sizeInches = Number(input.sizeInches);
  if (!(sizeInches > 0)) throw new Error('linearPerUnit: sizeInches must be > 0');
  if (sizeInches < unitSizeInches) {
    throw new Error(`linearPerUnit: sizeInches must be at least ${unitSizeInches}`);
  }

  const units = Math.ceil(sizeInches / unitSizeInches);
  const basePrice = Number(params.basePrice) + Math.max(0, units - 1) * Number(params.pricePerExtraUnit);
  const totalWatts = units * Number(params.wattsPerUnit);

  return { units, basePrice, totalWatts };
}

module.exports = { computeBase };
