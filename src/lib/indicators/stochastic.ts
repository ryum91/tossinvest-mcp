import { mean } from "es-toolkit";
import type { Candle } from "../candles.js";

// ─── 스토캐스틱 (Slow/Fast) ─────────────────────────────────────────────────────────

export function calculateStochastic(
  candles: Candle[],
  kPeriod: number,
  smoothK: number,
  dPeriod: number,
): { time_index: number; k: number; d: number | null }[] {
  if (candles.length < kPeriod + smoothK + dPeriod - 2) return [];
  const rawK = candles.slice(kPeriod - 1).map((c, i) => {
    const slice = candles.slice(i, i + kPeriod);
    const hi = Math.max(...slice.map((s) => s.high));
    const lo = Math.min(...slice.map((s) => s.low));
    return hi === lo ? 50 : ((c.close - lo) / (hi - lo)) * 100;
  });
  const smoothedK: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    smoothedK.push(mean(rawK.slice(i - smoothK + 1, i + 1)));
  }
  return smoothedK.map((k, i) => ({
    time_index: kPeriod + smoothK - 2 + i,
    k,
    d: i >= dPeriod - 1 ? mean(smoothedK.slice(i - dPeriod + 1, i + 1)) : null,
  }));
}
