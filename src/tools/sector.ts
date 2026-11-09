import { z } from "zod";
import { enumOf, sectorId } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { pathSeg } from "../lib/args.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── 섹터 (Sector) ───────────────────────────────────────────────────────────────

export const sectorTools: ToolDefinition[] = [
  defineTool({
    name: "list_sectors",
    title: "섹터 목록 조회",
    kind: "read",
    description:
      "토스증권 자체 산업 분류(섹터) 전체 목록을 계층 정보(depth 0=대분류, 1=중분류, 2=소분류, parentSectorId)와 함께 조회합니다. 다른 섹터 도구의 sector_id 는 여기서 확인합니다.",
    input: z.object({}),
    handler: async () => {
      return apiRequest("GET", "/api/v1/sectors");
    },
  }),
  defineTool({
    name: "get_sector_rankings",
    title: "섹터 랭킹 조회",
    kind: "read",
    description: "섹터 랭킹(기간 등락률 상위 / 시장 거래대금 상위)을 조회합니다.",
    input: z.object({
      type: enumOf(["TOP_GAINERS", "MARKET_TRADING_AMOUNT"]).describe("랭킹 종류"),
      market_country: enumOf(["KR", "US"]).describe("조회 시장"),
      duration: enumOf(["1d", "1w", "1mo", "3mo", "6mo", "1y"]).describe("산정 기간 (거래일 기준)"),
    }),
    handler: async (args) => {
      return apiRequest("GET", "/api/v1/sectors/rankings", {
        type: String(args.type),
        marketCountry: String(args.market_country),
        duration: String(args.duration),
      });
    },
  }),
];

// 섹터 ID 기반 조회 (상세 · 구성 주식 · 관련 ETF)
const SECTOR_DETAIL_TOOLS = [
  ["get_sector", "섹터 상세(프로필·시장별 기간 등락률)를 조회합니다.", "등락률(performance)의 기준 시장"],
  ["get_sector_stocks", "섹터 구성 주식을 시가총액순으로 조회합니다 (하위 섹터 종목 포함).", "조회 시장"],
  [
    "get_sector_etfs",
    "섹터 관련 ETF 를 조회합니다 (하위 섹터 미포함).",
    "조회 시장 (KR=국내 상장 ETF, US=미국 상장 ETF)",
  ],
] as const;

const SECTOR_TITLES: Record<string, string> = {
  get_sector: "섹터 상세 조회",
  get_sector_stocks: "섹터 구성 주식 조회",
  get_sector_etfs: "섹터 관련 ETF 조회",
};
const SECTOR_PATH: Record<string, string> = { get_sector: "", get_sector_stocks: "/stocks", get_sector_etfs: "/etfs" };

sectorTools.push(
  ...SECTOR_DETAIL_TOOLS.map(([name, description, mcDesc]) =>
    defineTool({
      name,
      title: SECTOR_TITLES[name],
      kind: "read",
      description,
      input: z.object({
        sector_id: sectorId.describe("섹터 식별자 (list_sectors 응답의 sectorId)"),
        market_country: enumOf(["KR", "US"]).describe(mcDesc),
      }),
      handler: async (args) =>
        apiRequest("GET", `/api/v1/sectors/${pathSeg(args.sector_id)}${SECTOR_PATH[name]}`, {
          marketCountry: args.market_country,
        }),
    }),
  ),
);
