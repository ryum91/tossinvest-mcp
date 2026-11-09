// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 사용하지 않는 변수: `_` 로 시작하면 허용
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // 타입 전용 import 는 `import type` 으로 분리
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // Promise 를 기다리지 않고 버리는 실수 방지 (주문 API 호출 누락 등)
      "@typescript-eslint/no-floating-promises": "error",
      // API 응답(unknown) 을 다루는 코드가 많아 템플릿 리터럴의 숫자·불리언 사용은 허용
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: true }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  // 포매팅 규칙은 Prettier 에 위임 (ESLint 의 스타일 규칙 비활성화)
  prettier,
);
