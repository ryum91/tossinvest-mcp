import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval, getPrice } from "../../lib/candles.js";
import type { PriceField } from "../../lib/candles.js";
import { calculateEMA } from "../../lib/indicators/ema.js";
import { defineTool } from "../types.js";

// ─── get_ema — EMA (지수이동평균) ───────────────────────────────────────────────────

export const emaTool = defineTool({
  name: "get_ema",
  title: "EMA 계산",
  kind: "read",
  description:
    "종목의 지수이동평균(EMA)을 계산합니다. 캔들 데이터를 기반으로 지정한 봉 단위·기간·계산 기준으로 EMA 시계열을 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe(
      "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
    ),
    period: period.describe("EMA 기간 (예: 5, 10, 20, 60, 120, 200)"),
    price_field: enumOf(["close", "open", "high", "low", "hl_avg", "hlc_avg", "ohlc_avg"])
      .optional()
      .describe(
        "계산 기준가. close(종가, 기본값), open(시가), high(고가), low(저가), hl_avg(고저평균), hlc_avg(고저종평균), ohlc_avg(시고저종평균)",
      ),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const emaInterval = parseInterval(args.interval);
    const period = Number(args.period);
    const priceField: PriceField = (args.price_field as PriceField) ?? "close";
    if (!Number.isInteger(period) || period < 1) throw new Error("period 는 1 이상의 정수여야 합니다.");

    const candles = await loadCandles(symbol, emaInterval, Math.max(period * 3, 150));

    if (candles.length < period) {
      throw new Error(
        `EMA 계산에 필요한 데이터가 부족합니다. 필요: ${period}개, 조회됨: ${candles.length}개 (${emaInterval} 봉)`,
      );
    }

    const prices = candles.map((c) => getPrice(c, priceField));
    const emaValues = calculateEMA(prices, period);

    const results = emaValues.map((value, i) => ({
      time: candles[period - 1 + i].time,
      ema: round(value, 2),
    }));

    return {
      symbol,
      interval: emaInterval,
      period,
      price_field: priceField,
      candle_count: candles.length,
      ema_count: results.length,
      latest_ema: last(results)?.ema ?? null,
      ema: results,
    };
  },
});
