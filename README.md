# tossinvest-mcp

토스증권 Open API를 [Model Context Protocol(MCP)](https://modelcontextprotocol.io)로 래핑한 서버입니다. Claude 등 MCP 호환 AI 클라이언트에서 국내/미국 주식 시세 조회 및 주문을 자연어로 실행할 수 있습니다.

## 제공 도구

| 카테고리 | 도구 | 설명 |
|---|---|---|
| 인증 | `issue_token` | 환경변수로 액세스 토큰 재발급 |
| 시세 | `get_prices` | 현재가 조회 (최대 200종목) |
| | `get_orderbook` | 호가 잔량 조회 |
| | `get_trades` | 당일 체결 내역 조회 |
| | `get_candles` | 캔들(OHLCV) 차트 데이터 (1분봉/일봉) |
| | `get_price_limits` | 상한가/하한가 조회 |
| 기술 지표 | `get_ema` | 지수이동평균(EMA) — 봉 단위·기간·기준가 지정 |
| | `get_rsi` | 상대강도지수(RSI) — 과매수/과매도 구간·시그널 라인·크로스오버 신호 포함 |
| | `get_macd` | MACD — MACD 라인·시그널·히스토그램·크로스오버 신호 |
| | `get_bollinger_bands` | 볼린저 밴드 — 상단·중간·하단 밴드·%B·밴드폭 |
| | `get_ichimoku` | 일목균형표 — 전환선·기준선·선행스팬1·2·후행스팬·구름 방향·미래 구름 예측 |
| 종목 정보 | `get_stocks` | 종목 기본 정보 (최대 200종목) |
| | `get_stock_warnings` | 투자 유의사항 조회 |
| 시장 정보 | `get_exchange_rate` | KRW↔USD 환율 조회 |
| | `get_kr_market_calendar` | 국내 시장 운영 시간 |
| | `get_us_market_calendar` | 미국 시장 운영 시간 |
| 계좌 | `get_accounts` | 계좌 목록 조회 |
| | `get_holdings` | 보유 주식 현황 |
| | `get_buying_power` | 매수 가능 금액 조회 |
| | `get_sellable_quantity` | 매도 가능 수량 조회 |
| | `get_commissions` | 수수료율 조회 |
| 주문 | `create_order` | 매수/매도 주문 생성 |
| | `modify_order` | 주문 정정 |
| | `cancel_order` | 주문 취소 |
| | `get_orders` | 주문 목록 조회 |
| | `get_order` | 주문 상세 조회 |

## 시작하기

### 1. 빌드

```bash
pnpm install
pnpm build
```

### 2. 환경변수 설정

토스증권 Open API에서 발급받은 Client ID와 Secret을 환경변수로 설정합니다. **두 값 모두 필수이며, 설정되지 않으면 서버가 시작되지 않습니다.**

```bash
export TOSSINVEST_API_KEY=your_client_id
export TOSSINVEST_SECRET_KEY=your_client_secret
```

### 3. MCP 클라이언트 등록

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "node",
      "args": ["/path/to/tossinvest-mcp/dist/index.js"],
      "env": {
        "TOSSINVEST_API_KEY": "your_client_id",
        "TOSSINVEST_SECRET_KEY": "your_client_secret"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add tossinvest -- node /path/to/tossinvest-mcp/dist/index.js
```

환경변수는 셸 프로파일(`~/.zshrc` 등)에 미리 설정해두거나 위 config의 `env` 블록으로 전달할 수 있습니다.

## 사용 예시

서버 시작 시 환경변수로 토큰이 자동 발급됩니다. 토큰 만료 시 `issue_token` 도구를 호출해 재발급할 수 있습니다.

```
삼성전자 현재가 알려줘
→ get_prices(symbols: "005930")

AAPL 일봉 차트 100개 가져와
→ get_candles(symbol: "AAPL", interval: "1d", count: 100)

내 계좌 보유 종목 보여줘
→ get_accounts() → get_holdings(account_seq: ...)

삼성전자 1주 시장가 매수
→ create_order(symbol: "005930", side: "BUY", order_type: "MARKET", quantity: "1", ...)

AAPL 일봉 20일 EMA 계산해줘
→ get_ema(symbol: "AAPL", interval: "1d", period: 20)

삼성전자 RSI 알려줘
→ get_rsi(symbol: "005930", interval: "1d")
  (기본값: period=14, overbought=70, oversold=30, signal_period=14)

AAPL MACD 계산해줘
→ get_macd(symbol: "AAPL", interval: "1d")
  (기본값: fast_period=12, slow_period=26, signal_period=9)

삼성전자 볼린저 밴드 보여줘
→ get_bollinger_bands(symbol: "005930", interval: "1d")
  (기본값: period=20, multiplier=2)

AAPL 일목균형표 분석해줘
→ get_ichimoku(symbol: "AAPL", interval: "1d")
  (기본값: tenkan=9, kijun=26, senkou_b=52, displacement=26)
```

## 개발

```bash
pnpm dev   # TypeScript watch 모드
pnpm build # 빌드
pnpm start # 빌드된 서버 실행
```

## 라이선스

MIT
