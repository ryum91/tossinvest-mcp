import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export const BASE_URL = "https://openapi.tossinvest.com";
export const SERVER_VERSION = "2.0.0";

// ─── Env loading ─────────────────────────────────────────────────────────────
// 패키지 루트(dist/..)의 .env.local → .env 순서로 읽어 process.env 에 없는 값만 채웁니다.
// MCP 클라이언트 config 의 env 블록 / 셸 환경변수가 항상 우선합니다.

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === "") continue; // 빈 값(.env 템플릿)은 무시
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

loadEnvFile(join(PACKAGE_ROOT, ".env.local"));
loadEnvFile(join(PACKAGE_ROOT, ".env"));

// 신규 변수명(TOSSINVEST_CLIENT_ID / TOSSINVEST_CLIENT_SECRET) 우선, 구 변수명은 하위 호환용
export const CLIENT_ID = process.env.TOSSINVEST_CLIENT_ID || process.env.TOSSINVEST_API_KEY || "";
export const CLIENT_SECRET = process.env.TOSSINVEST_CLIENT_SECRET || process.env.TOSSINVEST_SECRET_KEY || "";

// ─── Local file paths ───────────────────────────────────────────────────────

export const TOKEN_CACHE_PATH =
  process.env.TOSSINVEST_TOKEN_CACHE_PATH ?? join(process.env.HOME ?? process.cwd(), ".tossinvest-mcp", "token.json");
export const TRADE_LOG_PATH =
  process.env.TOSSINVEST_TRADE_LOG_PATH ?? join(process.env.HOME ?? process.cwd(), ".tossinvest-mcp", "trade-log.json");
