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

// ─── EMA helpers ─────────────────────────────────────────────────────────────

interface CandleRaw {
  time: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
}

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type PriceField = "close" | "open" | "high" | "low" | "hl_avg" | "hlc_avg" | "ohlc_avg";
type EmaInterval = "1m" | "5m" | "30m" | "60m" | "1d" | "1w" | "1mo";

async function fetchCandleBatches(
  symbol: string,
  rawInterval: "1m" | "1d",
  targetCount: number,
): Promise<Candle[]> {
  const allCandles: Candle[] = [];
  let before: string | undefined;

  for (let page = 0; page < 10 && allCandles.length < targetCount; page++) {
    const res = await apiRequest("GET", "/api/v1/candles", {
      symbol,
      interval: rawInterval,
      count: 200,
      before,
      adjusted: true,
    }) as { candles?: CandleRaw[] };

    const batch = res.candles ?? [];
    if (batch.length === 0) break;

    allCandles.push(
      ...batch.map((c) => ({
        time: c.time,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      })),
    );

    before = batch[batch.length - 1].time;
    if (batch.length < 200) break;
  }

  allCandles.sort((a, b) => a.time.localeCompare(b.time));
  return allCandles;
}

function makeBucketKey(interval: EmaInterval): (c: Candle) => string {
  if (interval === "1mo") {
    return (c) => c.time.slice(0, 7); // YYYY-MM
  }
  if (interval === "1w") {
    return (c) => {
      const d = new Date(c.time);
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day; // shift to Monday
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
        .toISOString()
        .slice(0, 10);
    };
  }
  // minute-based intervals
  const minutes = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1440 }[interval] ?? 1;
  return (c) => {
    const d = new Date(c.time);
    const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    const bucketMin = Math.floor(totalMin / minutes) * minutes;
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(bucketMin / 60), bucketMin % 60),
    ).toISOString();
  };
}

function aggregateCandles(candles: Candle[], keyFn: (c: Candle) => string): Candle[] {
  const buckets = new Map<string, Candle[]>();
  for (const c of candles) {
    const key = keyFn(c);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    }));
}

function getPrice(candle: Candle, field: PriceField): number {
  switch (field) {
    case "hl_avg":  return (candle.high + candle.low) / 2;
    case "hlc_avg": return (candle.high + candle.low + candle.close) / 3;
    case "ohlc_avg": return (candle.open + candle.high + candle.low + candle.close) / 4;
    default: return candle[field];
  }
}

