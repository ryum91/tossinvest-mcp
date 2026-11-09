import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf, number } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateEMA } from "../../lib/indicators/ema.js";
import { calculateRSI } from "../../lib/indicators/rsi.js";
import { defineTool } from "../types.js";

// ─── get_rsi — RSI (상대강도지수, Wilder 평활) ────────────────────────────────────────

export const rsiTool = defineTool({
  name: "get_rsi",
  title: "RSI 계산",
  kind: "read",
  description:
    "종목의 RSI(상대강도지수)를 계산합니다. Wilder 평활법을 사용하며 과매수/과매도 구간, 시그널 라인(RSI의 EMA), 크로스오버 신호를 함께 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe(
      "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
    ),
    period: period.optional().describe("RSI 기간 (기본값 14)"),
    overbought: number({ min: 0, max: 100 })
      .optional()
      .describe("과매수 기준선, 이 값 이상이면 overbought (기본값 70)"),
    oversold: number({ min: 0, max: 100 }).optional().describe("과매도 기준선, 이 값 이하이면 oversold (기본값 30)"),
    signal_period: period
      .optional()
      .describe("시그널 라인 기간: RSI에 EMA를 적용해 크로스오버 신호를 생성 (선택사항, 예: 9)"),
  }),
  validate: (a, errors) => {
    if (Number(a.oversold ?? 30) >= Number(a.overbought ?? 70))
      errors.push(`oversold: overbought(${a.overbought ?? 70}) 보다 작아야 합니다 (입력: ${a.oversold ?? 30})`);
  },
  handler: async (args) => {
    const symbol = String(args.symbol);
    const rsiInterval = parseInterval(args.interval);
    const period = Number(args.period ?? 14);
    const overbought = Number(args.overbought ?? 70);
    const oversold = Number(args.oversold ?? 30);
    const signalPeriod = Number(args.signal_period ?? args.period ?? 14);

    const candles = await loadCandles(symbol, rsiInterval, Math.max((period + 1) * 3, 150));

    if (candles.length < period + 1) {
      throw new Error(
        `RSI 계산에 필요한 데이터가 부족합니다. 필요: ${period + 1}개, 조회됨: ${candles.length}개 (${rsiInterval} 봉)`,
      );
    }

    const prices = candles.map((c) => c.close);
    const rsiValues = calculateRSI(prices, period);

    // signal line: EMA of RSI values
    const signalOffset = signalPeriod - 1;
    const signalValues = calculateEMA(
      rsiValues.map((r) => r.rsi),
      signalPeriod,
    );

    const results = rsiValues.map(({ time_index, rsi }, i) => {
      const zone = rsi >= overbought ? "overbought" : rsi <= oversold ? "oversold" : "neutral";
      const signal = i >= signalOffset ? signalValues[i - signalOffset] : undefined;
      const prevSignal = i > signalOffset ? signalValues[i - signalOffset - 1] : undefined;
      const prevRsi = i > 0 ? rsiValues[i - 1].rsi : undefined;
      const crossover =
        signal !== undefined && prevSignal !== undefined && prevRsi !== undefined
          ? prevRsi < prevSignal && rsi >= signal
            ? "bullish"
            : prevRsi > prevSignal && rsi <= signal
              ? "bearish"
              : null
          : null;

      return {
        time: candles[time_index].time,
        rsi,
        zone,
        ...(signal !== undefined && { signal: round(signal, 2) }),
        ...(crossover !== null && { crossover }),
      };
    });

    const latest = last(results);
    return {
      symbol,
      interval: rsiInterval,
      period,
      overbought,
      oversold,
      midline: 50,
      signal_period: signalPeriod,
      candle_count: candles.length,
      rsi_count: results.length,
      latest_rsi: latest?.rsi ?? null,
      latest_zone: latest?.zone ?? null,
      ...(latest?.signal !== undefined && { latest_signal: latest.signal }),
      rsi: results,
    };
  },
});
