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
  kstToday,
  SIDES,
} from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { optStr, optNum, pathSeg } from "../lib/args.js";
import type { Args } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 조건주문 (SINGLE · OCO · OTO) ─────────────────────────────────────────────────

/** 감시 조건 (leg): 가격이 trigger_price 에 닿으면 order_side 주문 실행 */
const condition = z.object({
  order_side: enumOf(SIDES).describe("매수/매도"),
  trigger_price: positiveDecimal.describe("감시 가격"),
  order_price: positiveDecimal
    .optional()
    .describe("주문 가격 (order_type=LIMIT 필수, MARKET 이면 생략). 호가 단위에 맞아야 함"),
});
type Condition = z.output<typeof condition>;

const conditionBody = (c: Condition) => ({
  orderSide: c.order_side,
  triggerPrice: c.trigger_price,
  ...(c.order_price !== undefined && { orderPrice: c.order_price }),
});

/** 조건주문 생성·수정 요청 본문 (검증은 zod 스키마 + validateConditionalOrder 에서 완료됨) */
function conditionalOrderBody(args: {
  symbol?: string;
  type: string;
  quantity: string;
  order_type: string;
  expire_date: string;
  first: Condition;
  second?: Condition;
  client_order_id?: string;
  confirm_high_value_order?: boolean;
}): Record<string, unknown> {
  return {
    ...(args.symbol !== undefined && { symbol: args.symbol }),
    type: args.type,
    quantity: args.quantity,
    orderType: args.order_type,
    expireDate: args.expire_date,
    first: conditionBody(args.first),
    ...(args.second !== undefined && { second: conditionBody(args.second) }),
    ...(args.client_order_id !== undefined && { clientOrderId: args.client_order_id }),
    ...(args.confirm_high_value_order !== undefined && { confirmHighValueOrder: args.confirm_high_value_order }),
  };
}

/** 조건주문 생성·수정 공통 조합 규칙 */
function validateConditionalOrder(a: Args, errors: string[]): void {
  // when: () => true 로 스키마 오류가 있어도 실행되므로, 값의 타입을 직접 확인합니다
  const first = a.first as Partial<Condition> | undefined;
  const second = a.second as Partial<Condition> | undefined;
  const type = typeof a.type === "string" ? a.type : undefined;
  if (!type) return; // type 누락은 스키마 오류로 보고됨
  if (type === "SINGLE" && second) errors.push("second: SINGLE 조건주문에는 second 를 지정할 수 없습니다");
  if (type !== "SINGLE" && !second) errors.push(`second: ${type} 조건주문은 second 조건이 필수입니다`);
  if (type !== "SINGLE" && a.order_type !== "LIMIT")
    errors.push(`order_type: ${type} 조건주문은 LIMIT(지정가)만 지원합니다`);
  for (const [label, leg] of [
    ["first", first],
    ["second", second],
  ] as const) {
    if (!leg) continue;
    if (a.order_type === "LIMIT" && leg.order_price === undefined)
      errors.push(`${label}.order_price: LIMIT 조건주문은 order_price 가 필수입니다`);
    if (a.order_type === "MARKET" && leg.order_price !== undefined)
      errors.push(`${label}.order_price: MARKET 조건주문에는 order_price 를 전달할 수 없습니다`);
  }
  if (type === "OCO" && first && second) {
    if (first.order_side !== "SELL" || second.order_side !== "SELL")
      errors.push("OCO 조건주문은 first / second 모두 SELL 이어야 합니다");
    if (!(Number(first.trigger_price) > Number(second.trigger_price))) {
      errors.push("OCO 조건주문은 first.trigger_price(익절) > 현재가 > second.trigger_price(손절) 이어야 합니다");
    }
  }
  if (type === "OTO" && first && second && (first.order_side !== "BUY" || second.order_side !== "SELL")) {
    errors.push("OTO 조건주문은 first=BUY, second=SELL 이어야 합니다");
  }
  if (typeof a.quantity === "string" && a.quantity.includes("."))
    errors.push("quantity: 조건주문 수량은 양의 정수여야 합니다");
  if (typeof a.expire_date === "string") {
    const today = kstToday();
    const [y, m, d] = today.split("-");
    const maxDate = `${Number(y) + 1}-${m}-${d}`;
    const exp = a.expire_date;
    if (exp < today) errors.push(`expire_date: 오늘(${today}, KST) 이후 날짜여야 합니다`);
    if (exp > maxDate) errors.push(`expire_date: 오늘로부터 최대 1년(${maxDate})까지 지정할 수 있습니다`);
  }
}