function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const seed = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const ema = [seed];
  for (let i = period; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

// Wilder's smoothing RSI
function calculateRSI(prices: number[], period: number): { time_index: number; rsi: number }[] {
  if (prices.length < period + 1) return [];

  const deltas = prices.slice(1).map((p, i) => p - prices[i]);

  // seed averages using simple mean of first `period` deltas
  let avgGain = deltas.slice(0, period).reduce((s, d) => s + Math.max(d, 0), 0) / period;
  let avgLoss = deltas.slice(0, period).reduce((s, d) => s + Math.max(-d, 0), 0) / period;

  const results: { time_index: number; rsi: number }[] = [];
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  results.push({ time_index: period, rsi: Math.round(firstRsi * 100) / 100 });

  for (let i = period; i < deltas.length; i++) {
    const gain = Math.max(deltas[i], 0);
    const loss = Math.max(-deltas[i], 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    results.push({ time_index: i + 1, rsi: Math.round(rsi * 100) / 100 });
  }

  return results;
}

function calculateMACD(
  prices: number[],
  fast: number,
  slow: number,
  signal: number,
): { price_index: number; macd: number; signal: number; histogram: number }[] {
  const fastEMA = calculateEMA(prices, fast);
  const slowEMA = calculateEMA(prices, slow);
  if (fastEMA.length === 0 || slowEMA.length === 0) return [];

  // fastEMA[i] → prices[fast-1+i], slowEMA[i] → prices[slow-1+i]
  const offset = slow - fast;
  const macdLine = slowEMA.map((s, i) => fastEMA[i + offset] - s);

  const signalLine = calculateEMA(macdLine, signal);
  if (signalLine.length === 0) return [];

  return signalLine.map((sig, j) => {
    const macdIdx = signal - 1 + j;
    const macd = macdLine[macdIdx];
    return { price_index: slow + signal - 2 + j, macd, signal: sig, histogram: macd - sig };
  });
}

function calculateBollingerBands(
  prices: number[],
  period: number,
  multiplier: number,
): { price_index: number; middle: number; upper: number; lower: number; percent_b: number; bandwidth: number }[] {
  const results = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const middle = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    const upper = middle + multiplier * stdDev;
    const lower = middle - multiplier * stdDev;
    const range = upper - lower;
    results.push({
      price_index: i,
      middle,
      upper,
      lower,
      percent_b: range === 0 ? 0.5 : (prices[i] - lower) / range,
      bandwidth: range === 0 ? 0 : range / middle,
    });
  }
  return results;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools: Tool[] = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    name: "issue_token",
    description:
      "환경변수 TOSSINVEST_API_KEY(client_id)와 TOSSINVEST_SECRET_KEY(client_secret)를 사용해 액세스 토큰을 재발급합니다. 별도 파라미터 없이 호출하면 됩니다.",
    inputSchema: {
      type: "object",
      properties: {},
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

  {
    name: "get_rsi",
    description:
      "종목의 RSI(상대강도지수)를 계산합니다. Wilder 평활법을 사용하며 과매수/과매도 구간, 시그널 라인(RSI의 EMA), 크로스오버 신호를 함께 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: {
          type: "string",
          enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"],
          description: "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
        },
        period: {
          type: "number",
          description: "RSI 기간 (기본값 14)",
        },
        overbought: {
          type: "number",
          description: "과매수 기준선, 이 값 이상이면 overbought (기본값 70)",
        },
        oversold: {
          type: "number",
          description: "과매도 기준선, 이 값 이하이면 oversold (기본값 30)",
        },
        signal_period: {
          type: "number",
          description: "시그널 라인 기간: RSI에 EMA를 적용해 크로스오버 신호를 생성 (선택사항, 예: 9)",
        },
      },
    },
  },

  {
    name: "get_macd",
    description:
      "종목의 MACD(이동평균 수렴확산)를 계산합니다. MACD 라인, 시그널 라인, 히스토그램, 크로스오버 신호를 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: {
          type: "string",
          enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"],
          description: "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
        },
        fast_period: { type: "number", description: "빠른 EMA 기간 (기본값 12)" },
        slow_period: { type: "number", description: "느린 EMA 기간 (기본값 26)" },
        signal_period: { type: "number", description: "시그널 라인 기간 (기본값 9)" },
      },
    },
  },

  {
    name: "get_bollinger_bands",
    description:
      "종목의 볼린저 밴드를 계산합니다. 중간선(SMA), 상단·하단 밴드, %B(현재가 위치), 밴드폭을 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: {
          type: "string",
          enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"],
          description: "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
        },
        period: { type: "number", description: "SMA 기간 (기본값 20)" },
        multiplier: { type: "number", description: "표준편차 배수 (기본값 2)" },
        price_field: {
          type: "string",
          enum: ["close", "open", "high", "low", "hl_avg", "hlc_avg", "ohlc_avg"],
          description: "계산 기준가 (기본값 close)",
        },
      },
    },
  },

  {
    name: "get_ema",
    description:
      "종목의 지수이동평균(EMA)을 계산합니다. 캔들 데이터를 기반으로 지정한 봉 단위·기간·계산 기준으로 EMA 시계열을 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval", "period"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: {
          type: "string",
          enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"],
          description: "봉 단위: 1m(1분), 5m(5분), 30m(30분), 60m(60분/1시간), 1d(일봉), 1w(주봉), 1mo(월봉)",
        },
        period: {
          type: "number",
          description: "EMA 기간 (예: 5, 10, 20, 60, 120, 200)",
        },
        price_field: {
          type: "string",
          enum: ["close", "open", "high", "low", "hl_avg", "hlc_avg", "ohlc_avg"],
          description: "계산 기준가. close(종가, 기본값), open(시가), high(고가), low(저가), hl_avg(고저평균), hlc_avg(고저종평균), ohlc_avg(시고저종평균)",
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
    case "issue_token": {
      const token = await issueTokenWithCredentials(
        process.env.TOSSINVEST_API_KEY!,
        process.env.TOSSINVEST_SECRET_KEY!,
      );
      return {
        access_token: token,
        message: "토큰이 재발급되어 메모리에 저장되었습니다. 이후 모든 API 호출에 자동으로 사용됩니다.",
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

    case "get_rsi": {
      const symbol = String(args.symbol);
      const rsiInterval = String(args.interval) as EmaInterval;
      const period = Number(args.period ?? 14);
      const overbought = Number(args.overbought ?? 70);
      const oversold = Number(args.oversold ?? 30);
      const signalPeriod = Number(args.signal_period ?? args.period ?? 14);

      const rawPerUnit: Record<EmaInterval, number> = {
        "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22,
      };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(rsiInterval) ? "1d" : "1m";
      const rawNeeded = (period + 1) * 2 * rawPerUnit[rsiInterval];

      const rawCandles = await fetchCandleBatches(symbol, rawInterval, rawNeeded);
      const needsAggregation = !["1d", "1m"].includes(rsiInterval);
      const candles = needsAggregation
        ? aggregateCandles(rawCandles, makeBucketKey(rsiInterval))
        : rawCandles;

      if (candles.length < period + 1) {
        throw new Error(
          `RSI 계산에 필요한 데이터가 부족합니다. 필요: ${period + 1}개, 조회됨: ${candles.length}개 (${rsiInterval} 봉)`,
        );
      }

      const prices = candles.map((c) => c.close);
      const rsiValues = calculateRSI(prices, period);

      // signal line: EMA of RSI values
      const signalOffset = signalPeriod - 1;
      const signalValues = calculateEMA(rsiValues.map((r) => r.rsi), signalPeriod);

      const results = rsiValues.map(({ time_index, rsi }, i) => {
        const zone = rsi >= overbought ? "overbought" : rsi <= oversold ? "oversold" : "neutral";
        const signal = i >= signalOffset ? signalValues[i - signalOffset] : undefined;
        const prevSignal = i > signalOffset ? signalValues[i - signalOffset - 1] : undefined;
        const prevRsi = i > 0 ? rsiValues[i - 1].rsi : undefined;
        const crossover =
          signal !== undefined && prevSignal !== undefined && prevRsi !== undefined
            ? prevRsi < prevSignal && rsi >= signal
              ? "bullish"
              : prevRsi > prevSignal && rsi <= signal
              ? "bearish"
              : null
            : null;

        return {
          time: candles[time_index].time,
          rsi,
          zone,
          ...(signal !== undefined && { signal: Math.round(signal * 100) / 100 }),
          ...(crossover !== null && { crossover }),
        };
      });

      const latest = results[results.length - 1];
      return {
        symbol,
        interval: rsiInterval,
        period,
        overbought,
        oversold,
        midline: 50,
        signal_period: signalPeriod,
        candle_count: candles.length,
        rsi_count: results.length,
        latest_rsi: latest?.rsi ?? null,
        latest_zone: latest?.zone ?? null,
        ...(latest?.signal !== undefined && { latest_signal: latest.signal }),
        rsi: results,
      };
    }

    case "get_macd": {
      const symbol = String(args.symbol);
      const macdInterval = String(args.interval) as EmaInterval;
      const fast = Number(args.fast_period ?? 12);
      const slow = Number(args.slow_period ?? 26);
      const signal = Number(args.signal_period ?? 9);

      const rawPerUnit: Record<EmaInterval, number> = {
        "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22,
      };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(macdInterval) ? "1d" : "1m";
      const rawNeeded = (slow + signal) * 2 * rawPerUnit[macdInterval];

      const rawCandles = await fetchCandleBatches(symbol, rawInterval, rawNeeded);
      const candles = !["1d", "1m"].includes(macdInterval)
        ? aggregateCandles(rawCandles, makeBucketKey(macdInterval))
        : rawCandles;

      if (candles.length < slow + signal - 1) {
        throw new Error(
          `MACD 계산에 필요한 데이터가 부족합니다. 필요: ${slow + signal - 1}개, 조회됨: ${candles.length}개 (${macdInterval} 봉)`,
        );
      }

      const prices = candles.map((c) => c.close);
      const macdData = calculateMACD(prices, fast, slow, signal);

      const results = macdData.map((d, i) => {
        const prev = i > 0 ? macdData[i - 1] : null;
        const crossover =
          prev !== null
            ? prev.macd < prev.signal && d.macd >= d.signal
              ? "bullish"
              : prev.macd > prev.signal && d.macd <= d.signal
              ? "bearish"
              : null
            : null;
        return {
          time: candles[d.price_index].time,
          macd: Math.round(d.macd * 100) / 100,
          signal: Math.round(d.signal * 100) / 100,
          histogram: Math.round(d.histogram * 100) / 100,
          ...(crossover !== null && { crossover }),
        };
      });

      const latest = results[results.length - 1];
      return {
        symbol,
        interval: macdInterval,
        fast_period: fast,
        slow_period: slow,
        signal_period: signal,
        candle_count: candles.length,
        macd_count: results.length,
        latest_macd: latest?.macd ?? null,
        latest_signal: latest?.signal ?? null,
        latest_histogram: latest?.histogram ?? null,
        macd: results,
      };
    }

    case "get_bollinger_bands": {
      const symbol = String(args.symbol);
      const bbInterval = String(args.interval) as EmaInterval;
      const period = Number(args.period ?? 20);
      const multiplier = Number(args.multiplier ?? 2);
      const priceField: PriceField = (args.price_field as PriceField) ?? "close";

      const rawPerUnit: Record<EmaInterval, number> = {
        "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22,
      };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(bbInterval) ? "1d" : "1m";
      const rawNeeded = period * 2 * rawPerUnit[bbInterval];

      const rawCandles = await fetchCandleBatches(symbol, rawInterval, rawNeeded);
      const candles = !["1d", "1m"].includes(bbInterval)
        ? aggregateCandles(rawCandles, makeBucketKey(bbInterval))
        : rawCandles;

      if (candles.length < period) {
        throw new Error(
          `볼린저 밴드 계산에 필요한 데이터가 부족합니다. 필요: ${period}개, 조회됨: ${candles.length}개 (${bbInterval} 봉)`,
        );
      }

      const prices = candles.map((c) => getPrice(c, priceField));
      const bbData = calculateBollingerBands(prices, period, multiplier);

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const round4 = (n: number) => Math.round(n * 10000) / 10000;

      const results = bbData.map((d) => ({
        time: candles[d.price_index].time,
        upper: round2(d.upper),
        middle: round2(d.middle),
        lower: round2(d.lower),
        percent_b: round4(d.percent_b),
        bandwidth: round4(d.bandwidth),
      }));

      const latest = results[results.length - 1];
      return {
        symbol,
        interval: bbInterval,
        period,
        multiplier,
        price_field: priceField,
        candle_count: candles.length,
        bb_count: results.length,
        latest_upper: latest?.upper ?? null,
        latest_middle: latest?.middle ?? null,
        latest_lower: latest?.lower ?? null,
        latest_percent_b: latest?.percent_b ?? null,
        latest_bandwidth: latest?.bandwidth ?? null,
        bollinger_bands: results,
      };
    }

    case "get_ema": {
      const symbol = String(args.symbol);
      const emaInterval = String(args.interval) as EmaInterval;
      const period = Number(args.period);
      const priceField: PriceField = (args.price_field as PriceField) ?? "close";

      // raw candles per one aggregated candle (for fetch size estimation)
      const rawPerUnit: Record<EmaInterval, number> = {
        "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22,
      };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(emaInterval) ? "1d" : "1m";
      const rawNeeded = period * 2 * rawPerUnit[emaInterval];

      const rawCandles = await fetchCandleBatches(symbol, rawInterval, rawNeeded);
      const needsAggregation = !["1d", "1m"].includes(emaInterval);
      const candles = needsAggregation
        ? aggregateCandles(rawCandles, makeBucketKey(emaInterval))
        : rawCandles;

      if (candles.length < period) {
        throw new Error(
          `EMA 계산에 필요한 데이터가 부족합니다. 필요: ${period}개, 조회됨: ${candles.length}개 (${emaInterval} 봉)`,
        );
      }

      const prices = candles.map((c) => getPrice(c, priceField));
      const emaValues = calculateEMA(prices, period);

      const results = emaValues.map((value, i) => ({
        time: candles[period - 1 + i].time,
        ema: Math.round(value * 100) / 100,
      }));

      return {
        symbol,
        interval: emaInterval,
        period,
        price_field: priceField,
        candle_count: candles.length,
        ema_count: results.length,
        latest_ema: results[results.length - 1]?.ema ?? null,
        ema: results,
      };
    }

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

if (!process.env.TOSSINVEST_API_KEY || !process.env.TOSSINVEST_SECRET_KEY) {
  process.stderr.write(
    "오류: 환경변수 TOSSINVEST_API_KEY와 TOSSINVEST_SECRET_KEY가 필요합니다.\n",
  );
  process.exit(1);
}

const transport = new StdioServerTransport();
await server.connect(transport);

// 서버 시작 시 토큰 자동 발급
await issueTokenWithCredentials(
  process.env.TOSSINVEST_API_KEY,
  process.env.TOSSINVEST_SECRET_KEY,
);
