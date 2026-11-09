import { last, round } from "es-toolkit";
import { z } from "zod";
import { symbol, enumOf, number } from "../../lib/schema.js";
import { loadCandles, parseInterval } from "../../lib/candles.js";
import { calculateParabolicSAR } from "../../lib/indicators/parabolic-sar.js";
import { defineTool } from "../types.js";

// ─── get_parabolic_sar — Parabolic SAR ────────────────────────────────────────

export const parabolicSarTool = defineTool({
  name: "get_parabolic_sar",
  title: "Parabolic SAR 계산",
  kind: "read",
  description: "종목의 Parabolic SAR를 계산합니다. 추세 방향·반전 신호·트레일링 스탑 기준선을 반환합니다.",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).describe("봉 단위"),
    initial_af: number({ gt: 0, max: 1 }).optional().describe("초기 가속 인수 (기본값 0.02)"),
    step: number({ gt: 0, max: 1 }).optional().describe("가속 인수 증가량 (기본값 0.02)"),
    max_af: number({ gt: 0, max: 1 }).optional().describe("최대 가속 인수 (기본값 0.2)"),
  }),
  validate: (a, errors) => {
    if (Number(a.initial_af ?? 0.02) > Number(a.max_af ?? 0.2))
      errors.push(`initial_af: max_af(${a.max_af ?? 0.2}) 이하여야 합니다 (입력: ${a.initial_af ?? 0.02})`);
  },
  handler: async (args) => {
    const symbol = String(args.symbol);
    const sarInterval = parseInterval(args.interval);
    const initialAF = Number(args.initial_af ?? 0.02);
    const step = Number(args.step ?? 0.02);
    const maxAF = Number(args.max_af ?? 0.2);
    const candles = await loadCandles(symbol, sarInterval, 200);
    if (candles.length < 2) throw new Error(`Parabolic SAR 계산 데이터 부족. 최소 2개 필요`);
    const sarData = calculateParabolicSAR(candles, initialAF, step, maxAF);
    const results = sarData.map((d) => ({
      time: candles[d.time_index].time,
      sar: round(d.sar, 2),
      trend: d.trend,
      reversal: d.reversal,
    }));
    const latest = last(results);
    return {
      symbol,
      interval: sarInterval,
      initial_af: initialAF,
      step,
      max_af: maxAF,
      candle_count: candles.length,
      sar_count: results.length,
      latest_sar: latest?.sar ?? null,
      latest_trend: latest?.trend ?? null,
      reversal_count: sarData.filter((d) => d.reversal).length,
      parabolic_sar: results,
    };
  },
});
