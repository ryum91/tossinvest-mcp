import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

// ─── Tool definition contract ────────────────────────────────────────────────

/**
 * 툴 성격. annotations 로 변환되어 MCP 클라이언트가 승인 정책을 정하는 힌트가 됩니다.
 * - read: 토스증권 API 조회 (부작용 없음)
 * - local-read / local-write: 로컬 매매 로그 조회 / 기록
 * - auth: 토큰 재발급 (다른 프로세스의 기존 토큰 무효화)
 * - trade: 실제 주문 생성·정정
 * - trade-cancel: 주문 취소 (같은 취소 반복은 추가 효과 없음)
 */
export type ToolKind = "read" | "local-read" | "local-write" | "auth" | "trade" | "trade-cancel";

export const ANNOTATIONS: Record<ToolKind, NonNullable<Tool["annotations"]>> = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  "local-read": { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  "local-write": { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  auth: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  trade: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  "trade-cancel": { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  /** 한글 제목 (MCP title / annotations.title) */
  title: string;
  kind: ToolKind;
  description: string;
  /** 입력 스키마 (zod). tools/list 의 JSON Schema 와 tools/call 검증·타입 보정에 모두 사용 */
  input: S;
  /** 필드 조합 규칙. "field: 내용" 형태의 위반 메시지를 errors 에 추가합니다 (zod refinement 로 실행). */
  validate?(args: z.output<S>, errors: string[]): void;
  /** 검증·보정이 끝난, zod 스키마로 타입이 추론된 인자를 받아 결과를 반환합니다. */
  handler(args: z.output<S>): Promise<unknown>;
}

/** 도구 정의 헬퍼: input 스키마로부터 handler / validate 의 인자 타입을 추론합니다. */
export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}
