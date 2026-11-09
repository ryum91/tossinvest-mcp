import { isNil } from "es-toolkit";
// ─── Tool argument helpers ───────────────────────────────────────────────────

export type Args = Record<string, unknown>;

// zod 검증(lib/schema.ts)을 통과한 원시값을 API 요청 형태로 바꾸는 헬퍼들입니다.

type Primitive = string | number | boolean | null | undefined;

/** 숫자/문자열 입력을 API 가 요구하는 decimal 문자열로 변환 */
export function decimalString(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`숫자 형식이 올바르지 않습니다: ${s}`);
  return s;
}

export const optStr = (v: Primitive): string | undefined => (isNil(v) || v === "" ? undefined : String(v));
export const optNum = (v: Primitive): number | undefined => (isNil(v) || v === "" ? undefined : Number(v));
export const optBool = (v: Primitive): boolean | undefined =>
  isNil(v) || v === "" ? undefined : v === true || v === "true";
export const pathSeg = (v: unknown): string => encodeURIComponent(String(v));
