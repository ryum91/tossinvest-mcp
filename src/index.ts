#!/usr/bin/env node
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
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
  if (!res.ok) {
    const detail = JSON.stringify(data);
    const hint = data.error === "access_denied" && String(data.error_description ?? "").includes("IP")
      ? " → TossInvest 개발자 센터에서 현재 IP를 허용 목록에 추가하세요."
      : "";
    throw new Error(`토큰 발급 실패 (HTTP ${res.status}): ${detail}${hint}`);
  }
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

function calculateIchimoku(
  candles: Candle[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouBPeriod: number,
  displacement: number,
): {
  results: {
    time_index: number;
    tenkan: number | null;
    kijun: number | null;
    chikou: number | null;
    senkou_a: number | null;
    senkou_b: number | null;
  }[];
  forecast: { periods_ahead: number; senkou_a: number | null; senkou_b: number | null }[];
} {
  const n = candles.length;

  const rangeMiddle = (endIdx: number, period: number): number | null => {
    if (endIdx < period - 1) return null;
    let max = -Infinity, min = Infinity;
    for (let i = endIdx - period + 1; i <= endIdx; i++) {
      if (candles[i].high > max) max = candles[i].high;
      if (candles[i].low < min) min = candles[i].low;
    }
    return (max + min) / 2;
  };

  const tenkan = candles.map((_, i) => rangeMiddle(i, tenkanPeriod));
  const kijun = candles.map((_, i) => rangeMiddle(i, kijunPeriod));

  const results = candles.map((_, i) => {
    const senkouCalcIdx = i - displacement;
    const ft = senkouCalcIdx >= 0 ? tenkan[senkouCalcIdx] : null;
    const fk = senkouCalcIdx >= 0 ? kijun[senkouCalcIdx] : null;
    const senkou_a = ft !== null && fk !== null ? (ft + fk) / 2 : null;
    const senkou_b = senkouCalcIdx >= 0 ? rangeMiddle(senkouCalcIdx, senkouBPeriod) : null;
    const chikou = i + displacement < n ? candles[i + displacement].close : null;
    return { time_index: i, tenkan: tenkan[i], kijun: kijun[i], chikou, senkou_a, senkou_b };
  });

  // Future cloud: already deterministic from existing tenkan/kijun data
  const forecast = [];
  for (let j = 1; j <= displacement; j++) {
    const calcIdx = n - displacement - 1 + j;
    if (calcIdx < 0 || calcIdx >= n) continue;
    const ft = tenkan[calcIdx];
    const fk = kijun[calcIdx];
    const senkou_a = ft !== null && fk !== null ? (ft + fk) / 2 : null;
    const senkou_b = rangeMiddle(calcIdx, senkouBPeriod);
    forecast.push({ periods_ahead: j, senkou_a, senkou_b });
  }

  return { results, forecast };
}

function calculateATR(candles: Candle[], period: number): { time_index: number; atr: number }[] {
  if (candles.length < period + 1) return [];
  const tr = candles.slice(1).map((c, i) =>
    Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)),
  );
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const results: { time_index: number; atr: number }[] = [{ time_index: period, atr }];
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    results.push({ time_index: i + 1, atr });
  }
  return results;
}

function calculateADX(
  candles: Candle[],
  period: number,
): { time_index: number; adx: number; plus_di: number; minus_di: number }[] {
  if (candles.length < 2 * period + 1) return [];
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM.push(up > 0 && up > dn ? up : 0);
    minusDM.push(dn > 0 && dn > up ? dn : 0);
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }
  const wilderSum = (arr: number[]): number[] => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const sTR = wilderSum(tr), sPDM = wilderSum(plusDM), sMDM = wilderSum(minusDM);
  const plusDI = sPDM.map((v, i) => sTR[i] === 0 ? 0 : 100 * v / sTR[i]);
  const minusDI = sMDM.map((v, i) => sTR[i] === 0 ? 0 : 100 * v / sTR[i]);
  const dx = plusDI.map((p, i) => { const s = p + minusDI[i]; return s === 0 ? 0 : 100 * Math.abs(p - minusDI[i]) / s; });
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const results: { time_index: number; adx: number; plus_di: number; minus_di: number }[] = [
    { time_index: 2 * period - 1, adx, plus_di: plusDI[period - 1], minus_di: minusDI[period - 1] },
  ];
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    const j = i - period + 1;
    results.push({ time_index: 2 * period - 1 + j, adx, plus_di: plusDI[period - 1 + j], minus_di: minusDI[period - 1 + j] });
  }
  return results;
}

