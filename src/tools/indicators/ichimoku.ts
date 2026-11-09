import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateIchimoku } from "../../lib/indicators/ichimoku.js";
import { defineTool } from "../types.js";

// ─── get_ichimoku — 일목균형표 ─────────────────────────────────────────────────────

export const ichimokuTool = defineTool({
  name: "get_ichimoku",
  title: "일목균형표 계산",
  kind: "read",
  description:
    "종목의 일목균형표를 계산합니다. 전환선·기준선·선행스팬1·2·후행스팬과 구름(kumo) 방향, 향후 displacement 기간의 구름 예측을 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe(
      "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
    ),
    tenkan_period: period.optional().describe("전환선 기간 (기본값 9)"),
    kijun_period: period.optional().describe("기준선 기간 (기본값 26)"),
    senkou_b_period: period.optional().describe("선행스팬2 기간 (기본값 52)"),
    displacement: period.optional().describe("선행·후행 이동 기간 (기본값 26)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const ichiInterval = parseInterval(args.interval);
    const tenkanPeriod = Number(args.tenkan_period ?? 9);
    const kijunPeriod = Number(args.kijun_period ?? 26);
    const senkouBPeriod = Number(args.senkou_b_period ?? 52);
    const displacement = Number(args.displacement ?? 26);

    const candles = await loadCandles(symbol, ichiInterval, (kijunPeriod + senkouBPeriod + displacement) * 2);

    const minRequired = kijunPeriod + senkouBPeriod + displacement - 1;
    if (candles.length < minRequired) {
      throw new Error(
        `일목균형표 계산에 필요한 데이터가 부족합니다. 필요: ${minRequired}개, 조회됨: ${candles.length}개 (${ichiInterval} 봉)`,
      );
    }

    const { results: raw, forecast: rawForecast } = calculateIchimoku(
      candles,
      tenkanPeriod,
      kijunPeriod,
      senkouBPeriod,
      displacement,
    );

    const ichimoku = raw
      .filter((d) => d.tenkan !== null || d.kijun !== null)
      .map((d) => {
        const cloud =
          d.senkou_a !== null && d.senkou_b !== null
            ? d.senkou_a > d.senkou_b
              ? "bullish"
              : d.senkou_a < d.senkou_b
                ? "bearish"
                : "neutral"
            : null;
        return {
          time: candles[d.time_index].time,
          ...(d.tenkan !== null && { tenkan: round(d.tenkan, 2) }),
          ...(d.kijun !== null && { kijun: round(d.kijun, 2) }),
          ...(d.chikou !== null && { chikou: round(d.chikou, 2) }),
          ...(d.senkou_a !== null && { senkou_a: round(d.senkou_a, 2) }),
          ...(d.senkou_b !== null && { senkou_b: round(d.senkou_b, 2) }),
          ...(cloud !== null && { cloud }),
        };
      });

    const cloud_forecast = rawForecast.map((f) => {
      const cloud =
        f.senkou_a !== null && f.senkou_b !== null
          ? f.senkou_a > f.senkou_b
            ? "bullish"
            : f.senkou_a < f.senkou_b
              ? "bearish"
              : "neutral"
          : null;
      return {
        periods_ahead: f.periods_ahead,
        ...(f.senkou_a !== null && { senkou_a: round(f.senkou_a, 2) }),
        ...(f.senkou_b !== null && { senkou_b: round(f.senkou_b, 2) }),
        ...(cloud !== null && { cloud }),
      };
    });

    const latest = last(ichimoku);
    return {
      symbol,
      interval: ichiInterval,
      tenkan_period: tenkanPeriod,
      kijun_period: kijunPeriod,
      senkou_b_period: senkouBPeriod,
      displacement,
      candle_count: candles.length,
      ichimoku_count: ichimoku.length,
      latest_tenkan: latest?.tenkan ?? null,
      latest_kijun: latest?.kijun ?? null,
      latest_cloud: latest?.cloud ?? null,
      cloud_forecast,
      ichimoku,
    };
  },
});
