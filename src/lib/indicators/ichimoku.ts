import type { Candle } from "../candles.js";

// ─── 일목균형표 ─────────────────────────────────────────────────────────────────────

export function calculateIchimoku(
  candles: Candle[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouBPeriod: number,
  displacement: number,
): {
  results: {
    time_index: number;
    tenkan: number | null;
    kijun: number | null;
    chikou: number | null;
    senkou_a: number | null;
    senkou_b: number | null;
  }[];
  forecast: { periods_ahead: number; senkou_a: number | null; senkou_b: number | null }[];
} {
  const n = candles.length;

  const rangeMiddle = (endIdx: number, period: number): number | null => {
    if (endIdx < period - 1) return null;
    let max = -Infinity,
      min = Infinity;
    for (let i = endIdx - period + 1; i <= endIdx; i++) {
      if (candles[i].high > max) max = candles[i].high;
      if (candles[i].low < min) min = candles[i].low;
    }
    return (max + min) / 2;
  };

  const tenkan = candles.map((_, i) => rangeMiddle(i, tenkanPeriod));
  const kijun = candles.map((_, i) => rangeMiddle(i, kijunPeriod));

  const results = candles.map((_, i) => {
    const senkouCalcIdx = i - displacement;
    const ft = senkouCalcIdx >= 0 ? tenkan[senkouCalcIdx] : null;
    const fk = senkouCalcIdx >= 0 ? kijun[senkouCalcIdx] : null;
    const senkou_a = ft !== null && fk !== null ? (ft + fk) / 2 : null;
    const senkou_b = senkouCalcIdx >= 0 ? rangeMiddle(senkouCalcIdx, senkouBPeriod) : null;
    const chikou = i + displacement < n ? candles[i + displacement].close : null;
    return { time_index: i, tenkan: tenkan[i], kijun: kijun[i], chikou, senkou_a, senkou_b };
  });

  // Future cloud: already deterministic from existing tenkan/kijun data
  const forecast = [];
  for (let j = 1; j <= displacement; j++) {
    const calcIdx = n - displacement - 1 + j;
    if (calcIdx < 0 || calcIdx >= n) continue;
    const ft = tenkan[calcIdx];
    const fk = kijun[calcIdx];
    const senkou_a = ft !== null && fk !== null ? (ft + fk) / 2 : null;
    const senkou_b = rangeMiddle(calcIdx, senkouBPeriod);
    forecast.push({ periods_ahead: j, senkou_a, senkou_b });
  }

  return { results, forecast };
}