function calculateStochastic(
  candles: Candle[],
  kPeriod: number,
  smoothK: number,
  dPeriod: number,
): { time_index: number; k: number; d: number | null }[] {
  if (candles.length < kPeriod + smoothK + dPeriod - 2) return [];
  const rawK = candles.slice(kPeriod - 1).map((c, i) => {
    const slice = candles.slice(i, i + kPeriod);
    const hi = Math.max(...slice.map((s) => s.high));
    const lo = Math.min(...slice.map((s) => s.low));
    return hi === lo ? 50 : (c.close - lo) / (hi - lo) * 100;
  });
  const smoothedK: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    smoothedK.push(rawK.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + b, 0) / smoothK);
  }
  return smoothedK.map((k, i) => ({
    time_index: kPeriod + smoothK - 2 + i,
    k,
    d: i >= dPeriod - 1 ? smoothedK.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod : null,
  }));
}

function calculateOBV(candles: Candle[]): number[] {
  const obv = [candles[0].volume];
  for (let i = 1; i < candles.length; i++) {
    const prev = obv[i - 1];
    obv.push(
      candles[i].close > candles[i - 1].close ? prev + candles[i].volume
        : candles[i].close < candles[i - 1].close ? prev - candles[i].volume
        : prev,
    );
  }
  return obv;
}

function calculateParabolicSAR(
  candles: Candle[],
  initialAF: number,
  step: number,
  maxAF: number,
): { time_index: number; sar: number; trend: "bullish" | "bearish"; reversal: boolean }[] {
  if (candles.length < 2) return [];
  let isBullish = candles[1].close > candles[0].close;
  let af = initialAF;
  let ep = isBullish ? candles[0].high : candles[0].low;
  let sar = isBullish ? candles[0].low : candles[0].high;
  const results: { time_index: number; sar: number; trend: "bullish" | "bearish"; reversal: boolean }[] = [];
  for (let i = 1; i < candles.length; i++) {
    sar = sar + af * (ep - sar);
    let reversal = false;
    if (isBullish) {
      sar = i >= 2 ? Math.min(sar, candles[i - 1].low, candles[i - 2].low) : Math.min(sar, candles[i - 1].low);
      if (candles[i].low <= sar) {
        isBullish = false; sar = ep; ep = candles[i].low; af = initialAF; reversal = true;
      } else if (candles[i].high > ep) {
        ep = candles[i].high; af = Math.min(af + step, maxAF);
      }
    } else {
      sar = i >= 2 ? Math.max(sar, candles[i - 1].high, candles[i - 2].high) : Math.max(sar, candles[i - 1].high);
      if (candles[i].high >= sar) {
        isBullish = true; sar = ep; ep = candles[i].high; af = initialAF; reversal = true;
      } else if (candles[i].low < ep) {
        ep = candles[i].low; af = Math.min(af + step, maxAF);
      }
    }
    results.push({ time_index: i, sar, trend: isBullish ? "bullish" : "bearish", reversal });
  }
  return results;
}

// ─── Trade log ───────────────────────────────────────────────────────────────

const TRADE_LOG_PATH = process.env.TOSSINVEST_TRADE_LOG_PATH ??
  join(process.env.HOME ?? process.cwd(), ".tossinvest-mcp", "trade-log.json");

interface TradeLogEntry {
  id: string;
  timestamp: string;
  symbol: string;
  side: "BUY" | "SELL";
  order_type: string;
  quantity: string;
  price?: string;
  order_id?: string;
  rationale?: string;
  indicators?: Record<string, unknown>;
  tags?: string[];
  account_seq: number;
}

async function readTradeLog(): Promise<TradeLogEntry[]> {
  try {
    return JSON.parse(await readFile(TRADE_LOG_PATH, "utf-8")) as TradeLogEntry[];
  } catch {
    return [];
  }
}

