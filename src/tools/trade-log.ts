import { takeRight } from "es-toolkit";
import { z } from "zod";
import {
  accountSeq,
  symbol,
  positiveDecimal,
  isoDate,
  id,
  limit,
  enumOf,
  csv,
  str,
  SIDES,
  argChecks,
} from "../lib/schema.js";
import { TRADE_LOG_PATH } from "../config.js";
import { readTradeLog, appendTradeLog } from "../lib/trade-log.js";
import type { TradeLogEntry } from "../lib/trade-log.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 매매 이력 (로컬 파일) ─────────────────────────────────────────────────────────────

export const tradeLogTools: ToolDefinition[] = [
  defineTool({
    name: "log_trade",
    title: "매매 이력 기록",
    kind: "local-write",
    description:
      "매매 실행 후 근거·지표 스냅샷을 로컬 파일에 기록합니다. create_order 호출 후 반드시 호출해 AI 매매 이력을 남깁니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      side: enumOf(SIDES).describe("매수/매도 방향"),
      quantity: positiveDecimal.describe("주문 수량"),
      account_seq: accountSeq.describe("계좌 식별자"),
      order_type: str().optional().describe("주문 유형 (LIMIT/MARKET)"),
      price: positiveDecimal.optional().describe("주문 가격"),
      order_id: id.optional().describe("create_order 응답의 orderId"),
      rationale: str().optional().describe("매매 근거 — 어떤 신호와 판단으로 주문했는지 자세히 기술"),
      indicators: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("당시 주요 지표 스냅샷 (get_technical_summary 결과 등을 그대로 전달)"),
      tags: csv(z.string()).optional().describe("분류 태그 (예: ['trend-follow', 'rsi-oversold'])"),
    }),
    handler: async (args) => {
      const entry: TradeLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        symbol: String(args.symbol),
        side: String(args.side) as "BUY" | "SELL",
        order_type: String(args.order_type ?? "UNKNOWN"),
        quantity: String(args.quantity),
        account_seq: Number(args.account_seq),
        ...(args.price !== undefined && { price: String(args.price) }),
        ...(args.order_id !== undefined && { order_id: String(args.order_id) }),
        ...(args.rationale !== undefined && { rationale: String(args.rationale) }),
        ...(args.indicators !== undefined && { indicators: args.indicators }),
        ...(args.tags !== undefined && { tags: args.tags }),
      };
      await appendTradeLog(entry);
      return { success: true, id: entry.id, timestamp: entry.timestamp, log_path: TRADE_LOG_PATH };
    },
  }),
  defineTool({
    name: "get_trade_log",
    title: "매매 이력 조회",
    kind: "local-read",
    description:
      "로컬에 저장된 AI 매매 이력을 조회합니다. 과거 매매 근거·지표 상태를 파악해 현재 전략 판단에 활용합니다.",
    input: z.object({
      symbol: symbol.optional().describe("특정 종목만 필터링 (선택)"),
      side: enumOf(SIDES).optional().describe("매수/매도 필터링 (선택)"),
      from_date: isoDate.optional().describe("조회 시작일 (YYYY-MM-DD)"),
      to_date: isoDate.optional().describe("조회 종료일 (YYYY-MM-DD)"),
      limit: limit(10_000).optional().describe("최대 조회 건수 (기본값 50, 최신순)"),
    }),
    validate: (a, errors) => argChecks(a, errors).range("from_date", "to_date"),
    handler: async (args) => {
      let entries = await readTradeLog();
      if (args.symbol !== undefined) entries = entries.filter((e) => e.symbol === String(args.symbol));
      if (args.side !== undefined) entries = entries.filter((e) => e.side === String(args.side));
      if (args.from_date !== undefined)
        entries = entries.filter((e) => e.timestamp.slice(0, 10) >= String(args.from_date));
      if (args.to_date !== undefined) entries = entries.filter((e) => e.timestamp.slice(0, 10) <= String(args.to_date));
      const limit = args.limit !== undefined && Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : 50;
      const result = takeRight(entries, limit).reverse(); // 최신순
      return { total: entries.length, count: result.length, log_path: TRADE_LOG_PATH, trades: result };
    },
  }),
];