export const conditionalOrderTools: ToolDefinition[] = [
  defineTool({
    name: "create_conditional_order",
    title: "조건주문 등록",
    kind: "trade",
    description:
      "조건주문(감시가 도달 시 자동 매매)을 등록합니다. SINGLE: first 한 조건만 감시. OCO: first·second 모두 SELL, first 감시가 > 현재가 > second 감시가 (익절/손절), LIMIT 만 지원, 종목당 1개. OTO: first=BUY 체결 후 second=SELL 감시 시작, LIMIT 만 지원. 국내는 KRX 정규장에서만 발동, 해외는 거래 가능 전 시간대 발동.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      type: enumOf(["SINGLE", "OCO", "OTO"]).describe("조건주문 타입"),
      quantity: positiveDecimal.describe("매매 수량 (그룹 공통)"),
      order_type: enumOf(["LIMIT", "MARKET"]).describe(
        "호가 유형 (그룹 공통). LIMIT 이면 각 조건의 order_price 필수, MARKET 이면 order_price 전달 불가. OCO/OTO 는 LIMIT 만",
      ),
      expire_date: isoDate.describe("만료일 (YYYY-MM-DD, 오늘부터 최대 1년)"),
      first: condition.describe("감시 조건: 가격이 trigger_price 에 닿으면 order_side 주문 실행"),
      second: condition.optional().describe("두번째 감시 조건 (OCO/OTO 필수, SINGLE 은 생략)"),
      client_order_id: clientOrderId.optional().describe("멱등성 키 (선택, 최대 36자)"),
      confirm_high_value_order: bool.optional().describe("1억원 이상 주문 동의 여부"),
    }),
    validate: validateConditionalOrder,
    handler: async (args) => {
      return apiRequest(
        "POST",
        "/api/v1/conditional-orders",
        undefined,
        conditionalOrderBody(args),
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "modify_conditional_order",
    title: "조건주문 수정",
    kind: "trade",
    description:
      "조건주문을 수정합니다. 전체를 재설정하므로 유지할 조건도 모두 전달해야 하며, 타입 전환(SINGLE→OCO 등)이 가능합니다. 수정 시 기존 조건주문은 취소되고 새 conditionalOrderId 가 발급됩니다 (이후에는 응답의 새 ID 사용). WATCHING·PAUSED 상태만 수정 가능합니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      conditional_order_id: id.describe("수정할 조건주문 ID"),
      type: enumOf(["SINGLE", "OCO", "OTO"]).describe("변경 결과 타입"),
      quantity: positiveDecimal.describe("매매 수량 (그룹 공통)"),
      order_type: enumOf(["LIMIT", "MARKET"]).describe("호가 유형 (OCO/OTO 는 LIMIT 만)"),
      expire_date: isoDate.describe("만료일 (YYYY-MM-DD, 오늘부터 최대 1년)"),
      first: condition.describe("감시 조건: 가격이 trigger_price 에 닿으면 order_side 주문 실행"),
      second: condition.optional().describe("두번째 감시 조건 (OCO/OTO 필수, SINGLE 은 생략)"),
      confirm_high_value_order: bool.optional().describe("1억원 이상 주문 동의 여부"),
    }),
    validate: validateConditionalOrder,
    handler: async (args) => {
      return apiRequest(
        "POST",
        `/api/v1/conditional-orders/${pathSeg(args.conditional_order_id)}/modify`,
        undefined,
        conditionalOrderBody(args),
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "cancel_conditional_order",
    title: "조건주문 취소",
    kind: "trade-cancel",
    description:
      "조건주문을 취소합니다. 이미 접수된 주문은 함께 취소되지 않으므로 필요 시 cancel_order 로 별도 취소하세요.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      conditional_order_id: id.describe("취소할 조건주문 ID"),
    }),
    handler: async (args) => {
      return apiRequest(
        "DELETE",
        `/api/v1/conditional-orders/${pathSeg(args.conditional_order_id)}`,
        undefined,
        undefined,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_conditional_orders",
    title: "조건주문 목록 조회",
    kind: "read",
    description:
      "조건주문 목록을 조회합니다. OPEN: 진행 중(WATCHING·PAUSED·ORDERING·ORDERED), CLOSED: 종료(COMPLETED·EXPIRED).",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      status: enumOf(["OPEN", "CLOSED"]).describe("조건주문 상태 그룹"),
      symbol: symbol.optional().describe("종목 심볼 필터 (선택)"),
      cursor: str().optional().describe("이전 응답의 nextCursor"),
      limit: limit(100).optional().describe("페이지 크기 (기본 20, 최대 100)"),
    }),
    handler: async (args) => {
      return apiRequest(
        "GET",
        "/api/v1/conditional-orders",
        {
          status: String(args.status),
          symbol: optStr(args.symbol),
          cursor: optStr(args.cursor),
          limit: optNum(args.limit),
        },
        undefined,
        Number(args.account_seq),
      );
    },
  }),
  defineTool({
    name: "get_conditional_order",
    title: "조건주문 상세 조회",
    kind: "read",
    description: "조건주문 상세(진행 중·종료 모두)를 조회합니다.",
    input: z.object({
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      conditional_order_id: id.describe("조건주문 ID"),
    }),
    handler: async (args) => {
      return apiRequest(
        "GET",
        `/api/v1/conditional-orders/${pathSeg(args.conditional_order_id)}`,
        undefined,
        undefined,
        Number(args.account_seq),
      );
    },
  }),
];
