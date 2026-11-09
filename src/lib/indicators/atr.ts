import { mean } from "es-toolkit";
import type { Candle } from "../candles.js";

// ─── ATR (평균 실제 범위, Wilder 평활) ─────────────────────────────────────────────────

export function calculateATR(candles: Candle[], period: number): { time_index: number; atr: number }[] {
  if (candles.length < period + 1) return [];
  const tr = candles
    .slice(1)
    .map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)));
  let atr = mean(tr.slice(0, period));
  const results: { time_index: number; atr: number }[] = [{ time_index: period, atr }];
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    results.push({ time_index: i + 1, atr });
  }
  return results;
}
