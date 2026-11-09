import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseToolArgs, toToolInputSchema, withCrossValidation } from "../lib/schema.js";
import { accountTools } from "./account.js";
import { authTools } from "./auth.js";
import { conditionalOrderTools } from "./conditional-order.js";
import { indicatorTools } from "./indicators/index.js";
import { marketDataTools } from "./market-data.js";
import { marketIndicatorTools } from "./market-indicators.js";
import { marketInfoTools } from "./market-info.js";
import { orderInfoTools } from "./order-info.js";
import { orderTools } from "./order.js";
import { rankingTools } from "./ranking.js";
import { sectorTools } from "./sector.js";
import { stockInfoTools } from "./stock-info.js";
import { stockTrendTools } from "./stock-trends.js";
import { tradeLogTools } from "./trade-log.js";
import { tradingSupportTools } from "./trading-support.js";
import { ANNOTATIONS, type ToolDefinition } from "./types.js";

// ─── Tool registry ───────────────────────────────────────────────────────────

/** 노출 순서대로 나열한 전체 툴 정의 */
export const toolDefinitions: ToolDefinition[] = [
  ...tradeLogTools,
  ...authTools,
  ...marketDataTools,
  ...indicatorTools,
  ...tradingSupportTools,
  ...stockInfoTools,
  ...stockTrendTools,
  ...marketInfoTools,
  ...rankingTools,
  ...marketIndicatorTools,
  ...sectorTools,
  ...accountTools,
  ...orderTools,
  ...orderInfoTools,
  ...conditionalOrderTools,
];

interface RegisteredTool {
  def: ToolDefinition;
  /** 조합 규칙(validate)까지 연결된 최종 zod 스키마 */
  schema: ToolDefinition["input"];
}

const registry = new Map<string, RegisteredTool>();
for (const def of toolDefinitions) {
  if (registry.has(def.name)) throw new Error(`[tossinvest-mcp] 툴 이름 중복: ${def.name}`);
  const schema = def.validate ? withCrossValidation(def.input, (a, errors) => def.validate!(a, errors)) : def.input;
  registry.set(def.name, { def, schema });
}

/** tools/list 응답 (inputSchema 는 zod 스키마에서 생성) */
export const tools: Tool[] = toolDefinitions.map((def) => ({
  name: def.name,
  title: def.title,
  description: def.description,
  inputSchema: toToolInputSchema(def.input),
  annotations: { title: def.title, ...ANNOTATIONS[def.kind] },
}));

/** tools/call: zod 로 입력 검증·타입 보정(스키마 + 조합 규칙) 후 핸들러 실행 */
export async function callTool(name: string, rawArgs: unknown): Promise<unknown> {
  const entry = registry.get(name);
  if (!entry) throw new Error(`Unknown tool: ${name}`);
  const args = parseToolArgs(name, entry.schema, rawArgs);
  return entry.def.handler(args);
}
