import { readFile, writeFile, mkdir, chmod } from "fs/promises";
import { dirname } from "path";
import { errorMessage } from "../lib/errors.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET, TOKEN_CACHE_PATH } from "../config.js";

// ─── Token management ────────────────────────────────────────────────────────
// 토스증권은 클라이언트당 1개의 토큰만 유효합니다(새 토큰 발급 시 이전 토큰은 token-revoked).
// 여러 MCP 프로세스가 서로의 토큰을 무효화하지 않도록 토큰을 로컬 파일에 캐시해 공유합니다.

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface CachedToken {
  clientId: string;
  accessToken: string;
  expiresAt: number; // epoch ms
}

let currentToken: CachedToken | null = null;
let tokenInFlight: Promise<CachedToken> | null = null;

function isTokenFresh(t: CachedToken | null): t is CachedToken {
  return !!t && t.clientId === CLIENT_ID && t.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now();
}

async function readCachedToken(): Promise<CachedToken | null> {
  try {
    const t = JSON.parse(await readFile(TOKEN_CACHE_PATH, "utf-8")) as CachedToken;
    return typeof t.accessToken === "string" && typeof t.expiresAt === "number" ? t : null;
  } catch {
    return null;
  }
}

async function writeCachedToken(t: CachedToken): Promise<void> {
  try {
    await mkdir(dirname(TOKEN_CACHE_PATH), { recursive: true });
    await writeFile(TOKEN_CACHE_PATH, JSON.stringify(t), { encoding: "utf-8", mode: 0o600 });
    await chmod(TOKEN_CACHE_PATH, 0o600);
  } catch (err) {
    process.stderr.write(`[tossinvest-mcp] 토큰 캐시 저장 실패(무시): ${errorMessage(err)}\n`);
  }
}

export async function issueNewToken(): Promise<CachedToken> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("환경변수 TOSSINVEST_CLIENT_ID / TOSSINVEST_CLIENT_SECRET 가 설정되지 않았습니다.");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok || typeof data.access_token !== "string") {
    const hint =
      data.error === "access_denied"
        ? " → 토스증권 WTS 설정 > Open API > 허용 IP 관리에서 현재 IP를 등록했는지 확인하세요."
        : data.error === "invalid_client"
          ? " → client_id / client_secret 값을 확인하세요."
          : "";
    throw new Error(`토큰 발급 실패 (HTTP ${res.status}): ${JSON.stringify(data)}${hint}`);
  }
  const expiresIn = Number(data.expires_in ?? 86400);
  const token: CachedToken = {
    clientId: CLIENT_ID,
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  await writeCachedToken(token);
  return token;
}

/**
 * 유효한 액세스 토큰을 반환합니다.
 * force=true 이면 메모리 토큰을 버리고, 다른 프로세스가 갱신한 캐시 토큰이 있으면 그것을, 없으면 새로 발급합니다.
 */
export async function getAccessToken(force = false, rejected?: string): Promise<string> {
  if (!force && isTokenFresh(currentToken)) return currentToken.accessToken;
  if (tokenInFlight) return (await tokenInFlight).accessToken;

  tokenInFlight = (async () => {
    const cached = await readCachedToken();
    if (
      isTokenFresh(cached) &&
      cached.accessToken !== rejected &&
      (!force || cached.accessToken !== currentToken?.accessToken)
    ) {
      return cached;
    }
    return issueNewToken();
  })();

  try {
    currentToken = await tokenInFlight;
    return currentToken.accessToken;
  } finally {
    tokenInFlight = null;
  }
}

/** 강제 재발급 (issue_token 도구용). 다른 프로세스의 기존 토큰은 무효화됩니다. */
export async function forceReissueToken(): Promise<CachedToken> {
  currentToken = await issueNewToken();
  return currentToken;
}
