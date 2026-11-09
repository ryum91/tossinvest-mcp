import type { Candle } from "../candles.js";

// ─── OBV (누적 거래량) ──────────────────────────────────────────────────────────────

export function calculateOBV(candles: Candle[]): number[] {
  const obv = [candles[0].volume];
  for (let i = 1; i < candles.length; i++) {
    const prev = obv[i - 1];
    obv.push(
      candles[i].close > candles[i - 1].close
        ? prev + candles[i].volume
        : candles[i].close < candles[i - 1].close
          ? prev - candles[i].volume
          : prev,
    );
  }
  return obv;
}
