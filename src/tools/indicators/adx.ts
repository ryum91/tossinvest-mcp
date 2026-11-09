import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateADX } from "../../lib/indicators/adx.js";
import { defineTool } from "../types.js";

// ─── get_adx — ADX / +DI / -DI (평균 방향성 지수) ────────────────────────────────────

export const adxTool = defineTool({
  name: "get_adx",
  title: "ADX 계산",
  kind: "read",
  description:
    "종목의 ADX(평균 방향성 지수)를 계산합니다. ADX≥25이면 강한 추세, +DI>-DI이면 상승 추세. 추세/횡보 판별로 전략 전환에 활용됩니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe("봉 단위"),
    period: period.optional().describe("기간 (기본값 14)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const adxInterval = parseInterval(args.interval);
    const period = Number(args.period ?? 14);
    const candles = await loadCandles(symbol, adxInterval, Math.max(period * 6, 150));
    if (candles.length < 2 * period + 1)
      throw new Error(`ADX 계산 데이터 부족. 필요: ${2 * period + 1}개, 조회됨: ${candles.length}개`);
    const adxData = calculateADX(candles, period);
    const results = adxData.map((d) => ({
      time: candles[d.time_index].time,
      adx: round(d.adx, 2),
      plus_di: round(d.plus_di, 2),
      minus_di: round(d.minus_di, 2),
      trend_strength: d.adx >= 25 ? "strong" : "weak",
      direction: d.plus_di > d.minus_di ? "bullish" : d.plus_di < d.minus_di ? "bearish" : "neutral",
    }));
    const latest = last(results);
    return {
      symbol,
      interval: adxInterval,
      period,
      candle_count: candles.length,
      adx_count: results.length,
      latest_adx: latest?.adx ?? null,
      latest_plus_di: latest?.plus_di ?? null,
      latest_minus_di: latest?.minus_di ?? null,
      latest_trend_strength: latest?.trend_strength ?? null,
      latest_direction: latest?.direction ?? null,
      adx: results,
    };
  },
});
