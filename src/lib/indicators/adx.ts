import { mean, sum } from "es-toolkit";
import type { Candle } from "../candles.js";

// ─── ADX / +DI / -DI (평균 방향성 지수) ───────────────────────────────────────────────

export function calculateADX(
  candles: Candle[],
  period: number,
): { time_index: number; adx: number; plus_di: number; minus_di: number }[] {
  if (candles.length < 2 * period + 1) return [];
  const plusDM: number[] = [],
    minusDM: number[] = [],
    tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM.push(up > 0 && up > dn ? up : 0);
    minusDM.push(dn > 0 && dn > up ? dn : 0);
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }
  const wilderSum = (arr: number[]): number[] => {
    let s = sum(arr.slice(0, period));
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };
  const sTR = wilderSum(tr),
    sPDM = wilderSum(plusDM),
    sMDM = wilderSum(minusDM);
  const plusDI = sPDM.map((v, i) => (sTR[i] === 0 ? 0 : (100 * v) / sTR[i]));
  const minusDI = sMDM.map((v, i) => (sTR[i] === 0 ? 0 : (100 * v) / sTR[i]));
  const dx = plusDI.map((p, i) => {
    const s = p + minusDI[i];
    return s === 0 ? 0 : (100 * Math.abs(p - minusDI[i])) / s;
  });
  let adx = mean(dx.slice(0, period));
  const results: { time_index: number; adx: number; plus_di: number; minus_di: number }[] = [
    { time_index: 2 * period - 1, adx, plus_di: plusDI[period - 1], minus_di: minusDI[period - 1] },
  ];
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    const j = i - period + 1;
    results.push({
      time_index: 2 * period - 1 + j,
      adx,
      plus_di: plusDI[period - 1 + j],
      minus_di: minusDI[period - 1 + j],
    });
  }
  return results;
}
