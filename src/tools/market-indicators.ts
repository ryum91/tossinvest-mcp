import { z } from "zod";
import { indicatorSymbols, isoDate, isoDateTime, count, enumOf } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { optStr, optNum, pathSeg } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 시장 지표 (지수 · 국채) ───────────────────────────────────────────────────────────

export const marketIndicatorTools: ToolDefinition[] = [
  defineTool({
    name: "get_market_indicator_prices",
    title: "시장 지표 현재가 조회",
    kind: "read",
    description:
      "시장 지표(국내 지수·국채 금리) 현재가를 조회합니다. 지원 심볼: KOSPI, KOSDAQ, KR_BOND_2Y, KR_BOND_3Y, KR_BOND_5Y, KR_BOND_10Y, KR_BOND_20Y, KR_BOND_30Y (국채는 수익률 %).",
    input: z.object({
      symbols: indicatorSymbols.describe("콤마 구분 심볼 목록 (예: KOSPI,KOSDAQ,KR_BOND_10Y)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/market-indicators/prices", { symbols: String(args.symbols) });
    },
  }),
  defineTool({
    name: "get_market_indicator_candles",
    title: "시장 지표 캔들 조회",
    kind: "read",
    description:
      "시장 지표(지수·국채) 캔들 차트를 최신순으로 조회합니다. 1m(분봉)은 KOSPI·KOSDAQ 만 지원, 국채(KR_BOND_*)는 1d 만 지원합니다. 다음 페이지는 nextBefore 를 before 로 전달합니다.",
    input: z.object({
      symbol: enumOf([
        "KOSPI",
        "KOSDAQ",
        "KR_BOND_2Y",
        "KR_BOND_3Y",
        "KR_BOND_5Y",
        "KR_BOND_10Y",
        "KR_BOND_20Y",
        "KR_BOND_30Y",
      ]).describe("시장 지표 심볼"),
      interval: enumOf(["1m", "1d"]).describe("봉 단위"),
      count: count(200).optional().describe("조회 봉 수 (기본 100, 최대 200)"),
      before: isoDateTime.optional().describe("페이지네이션 상한 (inclusive, ISO 8601). 이전 응답의 nextBefore 값"),
    }),
    validate: (a, errors) => {
      if (String(a.symbol).startsWith("KR_BOND_") && a.interval === "1m") {
        errors.push("interval: 국채(KR_BOND_*)는 일봉(1d)만 지원합니다");
      }
    },
    handler: async (args) => {
      return apiRequest("GET", `/api/v1/market-indicators/${pathSeg(args.symbol)}/candles`, {
        interval: String(args.interval),
        count: optNum(args.count),
        before: optStr(args.before),
      });
    },
  }),
  defineTool({
    name: "get_market_indicator_investor_trading",
    title: "투자자별 매매대금 조회",
    kind: "read",
    description:
      "코스피·코스닥의 투자자별(개인·외국인·기관·기타법인, 기관 세부 포함) 매수·매도 거래대금을 기간 단위로 최신순 조회합니다. 다음 페이지는 nextUntil 을 until 로 전달합니다.",
    input: z.object({
      symbol: enumOf(["KOSPI", "KOSDAQ"]).describe("지수 심볼"),
      interval: enumOf(["1d", "1w", "1mo", "1y"]).describe("집계 단위 (일/주/월/연)"),
      count: count(100).optional().describe("조회 수 (기본 10, 최대 100)"),
      until: isoDate.optional().describe("조회 기준일 (inclusive, YYYY-MM-DD)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", `/api/v1/market-indicators/${pathSeg(args.symbol)}/investor-trading`, {
        interval: String(args.interval),
        count: optNum(args.count),
        until: optStr(args.until),
      });
    },
  }),
];
