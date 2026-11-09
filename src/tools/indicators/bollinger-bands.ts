import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf, number } from "../../lib/schema.js";
import { loadCandles, parseInterval, getPrice } from "../../lib/candles.js";
import type { PriceField } from "../../lib/candles.js";
import { calculateBollingerBands } from "../../lib/indicators/bollinger-bands.js";
import { defineTool } from "../types.js";

// ─── get_bollinger_bands — 볼린저 밴드 ─────────────────────────────────────────────

export const bollingerBandsTool = defineTool({
  name: "get_bollinger_bands",
  title: "볼린저 밴드 계산",
  kind: "read",
  description: "종목의 볼린저 밴드를 계산합니다. 중간선(SMA), 상단·하단 밴드, %B(현재가 위치), 밴드폭을 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe(
      "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
    ),
    period: period.optional().describe("SMA 기간 (기본값 20)"),
    multiplier: number({ gt: 0, max: 10 }).optional().describe("표준편차 배수 (기본값 2)"),
    price_field: enumOf(["close", "open", "high", "low", "hl_avg", "hlc_avg", "ohlc_avg"])
      .optional()
      .describe("계산 기준가 (기본값 close)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const bbInterval = parseInterval(args.interval);
    const period = Number(args.period ?? 20);
    const multiplier = Number(args.multiplier ?? 2);
    const priceField: PriceField = (args.price_field as PriceField) ?? "close";

    const candles = await loadCandles(symbol, bbInterval, period * 2);

    if (candles.length < period) {
      throw new Error(
        `볼린저 밴드 계산에 필요한 데이터가 부족합니다. 필요: ${period}개, 조회됨: ${candles.length}개 (${bbInterval} 봉)`,
      );
    }

    const prices = candles.map((c) => getPrice(c, priceField));
    const bbData = calculateBollingerBands(prices, period, multiplier);

    const results = bbData.map((d) => ({
      time: candles[d.price_index].time,
      upper: round(d.upper, 2),
      middle: round(d.middle, 2),
      lower: round(d.lower, 2),
      percent_b: round(d.percent_b, 4),
      bandwidth: round(d.bandwidth, 4),
    }));

    const latest = last(results);
    return {
      symbol,
      interval: bbInterval,
      period,
      multiplier,
      price_field: priceField,
      candle_count: candles.length,
      bb_count: results.length,
      latest_upper: latest?.upper ?? null,
      latest_middle: latest?.middle ?? null,
      latest_lower: latest?.lower ?? null,
      latest_percent_b: latest?.percent_b ?? null,
      latest_bandwidth: latest?.bandwidth ?? null,
      bollinger_bands: results,
    };
  },
});
