import { z } from "zod";
import { accountSeq, symbol, isoDate, limit, enumOf, csv, str, argChecks } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { optStr, optNum } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 계좌 · 자산 · 거래내역 ────────────────────────────────────────────────────────────

export const accountTools: ToolDefinition[] = [
  defineTool({
    name: "get_accounts",
    title: "계좌 목록 조회",
    kind: "read",
    description:
      "사용자의 계좌 목록을 조회합니다. 응답의 accountSeq를 다른 계좌 관련 API의 account_seq 파라미터에 사용합니다.",
    input: z.object({}),
    handler: async () => {
      return apiRequest("GET", "/api/v1/accounts");
    },
  }),
  defineTool({
    name: "get_holdings",
    title: "보유 주식 조회",
    kind: "read",
    description: "계좌의 보유 주식 현황(수량, 매입가, 평가금액, 손익)을 조회합니다. 국내/미국 주식 모두 포함됩니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      symbol: symbol
        .optional()
        .describe("특정 종목만 조회할 경우 심볼 지정 (예: 005930, AAPL). 생략 시 전체 보유 종목 반환"),
    }),
    handler: async (args) => {
      return apiRequest(
        "GET",
        "/api/v1/holdings",
        { symbol: args.symbol !== undefined ? String(args.symbol) : undefined },
        undefined,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_transactions",
    title: "거래내역 조회",
    kind: "read",
    description:
      "계좌 거래내역(매매·입출금·환전·배당·이자·수수료·증권 입출고)을 결제일 기준으로 조회합니다. 국내·미국 주식/옵션/채권을 한 목록으로 제공하며, hasNext/nextCursor 로 페이지를 넘깁니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      transaction_types: csv(
        enumOf([
          "BUY",
          "SELL",
          "SECURITIES_TRANSFER_IN",
          "SECURITIES_TRANSFER_OUT",
          "DEPOSIT",
          "WITHDRAWAL",
          "EXCHANGE_IN",
          "EXCHANGE_OUT",
          "DIVIDEND",
          "INTEREST",
          "FEE",
        ]),
      )
        .optional()
        .describe("거래 유형 필터 (OR 조건, 미지정 시 전체)"),
      from: isoDate.optional().describe("조회 시작일 (inclusive, YYYY-MM-DD, KST, 결제일 기준)"),
      to: isoDate.optional().describe("조회 종료일 (inclusive, YYYY-MM-DD, KST, 결제일 기준). 미지정 시 미결제 포함"),
      cursor: str().optional().describe("이전 응답의 nextCursor (필터 변경 시 생략)"),
      limit: limit(100).optional().describe("페이지 크기 (기본 20, 최대 100)"),
    }),
    validate: (a, errors) => argChecks(a, errors).range("from", "to"),
    handler: async (args) => {
      const types = Array.isArray(args.transaction_types)
        ? (args.transaction_types as unknown[]).map(String).join(",")
        : optStr(args.transaction_types);
      return apiRequest(
        "GET",
        "/api/v1/transactions",
        {
          transactionTypes: types,
          from: optStr(args.from),
          to: optStr(args.to),
          cursor: optStr(args.cursor),
          limit: optNum(args.limit),
        },
        undefined,
        Number(args.account_seq),
      );
    },
  }),
];
