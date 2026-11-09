import { z } from "zod";
import { count, enumOf, bool } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { optNum, optBool } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 랭킹 (Ranking) ──────────────────────────────────────────────────────────────

export const rankingTools: ToolDefinition[] = [
  defineTool({
    name: "get_rankings",
    title: "주식 랭킹 조회",
    kind: "read",
    description:
      "국내·미국 주식 랭킹(시장 거래대금·거래량 상위, 급상승·급하락, 토스증권 체결 기준 거래대금·거래량 상위)을 조회합니다. 순위와 현재가·등락률·거래량·거래대금을 반환합니다.",
    input: z.object({
      type: enumOf([
        "MARKET_TRADING_AMOUNT",
        "MARKET_TRADING_VOLUME",
        "TOP_GAINERS",
        "TOP_LOSERS",
        "TOSS_SECURITIES_TRADING_AMOUNT",
        "TOSS_SECURITIES_TRADING_VOLUME",
      ]).describe("랭킹 종류. TOP_GAINERS/TOP_LOSERS 는 duration=realtime 미지원"),
      market_country: enumOf(["KR", "US"]).describe("조회 시장"),
      duration: enumOf(["realtime", "1d", "1w", "1mo", "3mo", "6mo", "1y"]).describe("산정 기간 (거래일 기준)"),
      exclude_investment_caution: bool.optional().describe("투자 유의 종목 제외 여부 (기본 false)"),
      count: count(100).optional().describe("조회 수 (기본 100, 최대 100)"),
    }),
    validate: (a, errors) => {
      if ((a.type === "TOP_GAINERS" || a.type === "TOP_LOSERS") && a.duration === "realtime") {
        errors.push("duration: TOP_GAINERS / TOP_LOSERS 랭킹은 realtime 을 지원하지 않습니다");
      }
    },
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/rankings", {
        type: String(args.type),
        marketCountry: String(args.market_country),
        duration: String(args.duration),
        excludeInvestmentCaution: optBool(args.exclude_investment_caution),
        count: optNum(args.count),
      });
    },
  }),
  defineTool({
    name: "get_investor_trading_rankings",
    title: "투자자별 순매수·순매도 랭킹 조회",
    kind: "read",
    description:
      "국내 종목의 외국인·기관·개인 순매수 상위 / 순매도 상위 종목을 최근 영업일 기준으로 조회합니다 (KRX·NXT 통합, 원화 거래액 순). 시세는 포함하지 않으므로 필요 시 get_prices 로 조회하세요.",
    input: z.object({
      count: count(100).optional().describe("투자자별 순매수·순매도 목록 각각의 조회 수 (기본 100, 최대 100)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/rankings/investor-trading", { count: optNum(args.count) });
    },
  }),
];
