#!/usr/bin/env node
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://openapi.tossinvest.com";

// In-memory token storage
let accessToken: string | null = null;

async function issueTokenWithCredentials(clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(JSON.stringify(data));
  accessToken = String(data.access_token);
  return accessToken;
}

function getHeaders(accountSeq?: number): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  if (accountSeq !== undefined) {
    headers["X-Tossinvest-Account"] = String(accountSeq);
  }
  return headers;
}

async function apiRequest(
  method: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  body?: unknown,
  accountSeq?: number,
): Promise<unknown> {
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    headers: getHeaders(accountSeq),
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools: Tool[] = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    name: "issue_token_from_env",
    description:
      "환경변수 TOSSINVEST_API_KEY(client_id)와 TOSSINVEST_SECRET_KEY(client_secret)를 사용해 액세스 토큰을 자동 발급합니다. 별도 파라미터 없이 호출하면 됩니다.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "issue_token",
    description:
      "OAuth2 Client Credentials Grant으로 액세스 토큰을 발급합니다. 발급된 토큰은 이후 모든 API 호출에 자동으로 사용됩니다.",
    inputSchema: {
      type: "object",
      required: ["client_id", "client_secret"],
      properties: {
        client_id: { type: "string", description: "발급받은 클라이언트 ID" },
        client_secret: { type: "string", description: "발급받은 클라이언트 시크릿" },
      },
    },
  },

  // ── Market Data ───────────────────────────────────────────────────────────
  {
    name: "get_orderbook",
    description: "종목의 매수/매도 호가 및 잔량을 조회합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
      },
    },
  },
  {
    name: "get_prices",
    description: "종목의 현재가를 조회합니다. 최대 200개 종목을 콤마로 구분하여 한 번에 조회 가능합니다.",
    inputSchema: {
      type: "object",
      required: ["symbols"],
      properties: {
        symbols: {
          type: "string",
          description: "종목 심볼 목록. 콤마(,)로 구분, 최대 200개 (예: 005930,000660 또는 AAPL,MSFT)",
        },
      },
    },
  },
  {
    name: "get_trades",
    description: "종목의 당일 최근 체결 내역을 조회합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        count: {
          type: "number",
          description: "조회 건수 (기본값 50, 최대 50)",
        },
      },
    },
  },
  {
    name: "get_price_limits",
    description: "종목의 당일 상한가 및 하한가를 조회합니다. 미국 주식은 가격제한이 없어 null로 반환됩니다.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
      },
    },
  },
  {
    name: "get_candles",
    description:
      "종목의 캔들(OHLCV) 차트 데이터를 조회합니다. 1분봉(1m) 또는 일봉(1d)을 지원하며 최대 200개를 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: {
          type: "string",
          enum: ["1m", "1d"],
          description: "봉 단위: 1m(1분봉), 1d(일봉)",
        },
        count: {
          type: "number",
          description: "조회 봉 수 (기본값 100, 최대 200)",
        },
        before: {
          type: "string",
          description: "페이지네이션 상한 (exclusive, ISO 8601). 이 시각보다 이전 봉만 반환. 예: 2026-03-25T09:00:00+09:00",
        },
        adjusted: {
          type: "boolean",
          description: "수정주가 적용 여부 (기본값 true)",
        },
      },
    },
  },

  // ── Stock Info ────────────────────────────────────────────────────────────
  {
    name: "get_stocks",
    description:
      "종목의 기본 정보(종목명, 시장, 통화, 상장상태 등)를 조회합니다. 최대 200개를 콤마로 구분하여 한 번에 조회 가능합니다.",
    inputSchema: {
      type: "object",
      required: ["symbols"],
      properties: {
        symbols: {
          type: "string",
          description: "종목 심볼 목록. 콤마(,)로 구분, 최대 200개 (예: 005930,AAPL)",
        },
      },
    },
  },
  {
    name: "get_stock_warnings",
    description:
      "종목의 매수 유의사항(정리매매, 단기과열, 투자경고/위험, VI 발동, 신주인수권 등)을 조회합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
      },
    },
  },

  // ── Market Info ───────────────────────────────────────────────────────────
  {
    name: "get_exchange_rate",
    description:
      "KRW↔USD 환율 정보를 조회합니다. 1분 주기로 갱신되는 참고용 표시 환율입니다.",
    inputSchema: {
      type: "object",
      required: ["base_currency", "quote_currency"],
      properties: {
        base_currency: {
          type: "string",
          enum: ["KRW", "USD"],
          description: "기준 통화",
        },
        quote_currency: {
          type: "string",
          enum: ["KRW", "USD"],
          description: "표시 통화",
        },
        date_time: {
          type: "string",
          description: "조회할 특정 시각 (ISO 8601). 생략 시 현재 시점 환율 반환. 예: 2026-03-25T09:30:00+09:00",
        },
      },
    },
  },
  {
    name: "get_kr_market_calendar",
    description:
      "국내 시장(KRX+NXT 통합 모드)의 장 운영 시간을 조회합니다. 전일/당일/익일 3영업일 정보를 반환합니다.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "조회 기준일 (YYYY-MM-DD). 생략 시 오늘 기준",
        },
      },
    },
  },
  {
    name: "get_us_market_calendar",
    description:
      "미국 시장의 장 운영 시간을 조회합니다. 데이마켓/프리마켓/정규장/애프터마켓 세션별로 반환하며 전일/당일/익일 3영업일 정보를 제공합니다.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "조회 기준일 (YYYY-MM-DD, 미국 현지 날짜). 생략 시 오늘 기준",
        },
      },
    },
  },

  // ── Account ───────────────────────────────────────────────────────────────
  {
    name: "get_accounts",
    description:
      "사용자의 계좌 목록을 조회합니다. 응답의 accountSeq를 다른 계좌 관련 API의 account_seq 파라미터에 사용합니다.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ── Asset ─────────────────────────────────────────────────────────────────
  {
    name: "get_holdings",
    description:
      "계좌의 보유 주식 현황(수량, 매입가, 평가금액, 손익)을 조회합니다. 국내/미국 주식 모두 포함됩니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        symbol: {
          type: "string",
          description: "특정 종목만 조회할 경우 심볼 지정 (예: 005930, AAPL). 생략 시 전체 보유 종목 반환",
        },
      },
    },
  },

  // ── Order History ─────────────────────────────────────────────────────────
  {
    name: "get_orders",
    description:
      "주문 목록을 조회합니다. OPEN(진행 중) 또는 CLOSED(종료됨)으로 필터링합니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq", "status"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        status: {
          type: "string",
          enum: ["OPEN", "CLOSED"],
          description: "주문 상태 필터. OPEN: 진행 중, CLOSED: 종료된 주문",
        },
        symbol: {
          type: "string",
          description: "특정 종목만 조회 (예: 005930, AAPL)",
        },
        from: {
          type: "string",
          description: "조회 시작일 (inclusive, YYYY-MM-DD, KST 기준)",
        },
        to: {
          type: "string",
          description: "조회 종료일 (inclusive, YYYY-MM-DD, KST 기준)",
        },
        cursor: {
          type: "string",
          description: "페이지네이션 커서 (CLOSED 전용). 이전 응답의 nextCursor 값을 그대로 전달",
        },
        limit: {
          type: "number",
          description: "페이지 크기 (CLOSED 전용, 기본값 20, 최대 100)",
        },
      },
    },
  },
  {
    name: "get_order",
    description: "특정 주문의 상세 정보를 조회합니다. 모든 상태의 주문을 조회할 수 있습니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq", "order_id"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        order_id: {
          type: "string",
          description: "주문 식별자 (create_order 응답의 orderId)",
        },
      },
    },
  },

  // ── Order ─────────────────────────────────────────────────────────────────
  {
    name: "create_order",
    description:
      "매수 또는 매도 주문을 생성합니다. quantity(수량) 또는 order_amount(금액) 중 하나를 지정합니다. order_amount는 미국 주식 시장가 주문 전용입니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq", "symbol", "side", "order_type"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        side: {
          type: "string",
          enum: ["BUY", "SELL"],
          description: "주문 방향: BUY(매수), SELL(매도)",
        },
        order_type: {
          type: "string",
          enum: ["LIMIT", "MARKET"],
          description: "호가 유형: LIMIT(지정가), MARKET(시장가)",
        },
        quantity: {
          type: "string",
          description: "주문 수량 (주 단위). order_amount와 둘 중 하나만 사용",
        },
        price: {
          type: "string",
          description: "주문 가격 (지정가 주문 시 필수)",
        },
        order_amount: {
          type: "string",
          description: "주문 금액 (달러). 미국 시장가 주문 전용. quantity와 둘 중 하나만 사용",
        },
        time_in_force: {
          type: "string",
          enum: ["DAY", "CLS"],
          description: "유효 조건: DAY(당일), CLS(종가 주문, 미국 지정가 전용)",
        },
        client_order_id: {
          type: "string",
          description: "멱등성을 위한 클라이언트 주문 ID (선택)",
        },
        confirm_high_value_order: {
          type: "boolean",
          description: "1억원 이상 주문 확인 플래그 (필요한 경우 true)",
        },
      },
    },
  },
  {
    name: "modify_order",
    description:
      "기존 주문의 가격 또는 수량을 정정합니다. 국내 주식은 가격+수량 정정 가능, 미국 주식은 가격만 정정 가능합니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq", "order_id", "order_type"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        order_id: {
          type: "string",
          description: "정정할 주문의 주문 식별자",
        },
        order_type: {
          type: "string",
          enum: ["LIMIT", "MARKET"],
          description: "호가 유형",
        },
        price: {
          type: "string",
          description: "새 주문 가격 (지정가 주문 필수)",
        },
        quantity: {
          type: "string",
          description: "새 주문 수량 (국내 주식 전용, 양의 정수만 허용)",
        },
        confirm_high_value_order: {
          type: "boolean",
          description: "정정 후 1억원 이상이 될 경우 확인 플래그",
        },
      },
    },
  },
  {
    name: "cancel_order",
    description: "기존 주문을 취소합니다. 이미 체결된 주문은 취소할 수 없습니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq", "order_id"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        order_id: {
          type: "string",
          description: "취소할 주문의 주문 식별자",
        },
      },
    },
  },

  // ── Order Info ────────────────────────────────────────────────────────────
  {
    name: "get_buying_power",
    description:
      "매수 주문 시 사용 가능한 현금 기반 매수 가능 금액을 조회합니다 (미수 미발생 기준).",
    inputSchema: {
      type: "object",
      required: ["account_seq", "currency"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        currency: {
          type: "string",
          enum: ["KRW", "USD"],
          description: "통화 코드: KRW(원화), USD(달러)",
        },
      },
    },
  },
  {
    name: "get_sellable_quantity",
    description: "특정 종목의 매도 가능 수량을 조회합니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq", "symbol"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
      },
    },
  },
  {
    name: "get_commissions",
    description: "현재 계좌의 시장별(국내/미국) 매매 수수료율을 조회합니다.",
    inputSchema: {
      type: "object",
      required: ["account_seq"],
      properties: {
        account_seq: {
          type: "number",
          description: "계좌 식별자 (get_accounts로 조회한 accountSeq)",
        },
      },
    },
  },
];

