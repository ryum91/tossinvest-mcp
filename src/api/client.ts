import { delay, isPlainObject } from "es-toolkit";
import { BASE_URL } from "../config.js";
import { getAccessToken } from "./auth.js";

// ─── HTTP ────────────────────────────────────────────────────────────────────

export type QueryValue = string | number | boolean | undefined;

export class TossApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

const TOKEN_ERROR_CODES = new Set(["invalid-token", "expired-token", "token-revoked"]);

/**
 * 토스증권 Open API 호출. 성공 응답의 `result` envelope 을 벗겨서 반환합니다.
 * - 401 토큰 오류(invalid/expired/revoked) → 토큰 재발급 후 1회 재시도
 * - 429 → Retry-After(또는 지수 백오프) 만큼 대기 후 최대 3회 재시도
 */
export async function apiRequest(
  method: string,
  path: string,
  params?: Record<string, QueryValue>,
  body?: unknown,
  accountSeq?: number,
): Promise<unknown> {
  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  let tokenRetried = false;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (accountSeq !== undefined) headers["X-Tossinvest-Account"] = String(accountSeq);

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
    }

    if (res.ok) {
      if (isPlainObject(data) && "result" in data) return data.result;
      return data ?? { success: true };
    }

    const err = (
      data as { error?: { code?: string; message?: string; requestId?: string; data?: unknown } } | undefined
    )?.error;
    const code = err?.code ?? `http-${res.status}`;
    const requestId = err?.requestId ?? res.headers.get("x-request-id") ?? undefined;

    if (res.status === 401 && !tokenRetried && (TOKEN_ERROR_CODES.has(code) || !err)) {
      tokenRetried = true;
      await getAccessToken(true, token);
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000 + Math.random() * 250;
      await delay(Math.min(waitMs, 10_000));
      continue;
    }

    const detail = err?.data !== undefined ? ` data=${JSON.stringify(err.data)}` : "";
    const msg = `[HTTP ${res.status} ${code}] ${err?.message || "요청 실패"}${detail}${requestId ? ` (requestId=${requestId})` : ""}`;
    throw new TossApiError(res.status, code, err ? msg : `${msg} ${text.slice(0, 300)}`, requestId, err?.data);
  }
}
