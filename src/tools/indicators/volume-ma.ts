import { last, meanBy, round } from "es-toolkit";
import { z } from "zod";
import { symbol, period, enumOf, number } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { defineTool } from "../types.js";

// ─── get_volume_ma — 거래량 이동평균 ─────────────────────────────────────────────────

export const volumeMaTool = defineTool({
  name: "get_volume_ma",
  title: "거래량 이동평균 계산",
  kind: "read",
  description: "종목의 거래량 이동평균을 계산합니다. 현재/평균 거래량 비율로 급등 거래량을 감지합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe("봉 단위"),
    period: period.optional().describe("이동평균 기간 (기본값 20)"),
    spike_threshold: number({ gt: 0 }).optional().describe("거래량 급등 판단 비율 (기본값 2.0, 평균 대비 2배 이상)"),
  }),
  handler: async (args) => {
    const symbol = String(args.symbol);
    const volInterval = parseInterval(args.interval);
    const period = Number(args.period ?? 20);
    const spikeThreshold = Number(args.spike_threshold ?? 2.0);
    const candles = await loadCandles(symbol, volInterval, period * 3);
    if (candles.length < period)
      throw new Error(`거래량 이동평균 계산 데이터 부족. 필요: ${period}개, 조회됨: ${candles.length}개`);
    const results = candles.slice(period - 1).map((c, i) => {
      const volume_ma = Math.round(meanBy(candles.slice(i, i + period), (s) => s.volume));
      const ratio = volume_ma > 0 ? round(c.volume / volume_ma, 2) : 0;
      return { time: c.time, volume: c.volume, volume_ma, ratio, spike: ratio >= spikeThreshold };
    });
    const latest = last(results);
    return {
      symbol,
      interval: volInterval,
      period,
      spike_threshold: spikeThreshold,
      candle_count: candles.length,
      volume_count: results.length,
      latest_volume: latest?.volume ?? null,
      latest_volume_ma: latest?.volume_ma ?? null,
      latest_ratio: latest?.ratio ?? null,
      latest_spike: latest?.spike ?? null,
      spike_count: results.filter((r) => r.spike).length,
      volume_ma: results,
    };
  },
});