// ─── Tool handlers ───────────────────────────────────────────────────────────

type Args = Record<string, unknown>;

async function handleTool(name: string, args: Args): Promise<unknown> {
  switch (name) {
    // ── Auth ────────────────────────────────────────────────────────────────
    case "issue_token_from_env": {
      const clientId = process.env.TOSSINVEST_API_KEY;
      const clientSecret = process.env.TOSSINVEST_SECRET_KEY;
      if (!clientId || !clientSecret) {
        throw new Error(
          "환경변수 TOSSINVEST_API_KEY 또는 TOSSINVEST_SECRET_KEY가 설정되지 않았습니다.",
        );
      }
      const token = await issueTokenWithCredentials(clientId, clientSecret);
      return {
        access_token: token,
        message: "환경변수로 토큰이 발급되어 메모리에 저장되었습니다. 이후 모든 API 호출에 자동으로 사용됩니다.",
      };
    }

    case "issue_token": {
      const token = await issueTokenWithCredentials(
        String(args.client_id),
        String(args.client_secret),
      );
      return {
        access_token: token,
        message: "토큰이 발급되어 메모리에 저장되었습니다. 이후 모든 API 호출에 자동으로 사용됩니다.",
      };
    }

    // ── Market Data ─────────────────────────────────────────────────────────
    case "get_orderbook":
      return apiRequest("GET", "/api/v1/orderbook", { symbol: String(args.symbol) });

    case "get_prices":
      return apiRequest("GET", "/api/v1/prices", { symbols: String(args.symbols) });

    case "get_trades":
      return apiRequest("GET", "/api/v1/trades", {
        symbol: String(args.symbol),
        count: args.count !== undefined ? Number(args.count) : undefined,
      });

    case "get_price_limits":
      return apiRequest("GET", "/api/v1/price-limits", { symbol: String(args.symbol) });

    case "get_candles":
      return apiRequest("GET", "/api/v1/candles", {
        symbol: String(args.symbol),
        interval: String(args.interval),
        count: args.count !== undefined ? Number(args.count) : undefined,
        before: args.before !== undefined ? String(args.before) : undefined,
        adjusted: args.adjusted !== undefined ? Boolean(args.adjusted) : undefined,
      });

    // ── Stock Info ──────────────────────────────────────────────────────────
    case "get_stocks":
      return apiRequest("GET", "/api/v1/stocks", { symbols: String(args.symbols) });

    case "get_stock_warnings":
      return apiRequest("GET", `/api/v1/stocks/${encodeURIComponent(String(args.symbol))}/warnings`);

    // ── Market Info ─────────────────────────────────────────────────────────
    case "get_exchange_rate":
      return apiRequest("GET", "/api/v1/exchange-rate", {
        baseCurrency: String(args.base_currency),
        quoteCurrency: String(args.quote_currency),
        dateTime: args.date_time !== undefined ? String(args.date_time) : undefined,
      });

    case "get_kr_market_calendar":
      return apiRequest("GET", "/api/v1/market-calendar/KR", {
        date: args.date !== undefined ? String(args.date) : undefined,
      });

    case "get_us_market_calendar":
      return apiRequest("GET", "/api/v1/market-calendar/US", {
        date: args.date !== undefined ? String(args.date) : undefined,
      });

    // ── Account ─────────────────────────────────────────────────────────────
    case "get_accounts":
      return apiRequest("GET", "/api/v1/accounts");

    // ── Asset ───────────────────────────────────────────────────────────────
    case "get_holdings":
      return apiRequest(
        "GET",
        "/api/v1/holdings",
        { symbol: args.symbol !== undefined ? String(args.symbol) : undefined },
        undefined,
        Number(args.account_seq),
      );

    // ── Order History ───────────────────────────────────────────────────────
    case "get_orders":
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

    case "get_order":
      return apiRequest(
        "GET",
        `/api/v1/orders/${encodeURIComponent(String(args.order_id))}`,
        undefined,
        undefined,
        Number(args.account_seq),
      );

    // ── Order ───────────────────────────────────────────────────────────────
    case "create_order": {
      const body: Record<string, unknown> = {
        symbol: args.symbol,
        side: args.side,
        orderType: args.order_type,
      };
      if (args.quantity !== undefined) body.quantity = args.quantity;
      if (args.price !== undefined) body.price = args.price;
      if (args.order_amount !== undefined) body.orderAmount = args.order_amount;
      if (args.time_in_force !== undefined) body.timeInForce = args.time_in_force;
      if (args.client_order_id !== undefined) body.clientOrderId = args.client_order_id;
      if (args.confirm_high_value_order !== undefined) body.confirmHighValueOrder = args.confirm_high_value_order;
      return apiRequest("POST", "/api/v1/orders", undefined, body, Number(args.account_seq));
    }

    case "modify_order": {
      const body: Record<string, unknown> = { orderType: args.order_type };
      if (args.price !== undefined) body.price = args.price;
      if (args.quantity !== undefined) body.quantity = args.quantity;
      if (args.confirm_high_value_order !== undefined) body.confirmHighValueOrder = args.confirm_high_value_order;
      return apiRequest(
        "POST",
        `/api/v1/orders/${encodeURIComponent(String(args.order_id))}/modify`,
        undefined,
        body,
        Number(args.account_seq),
      );
    }

    case "cancel_order":
      return apiRequest(
        "POST",
        `/api/v1/orders/${encodeURIComponent(String(args.order_id))}/cancel`,
        undefined,
        {},
        Number(args.account_seq),
      );

    // ── Order Info ──────────────────────────────────────────────────────────
    case "get_buying_power":
      return apiRequest(
        "GET",
        "/api/v1/buying-power",
        { currency: String(args.currency) },
        undefined,
        Number(args.account_seq),
      );

    case "get_sellable_quantity":
      return apiRequest(
        "GET",
        "/api/v1/sellable-quantity",
        { symbol: String(args.symbol) },
        undefined,
        Number(args.account_seq),
      );

    case "get_commissions":
      return apiRequest("GET", "/api/v1/commissions", undefined, undefined, Number(args.account_seq));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "tossinvest-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const result = await handleTool(name, args as Args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `오류: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// 서버 시작 시 env 자격증명이 있으면 토큰 자동 발급
if (!accessToken && process.env.TOSSINVEST_API_KEY && process.env.TOSSINVEST_SECRET_KEY) {
  try {
    await issueTokenWithCredentials(
      process.env.TOSSINVEST_API_KEY,
      process.env.TOSSINVEST_SECRET_KEY,
    );
  } catch {
    // 토큰 발급 실패 시 도구 호출 시점에 에러 반환
  }
}
