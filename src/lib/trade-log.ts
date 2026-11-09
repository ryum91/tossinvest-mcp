import { Mutex } from "es-toolkit";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { TRADE_LOG_PATH } from "../config.js";
import { errorMessage } from "./errors.js";

// ─── Trade log ───────────────────────────────────────────────────────────────

export interface TradeLogEntry {
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

export async function readTradeLog(): Promise<TradeLogEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(TRADE_LOG_PATH, "utf-8"));
    return Array.isArray(parsed) ? (parsed as TradeLogEntry[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    // 파일이 손상된 경우 덮어써서 기존 기록을 잃지 않도록 에러로 알림
    throw new Error(`매매 로그 파일을 읽을 수 없습니다 (${TRADE_LOG_PATH}): ${errorMessage(err)}`, { cause: err });
  }
}

// 동시 호출 시 read-modify-write 경합으로 기록이 유실되지 않도록 직렬화
const tradeLogMutex = new Mutex();

export async function appendTradeLog(entry: TradeLogEntry): Promise<void> {
  await tradeLogMutex.acquire();
  try {
    const entries = await readTradeLog();
    entries.push(entry);
    await mkdir(dirname(TRADE_LOG_PATH), { recursive: true });
    await writeFile(TRADE_LOG_PATH, JSON.stringify(entries, null, 2), "utf-8");
  } finally {
    tradeLogMutex.release();
  }
}
