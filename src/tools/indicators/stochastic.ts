import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateStochastic } from "../../lib/indicators/stochastic.js";
import { defineTool } from "../types.js";

// ─── get_stochastic — 스토캐스틱 (Slow/Fast) ───────────────────────────────────────

export const stochasticTool = defineTool({
  name: "get_stochastic",
  title: "스토캐스틱 계산",
  kind: "read",
  description:
    "종목의 Slow Stochastic을 계산합니다. %K, %D, 과매수(≥80)/과매도(≤20) 구간, 크로스오버 신호를 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe("봉 단위"),
    k_period: period.optional().describe("%K 기간 (기본값 14)"),
    smooth_k: period.optional().describe("%K 평활 기간, 1이면 Fast Stochastic (기본값 3)"),
    d_period: period.optional().describe("%D 기간 (기본값 3)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const stochInterval = parseInterval(args.interval);
    const kPeriod = Number(args.k_period ?? 14);
    const smoothK = Number(args.smooth_k ?? 3);
    const dPeriod = Number(args.d_period ?? 3);
    const candles = await loadCandles(symbol, stochInterval, (kPeriod + smoothK + dPeriod) * 3);
    const minReq = kPeriod + smoothK + dPeriod - 2;
    if (candles.length < minReq)
      throw new Error(`스토캐스틱 계산 데이터 부족. 필요: ${minReq}개, 조회됨: ${candles.length}개`);
    const stochData = calculateStochastic(candles, kPeriod, smoothK, dPeriod);
    const results = stochData.map((d, i) => {
      const prev = i > 0 ? stochData[i - 1] : null;
      const crossover: "bullish" | "bearish" | null =
        d.d !== null && prev !== null && prev.d !== null
          ? prev.k < prev.d && d.k >= d.d
            ? "bullish"
            : prev.k > prev.d && d.k <= d.d
              ? "bearish"
              : null
          : null;
      return {
        time: candles[d.time_index].time,
        k: round(d.k, 2),
        d: d.d !== null ? round(d.d, 2) : null,
        zone: d.k >= 80 ? "overbought" : d.k <= 20 ? "oversold" : "neutral",
        ...(crossover !== null && { crossover }),
      };
    });
    const latest = last(results);
    return {
      symbol,
      interval: stochInterval,
      k_period: kPeriod,
      smooth_k: smoothK,
      d_period: dPeriod,
      candle_count: candles.length,
      stochastic_count: results.length,
      latest_k: latest?.k ?? null,
      latest_d: latest?.d ?? null,
      latest_zone: latest?.zone ?? null,
      stochastic: results,
    };
  },
});
