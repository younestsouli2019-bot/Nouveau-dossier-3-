export function calculateUnitEconomics(gross, cogs = 0, rail = "paypal", feeRate = 0) {
  const g = Number(gross || 0);
  const c = Number(cogs || 0);
  const f = Number(feeRate || 0);
  const fees = g * f;
  const netProfit = g - c - fees;
  const margin = g > 0 ? netProfit / g : 0;
  return { rail, gross: g, cogs: c, fees, netProfit, margin };
}

export function enforceUnitEconomics(econ) {
  const minProfit = 5;
  const minMargin = 0.15;
  if (Number(econ.netProfit || 0) < minProfit) {
    throw new Error("UNIT_ECONOMICS_PROFIT_TOO_LOW");
  }
  if (Number(econ.margin || 0) < minMargin) {
    throw new Error("UNIT_ECONOMICS_MARGIN_TOO_LOW");
  }
  return true;
}
