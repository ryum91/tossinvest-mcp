import { mean } from "es-toolkit";
// ─── EMA (지수이동평균) ──────────────────────────────────────────────────────────────

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const seed = mean(prices.slice(0, period)); // SMA 로 시드
  const ema = [seed];
  for (let i = period; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}
