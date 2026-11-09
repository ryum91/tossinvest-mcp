import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateMACD } from "../../lib/indicators/macd.js";
import { defineTool } from "../types.js";

// ─── get_macd — MACD (이동평균 수렴확산) ──────────────────────────────────────────────

export const macdTool = defineTool({
  name: "get_macd",
  title: "MACD 계산",
  kind: "read",
  description:
    "종목의 MACD(이동평균 수렴확산)를 계산합니다. MACD 라인, 시그널 라인, 히스토그램, 크로스오버 신호를 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe(
      "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
    ),
    fast_period: period.optional().describe("빠른 EMA 기간 (기본값 12)"),
    slow_period: period.optional().describe("느린 EMA 기간 (기본값 26)"),
    signal_period: period.optional().describe("시그널 라인 기간 (기본값 9)"),
  }),
  validate: (a, errors) => {
    if (a.fast_period !== undefined || a.slow_period !== undefined) {
      const fast = Number(a.fast_period ?? 12);
      const slow = Number(a.slow_period ?? 26);
      if (fast >= slow) errors.push(`fast_period: slow_period(${slow}) 보다 작아야 합니다 (입력: ${fast})`);
    }
  },
  handler: async (args) => {
    const symbol = String(args.symbol);
    const macdInterval = parseInterval(args.interval);
    const fast = Number(args.fast_period ?? 12);
    const slow = Number(args.slow_period ?? 26);
    const signal = Number(args.signal_period ?? 9);
    if (!(fast > 0 && slow > fast && signal > 0)) {
      throw new Error("MACD 기간은 0 < fast_period < slow_period, signal_period > 0 이어야 합니다.");
    }

    const candles = await loadCandles(symbol, macdInterval, Math.max((slow + signal) * 3, 150));

    if (candles.length < slow + signal - 1) {
      throw new Error(
        `MACD 계산에 필요한 데이터가 부족합니다. 필요: ${slow + signal - 1}개, 조회됨: ${candles.length}개 (${macdInterval} 봉)`,
      );
    }

    const prices = candles.map((c) => c.close);
    const macdData = calculateMACD(prices, fast, slow, signal);

    const results = macdData.map((d, i) => {
      const prev = i > 0 ? macdData[i - 1] : null;
      const crossover =
        prev !== null
          ? prev.macd < prev.signal && d.macd >= d.signal
            ? "bullish"
            : prev.macd > prev.signal && d.macd <= d.signal
              ? "bearish"
              : null
          : null;
      return {
        time: candles[d.price_index].time,
        macd: round(d.macd, 2),
        signal: round(d.signal, 2),
        histogram: round(d.histogram, 2),
        ...(crossover !== null && { crossover }),
      };
    });

    const latest = last(results);
    return {
      symbol,
      interval: macdInterval,
      fast_period: fast,
      slow_period: slow,
      signal_period: signal,
      candle_count: candles.length,
      macd_count: results.length,
      latest_macd: latest?.macd ?? null,
      latest_signal: latest?.signal ?? null,
      latest_histogram: latest?.histogram ?? null,
      macd: results,
    };
  },
});
