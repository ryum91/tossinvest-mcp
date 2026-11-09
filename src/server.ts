import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_VERSION } from "./config.js";
import { errorMessage } from "./lib/errors.js";
import { InputValidationError } from "./lib/schema.js";
import { callTool, tools } from "./tools/index.js";

// ─── MCP Server ──────────────────────────────────────────────────────────────

/** MCP 클라이언트에 전달되는 서버 사용 지침 */
export const SERVER_INSTRUCTIONS = [
  "토스증권 Open API(국내·미국 주식 시세, 계좌, 주문, 조건주문) MCP 서버입니다.",
  "- 계좌·주문 관련 도구를 호출하기 전에 get_accounts 로 account_seq(accountSeq)를 먼저 확인하세요.",
  "- create_order, modify_order, cancel_order, create_conditional_order, modify_conditional_order, cancel_conditional_order 는 실제 계좌에 영향을 주는 주문입니다. 종목·방향·수량·가격(또는 조건)을 사용자에게 보여주고 명시적인 승인을 받은 경우에만 호출하세요.",
  "- confirm_high_value_order 는 1억원 이상 주문임을 사용자가 직접 확인한 경우에만 true 로 설정하세요.",
  "- 주문을 실행했다면 log_trade 로 근거와 지표 스냅샷을 기록하세요.",
  '- 수량·가격은 문자열 decimal 입니다 (예: "10", "71500", "187.25"). 국내 종목은 6자리 코드(005930), 미국 종목은 티커(AAPL)입니다.',
  "- 여러 지표가 필요하면 개별 지표 도구 대신 get_technical_summary 한 번으로 조회하세요.",
].join("\n");
export function createServer(): Server {
  const server = new Server(
    { name: "tossinvest-mcp", version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const result = await callTool(name, args);
      // 대용량 응답(전체 종목 목록 등)은 들여쓰기 없이 직렬화해 컨텍스트 사용량을 줄임
      const pretty = JSON.stringify(result, null, 2) ?? "null";
      const text = pretty.length > 50_000 ? JSON.stringify(result) : pretty;
      return {
        content: [{ type: "text", text }],
      };
    } catch (err) {
      const message = errorMessage(err);
      return {
        content: [{ type: "text", text: err instanceof InputValidationError ? message : `오류: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
