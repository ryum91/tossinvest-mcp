import { z } from "zod";
import { isoDate, isoDateTime, enumOf } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 시장 정보 (환율 · 장 운영 시간) ──────────────────────────────────────────────────────

export const marketInfoTools: ToolDefinition[] = [
  defineTool({
    name: "get_exchange_rate",
    title: "환율 조회",
    kind: "read",
    description: "KRW↔USD 환율 정보를 조회합니다. 1분 주기로 갱신되는 참고용 표시 환율입니다.",
    input: z.object({
      base_currency: enumOf(["KRW", "USD"]).describe("기준 통화"),
      quote_currency: enumOf(["KRW", "USD"]).describe("표시 통화"),
      date_time: isoDateTime
        .optional()
        .describe("조회할 특정 시각 (ISO 8601). 생략 시 현재 시점 환율 반환. 예: 2026-03-25T09:30:00+09:00"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/exchange-rate", {
        baseCurrency: String(args.base_currency),
        quoteCurrency: String(args.quote_currency),
        dateTime: args.date_time !== undefined ? String(args.date_time) : undefined,
      });
    },
  }),
  defineTool({
    name: "get_kr_market_calendar",
    title: "국내 장 운영 정보 조회",
    kind: "read",
    description: "국내 시장(KRX+NXT 통합 모드)의 장 운영 시간을 조회합니다. 전일/당일/익일 3영업일 정보를 반환합니다.",
    input: z.object({
      date: isoDate.optional().describe("조회 기준일 (YYYY-MM-DD). 생략 시 오늘 기준"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/market-calendar/KR", {
        date: args.date !== undefined ? String(args.date) : undefined,
      });
    },
  }),
  defineTool({
    name: "get_us_market_calendar",
    title: "미국 장 운영 정보 조회",
    kind: "read",
    description:
      "미국 시장의 장 운영 시간을 조회합니다. 데이마켓/프리마켓/정규장/애프터마켓 세션별로 반환하며 전일/당일/익일 3영업일 정보를 제공합니다.",
    input: z.object({
      date: isoDate.optional().describe("조회 기준일 (YYYY-MM-DD, 미국 현지 날짜). 생략 시 오늘 기준"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/market-calendar/US", {
        date: args.date !== undefined ? String(args.date) : undefined,
      });
    },
  }),
];
