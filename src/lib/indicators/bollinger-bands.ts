import { mean, meanBy } from "es-toolkit";
// ─── 볼린저 밴드 ────────────────────────────────────────────────────────────────────

export function calculateBollingerBands(
  prices: number[],
  period: number,
  multiplier: number,
): { price_index: number; middle: number; upper: number; lower: number; percent_b: number; bandwidth: number }[] {
  const results = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const middle = mean(slice);
    const variance = meanBy(slice, (p) => (p - middle) ** 2);
    const stdDev = Math.sqrt(variance);
    const upper = middle + multiplier * stdDev;
    const lower = middle - multiplier * stdDev;
    const range = upper - lower;
    results.push({
      price_index: i,
      middle,
      upper,
      lower,
      percent_b: range === 0 ? 0.5 : (prices[i] - lower) / range,
      bandwidth: range === 0 ? 0 : range / middle,
    });
  }
  return results;
}
