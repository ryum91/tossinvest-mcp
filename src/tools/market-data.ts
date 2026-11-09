import { z } from "zod";
import { symbol, symbols, isoDateTime, count, enumOf, bool } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { optBool } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 시세 (Market Data) ──────────────────────────────────────────────────────────

export const marketDataTools: ToolDefinition[] = [
  defineTool({
    name: "get_prices",
    title: "현재가 조회",
    kind: "read",
    description: "종목의 현재가를 조회합니다. 최대 200개 종목을 콤마로 구분하여 한 번에 조회 가능합니다.",
    input: z.object({
      symbols: symbols.describe("종목 심볼 목록. 콤마(,)로 구분, 최대 200개 (예: 005930,000660 또는 AAPL,MSFT)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/prices", { symbols: String(args.symbols) });
    },
  }),
  defineTool({
    name: "get_orderbook",
    title: "호가 조회",
    kind: "read",
    description: "종목의 매수/매도 호가 및 잔량을 조회합니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/orderbook", { symbol: String(args.symbol) });
    },
  }),
  defineTool({
    name: "get_trades",
    title: "최근 체결 조회",
    kind: "read",
    description: "종목의 당일 최근 체결 내역을 조회합니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      count: count(50).optional().describe("조회 건수 (기본값 50, 최대 50)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/trades", {
        symbol: String(args.symbol),
        count: args.count !== undefined ? Number(args.count) : undefined,
      });
    },
  }),
  defineTool({
    name: "get_price_limits",
    title: "상·하한가 조회",
    kind: "read",
    description: "종목의 당일 상한가 및 하한가를 조회합니다. 미국 주식은 가격제한이 없어 null로 반환됩니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/price-limits", { symbol: String(args.symbol) });
    },
  }),
  defineTool({
    name: "get_candles",
    title: "캔들 차트 조회",
    kind: "read",
    description:
      "종목의 캔들(OHLCV) 차트 데이터를 조회합니다. 1분봉(1m) 또는 일봉(1d)을 지원하며 최대 200개를 최신순으로 반환합니다. 1m 봉의 timestamp 는 봉 종료 시각입니다. 다음 페이지는 응답의 nextBefore 를 before 로 전달합니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      interval: enumOf(["1m", "1d"]).describe("봉 단위: 1m(1분봉), 1d(일봉)"),
      count: count(200).optional().describe("조회 봉 수 (기본값 100, 최대 200)"),
      before: isoDateTime
        .optional()
        .describe(
          "페이지네이션 상한 (inclusive, ISO 8601). 이 시각과 같거나 이전인 봉만 반환. 이전 응답의 nextBefore 값을 그대로 전달. 예: 2026-03-25T09:00:00+09:00",
        ),
      adjusted: bool.optional().describe("수정주가 적용 여부 (기본값 true)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/candles", {
        symbol: String(args.symbol),
        interval: String(args.interval),
        count: args.count !== undefined ? Number(args.count) : undefined,
        before: args.before !== undefined ? String(args.before) : undefined,
        adjusted: optBool(args.adjusted),
      });
    },
  }),
];
