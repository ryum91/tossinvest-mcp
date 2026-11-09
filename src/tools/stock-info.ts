import { z } from "zod";
import { symbol, symbols, limit, enumOf, bool, str } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { optStr, optNum, optBool } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 종목 정보 (Stock Info) ────────────────────────────────────────────────────────

export const stockInfoTools: ToolDefinition[] = [
  defineTool({
    name: "get_stocks",
    title: "종목 기본 정보 조회",
    kind: "read",
    description:
      "종목의 기본 정보(종목명, 시장, 통화, 상장상태 등)를 조회합니다. 최대 200개를 콤마로 구분하여 한 번에 조회 가능합니다.",
    input: z.object({
      symbols: symbols.describe("종목 심볼 목록. 콤마(,)로 구분, 최대 200개 (예: 005930,AAPL)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/stocks", { symbols: String(args.symbols) });
    },
  }),
  defineTool({
    name: "list_stocks",
    title: "마켓 전체 종목 조회",
    kind: "read",
    description:
      "마켓(거래소)별 전체 거래 가능 종목 목록(symbol·한글 종목명·종목유형·보통주 여부·ISIN)을 조회합니다. 종목 유니버스 구성·종목명으로 심볼 찾기에 사용합니다. 응답이 수천 건일 수 있어 query/limit 로 클라이언트 측 필터링을 지원합니다. (API 한도: 초당 1회)",
    input: z.object({
      market: enumOf(["KOSPI", "KOSDAQ", "NYSE", "NASDAQ", "AMEX", "KR_ETC", "US_ETC"]).describe("조회할 마켓"),
      status: enumOf(["SCHEDULED", "ACTIVE", "DELISTED"]).optional().describe("종목 상태 필터 (기본 ACTIVE)"),
      security_type: enumOf([
        "STOCK",
        "FOREIGN_STOCK",
        "DEPOSITARY_RECEIPT",
        "INFRASTRUCTURE_FUND",
        "REIT",
        "ETF",
        "FOREIGN_ETF",
        "ETN",
        "STOCK_WARRANTS",
      ])
        .optional()
        .describe("종목 유형 필터 (미지정 시 전체)"),
      common_share: bool.optional().describe("true=보통주만, false=우선주만 (미지정 시 전체)"),
      query: str().optional().describe("(클라이언트 측) 종목명·심볼·ISIN 부분 일치 검색어 (예: 삼성, AAPL)"),
      limit: limit(10_000).optional().describe("(클라이언트 측) 최대 반환 건수 (기본 500)"),
    }),
    handler: async (args) => {
      const res = await apiRequest("GET", "/api/v1/stocks/all", {
        market: String(args.market),
        status: optStr(args.status),
        securityType: optStr(args.security_type),
        commonShare: optBool(args.common_share),
      });
      // 응답이 수천 건일 수 있어 선택적으로 클라이언트 측 필터·제한 적용
      const list: Record<string, unknown>[] | null = Array.isArray(res)
        ? (res as Record<string, unknown>[])
        : Array.isArray((res as Record<string, unknown>)?.stocks)
          ? ((res as Record<string, unknown>).stocks as Record<string, unknown>[])
          : null;
      if (!list) return res;
      const q = optStr(args.query)?.toLowerCase();
      const filtered = q
        ? list.filter((st) => Object.values(st).some((v) => typeof v === "string" && v.toLowerCase().includes(q)))
        : list;
      const limit = optNum(args.limit) ?? 500;
      return {
        total: list.length,
        matched: filtered.length,
        returned: Math.min(limit, filtered.length),
        stocks: filtered.slice(0, limit),
      };
    },
  }),
  defineTool({
    name: "get_stock_warnings",
    title: "종목 유의사항 조회",
    kind: "read",
    description: "종목의 매수 유의사항(정리매매, 단기과열, 투자경고/위험, VI 발동, 신주인수권 등)을 조회합니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", `/api/v1/stocks/${encodeURIComponent(String(args.symbol))}/warnings`);
    },
  }),
];
