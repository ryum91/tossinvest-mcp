import { calculateEMA } from "./ema.js";

// ─── MACD (이동평균 수렴확산) ──────────────────────────────────────────────────────────

export function calculateMACD(
  prices: number[],
  fast: number,
  slow: number,
  signal: number,
): { price_index: number; macd: number; signal: number; histogram: number }[] {
  const fastEMA = calculateEMA(prices, fast);
  const slowEMA = calculateEMA(prices, slow);
  if (fastEMA.length === 0 || slowEMA.length === 0) return [];

  // fastEMA[i] → prices[fast-1+i], slowEMA[i] → prices[slow-1+i]
  const offset = slow - fast;
  const macdLine = slowEMA.map((s, i) => fastEMA[i + offset] - s);

  const signalLine = calculateEMA(macdLine, signal);
  if (signalLine.length === 0) return [];

  return signalLine.map((sig, j) => {
    const macdIdx = signal - 1 + j;
    const macd = macdLine[macdIdx];
    return { price_index: slow + signal - 2 + j, macd, signal: sig, histogram: macd - sig };
  });
}
