import { last } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateEMA } from "../../lib/indicators/ema.js";
import { calculateOBV } from "../../lib/indicators/obv.js";
import { defineTool } from "../types.js";

// ─── get_obv — OBV (누적 거래량) ───────────────────────────────────────────────────

export const obvTool = defineTool({
  name: "get_obv",
  title: "OBV 계산",
  kind: "read",
  description:
    "종목의 OBV(누적 거래량)를 계산합니다. 시그널 라인(EMA of OBV)과 비교해 거래량 기반 추세 방향을 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe("봉 단위"),
    signal_period: period.optional().describe("시그널 라인 기간 (기본값 20)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const obvInterval = parseInterval(args.interval);
    const signalPeriod = Number(args.signal_period ?? 20);
    const candles = await loadCandles(symbol, obvInterval, Math.max(signalPeriod * 3, 100));
    if (candles.length < signalPeriod + 1)
      throw new Error(`OBV 계산 데이터 부족. 필요: ${signalPeriod + 1}개, 조회됨: ${candles.length}개`);
    const obvValues = calculateOBV(candles);
    const signalValues = calculateEMA(obvValues, signalPeriod);
    const signalOffset = signalPeriod - 1;
    const results = candles.map((c, i) => {
      const obv = obvValues[i];
      const signal = i >= signalOffset ? Math.round(signalValues[i - signalOffset]) : null;
      return {
        time: c.time,
        obv,
        signal,
        trend: signal !== null ? (obv > signal ? "bullish" : obv < signal ? "bearish" : "neutral") : null,
      };
    });
    const latest = last(results);
    return {
      symbol,
      interval: obvInterval,
      signal_period: signalPeriod,
      candle_count: candles.length,
      latest_obv: latest?.obv ?? null,
      latest_signal: latest?.signal ?? null,
      latest_trend: latest?.trend ?? null,
      obv: results,
    };
  },
});
