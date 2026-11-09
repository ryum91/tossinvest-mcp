import { z } from "zod";
import { forceReissueToken } from "../api/auth.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 인증 ────────────────────────────────────────────────────────────────────────

export const authTools: ToolDefinition[] = [
  defineTool({
    name: "issue_token",
    title: "액세스 토큰 재발급",
    kind: "auth",
    description:
      "환경변수 TOSSINVEST_CLIENT_ID / TOSSINVEST_CLIENT_SECRET 으로 액세스 토큰을 강제 재발급합니다. 토큰은 만료·무효화 시 자동 갱신되므로 일반적으로 호출할 필요가 없습니다. 주의: 클라이언트당 토큰은 1개만 유효하므로 재발급 시 다른 프로세스의 기존 토큰은 무효화됩니다.",
    input: z.object({}),
    handler: async () => {
      const token = await forceReissueToken();
      const t = token.accessToken;
      return {
        access_token_preview: `${t.slice(0, 8)}…${t.slice(-4)}`,
        expires_at: new Date(token.expiresAt).toISOString(),
        message:
          "토큰이 재발급되었습니다. 이후 모든 API 호출에 자동으로 사용됩니다. (토큰은 만료·무효화 시 자동 갱신되므로 보통 직접 호출할 필요가 없습니다)",
      };
    },
  }),
];
