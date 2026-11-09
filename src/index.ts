#!/usr/bin/env node
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");

import { join } from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAccessToken } from "./api/auth.js";
import { CLIENT_ID, CLIENT_SECRET, PACKAGE_ROOT } from "./config.js";
import { errorMessage } from "./lib/errors.js";
import { createServer } from "./server.js";

// ─── Start ───────────────────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
  process.stderr.write(
    "[tossinvest-mcp] 오류: 환경변수 TOSSINVEST_CLIENT_ID 와 TOSSINVEST_CLIENT_SECRET 가 필요합니다.\n" +
      `  MCP 클라이언트 config 의 env 블록 또는 ${join(PACKAGE_ROOT, ".env.local")} 에 설정하세요.\n`,
  );
  process.exit(1);
}

const server = createServer();
await server.connect(new StdioServerTransport());

// 시작 시 토큰을 미리 확보 (실패해도 서버는 유지 — 각 도구 호출 시 재시도되며 오류 원인이 응답으로 전달됨)
try {
  await getAccessToken();
  process.stderr.write("[tossinvest-mcp] 토큰 확보 성공. MCP 서버가 준비되었습니다.\n");
} catch (err) {
  process.stderr.write(
    `[tossinvest-mcp] 경고: 시작 시 토큰 발급 실패 — 도구 호출 시 재시도합니다. ${errorMessage(err)}\n`,
  );
}
