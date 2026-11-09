import { isPlainObject, mapValues, omitBy, uniq } from "es-toolkit";
import { z } from "zod";

// ─── zod 기반 입력 스키마 ────────────────────────────────────────────────────
// 각 도구의 입력은 zod 스키마 하나로 정의합니다.
//  - tools/list 의 JSON Schema 는 toToolInputSchema() 로 zod 에서 생성
//  - tools/call 인자는 parseToolArgs() 로 검증·타입 보정 (핸들러 인자 타입은 z.infer 로 추론)

z.config(z.locales.ko()); // zod 기본 오류 메시지를 한국어로

// ── 관대한 타입 보정 (LLM 이 "5" / 5 / "true" / "A,B" 처럼 보내는 경우) ──────────

const toNumber = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
const toStr = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : v;
const toBool = (v: unknown) => (v === "true" ? true : v === "false" ? false : v);
const toCsvArray = (v: unknown) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : v;

// ── 기본 빌더 ───────────────────────────────────────────────────────────────

const typeError = (message: string) => ({ error: message });

/** 문자열 (숫자 입력은 문자열로, 앞뒤 공백 제거) */
export const str = <T extends z.ZodType<string>>(schema?: T) =>
  z.preprocess(toStr, (schema ?? z.string(typeError("문자열이어야 합니다"))) as T);

/** 문자열 enum */
export const enumOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(toStr, z.enum(values, { error: `허용값은 ${values.join(", ")} 입니다` }));

/** 숫자 ("5" → 5) */
export const number = (opts: { gt?: number; min?: number; max?: number } = {}) => {
  let s = z.number(typeError("숫자여야 합니다"));
  if (opts.gt !== undefined) s = s.gt(opts.gt, `${opts.gt} 보다 커야 합니다`);
  if (opts.min !== undefined) s = s.min(opts.min, `${opts.min} 이상이어야 합니다`);
  if (opts.max !== undefined) s = s.max(opts.max, `${opts.max} 이하여야 합니다`);
  return z.preprocess(toNumber, s);
};

/** 정수 ("5" → 5) */
export const int = (opts: { min?: number; max?: number } = {}) => {
  let s = z.number(typeError("숫자여야 합니다")).int("정수여야 합니다");
  if (opts.min !== undefined) s = s.min(opts.min, `${opts.min} 이상이어야 합니다`);
  if (opts.max !== undefined) s = s.max(opts.max, `${opts.max} 이하여야 합니다`);
  return z.preprocess(toNumber, s);
};

/** 불리언 ("true"/"false" 문자열 허용) */
export const bool = z.preprocess(toBool, z.boolean({ error: "true 또는 false 여야 합니다" }));

/** 배열 ("A,B" 콤마 문자열 허용) */
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(toCsvArray, z.array(item, { error: "배열(또는 콤마 구분 문자열)이어야 합니다" }));

// ── 도메인 빌더 (토스증권 Open API 스펙 기준) ─────────────────────────────────

const SYMBOL_RE = /^[A-Za-z0-9.-]+$/;
const POSITIVE_DECIMAL_RE = /^(?=.*[1-9])\d+(\.\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const csvCountMax = (max: number) => (s: string) => s.split(",").filter(Boolean).length <= max;

/** 계좌 식별자 (get_accounts 의 accountSeq) */
export const accountSeq = int({ min: 1 });

/** 종목 심볼. KR 6자리 코드(005930, 0101N0) / US 티커(AAPL) */
export const symbol = str(z.string().min(1).max(20).regex(SYMBOL_RE, "종목 심볼 형식이 아닙니다 (예: 005930, AAPL)"));

/** 콤마 구분 종목 심볼 (최대 200개) */
export const symbols = str(
  z
    .string()
    .regex(/^[A-Za-z0-9.-]+(,[A-Za-z0-9.-]+)*$/, "콤마로 구분한 종목 심볼이어야 합니다 (예: 005930,AAPL)")
    .refine(csvCountMax(200), "최대 200개까지 조회할 수 있습니다"),
);

/** 콤마 구분 시장 지표 심볼 (KOSPI, KR_BOND_10Y 등, 최대 200개) */
export const indicatorSymbols = str(
  z
    .string()
    .regex(/^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/, "콤마로 구분한 시장 지표 심볼이어야 합니다 (예: KOSPI,KR_BOND_10Y)")
    .refine(csvCountMax(200), "최대 200개까지 조회할 수 있습니다"),
);

/** 0보다 큰 decimal 문자열 (수량·가격·금액). 숫자 입력도 문자열로 변환 */
export const positiveDecimal = str(
  z.string().max(30).regex(POSITIVE_DECIMAL_RE, '0보다 큰 숫자 문자열이어야 합니다 (예: "10", "187.25")'),
);

/** YYYY-MM-DD (실존 날짜만 허용) */
export const isoDate = str(
  z
    .string()
    .regex(DATE_RE, "YYYY-MM-DD 형식이어야 합니다")
    .refine(isValidDate, "존재하지 않는 날짜입니다")
    .meta({ format: "date" }),
);

/** ISO 8601 일시 (예: 2026-03-25T09:00:00+09:00) */
export const isoDateTime = str(
  z
    .string()
    .refine((s) => Number.isFinite(Date.parse(s)), "ISO 8601 일시 형식이어야 합니다 (예: 2026-03-25T09:00:00+09:00)")
    .meta({ format: "date-time" }),
);

/** 멱등성 키 (최대 36자, 영숫자·-·_) */
export const clientOrderId = str(
  z
    .string()
    .min(1)
    .max(36)
    .regex(/^[a-zA-Z0-9\-_]+$/, "영문·숫자·-·_ 만 사용할 수 있습니다"),
);

/** 서버가 발급한 식별자 (주문 ID 등) */
export const id = str(z.string().min(1));

/** 섹터 식별자 */
export const sectorId = str(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "섹터 ID 형식이 아닙니다"));

