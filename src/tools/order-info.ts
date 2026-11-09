import { z } from "zod";
import { accountSeq, symbol, enumOf } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 거래 가능 정보 (매수 가능 금액 · 매도 가능 수량 · 수수료) ──────────────────────────────────────

export const orderInfoTools: ToolDefinition[] = [
  defineTool({
    name: "get_buying_power",
    title: "매수 가능 금액 조회",
    kind: "read",
    description: "매수 주문 시 사용 가능한 현금 기반 매수 가능 금액을 조회합니다 (미수 미발생 기준).",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      currency: enumOf(["KRW", "USD"]).describe("통화 코드: KRW(원화), USD(달러)"),
    }),
    handler: async (args) => {
      return apiRequest(
        "GET",
        "/api/v1/buying-power",
        { currency: String(args.currency) },
        undefined,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_sellable_quantity",
    title: "매도 가능 수량 조회",
    kind: "read",
    description: "특정 종목의 매도 가능 수량을 조회합니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    }),
    handler: async (args) => {
      return apiRequest(
        "GET",
        "/api/v1/sellable-quantity",
        { symbol: String(args.symbol) },
        undefined,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_commissions",
    title: "매매 수수료 조회",
    kind: "read",
    description: "현재 계좌의 시장별(국내/미국) 매매 수수료율을 조회합니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/commissions", undefined, undefined, Number(args.account_seq));
    },
  }),
];
