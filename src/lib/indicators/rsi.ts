import { meanBy, round } from "es-toolkit";
// ─── RSI (상대강도지수, Wilder 평활) ───────────────────────────────────────────────────

// Wilder's smoothing RSI
export function calculateRSI(prices: number[], period: number): { time_index: number; rsi: number }[] {
  if (prices.length < period + 1) return [];

  const deltas = prices.slice(1).map((p, i) => p - prices[i]);

  // seed averages using simple mean of first `period` deltas
  let avgGain = meanBy(deltas.slice(0, period), (d) => Math.max(d, 0));
  let avgLoss = meanBy(deltas.slice(0, period), (d) => Math.max(-d, 0));

  const results: { time_index: number; rsi: number }[] = [];
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  results.push({ time_index: period, rsi: round(firstRsi, 2) });

  for (let i = period; i < deltas.length; i++) {
    const gain = Math.max(deltas[i], 0);
    const loss = Math.max(-deltas[i], 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    results.push({ time_index: i + 1, rsi: round(rsi, 2) });
  }

  return results;
}
