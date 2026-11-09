import { last, meanBy, round, takeRight } from "es-toolkit";
import { z } from "zod";
import { accountSeq, symbol, period, enumOf, number, SIDES } from "../lib/schema.js";
import { apiRequest } from "../api/client.js";
import { loadCandles, parseInterval, candleCurrency } from "../lib/candles.js";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateADX,
  calculateStochastic,
} from "../lib/indicators/index.js";
import { defineTool, type ToolDefinition } from "./types.js";

// ─── AI 매매 지원 (지표 종합 · 리스크) ────────────────────────────────────────────────────

export const tradingSupportTools: ToolDefinition[] = [
  defineTool({
    name: "get_technical_summary",
    title: "기술 지표 종합 요약",
    kind: "read",
    description:
      "종목의 주요 기술 지표를 한 번에 조회합니다. 현재가·RSI·MACD·볼린저밴드·ADX·ATR·스토캐스틱·EMA20/60·거래량MA와 종합 신호(signal score)를 반환합니다. AI 자동매매에서 분석 호출 횟수를 최소화하는 데 적합합니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"]).optional().describe("봉 단위 (기본값 1d)"),
    }),
    handler: async (args) => {
      const symbol = String(args.symbol);
      const sumInterval = parseInterval(args.interval, "1d");
      const candles = await loadCandles(symbol, sumInterval, 200);
      if (candles.length < 30) throw new Error(`기술 지표 계산 데이터 부족. 필요: 30개, 조회됨: ${candles.length}개`);

      const prices = candles.map((c) => c.close);
      const latest = candles[candles.length - 1];
      const prev = candles[candles.length - 2];

      const rsiArr = calculateRSI(prices, 14);
      const macdArr = calculateMACD(prices, 12, 26, 9);
      const bbArr = calculateBollingerBands(prices, 20, 2);
      const adxArr = candles.length >= 29 ? calculateADX(candles, 14) : [];
      const atrArr = calculateATR(candles, 14);
      const stochArr = calculateStochastic(candles, 14, 3, 3);
      const ema20Arr = calculateEMA(prices, 20);
      const ema60Arr = candles.length >= 60 ? calculateEMA(prices, 60) : [];

      const rsi = last(rsiArr) ?? null;
      const macd = last(macdArr) ?? null;
      const bb = last(bbArr) ?? null;
      const adx = last(adxArr) ?? null;
      const atr = last(atrArr) ?? null;
      const stoch = last(stochArr) ?? null;
      const ema20 = last(ema20Arr) ?? null;
      const ema60 = last(ema60Arr) ?? null;

      const volMA20 = Math.round(meanBy(takeRight(candles, 20), (c) => c.volume));
      const volRatio = volMA20 > 0 ? round(latest.volume / volMA20, 2) : 0;

      let score = 0;
      if (rsi) {
        if (rsi.rsi <= 30) score++;
        else if (rsi.rsi >= 70) score--;
      }
      if (macd) {
        if (macd.histogram > 0) score++;
        else if (macd.histogram < 0) score--;
      }
      if (ema20 !== null) {
        if (latest.close > ema20) score++;
        else if (latest.close < ema20) score--;
      }
      if (adx && adx.adx >= 25) {
        if (adx.plus_di > adx.minus_di) score++;
        else score--;
      }
      if (stoch) {
        if (stoch.k <= 20) score++;
        else if (stoch.k >= 80) score--;
      }
      const overall =
        score >= 3 ? "strong_buy" : score >= 1 ? "buy" : score <= -3 ? "strong_sell" : score <= -1 ? "sell" : "neutral";

      return {
        symbol,
        interval: sumInterval,
        as_of: latest.time,
        candle_count: candles.length,
        price: {
          current: latest.close,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          volume: latest.volume,
          change: round(latest.close - prev.close, 2),
          change_percent: round(((latest.close - prev.close) / prev.close) * 100, 2),
        },
        rsi: rsi
          ? { value: rsi.rsi, zone: rsi.rsi >= 70 ? "overbought" : rsi.rsi <= 30 ? "oversold" : "neutral" }
          : null,
        macd: macd
          ? {
              macd: round(macd.macd, 2),
              signal: round(macd.signal, 2),
              histogram: round(macd.histogram, 2),
              trend: macd.histogram > 0 ? "bullish" : "bearish",
            }
          : null,
        bollinger_bands: bb
          ? {
              upper: round(bb.upper, 2),
              middle: round(bb.middle, 2),
              lower: round(bb.lower, 2),
              percent_b: round(bb.percent_b, 4),
            }
          : null,
        adx: adx
          ? {
              adx: round(adx.adx, 2),
              plus_di: round(adx.plus_di, 2),
              minus_di: round(adx.minus_di, 2),
              strength: adx.adx >= 25 ? "strong" : "weak",
              direction: adx.plus_di > adx.minus_di ? "bullish" : "bearish",
            }
          : null,
        atr: atr ? { atr: round(atr.atr, 2), atr_percent: round((atr.atr / latest.close) * 100, 2) } : null,
        stochastic: stoch
          ? {
              k: round(stoch.k, 2),
              d: stoch.d !== null ? round(stoch.d, 2) : null,
              zone: stoch.k >= 80 ? "overbought" : stoch.k <= 20 ? "oversold" : "neutral",
            }
          : null,
        ema: {
          ema20: ema20 !== null ? round(ema20, 2) : null,
          ema60: ema60 !== null ? round(ema60, 2) : null,
          price_vs_ema20: ema20 !== null ? (latest.close > ema20 ? "above" : "below") : null,
        },
        volume: { current: latest.volume, ma20: volMA20, ratio: volRatio, spike: volRatio >= 2.0 },
        signal: { score, overall },
      };
    },
  }),
  defineTool({
    name: "get_position_risk",
    title: "포지션 리스크 계산",
    kind: "read",
    description:
      "ATR 기반 스탑로스 가격과 계좌 잔고 대비 적정 포지션 규모를 계산합니다. AI 자동매매에서 주문 전 리스크 관리용으로 호출합니다.",
    input: z.object({
      symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
      account_seq: accountSeq.describe("계좌 식별자 (get_accounts로 조회한 accountSeq)"),
      side: enumOf(SIDES).optional().describe("매수/매도 방향 (기본값 BUY)"),
      interval: enumOf(["1m", "5m", "30m", "60m", "1d", "1w", "1mo"])
        .optional()
        .describe("ATR 계산 봉 단위 (기본값 1d)"),
      entry_price: number({ gt: 0 }).optional().describe("진입 가격. 생략 시 최근 종가 사용"),
      atr_period: period.optional().describe("ATR 기간 (기본값 14)"),
      atr_multiplier: number({ gt: 0, max: 20 }).optional().describe("스탑로스 거리 = ATR × 배수 (기본값 2.0)"),
      risk_percent: number({ gt: 0, max: 100 }).optional().describe("계좌 잔고 대비 허용 손실 비율 % (기본값 1.0)"),
    }),
    handler: async (args) => {
      const symbol = String(args.symbol);
      const accountSeq = Number(args.account_seq);
      const side = String(args.side ?? "BUY") as "BUY" | "SELL";
      const interval = parseInterval(args.interval, "1d");
      const atrPeriod = Number(args.atr_period ?? 14);
      const atrMultiplier = Number(args.atr_multiplier ?? 2.0);
      const riskPercent = Number(args.risk_percent ?? 1.0);

      const candles = await loadCandles(symbol, interval, Math.max(atrPeriod * 4, 100));
      if (candles.length < atrPeriod + 1)
        throw new Error(`ATR 계산 데이터 부족. 필요: ${atrPeriod + 1}개, 조회됨: ${candles.length}개`);
      // 통화: 캔들 응답의 currency 우선, 없으면 심볼 형태로 추정 (KR 코드는 6자리 숫자/영숫자, 예: 005930, 0101N0)
      const cc = candleCurrency.get(symbol);
      const currency = cc === "KRW" || cc === "USD" ? cc : /^\d[0-9A-Z]{5}$/.test(symbol) ? "KRW" : "USD";
      const bpData = (await apiRequest("GET", "/api/v1/buying-power", { currency }, undefined, accountSeq)) as Record<
        string,
        unknown
      >;

      const atrData = calculateATR(candles, atrPeriod);
      const latestATR = last(atrData)?.atr ?? 0;
      const currentPrice = candles[candles.length - 1].close;
      const entryPrice = args.entry_price !== undefined ? Number(args.entry_price) : currentPrice;

      const stopLossDistance = latestATR * atrMultiplier;
      const stopLossPrice = round(side === "BUY" ? entryPrice - stopLossDistance : entryPrice + stopLossDistance, 2);
      const stopLossPercent = round((stopLossDistance / entryPrice) * 100, 2);

      // 신규 스펙: BuyingPowerResponse.cashBuyingPower (문자열 decimal)
      const bp = Number(bpData?.cashBuyingPower ?? 0);
      const riskAmount = (bp * riskPercent) / 100;
      const riskBasedQty = stopLossDistance > 0 ? Math.floor(riskAmount / stopLossDistance) : 0;
      // 매수 시 현금 매수 가능 금액을 초과하지 않도록 상한 적용
      const affordableQty = side === "BUY" && entryPrice > 0 ? Math.floor(bp / entryPrice) : Infinity;
      // 0 이상 · 매수 가능 수량 이하 (bp 가 음수인 경우에도 0 을 보장하도록 max 를 바깥에 둠)
      const recommendedQuantity = Math.max(0, Math.min(riskBasedQty, affordableQty));

      return {
        symbol,
        interval,
        side,
        currency,
        current_price: currentPrice,
        entry_price: entryPrice,
        atr: round(latestATR, 2),
        atr_period: atrPeriod,
        atr_multiplier: atrMultiplier,
        stop_loss_price: stopLossPrice,
        stop_loss_distance: round(stopLossDistance, 2),
        stop_loss_percent: stopLossPercent,
        buying_power: bp,
        risk_percent: riskPercent,
        risk_amount: round(riskAmount, 2),
        risk_based_quantity: riskBasedQty,
        recommended_quantity: recommendedQuantity,
        max_position_value: round(recommendedQuantity * entryPrice, 2),
        ...(side === "BUY" && riskBasedQty > affordableQty && { capped_by_buying_power: true }),
      };
    },
  }),
];
