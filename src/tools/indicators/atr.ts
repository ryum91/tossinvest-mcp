import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateATR } from "../../lib/indicators/atr.js";
import { defineTool } from "../types.js";

// ─── get_atr — ATR (평균 실제 범위, Wilder 평활) ──────────────────────────────────────

export const atrTool = defineTool({
  name: "get_atr",
  title: "ATR 계산",
  kind: "read",
  description:
    "종목의 ATR(평균 실제 범위)을 계산합니다. Wilder 평활법 사용. 변동성 측정으로 포지션 사이징과 스탑로스 거리 자동 설정에 활용됩니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe("봉 단위"),
    period: period.optional().describe("기간 (기본값 14)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const atrInterval = parseInterval(args.interval);
    const period = Number(args.period ?? 14);
    const candles = await loadCandles(symbol, atrInterval, Math.max(period * 4, 100));
    if (candles.length < period + 1)
      throw new Error(`ATR 계산 데이터 부족. 필요: ${period + 1}개, 조회됨: ${candles.length}개`);
    const atrData = calculateATR(candles, period);
    const results = atrData.map((d) => ({
      time: candles[d.time_index].time,
      atr: round(d.atr, 2),
      atr_percent: round((d.atr / candles[d.time_index].close) * 100, 2),
    }));
    const latest = last(results);
    return {
      symbol,
      interval: atrInterval,
      period,
      candle_count: candles.length,
      atr_count: results.length,
      latest_atr: latest?.atr ?? null,
      latest_atr_percent: latest?.atr_percent ?? null,
      atr: results,
    };
  },
});
