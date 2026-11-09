// ─── 기술 지표 도구 (캔들 기반 계산) ─────────────────────────────────────────

import { emaTool } from "./ema.js";
import { rsiTool } from "./rsi.js";
import { macdTool } from "./macd.js";
import { bollingerBandsTool } from "./bollinger-bands.js";
import { ichimokuTool } from "./ichimoku.js";
import { atrTool } from "./atr.js";
import { adxTool } from "./adx.js";
import { stochasticTool } from "./stochastic.js";
import { obvTool } from "./obv.js";
import { volumeMaTool } from "./volume-ma.js";
import { parabolicSarTool } from "./parabolic-sar.js";
import type { ToolDefinition } from "../types.js";

/** 노출 순서 */
export const indicatorTools: ToolDefinition[] = [
  emaTool,
  rsiTool,
  macdTool,
  bollingerBandsTool,
  ichimokuTool,
  atrTool,
  adxTool,
  stochasticTool,
  obvTool,
  volumeMaTool,
  parabolicSarTool,
];
