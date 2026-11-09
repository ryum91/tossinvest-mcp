import { apiRequest } from "../api/client.js";
import { z } from "zod";
import { pathSeg } from "../lib/args.js";
import { count, isoDate, symbol } from "../lib/schema.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 수급 동향 (국내 종목 일별 시계열) ─────────────────────────────────────────

const TREND_TOOLS = [
  [
    "get_stock_investor_trading",
    "국내 종목의 투자자별(개인·외국인·기관·기타법인, 기관 7개 세부 분류) 일별 매수·매도·순매수 거래량, 외국인 보유 현황, CFD 잔고를 최신순으로 조회합니다.",
  ],
  [
    "get_stock_program_trades",
    "국내 종목의 프로그램매매(차익·비차익) 일별 매수·매도·순매수 거래량을 최신순으로 조회합니다.",
  ],
  ["get_stock_short_selling", "국내 종목의 공매도 일별 거래량·거래대금·비중을 최신순으로 조회합니다."],
  ["get_stock_credit_trades", "국내 종목의 신용거래(융자·대주) 일별 수량·잔고·공여율을 최신순으로 조회합니다."],
  ["get_stock_securities_lending", "국내 종목의 대차거래 일별 체결·상환·잔고를 최신순으로 조회합니다."],
] as const;

const TREND_META: Record<string, [title: string, pathSuffix: string]> = {
  get_stock_investor_trading: ["투자자별 매매동향 조회", "investor-trading"],
  get_stock_program_trades: ["프로그램매매 동향 조회", "program-trades"],
  get_stock_short_selling: ["공매도 동향 조회", "short-selling"],
  get_stock_credit_trades: ["신용거래 동향 조회", "credit-trades"],
  get_stock_securities_lending: ["대차거래 동향 조회", "securities-lending"],
};

export const stockTrendTools: ToolDefinition[] = TREND_TOOLS.map(([name, description]) =>
  defineTool({
    name,
    title: TREND_META[name][0],
    kind: "read",
    description: `${description} 국내(KR) 종목만 지원합니다. 다음 페이지는 응답의 nextUntil 을 until 로 전달합니다.`,
    input: z.object({
      symbol: symbol.describe("국내 종목코드 6자리 (예: 005930)"),
      count: count(100).optional().describe("조회 일수 (기본 10, 최대 100)"),
      until: isoDate.optional().describe("조회 기준일 (inclusive, YYYY-MM-DD). 이 날짜까지 최신순으로 count 개 반환"),
    }),
    handler: async (args) =>
      apiRequest("GET", `/api/v1/stocks/${pathSeg(args.symbol)}/${TREND_META[name][1]}`, {
        count: args.count,
        until: args.until,
      }),
  }),
);