async function appendTradeLog(entry: TradeLogEntry): Promise<void> {
  const entries = await readTradeLog();
  entries.push(entry);
  await mkdir(dirname(TRADE_LOG_PATH), { recursive: true });
  await writeFile(TRADE_LOG_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools: Tool[] = [
  // ── Trade Log ─────────────────────────────────────────────────────────────
  {
    name: "log_trade",
    description:
      "매매 실행 후 근거·지표 스냅샷을 로컬 파일에 기록합니다. create_order 호출 후 반드시 호출해 AI 매매 이력을 남깁니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "side", "quantity", "account_seq"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        side: { type: "string", enum: ["BUY", "SELL"], description: "매수/매도 방향" },
        quantity: { type: "string", description: "주문 수량" },
        account_seq: { type: "number", description: "계좌 식별자" },
        order_type: { type: "string", description: "주문 유형 (LIMIT/MARKET)" },
        price: { type: "string", description: "주문 가격" },
        order_id: { type: "string", description: "create_order 응답의 orderId" },
        rationale: { type: "string", description: "매매 근거 — 어떤 신호와 판단으로 주문했는지 자세히 기술" },
        indicators: {
          type: "object",
          description: "당시 주요 지표 스냅샷 (get_technical_summary 결과 등을 그대로 전달)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "분류 태그 (예: ['trend-follow', 'rsi-oversold'])",
        },
      },
    },
  },
  {
    name: "get_trade_log",
    description:
      "로컬에 저장된 AI 매매 이력을 조회합니다. 과거 매매 근거·지표 상태를 파악해 현재 전략 판단에 활용합니다.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "특정 종목만 필터링 (선택)" },
        side: { type: "string", enum: ["BUY", "SELL"], description: "매수/매도 필터링 (선택)" },
        from_date: { type: "string", description: "조회 시작일 (YYYY-MM-DD)" },
        to_date: { type: "string", description: "조회 종료일 (YYYY-MM-DD)" },
        limit: { type: "number", description: "최대 조회 건수 (기본값 50, 최신순)" },
      },
    },
  },

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
    name: "get_ichimoku",
    description:
      "종목의 일목균형표를 계산합니다. 전환선·기준선·선행스팬1·2·후행스팬과 구름(kumo) 방향, 향후 displacement 기간의 구름 예측을 반환합니다.",
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
        tenkan_period: { type: "number", description: "전환선 기간 (기본값 9)" },
        kijun_period: { type: "number", description: "기준선 기간 (기본값 26)" },
        senkou_b_period: { type: "number", description: "선행스팬2 기간 (기본값 52)" },
        displacement: { type: "number", description: "선행·후행 이동 기간 (기본값 26)" },
      },
    },
  },

  {
    name: "get_atr",
    description: "종목의 ATR(평균 실제 범위)을 계산합니다. Wilder 평활법 사용. 변동성 측정으로 포지션 사이징과 스탑로스 거리 자동 설정에 활용됩니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "봉 단위" },
        period: { type: "number", description: "기간 (기본값 14)" },
      },
    },
  },

  {
    name: "get_adx",
    description: "종목의 ADX(평균 방향성 지수)를 계산합니다. ADX≥25이면 강한 추세, +DI>-DI이면 상승 추세. 추세/횡보 판별로 전략 전환에 활용됩니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "봉 단위" },
        period: { type: "number", description: "기간 (기본값 14)" },
      },
    },
  },

  {
    name: "get_stochastic",
    description: "종목의 Slow Stochastic을 계산합니다. %K, %D, 과매수(≥80)/과매도(≤20) 구간, 크로스오버 신호를 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "봉 단위" },
        k_period: { type: "number", description: "%K 기간 (기본값 14)" },
        smooth_k: { type: "number", description: "%K 평활 기간, 1이면 Fast Stochastic (기본값 3)" },
        d_period: { type: "number", description: "%D 기간 (기본값 3)" },
      },
    },
  },

  {
    name: "get_obv",
    description: "종목의 OBV(누적 거래량)를 계산합니다. 시그널 라인(EMA of OBV)과 비교해 거래량 기반 추세 방향을 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "봉 단위" },
        signal_period: { type: "number", description: "시그널 라인 기간 (기본값 20)" },
      },
    },
  },

  {
    name: "get_volume_ma",
    description: "종목의 거래량 이동평균을 계산합니다. 현재/평균 거래량 비율로 급등 거래량을 감지합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "봉 단위" },
        period: { type: "number", description: "이동평균 기간 (기본값 20)" },
        spike_threshold: { type: "number", description: "거래량 급등 판단 비율 (기본값 2.0, 평균 대비 2배 이상)" },
      },
    },
  },

  {
    name: "get_parabolic_sar",
    description: "종목의 Parabolic SAR를 계산합니다. 추세 방향·반전 신호·트레일링 스탑 기준선을 반환합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "interval"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "봉 단위" },
        initial_af: { type: "number", description: "초기 가속 인수 (기본값 0.02)" },
        step: { type: "number", description: "가속 인수 증가량 (기본값 0.02)" },
        max_af: { type: "number", description: "최대 가속 인수 (기본값 0.2)" },
      },
    },
  },

  {
    name: "get_technical_summary",
    description:
      "종목의 주요 기술 지표를 한 번에 조회합니다. 현재가·RSI·MACD·볼린저밴드·ADX·ATR·스토캐스틱·EMA20/60·거래량MA와 종합 신호(signal score)를 반환합니다. AI 자동매매에서 분석 호출 횟수를 최소화하는 데 적합합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        interval: {
          type: "string",
          enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"],
          description: "봉 단위 (기본값 1d)",
        },
      },
    },
  },

  {
    name: "get_position_risk",
    description:
      "ATR 기반 스탑로스 가격과 계좌 잔고 대비 적정 포지션 규모를 계산합니다. AI 자동매매에서 주문 전 리스크 관리용으로 호출합니다.",
    inputSchema: {
      type: "object",
      required: ["symbol", "account_seq"],
      properties: {
        symbol: { type: "string", description: "종목 심볼 (예: 005930, AAPL)" },
        account_seq: { type: "number", description: "계좌 식별자 (get_accounts로 조회한 accountSeq)" },
        side: { type: "string", enum: ["BUY", "SELL"], description: "매수/매도 방향 (기본값 BUY)" },
        interval: { type: "string", enum: ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"], description: "ATR 계산 봉 단위 (기본값 1d)" },
        entry_price: { type: "number", description: "진입 가격. 생략 시 최근 종가 사용" },
        atr_period: { type: "number", description: "ATR 기간 (기본값 14)" },
        atr_multiplier: { type: "number", description: "스탑로스 거리 = ATR × 배수 (기본값 2.0)" },
        risk_percent: { type: "number", description: "계좌 잔고 대비 허용 손실 비율 % (기본값 1.0)" },
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
    // ── Trade Log ───────────────────────────────────────────────────────────
    case "log_trade": {
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
        ...(args.indicators !== undefined && { indicators: args.indicators as Record<string, unknown> }),
        ...(args.tags !== undefined && { tags: args.tags as string[] }),
      };
      await appendTradeLog(entry);
      return { success: true, id: entry.id, timestamp: entry.timestamp, log_path: TRADE_LOG_PATH };
    }

    case "get_trade_log": {
      let entries = await readTradeLog();
      if (args.symbol !== undefined) entries = entries.filter((e) => e.symbol === String(args.symbol));
      if (args.side !== undefined) entries = entries.filter((e) => e.side === String(args.side));
      if (args.from_date !== undefined) entries = entries.filter((e) => e.timestamp.slice(0, 10) >= String(args.from_date));
      if (args.to_date !== undefined) entries = entries.filter((e) => e.timestamp.slice(0, 10) <= String(args.to_date));
      const limit = args.limit !== undefined ? Number(args.limit) : 50;
      const result = entries.slice(-limit).reverse();
      return { total: entries.length, count: result.length, log_path: TRADE_LOG_PATH, trades: result };
    }

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

    case "get_ichimoku": {
      const symbol = String(args.symbol);
      const ichiInterval = String(args.interval) as EmaInterval;
      const tenkanPeriod = Number(args.tenkan_period ?? 9);
      const kijunPeriod = Number(args.kijun_period ?? 26);
      const senkouBPeriod = Number(args.senkou_b_period ?? 52);
      const displacement = Number(args.displacement ?? 26);

      const rawPerUnit: Record<EmaInterval, number> = {
        "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22,
      };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(ichiInterval) ? "1d" : "1m";
      const rawNeeded = (kijunPeriod + senkouBPeriod + displacement) * 3 * rawPerUnit[ichiInterval];

      const rawCandles = await fetchCandleBatches(symbol, rawInterval, rawNeeded);
      const candles = !["1d", "1m"].includes(ichiInterval)
        ? aggregateCandles(rawCandles, makeBucketKey(ichiInterval))
        : rawCandles;

      const minRequired = kijunPeriod + senkouBPeriod + displacement - 1;
      if (candles.length < minRequired) {
        throw new Error(
          `일목균형표 계산에 필요한 데이터가 부족합니다. 필요: ${minRequired}개, 조회됨: ${candles.length}개 (${ichiInterval} 봉)`,
        );
      }

      const { results: raw, forecast: rawForecast } = calculateIchimoku(
        candles, tenkanPeriod, kijunPeriod, senkouBPeriod, displacement,
      );

      const round2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;

      const ichimoku = raw
        .filter((d) => d.tenkan !== null || d.kijun !== null)
        .map((d) => {
          const cloud =
            d.senkou_a !== null && d.senkou_b !== null
              ? d.senkou_a > d.senkou_b ? "bullish" : d.senkou_a < d.senkou_b ? "bearish" : "neutral"
              : null;
          return {
            time: candles[d.time_index].time,
            ...(d.tenkan !== null && { tenkan: round2(d.tenkan) }),
            ...(d.kijun !== null && { kijun: round2(d.kijun) }),
            ...(d.chikou !== null && { chikou: round2(d.chikou) }),
            ...(d.senkou_a !== null && { senkou_a: round2(d.senkou_a) }),
            ...(d.senkou_b !== null && { senkou_b: round2(d.senkou_b) }),
            ...(cloud !== null && { cloud }),
          };
        });

      const cloud_forecast = rawForecast.map((f) => {
        const cloud =
          f.senkou_a !== null && f.senkou_b !== null
            ? f.senkou_a > f.senkou_b ? "bullish" : f.senkou_a < f.senkou_b ? "bearish" : "neutral"
            : null;
        return {
          periods_ahead: f.periods_ahead,
          ...(f.senkou_a !== null && { senkou_a: round2(f.senkou_a) }),
          ...(f.senkou_b !== null && { senkou_b: round2(f.senkou_b) }),
          ...(cloud !== null && { cloud }),
        };
      });

      const latest = ichimoku[ichimoku.length - 1];
      return {
        symbol,
        interval: ichiInterval,
        tenkan_period: tenkanPeriod,
        kijun_period: kijunPeriod,
        senkou_b_period: senkouBPeriod,
        displacement,
        candle_count: candles.length,
        ichimoku_count: ichimoku.length,
        latest_tenkan: latest?.tenkan ?? null,
        latest_kijun: latest?.kijun ?? null,
        latest_cloud: latest?.cloud ?? null,
        cloud_forecast,
        ichimoku,
      };
    }

    case "get_atr": {
      const symbol = String(args.symbol);
      const atrInterval = String(args.interval) as EmaInterval;
      const period = Number(args.period ?? 14);
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(atrInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, period * 3 * rawPerUnit[atrInterval]);
      const candles = !["1d", "1m"].includes(atrInterval) ? aggregateCandles(rawCandles, makeBucketKey(atrInterval)) : rawCandles;
      if (candles.length < period + 1) throw new Error(`ATR 계산 데이터 부족. 필요: ${period + 1}개, 조회됨: ${candles.length}개`);
      const atrData = calculateATR(candles, period);
      const results = atrData.map((d) => ({
        time: candles[d.time_index].time,
        atr: Math.round(d.atr * 100) / 100,
        atr_percent: Math.round(d.atr / candles[d.time_index].close * 10000) / 100,
      }));
      const latest = results[results.length - 1];
      return { symbol, interval: atrInterval, period, candle_count: candles.length, atr_count: results.length, latest_atr: latest?.atr ?? null, latest_atr_percent: latest?.atr_percent ?? null, atr: results };
    }

    case "get_adx": {
      const symbol = String(args.symbol);
      const adxInterval = String(args.interval) as EmaInterval;
      const period = Number(args.period ?? 14);
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(adxInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, period * 5 * rawPerUnit[adxInterval]);
      const candles = !["1d", "1m"].includes(adxInterval) ? aggregateCandles(rawCandles, makeBucketKey(adxInterval)) : rawCandles;
      if (candles.length < 2 * period + 1) throw new Error(`ADX 계산 데이터 부족. 필요: ${2 * period + 1}개, 조회됨: ${candles.length}개`);
      const adxData = calculateADX(candles, period);
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const results = adxData.map((d) => ({
        time: candles[d.time_index].time,
        adx: r2(d.adx),
        plus_di: r2(d.plus_di),
        minus_di: r2(d.minus_di),
        trend_strength: d.adx >= 25 ? "strong" : "weak",
        direction: d.plus_di > d.minus_di ? "bullish" : d.plus_di < d.minus_di ? "bearish" : "neutral",
      }));
      const latest = results[results.length - 1];
      return { symbol, interval: adxInterval, period, candle_count: candles.length, adx_count: results.length, latest_adx: latest?.adx ?? null, latest_plus_di: latest?.plus_di ?? null, latest_minus_di: latest?.minus_di ?? null, latest_trend_strength: latest?.trend_strength ?? null, latest_direction: latest?.direction ?? null, adx: results };
    }

    case "get_stochastic": {
      const symbol = String(args.symbol);
      const stochInterval = String(args.interval) as EmaInterval;
      const kPeriod = Number(args.k_period ?? 14);
      const smoothK = Number(args.smooth_k ?? 3);
      const dPeriod = Number(args.d_period ?? 3);
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(stochInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, (kPeriod + smoothK + dPeriod) * 3 * rawPerUnit[stochInterval]);
      const candles = !["1d", "1m"].includes(stochInterval) ? aggregateCandles(rawCandles, makeBucketKey(stochInterval)) : rawCandles;
      const minReq = kPeriod + smoothK + dPeriod - 2;
      if (candles.length < minReq) throw new Error(`스토캐스틱 계산 데이터 부족. 필요: ${minReq}개, 조회됨: ${candles.length}개`);
      const stochData = calculateStochastic(candles, kPeriod, smoothK, dPeriod);
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const results = stochData.map((d, i) => {
        const prev = i > 0 ? stochData[i - 1] : null;
        const crossover: "bullish" | "bearish" | null =
          d.d !== null && prev !== null && prev.d !== null
            ? prev.k < prev.d && d.k >= d.d ? "bullish"
            : prev.k > prev.d && d.k <= d.d ? "bearish" : null
            : null;
        return { time: candles[d.time_index].time, k: r2(d.k), d: d.d !== null ? r2(d.d) : null, zone: d.k >= 80 ? "overbought" : d.k <= 20 ? "oversold" : "neutral", ...(crossover !== null && { crossover }) };
      });
      const latest = results[results.length - 1];
      return { symbol, interval: stochInterval, k_period: kPeriod, smooth_k: smoothK, d_period: dPeriod, candle_count: candles.length, stochastic_count: results.length, latest_k: latest?.k ?? null, latest_d: latest?.d ?? null, latest_zone: latest?.zone ?? null, stochastic: results };
    }

    case "get_obv": {
      const symbol = String(args.symbol);
      const obvInterval = String(args.interval) as EmaInterval;
      const signalPeriod = Number(args.signal_period ?? 20);
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(obvInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, signalPeriod * 3 * rawPerUnit[obvInterval]);
      const candles = !["1d", "1m"].includes(obvInterval) ? aggregateCandles(rawCandles, makeBucketKey(obvInterval)) : rawCandles;
      if (candles.length < signalPeriod + 1) throw new Error(`OBV 계산 데이터 부족. 필요: ${signalPeriod + 1}개, 조회됨: ${candles.length}개`);
      const obvValues = calculateOBV(candles);
      const signalValues = calculateEMA(obvValues, signalPeriod);
      const signalOffset = signalPeriod - 1;
      const results = candles.map((c, i) => {
        const obv = obvValues[i];
        const signal = i >= signalOffset ? Math.round(signalValues[i - signalOffset]) : null;
        return { time: c.time, obv, signal, trend: signal !== null ? (obv > signal ? "bullish" : obv < signal ? "bearish" : "neutral") : null };
      });
      const latest = results[results.length - 1];
      return { symbol, interval: obvInterval, signal_period: signalPeriod, candle_count: candles.length, latest_obv: latest?.obv ?? null, latest_signal: latest?.signal ?? null, latest_trend: latest?.trend ?? null, obv: results };
    }

    case "get_volume_ma": {
      const symbol = String(args.symbol);
      const volInterval = String(args.interval) as EmaInterval;
      const period = Number(args.period ?? 20);
      const spikeThreshold = Number(args.spike_threshold ?? 2.0);
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(volInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, period * 3 * rawPerUnit[volInterval]);
      const candles = !["1d", "1m"].includes(volInterval) ? aggregateCandles(rawCandles, makeBucketKey(volInterval)) : rawCandles;
      if (candles.length < period) throw new Error(`거래량 이동평균 계산 데이터 부족. 필요: ${period}개, 조회됨: ${candles.length}개`);
      const results = candles.slice(period - 1).map((c, i) => {
        const volume_ma = Math.round(candles.slice(i, i + period).reduce((sum, s) => sum + s.volume, 0) / period);
        const ratio = Math.round(c.volume / volume_ma * 100) / 100;
        return { time: c.time, volume: c.volume, volume_ma, ratio, spike: ratio >= spikeThreshold };
      });
      const latest = results[results.length - 1];
      return { symbol, interval: volInterval, period, spike_threshold: spikeThreshold, candle_count: candles.length, volume_count: results.length, latest_volume: latest?.volume ?? null, latest_volume_ma: latest?.volume_ma ?? null, latest_ratio: latest?.ratio ?? null, latest_spike: latest?.spike ?? null, spike_count: results.filter((r) => r.spike).length, volume_ma: results };
    }

    case "get_parabolic_sar": {
      const symbol = String(args.symbol);
      const sarInterval = String(args.interval) as EmaInterval;
      const initialAF = Number(args.initial_af ?? 0.02);
      const step = Number(args.step ?? 0.02);
      const maxAF = Number(args.max_af ?? 0.2);
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(sarInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, 200 * rawPerUnit[sarInterval]);
      const candles = !["1d", "1m"].includes(sarInterval) ? aggregateCandles(rawCandles, makeBucketKey(sarInterval)) : rawCandles;
      if (candles.length < 2) throw new Error(`Parabolic SAR 계산 데이터 부족. 최소 2개 필요`);
      const sarData = calculateParabolicSAR(candles, initialAF, step, maxAF);
      const results = sarData.map((d) => ({ time: candles[d.time_index].time, sar: Math.round(d.sar * 100) / 100, trend: d.trend, reversal: d.reversal }));
      const latest = results[results.length - 1];
      return { symbol, interval: sarInterval, initial_af: initialAF, step, max_af: maxAF, candle_count: candles.length, sar_count: results.length, latest_sar: latest?.sar ?? null, latest_trend: latest?.trend ?? null, reversal_count: sarData.filter((d) => d.reversal).length, parabolic_sar: results };
    }

    case "get_technical_summary": {
      const symbol = String(args.symbol);
      const sumInterval = String(args.interval ?? "1d") as EmaInterval;
      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(sumInterval) ? "1d" : "1m";
      const rawCandles = await fetchCandleBatches(symbol, rawInterval, 200 * rawPerUnit[sumInterval]);
      const candles = !["1d", "1m"].includes(sumInterval) ? aggregateCandles(rawCandles, makeBucketKey(sumInterval)) : rawCandles;
      if (candles.length < 30) throw new Error(`기술 지표 계산 데이터 부족. 필요: 30개, 조회됨: ${candles.length}개`);

      const prices = candles.map((c) => c.close);
      const latest = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const r4 = (v: number) => Math.round(v * 10000) / 10000;

      const rsiArr = calculateRSI(prices, 14);
      const macdArr = calculateMACD(prices, 12, 26, 9);
      const bbArr = calculateBollingerBands(prices, 20, 2);
      const adxArr = candles.length >= 29 ? calculateADX(candles, 14) : [];
      const atrArr = calculateATR(candles, 14);
      const stochArr = calculateStochastic(candles, 14, 3, 3);
      const ema20Arr = calculateEMA(prices, 20);
      const ema60Arr = candles.length >= 60 ? calculateEMA(prices, 60) : [];

      const rsi = rsiArr[rsiArr.length - 1] ?? null;
      const macd = macdArr[macdArr.length - 1] ?? null;
      const bb = bbArr[bbArr.length - 1] ?? null;
      const adx = adxArr[adxArr.length - 1] ?? null;
      const atr = atrArr[atrArr.length - 1] ?? null;
      const stoch = stochArr[stochArr.length - 1] ?? null;
      const ema20 = ema20Arr[ema20Arr.length - 1] ?? null;
      const ema60 = ema60Arr.length > 0 ? ema60Arr[ema60Arr.length - 1] : null;

      const volWindow = candles.slice(-Math.min(20, candles.length));
      const volMA20 = Math.round(volWindow.reduce((s, c) => s + c.volume, 0) / volWindow.length);
      const volRatio = r2(latest.volume / volMA20);

      let score = 0;
      if (rsi) { if (rsi.rsi <= 30) score++; else if (rsi.rsi >= 70) score--; }
      if (macd) { if (macd.histogram > 0) score++; else if (macd.histogram < 0) score--; }
      if (ema20 !== null) { if (latest.close > ema20) score++; else if (latest.close < ema20) score--; }
      if (adx && adx.adx >= 25) { if (adx.plus_di > adx.minus_di) score++; else score--; }
      if (stoch) { if (stoch.k <= 20) score++; else if (stoch.k >= 80) score--; }
      const overall = score >= 3 ? "strong_buy" : score >= 1 ? "buy" : score <= -3 ? "strong_sell" : score <= -1 ? "sell" : "neutral";

      return {
        symbol,
        interval: sumInterval,
        candle_count: candles.length,
        price: {
          current: latest.close, open: latest.open, high: latest.high, low: latest.low, volume: latest.volume,
          change: r2(latest.close - prev.close),
          change_percent: r2((latest.close - prev.close) / prev.close * 100),
        },
        rsi: rsi ? { value: rsi.rsi, zone: rsi.rsi >= 70 ? "overbought" : rsi.rsi <= 30 ? "oversold" : "neutral" } : null,
        macd: macd ? { macd: r2(macd.macd), signal: r2(macd.signal), histogram: r2(macd.histogram), trend: macd.histogram > 0 ? "bullish" : "bearish" } : null,
        bollinger_bands: bb ? { upper: r2(bb.upper), middle: r2(bb.middle), lower: r2(bb.lower), percent_b: r4(bb.percent_b) } : null,
        adx: adx ? { adx: r2(adx.adx), plus_di: r2(adx.plus_di), minus_di: r2(adx.minus_di), strength: adx.adx >= 25 ? "strong" : "weak", direction: adx.plus_di > adx.minus_di ? "bullish" : "bearish" } : null,
        atr: atr ? { atr: r2(atr.atr), atr_percent: r2(atr.atr / latest.close * 100) } : null,
        stochastic: stoch ? { k: r2(stoch.k), d: stoch.d !== null ? r2(stoch.d) : null, zone: stoch.k >= 80 ? "overbought" : stoch.k <= 20 ? "oversold" : "neutral" } : null,
        ema: { ema20: ema20 !== null ? r2(ema20) : null, ema60: ema60 !== null ? r2(ema60) : null, price_vs_ema20: ema20 !== null ? (latest.close > ema20 ? "above" : "below") : null },
        volume: { current: latest.volume, ma20: volMA20, ratio: volRatio, spike: volRatio >= 2.0 },
        signal: { score, overall },
      };
    }

    case "get_position_risk": {
      const symbol = String(args.symbol);
      const accountSeq = Number(args.account_seq);
      const side = String(args.side ?? "BUY") as "BUY" | "SELL";
      const interval = String(args.interval ?? "1d") as EmaInterval;
      const atrPeriod = Number(args.atr_period ?? 14);
      const atrMultiplier = Number(args.atr_multiplier ?? 2.0);
      const riskPercent = Number(args.risk_percent ?? 1.0);
      const isKr = /^\d{6}$/.test(symbol);
      const currency = isKr ? "KRW" : "USD";

      const rawPerUnit: Record<EmaInterval, number> = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1, "1w": 5, "1mo": 22 };
      const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(interval) ? "1d" : "1m";

      const [rawCandles, bpData] = await Promise.all([
        fetchCandleBatches(symbol, rawInterval, atrPeriod * 3 * rawPerUnit[interval]),
        apiRequest("GET", "/api/v1/buying-power", { currency }, undefined, accountSeq) as Promise<Record<string, unknown>>,
      ]);
      const candles = !["1d", "1m"].includes(interval) ? aggregateCandles(rawCandles, makeBucketKey(interval)) : rawCandles;
      if (candles.length < atrPeriod + 1) throw new Error(`ATR 계산 데이터 부족. 필요: ${atrPeriod + 1}개, 조회됨: ${candles.length}개`);

      const atrData = calculateATR(candles, atrPeriod);
      const latestATR = atrData[atrData.length - 1]?.atr ?? 0;
      const currentPrice = candles[candles.length - 1].close;
      const entryPrice = args.entry_price !== undefined ? Number(args.entry_price) : currentPrice;

      const stopLossDistance = latestATR * atrMultiplier;
      const stopLossPrice = Math.round((side === "BUY" ? entryPrice - stopLossDistance : entryPrice + stopLossDistance) * 100) / 100;
      const stopLossPercent = Math.round(stopLossDistance / entryPrice * 10000) / 100;

      const bp = Number(bpData?.buyingPower ?? bpData?.buying_power ?? bpData?.amount ?? bpData?.availableAmount ?? 0);
      const riskAmount = bp * riskPercent / 100;
      const recommendedQuantity = stopLossDistance > 0 ? Math.floor(riskAmount / stopLossDistance) : 0;
      const r2 = (v: number) => Math.round(v * 100) / 100;

      return {
        symbol, interval, side, currency,
        current_price: currentPrice,
        entry_price: entryPrice,
        atr: r2(latestATR),
        atr_period: atrPeriod,
        atr_multiplier: atrMultiplier,
        stop_loss_price: stopLossPrice,
        stop_loss_distance: r2(stopLossDistance),
        stop_loss_percent: stopLossPercent,
        buying_power: bp,
        risk_percent: riskPercent,
        risk_amount: r2(riskAmount),
        recommended_quantity: recommendedQuantity,
        max_position_value: Math.round(recommendedQuantity * entryPrice),
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
try {
  await issueTokenWithCredentials(
    process.env.TOSSINVEST_API_KEY,
    process.env.TOSSINVEST_SECRET_KEY,
  );
  process.stderr.write("[tossinvest-mcp] 토큰 발급 성공. MCP 서버가 준비되었습니다.\n");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[tossinvest-mcp] 시작 실패: ${message}\n`);
  process.exit(1);
}
