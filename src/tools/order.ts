import { z } from "zod";
import {
  accountSeq,
  symbol,
  positiveDecimal,
  isoDate,
  clientOrderId,
  id,
  limit,
  enumOf,
  bool,
  str,
  SIDES,
  argChecks,
} from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { decimalString } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 주문 (생성 · 정정 · 취소 · 조회) ────────────────────────────────────────────────────

export const orderTools: ToolDefinition[] = [
  defineTool({
    name: "create_order",
    title: "주문 생성",
    kind: "trade",
    description:
      "매수 또는 매도 주문을 생성합니다. quantity(수량) 또는 order_amount(금액) 중 정확히 하나를 지정합니다. order_amount는 미국 주식 시장가(MARKET) 전용이며, 소수점 quantity 는 미국 주식 시장가 매도에만 허용됩니다. 금액·소수점 주문은 정규장 시작~종료 1시간 전까지만 접수됩니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      side: enumOf(SIDES).describe("주문 방향: BUY(매수), SELL(매도)"),
      order_type: enumOf(["LIMIT", "MARKET"]).describe("호가 유형: LIMIT(지정가), MARKET(시장가)"),
      quantity: positiveDecimal
        .optional()
        .describe(
          "주문 수량 (주 단위, 문자열). 기본 양의 정수. 소수점(최대 6자리)은 US MARKET SELL 에만 허용. order_amount와 둘 중 하나만 사용",
        ),
      price: positiveDecimal
        .optional()
        .describe(
          "주문 가격 (LIMIT 필수, MARKET 은 전달 불가). KR: 호가 단위에 맞는 정수, US: $1 미만 소수 4자리 / $1 이상 소수 2자리",
        ),
      order_amount: positiveDecimal
        .optional()
        .describe("주문 금액 (달러). 미국 시장가 주문 전용. quantity와 둘 중 하나만 사용"),
      time_in_force: enumOf(["DAY", "CLS", "OPG"])
        .optional()
        .describe(
          "유효 조건 (기본 DAY): DAY(당일), CLS(장 마감 주문 — 미국 LIMIT 전용, LOC), OPG(장 개시 주문 — 국내 시가단일가 전용, LIMIT/MARKET)",
        ),
      client_order_id: clientOrderId
        .optional()
        .describe("멱등성 키 (선택, 최대 36자, 영숫자·-·_). 10분간 동일 값 재요청 시 이전 주문 결과를 반환"),
      confirm_high_value_order: bool
        .optional()
        .describe("착오주문 방지 확인 플래그. 1억원 이상 주문 시 true 필요 (최대 주문 가능 금액 30억원)"),
    }),
    validate: (a, errors) => {
      const { has } = argChecks(a, errors);
      if (has("quantity") === has("order_amount"))
        errors.push("quantity 와 order_amount 중 정확히 하나만 지정해야 합니다");
      if (a.order_type === "LIMIT" && !has("price")) errors.push("price: LIMIT(지정가) 주문은 price 가 필수입니다");
      if (a.order_type === "MARKET" && has("price"))
        errors.push("price: MARKET(시장가) 주문에는 price 를 전달할 수 없습니다");
      if (has("order_amount")) {
        if (a.order_type !== "MARKET") errors.push("order_amount: 금액 주문은 MARKET(시장가) 전용입니다 (미국 주식)");
        if (has("time_in_force")) errors.push("time_in_force: 금액 주문에는 사용할 수 없습니다");
      }
      if (has("quantity") && String(a.quantity).includes(".")) {
        if (!(a.order_type === "MARKET" && a.side === "SELL")) {
          errors.push(
            "quantity: 소수점 수량은 미국 주식 시장가 매도(MARKET + SELL)에만 허용됩니다. 소수점 매수는 order_amount 를 사용하세요",
          );
        }
        if ((String(a.quantity).split(".")[1] ?? "").length > 6) errors.push("quantity: 소수점은 6자리까지 지원합니다");
      }
      if (a.time_in_force === "CLS" && a.order_type !== "LIMIT")
        errors.push("time_in_force: CLS(장 마감 주문)는 LIMIT 주문만 지원합니다");
    },
    handler: async (args) => {
      // 형식·필드 조합 규칙은 zod 스키마 + validate 에서 사전 검증됨 (quantity / order_amount 중 정확히 하나)
      const body: Record<string, unknown> = {
        symbol: String(args.symbol),
        side: String(args.side),
        orderType: String(args.order_type),
      };
      if (args.quantity !== undefined) body.quantity = decimalString(args.quantity);
      if (args.price !== undefined) body.price = decimalString(args.price);
      if (args.order_amount !== undefined) body.orderAmount = decimalString(args.order_amount);
      if (args.time_in_force !== undefined) body.timeInForce = String(args.time_in_force);
      if (args.client_order_id !== undefined) body.clientOrderId = String(args.client_order_id);
      if (args.confirm_high_value_order !== undefined)
        body.confirmHighValueOrder = Boolean(args.confirm_high_value_order);
      return apiRequest("POST", "/api/v1/orders", undefined, body, Number(args.account_seq));
    },
  }),
  defineTool({
    name: "modify_order",
    title: "주문 정정",
    kind: "trade",
    description:
      "기존 주문의 가격 또는 수량을 정정합니다. 국내(KR) 주식은 quantity 필수(양의 정수), 미국(US) 주식은 quantity 전달 불가(가격만 정정).",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      order_id: id.describe("정정할 주문의 주문 식별자"),
      order_type: enumOf(["LIMIT", "MARKET"]).describe("호가 유형"),
      price: positiveDecimal.optional().describe("새 주문 가격 (지정가 주문 필수)"),
      quantity: positiveDecimal.optional().describe("정정 수량 (KR 필수·양의 정수, US 전달 불가)"),
      confirm_high_value_order: bool.optional().describe("정정 후 1억원 이상이 될 경우 확인 플래그"),
    }),
    validate: (a, errors) => {
      const { has } = argChecks(a, errors);
      if (a.order_type === "LIMIT" && !has("price")) errors.push("price: LIMIT(지정가) 정정은 price 가 필수입니다");
      if (a.order_type === "MARKET" && has("price"))
        errors.push("price: MARKET(시장가) 정정에는 price 를 전달할 수 없습니다");
      if (has("quantity") && String(a.quantity).includes("."))
        errors.push("quantity: 정정 수량은 양의 정수만 허용됩니다");
    },
    handler: async (args) => {
      const body: Record<string, unknown> = { orderType: String(args.order_type) };
      if (args.price !== undefined) body.price = decimalString(args.price);
      if (args.quantity !== undefined) body.quantity = decimalString(args.quantity);
      if (args.confirm_high_value_order !== undefined)
        body.confirmHighValueOrder = Boolean(args.confirm_high_value_order);
      return apiRequest(
        "POST",
        `/api/v1/orders/${encodeURIComponent(String(args.order_id))}/modify`,
        undefined,
        body,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "cancel_order",
    title: "주문 취소",
    kind: "trade-cancel",
    description: "기존 주문을 취소합니다. 이미 체결된 주문은 취소할 수 없습니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      order_id: id.describe("취소할 주문의 주문 식별자"),
    }),
    handler: async (args) => {
      return apiRequest(
        "POST",
        `/api/v1/orders/${encodeURIComponent(String(args.order_id))}/cancel`,
        undefined,
        {},
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_orders",
    title: "주문 목록 조회",
    kind: "read",
    description: "주문 목록을 조회합니다. OPEN(진행 중) 또는 CLOSED(종료됨)으로 필터링합니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      status: enumOf(["OPEN", "CLOSED"]).describe("주문 상태 필터. OPEN: 진행 중, CLOSED: 종료된 주문"),
      symbol: symbol.optional().describe("특정 종목만 조회 (예: 005930, AAPL)"),
      from: isoDate.optional().describe("조회 시작일 (inclusive, YYYY-MM-DD, KST 기준)"),
      to: isoDate.optional().describe("조회 종료일 (inclusive, YYYY-MM-DD, KST 기준)"),
      cursor: str().optional().describe("페이지네이션 커서 (CLOSED 전용). 이전 응답의 nextCursor 값을 그대로 전달"),
      limit: limit(100).optional().describe("페이지 크기 (CLOSED 전용, 기본값 20, 최대 100)"),
    }),
    validate: (a, errors) => argChecks(a, errors).range("from", "to"),
    handler: async (args) => {
      return apiRequest(
        "GET",
        "/api/v1/orders",
        {
          status: String(args.status),
          symbol: args.symbol !== undefined ? String(args.symbol) : undefined,
          from: args.from !== undefined ? String(args.from) : undefined,
          to: args.to !== undefined ? String(args.to) : undefined,
          cursor: args.cursor !== undefined ? String(args.cursor) : undefined,
          limit: args.limit !== undefined ? Number(args.limit) : undefined,
        },
        undefined,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_order",
    title: "주문 상세 조회",
    kind: "read",
    description: "특정 주문의 상세 정보를 조회합니다. 모든 상태의 주문을 조회할 수 있습니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      order_id: id.describe("주문 식별자 (create_order 응답의 orderId)"),
    }),
    handler: async (args) => {
      return apiRequest(
        "GET",
        `/api/v1/orders/${encodeURIComponent(String(args.order_id))}`,
        undefined,
        undefined,
        Number(args.account_seq),
      );
    },
  }),
];
