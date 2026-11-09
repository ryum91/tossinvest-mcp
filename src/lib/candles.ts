import { clamp, groupBy, sumBy } from "es-toolkit";
import { apiRequest } from "../api/client.js";

// ─── Candles: 조회 · 집계 ────────────────────────────────────────────────────

// API 응답 캔들 (신규 스펙: result.candles[], 최신순, timestamp/openPrice/... 문자열 decimal)
interface CandleRaw {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency?: string;
}

interface CandlePage {
  candles?: CandleRaw[];
  nextBefore?: string | null;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PriceField = "close" | "open" | "high" | "low" | "hl_avg" | "hlc_avg" | "ohlc_avg";
export type EmaInterval = "1m" | "5m" | "30m" | "60m" | "1d" | "1w" | "1mo";

export const EMA_INTERVALS: EmaInterval[] = ["1m", "5m", "30m", "60m", "1d", "1w", "1mo"];
export const RAW_PER_UNIT: Record<EmaInterval, number> = {
  "1m": 1,
  "5m": 5,
  "30m": 30,
  "60m": 60,
  "1d": 1,
  "1w": 5,
  "1mo": 22,
};
const MAX_CANDLE_PAGES = 40; // 200봉 × 40페이지 = 최대 8,000봉 (MARKET_DATA_CHART 초당 20회 한도 내)

export function parseInterval(v: string | undefined, fallback?: EmaInterval): EmaInterval {
  const s = v ?? fallback;
  if (!s || !EMA_INTERVALS.includes(s as EmaInterval)) {
    throw new Error(`interval 값이 올바르지 않습니다: ${s}. 허용값: ${EMA_INTERVALS.join(", ")}`);
  }
  return s as EmaInterval;
}

export const candleCurrency = new Map<string, string>(); // symbol → 캔들 응답 currency

export async function fetchCandleBatches(
  symbol: string,
  rawInterval: "1m" | "1d",
  targetCount: number,
): Promise<Candle[]> {
  const byTime = new Map<string, Candle>();
  let before: string | undefined;
  const maxPages = clamp(Math.ceil(targetCount / 200), 1, MAX_CANDLE_PAGES);

  for (let page = 0; page < maxPages; page++) {
    const res = (await apiRequest("GET", "/api/v1/candles", {
      symbol,
      interval: rawInterval,
      count: 200,
      before,
      adjusted: true,
    })) as CandlePage;

    const batch = res?.candles ?? [];
    if (batch.length === 0) break;
    if (batch[0]?.currency) candleCurrency.set(symbol, batch[0].currency);

    for (const c of batch) {
      // before 는 inclusive 이므로 페이지 경계 봉이 중복될 수 있어 timestamp 로 dedupe
      byTime.set(c.timestamp, {
        time: c.timestamp,
        open: Number(c.openPrice),
        high: Number(c.highPrice),
        low: Number(c.lowPrice),
        close: Number(c.closePrice),
        volume: Number(c.volume),
      });
    }

    if (!res.nextBefore || res.nextBefore === before) break;
    before = res.nextBefore;
  }

  return [...byTime.values()]
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** ISO 8601 문자열의 타임존 오프셋(분). 없으면 0(UTC). */
function tzOffsetMinutes(iso: string): number {
  const m = iso.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function formatWithOffset(localMs: number, offsetMin: number): string {
  const d = new Date(localMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function makeBucketKey(interval: EmaInterval): (c: Candle) => string {
  if (interval === "1mo") {
    return (c) => c.time.slice(0, 7); // YYYY-MM (현지 날짜 기준)
  }
  if (interval === "1w") {
    // 일봉 timestamp 는 현지 자정(+09:00 등)이므로 UTC 로 변환하면 하루가 밀립니다 → 현지 날짜 문자열로 계산
    return (c) => {
      const [y, m, d] = c.time.slice(0, 10).split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      const day = date.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day; // 월요일 시작
      return new Date(Date.UTC(y, m - 1, d + diff)).toISOString().slice(0, 10);
    };
  }
  // 분 단위 집계: 1분봉 timestamp 는 "봉 종료 시각" 이므로 1분을 빼서 봉 시작 시각 기준으로 버킷팅
  const minutes = { "1m": 1, "5m": 5, "30m": 30, "60m": 60, "1d": 1440 }[interval] ?? 1;
  return (c) => {
    const offset = tzOffsetMinutes(c.time);
    const localStartMs = Date.parse(c.time) + offset * 60_000 - 60_000;
    const bucketMs = Math.floor(localStartMs / (minutes * 60_000)) * minutes * 60_000;
    return formatWithOffset(bucketMs, offset); // 버킷 시작 시각 (현지 오프셋 표기)
  };
}

/** 지표 계산용 캔들 로드: 원본 1m/1d 봉을 받아 필요 시 상위 봉으로 집계 */
export async function loadCandles(symbol: string, interval: EmaInterval, targetBars: number): Promise<Candle[]> {
  const rawInterval: "1m" | "1d" = ["1d", "1w", "1mo"].includes(interval) ? "1d" : "1m";
  const raw = await fetchCandleBatches(symbol, rawInterval, Math.ceil(targetBars * RAW_PER_UNIT[interval]));
  return interval === "1m" || interval === "1d" ? raw : aggregateCandles(raw, makeBucketKey(interval));
}

export function aggregateCandles(candles: Candle[], keyFn: (c: Candle) => string): Candle[] {
  return Object.entries(groupBy(candles, keyFn))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, group]) => ({
      time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: sumBy(group, (c) => c.volume),
    }));
}

export function getPrice(candle: Candle, field: PriceField): number {
  switch (field) {
    case "hl_avg":
      return (candle.high + candle.low) / 2;
    case "hlc_avg":
      return (candle.high + candle.low + candle.close) / 3;
    case "ohlc_avg":
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    default:
      return candle[field];
  }
}