/** 조회 건수 / 페이지 크기 */
export const count = (max: number) => int({ min: 1, max });
export const limit = (max: number) => int({ min: 1, max });

/** 지표 기간 */
export const period = int({ min: 1, max: 500 });

export const SIDES = ["BUY", "SELL"] as const;

// ── JSON Schema 출력 (tools/list) ──────────────────────────────────────────

type JsonObject = Record<string, unknown>;

/** zod 가 붙이는 불필요한 키 정리: $schema, additionalProperties:false, 안전 정수 경계값 */
function cleanJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanJsonSchema);
  if (!isPlainObject(node)) return node;
  const kept = omitBy(
    node,
    (v, k) =>
      k === "$schema" ||
      (k === "additionalProperties" && v === false) || // 알 수 없는 키는 서버에서 무시(strip)
      (k === "maximum" && v === Number.MAX_SAFE_INTEGER) ||
      (k === "minimum" && v === Number.MIN_SAFE_INTEGER),
  );
  return mapValues(kept, cleanJsonSchema);
}

export function toToolInputSchema(input: z.ZodObject): { type: "object"; [k: string]: unknown } {
  const schema = cleanJsonSchema(z.toJSONSchema(input, { io: "output" })) as JsonObject;
  return { ...schema, type: "object" };
}

// ── tools/call 인자 검증 ───────────────────────────────────────────────────

export class InputValidationError extends Error {}

/** 선택 필드의 null / 빈 문자열은 미지정으로 취급 (필수 필드는 "필수 항목" 오류) */
function stripEmpty(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripEmpty);
  if (!isPlainObject(v)) return v;
  return mapValues(
    omitBy(v, (val) => val === null || val === ""),
    stripEmpty,
  );
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  const input = (issue as { input?: unknown }).input;
  const missing = issue.code === "invalid_type" && input === undefined;
  let message = missing ? "필수 항목입니다" : issue.message;
  // 단일 값 검증 오류에는 입력값을 덧붙여 원인 파악을 돕습니다
  // (조합 규칙 이슈의 input 은 객체 전체라 제외 — 메시지에 값이 이미 포함됨)
  if (!missing && ["string", "number", "boolean"].includes(typeof input)) {
    const shown = JSON.stringify(input);
    message += ` (입력: ${shown.length > 60 ? `${shown.slice(0, 57)}…"` : shown})`;
  }
  return path ? `${path}: ${message}` : message;
}

/** 검증·보정된 인자를 반환. 위반 항목은 모두 모아 InputValidationError 로 던집니다. */
export function parseToolArgs<S extends z.ZodType>(name: string, schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(stripEmpty(raw ?? {}), { reportInput: true });
  if (result.success) return result.data;
  const messages = uniq(result.error.issues.map(formatIssue));
  throw new InputValidationError(`입력값 오류 (${name}):\n- ${messages.join("\n- ")}`);
}

// ── 필드 조합 규칙 ─────────────────────────────────────────────────────────

/**
 * 조합 규칙 함수(validate)를 zod refinement 로 연결합니다.
 * 메시지가 "field: 내용" 형태면 해당 field 경로의 이슈로 기록됩니다.
 * when: () => true → 스키마 오류가 있어도 조합 규칙 위반까지 한 번에 보고.
 */
export function withCrossValidation<S extends z.ZodObject>(
  schema: S,
  validate: (args: z.output<S>, errors: string[]) => void,
): S {
  return schema.check(
    z.superRefine(
      (value, ctx) => {
        const errors: string[] = [];
        validate(value, errors);
        for (const msg of errors) {
          const m = msg.match(/^([A-Za-z_][\w.]*): (.+)$/s);
          ctx.addIssue({
            code: "custom",
            message: m ? m[2] : msg,
            path: m ? m[1].split(".") : [],
            input: value,
          });
        }
      },
      { when: () => true },
    ),
  );
}

/** 조합 규칙 작성용 헬퍼 */
export function argChecks(a: Record<string, unknown>, errors: string[]) {
  return {
    has: (k: string) => a[k] !== undefined,
    range: (from: string, to: string) => {
      const f = a[from];
      const t = a[to];
      // 날짜(YYYY-MM-DD) 문자열은 사전순 비교 = 시간순 비교
      if (typeof f === "string" && typeof t === "string" && f > t) {
        errors.push(`${from}: ${to}(${t}) 보다 늦을 수 없습니다 (입력: ${f})`);
      }
    },
  };
}

export const kstToday = (): string => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
