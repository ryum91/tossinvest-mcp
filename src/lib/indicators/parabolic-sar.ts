import type { Candle } from "../candles.js";

// ─── Parabolic SAR ─────────────────────────────────────────────────────────────

export function calculateParabolicSAR(
  candles: Candle[],
  initialAF: number,
  step: number,
  maxAF: number,
): { time_index: number; sar: number; trend: "bullish" | "bearish"; reversal: boolean }[] {
  if (candles.length < 2) return [];
  let isBullish = candles[1].close > candles[0].close;
  let af = initialAF;
  let ep = isBullish ? candles[0].high : candles[0].low;
  let sar = isBullish ? candles[0].low : candles[0].high;
  const results: { time_index: number; sar: number; trend: "bullish" | "bearish"; reversal: boolean }[] = [];
  for (let i = 1; i < candles.length; i++) {
    sar = sar + af * (ep - sar);
    let reversal = false;
    if (isBullish) {
      sar = i >= 2 ? Math.min(sar, candles[i - 1].low, candles[i - 2].low) : Math.min(sar, candles[i - 1].low);
      if (candles[i].low <= sar) {
        isBullish = false;
        sar = ep;
        ep = candles[i].low;
        af = initialAF;
        reversal = true;
      } else if (candles[i].high > ep) {
        ep = candles[i].high;
        af = Math.min(af + step, maxAF);
      }
    } else {
      sar = i >= 2 ? Math.max(sar, candles[i - 1].high, candles[i - 2].high) : Math.max(sar, candles[i - 1].high);
      if (candles[i].high >= sar) {
        isBullish = true;
        sar = ep;
        ep = candles[i].high;
        af = initialAF;
        reversal = true;
      } else if (candles[i].low < ep) {
        ep = candles[i].low;
        af = Math.min(af + step, maxAF);
      }
    }
    results.push({ time_index: i, sar, trend: isBullish ? "bullish" : "bearish", reversal });
  }
  return results;
}
