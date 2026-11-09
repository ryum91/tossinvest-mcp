# tossinvest-mcp

토스증권 Open API를 [Model Context Protocol(MCP)](https://modelcontextprotocol.io)로 래핑한 서버입니다. Claude 등 MCP 호환 AI 클라이언트에서 국내/미국 주식 시세 조회 및 주문을 자연어로 실행할 수 있습니다.

> 토스증권 Open API **v1.2.28** 스펙 기준 ([llms.txt](https://developers.tossinvest.com/llms.txt) · [OpenAPI JSON](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)). 웹소켓(실시간 체결·호가·주문 이벤트)은 MCP 요청/응답 모델과 맞지 않아 제공하지 않습니다.

## 빠른 시작

토스증권 Open API 키를 발급하고 **허용 IP 를 등록**한 뒤, 사용하는 클라이언트에 등록합니다. (Node.js 20.19 이상)

```bash
claude mcp add tossinvest --scope user \
  -e TOSSINVEST_CLIENT_ID=tsck_live_xxx \
  -e TOSSINVEST_CLIENT_SECRET=tssk_live_xxx \
  -- npx -y @ryum91/tossinvest-mcp
```

Claude Desktop · Cursor · VS Code · Codex 설정과 소스 빌드, 문제 해결은 [설치 가이드](#설치-가이드)를 참고하세요.

## 제공 도구

| 카테고리         | 도구                                    | 설명                                                                                   |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| 인증             | `issue_token`                           | 액세스 토큰 강제 재발급 (평소에는 자동 갱신되므로 불필요)                              |
| 시세             | `get_prices`                            | 현재가 조회 (최대 200종목)                                                             |
|                  | `get_orderbook`                         | 호가 잔량 조회                                                                         |
|                  | `get_trades`                            | 당일 체결 내역 조회                                                                    |
|                  | `get_candles`                           | 캔들(OHLCV) 차트 데이터 (1분봉/일봉)                                                   |
|                  | `get_price_limits`                      | 상한가/하한가 조회                                                                     |
| 기술 지표        | `get_ema`                               | 지수이동평균(EMA) — 봉 단위·기간·기준가 지정                                           |
|                  | `get_rsi`                               | 상대강도지수(RSI) — 과매수/과매도 구간·시그널 라인·크로스오버 신호 포함                |
|                  | `get_macd`                              | MACD — MACD 라인·시그널·히스토그램·크로스오버 신호                                     |
|                  | `get_bollinger_bands`                   | 볼린저 밴드 — 상단·중간·하단 밴드·%B·밴드폭                                            |
|                  | `get_ichimoku`                          | 일목균형표 — 전환선·기준선·선행스팬1·2·후행스팬·구름 방향·미래 구름 예측               |
|                  | `get_atr`                               | ATR(평균 실제 범위) — 변동성 측정, 포지션 사이징·스탑로스 거리 설정용                  |
|                  | `get_adx`                               | ADX(평균 방향성 지수) — 추세 강도(≥25 강함)·방향(+DI/-DI)·추세/횡보 판별               |
|                  | `get_stochastic`                        | Slow Stochastic — %K·%D·과매수(≥80)/과매도(≤20)·크로스오버 신호                        |
|                  | `get_obv`                               | OBV(누적 거래량) — 시그널 라인과 비교한 거래량 기반 추세 방향                          |
|                  | `get_volume_ma`                         | 거래량 이동평균 — 현재/평균 비율로 거래량 급등 감지                                    |
|                  | `get_parabolic_sar`                     | Parabolic SAR — 추세 방향·반전 신호·트레일링 스탑 기준선                               |
| AI 매매 지원     | `get_technical_summary`                 | 주요 지표 복합 조회 — RSI·MACD·BB·ADX·ATR·Stochastic·EMA·거래량·종합 신호 한 번에 반환 |
|                  | `get_position_risk`                     | 포지션 리스크 계산 — ATR 기반 스탑로스 가격·적정 수량·최대 포지션 금액                 |
|                  | `log_trade`                             | 매매 이력 기록 — 근거(rationale)·지표 스냅샷·태그를 로컬 파일에 저장                   |
|                  | `get_trade_log`                         | 매매 이력 조회 — 종목·방향·날짜 필터, 최신순 반환                                      |
| 종목 정보        | `get_stocks`                            | 종목 기본 정보 (최대 200종목)                                                          |
|                  | `list_stocks`                           | 마켓별 전체 종목 목록 (종목명 검색·개수 제한 지원)                                     |
|                  | `get_stock_warnings`                    | 투자 유의사항 조회                                                                     |
| 수급 동향 (국내) | `get_stock_investor_trading`            | 투자자별 매매동향 (개인·외국인·기관·기타법인, 외국인 보유, CFD)                        |
|                  | `get_stock_program_trades`              | 프로그램매매 동향 (차익·비차익)                                                        |
|                  | `get_stock_short_selling`               | 공매도 동향                                                                            |
|                  | `get_stock_credit_trades`               | 신용거래 동향 (융자·대주)                                                              |
|                  | `get_stock_securities_lending`          | 대차거래 동향                                                                          |
| 랭킹             | `get_rankings`                          | 거래대금·거래량·급등락·토스증권 체결 상위 (KR/US, 실시간~1년)                          |
|                  | `get_investor_trading_rankings`         | 외국인·기관·개인 순매수/순매도 상위 (국내)                                             |
| 시장 지표        | `get_market_indicator_prices`           | 코스피·코스닥·국채(2~30년) 현재가                                                      |
|                  | `get_market_indicator_candles`          | 지수·국채 캔들                                                                         |
|                  | `get_market_indicator_investor_trading` | 코스피·코스닥 투자자별 매매대금                                                        |
| 섹터             | `list_sectors`                          | 섹터 분류 전체 (계층 구조)                                                             |
|                  | `get_sector`                            | 섹터 상세 (기간 등락률)                                                                |
|                  | `get_sector_stocks`                     | 섹터 구성 주식                                                                         |
|                  | `get_sector_etfs`                       | 섹터 관련 ETF                                                                          |
|                  | `get_sector_rankings`                   | 섹터 랭킹 (등락률·거래대금)                                                            |
| 시장 정보        | `get_exchange_rate`                     | KRW↔USD 환율 조회                                                                      |
|                  | `get_kr_market_calendar`                | 국내 시장 운영 시간                                                                    |
|                  | `get_us_market_calendar`                | 미국 시장 운영 시간                                                                    |
| 계좌             | `get_accounts`                          | 계좌 목록 조회                                                                         |
|                  | `get_holdings`                          | 보유 주식 현황                                                                         |
|                  | `get_transactions`                      | 거래내역 (매매·입출금·환전·배당·이자·수수료)                                           |
|                  | `get_buying_power`                      | 매수 가능 금액 조회                                                                    |
|                  | `get_sellable_quantity`                 | 매도 가능 수량 조회                                                                    |
|                  | `get_commissions`                       | 수수료율 조회                                                                          |
| 주문             | `create_order`                          | 매수/매도 주문 생성                                                                    |
|                  | `modify_order`                          | 주문 정정                                                                              |
|                  | `cancel_order`                          | 주문 취소                                                                              |
|                  | `get_orders`                            | 주문 목록 조회                                                                         |
|                  | `get_order`                             | 주문 상세 조회                                                                         |
| 조건주문         | `create_conditional_order`              | 조건주문 등록 (SINGLE · OCO · OTO)                                                     |
|                  | `modify_conditional_order`              | 조건주문 수정 (새 ID 발급)                                                             |
|                  | `cancel_conditional_order`              | 조건주문 취소                                                                          |
|                  | `get_conditional_orders`                | 조건주문 목록 (OPEN / CLOSED)                                                          |
|                  | `get_conditional_order`                 | 조건주문 상세                                                                          |

## 설치 가이드

### 사전 준비

1. **Node.js 20.19 이상** (`node -v` 로 확인)
2. **토스증권 Open API 키 발급**: 토스증권 WTS 로그인 → 설정 → Open API → `client_id` / `client_secret` 발급
3. **허용 IP 등록**: 같은 화면의 **허용 IP 관리**에 이 서버를 실행할 PC의 공인 IP를 등록합니다. 등록하지 않으면 토큰 발급과 모든 API 호출이 403 으로 거부됩니다. (공인 IP 확인: `curl ifconfig.me`)

> ⚠️ 이 서버는 **실제 계좌에 주문을 낼 수 있는 도구**(주문·조건주문 생성/정정/취소)를 포함합니다. MCP 클라이언트가 해당 도구 호출 전에 사용자 승인을 받도록 설정하고, 자동 승인("항상 허용")은 권장하지 않습니다.

### 방법 1. npx 로 설치 (권장)

빌드 없이 npm 패키지 [`@ryum91/tossinvest-mcp`](https://www.npmjs.com/package/@ryum91/tossinvest-mcp)를 바로 실행합니다. 키는 MCP 클라이언트 설정의 `env` 로 전달합니다.

#### Claude Code

```bash
claude mcp add tossinvest --scope user \
  -e TOSSINVEST_CLIENT_ID=tsck_live_xxx \
  -e TOSSINVEST_CLIENT_SECRET=tssk_live_xxx \
  -- npx -y @ryum91/tossinvest-mcp
```

`--scope user` 는 모든 프로젝트에서 사용, 생략하면 현재 프로젝트에서만 사용합니다. 확인: `claude mcp get tossinvest`

#### Claude Desktop

설정 → 개발자 → 구성 편집, 또는 파일을 직접 수정합니다.

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "npx",
      "args": ["-y", "@ryum91/tossinvest-mcp"],
      "env": {
        "TOSSINVEST_CLIENT_ID": "tsck_live_xxx",
        "TOSSINVEST_CLIENT_SECRET": "tssk_live_xxx"
      }
    }
  }
}
```

저장 후 Claude Desktop 을 완전히 종료했다가 다시 실행합니다.

#### Cursor

`~/.cursor/mcp.json` (전역) 또는 프로젝트의 `.cursor/mcp.json` — 위 Claude Desktop 과 같은 `mcpServers` 형식입니다.

#### VS Code (GitHub Copilot)

프로젝트의 `.vscode/mcp.json` 또는 명령 팔레트의 **MCP: Open User Configuration**:

```json
{
  "servers": {
    "tossinvest": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ryum91/tossinvest-mcp"],
      "env": {
        "TOSSINVEST_CLIENT_ID": "tsck_live_xxx",
        "TOSSINVEST_CLIENT_SECRET": "tssk_live_xxx"
      }
    }
  }
}
```

#### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.tossinvest]
command = "npx"
args = ["-y", "@ryum91/tossinvest-mcp"]
env = { TOSSINVEST_CLIENT_ID = "tsck_live_xxx", TOSSINVEST_CLIENT_SECRET = "tssk_live_xxx" }
```

> 설정 파일에 실제 키가 들어가므로 **저장소에 커밋하지 마세요** (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` 등 프로젝트 단위 설정 파일 주의).

### 방법 2. 소스에서 빌드

```bash
git clone https://github.com/ryum91/tossinvest-mcp.git
cd tossinvest-mcp
pnpm install
pnpm build
```

키는 레포 루트의 `.env.local` 에 넣습니다 (`.gitignore` 처리됨). 서버가 시작할 때 `.env.local` → `.env` 순서로 자동으로 읽으며, MCP 설정의 `env` 나 셸 환경변수가 있으면 그 값이 우선합니다.

```bash
# .env.local
TOSSINVEST_CLIENT_ID=tsck_live_xxx
TOSSINVEST_CLIENT_SECRET=tssk_live_xxx
```

클라이언트에는 `npx` 대신 빌드 결과를 등록합니다 (`.env.local` 을 쓰면 `env` 는 생략 가능).

```bash
claude mcp add tossinvest -- node /절대/경로/tossinvest-mcp/dist/index.js
```

```json
{
  "mcpServers": {
    "tossinvest": {
      "command": "node",
      "args": ["/절대/경로/tossinvest-mcp/dist/index.js"]
    }
  }
}
```

### 환경변수

| 변수                          | 필수 | 설명                                                             |
| ----------------------------- | ---- | ---------------------------------------------------------------- |
| `TOSSINVEST_CLIENT_ID`        | ✅   | Open API client_id                                               |
| `TOSSINVEST_CLIENT_SECRET`    | ✅   | Open API client_secret                                           |
| `TOSSINVEST_TRADE_LOG_PATH`   |      | AI 매매 이력 저장 경로 (기본 `~/.tossinvest-mcp/trade-log.json`) |
| `TOSSINVEST_TOKEN_CACHE_PATH` |      | 토큰 캐시 경로 (기본 `~/.tossinvest-mcp/token.json`)             |

> 구 변수명 `TOSSINVEST_API_KEY` / `TOSSINVEST_SECRET_KEY` 도 하위 호환으로 인식합니다.

### 설치 확인

클라이언트를 다시 시작한 뒤 AI 에게 다음과 같이 요청합니다.

```
삼성전자 현재가 알려줘
→ get_prices(symbols: "005930")
```

정상이라면 도구 58개가 등록되고 현재가가 반환됩니다. 서버 로그(stderr)에는 `토큰 확보 성공. MCP 서버가 준비되었습니다.` 가 출력됩니다.

### 업데이트

- npx: 이미 받아 둔 버전이 캐시에 있으면 그대로 쓰일 수 있습니다. 최신 버전을 쓰려면 설정의 패키지를 `@ryum91/tossinvest-mcp@latest` 로 지정하거나, 캐시(`rm -rf ~/.npm/_npx`)를 지우고 클라이언트를 재시작하세요.
- 소스: `git pull && pnpm install && pnpm build`

### 문제 해결

| 증상                                             | 원인 / 해결                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access_denied`, `ip-not-allowed`, 403           | 현재 PC 의 공인 IP 가 허용 IP 에 없습니다. WTS → 설정 → Open API → 허용 IP 관리에 등록하세요. (VPN·회사망·모바일 핫스팟은 IP 가 바뀝니다)                                             |
| `invalid_client`                                 | `client_id` / `client_secret` 오타 또는 재발급 전 값입니다. 키를 재발급했다면 설정을 갱신하세요.                                                                                      |
| `token-revoked`                                  | 같은 키로 다른 곳에서 토큰을 새로 발급했습니다 (토큰은 클라이언트당 1개). 서버가 자동으로 재발급하지만, 같은 키를 여러 프로그램에서 동시에 쓰면 서로 토큰을 무효화할 수 있습니다.     |
| 429 / `rate-limit-exceeded`                      | 초당 호출 한도 초과. 서버가 `Retry-After` 만큼 대기 후 자동 재시도합니다.                                                                                                             |
| 서버가 시작되지 않음 (`환경변수 ... 필요합니다`) | `TOSSINVEST_CLIENT_ID` / `TOSSINVEST_CLIENT_SECRET` 이 전달되지 않았습니다. 클라이언트 설정의 `env` 블록을 확인하세요.                                                                |
| `npx` 첫 실행이 느리거나 `Connection closed`     | 처음 한 번은 패키지를 내려받느라 시간이 걸립니다. 계속 실패하면 터미널에서 `npx -y @ryum91/tossinvest-mcp` 를 직접 실행해 오류 메시지를 확인하고, Node 버전(20.19 이상)을 점검하세요. |
| 도구가 보이지 않음                               | 클라이언트를 완전히 종료 후 재시작하세요. Claude Code 는 `claude mcp list` 로 연결 상태를 확인합니다.                                                                                 |

### 토큰 관리

- 액세스 토큰은 첫 호출 시 발급되어 `~/.tossinvest-mcp/token.json`(권한 600)에 캐시되고, 만료 5분 전 또는 401(`expired-token`·`invalid-token`·`token-revoked`) 응답 시 자동 갱신됩니다.
- 토스증권은 **클라이언트당 토큰 1개만 유효**하므로, 여러 MCP 프로세스(여러 세션)가 캐시를 공유해 서로의 토큰을 무효화하지 않도록 했습니다.
- 429(Rate Limit) 응답은 `Retry-After` 만큼 대기 후 최대 3회 재시도합니다.

### 도구 메타데이터 · 입력 검증

- **툴 성격(annotations)·제목(title)**: 모든 도구에 한글 제목과 성격 힌트를 붙여 MCP 클라이언트가 승인 정책을 구분할 수 있습니다.
  | 구분      | 도구                                                                                   | readOnly | destructive | idempotent | openWorld |
  | --------- | -------------------------------------------------------------------------------------- | -------- | ----------- | ---------- | --------- |
  | 조회      | 시세·지표·계좌·주문 조회 등 49개                                                       | ✅       | —           | ✅         | ✅        |
  | 주문      | `create_order`, `modify_order`, `create_conditional_order`, `modify_conditional_order` | —        | ✅          | —          | ✅        |
  | 주문 취소 | `cancel_order`, `cancel_conditional_order`                                             | —        | ✅          | ✅         | ✅        |
  | 로컬      | `log_trade`(기록) / `get_trade_log`(조회)                                              | —/✅     | —           | —/✅       | —         |
  | 인증      | `issue_token`                                                                          | —        | —           | —          | ✅        |
- **서버 지침(instructions)**: 계좌 API 전 `get_accounts` 선행, 주문 도구는 사용자 승인 후에만 호출, `confirm_high_value_order` 사용 조건 등을 MCP 클라이언트에 전달합니다.
- **입력 검증 ([zod](https://zod.dev))**: 각 도구의 입력은 zod 스키마 하나로 정의되며, 같은 스키마에서 tools/list 의 JSON Schema 생성과 tools/call 인자 검증·타입 보정을 모두 처리합니다. API 호출 전에 위반 항목을 한 번에 모두 알려줍니다 (한국어 메시지, 입력값 표시).
  - 형식·범위: 심볼 패턴, 0보다 큰 decimal 문자열, 날짜(실존 여부 포함)·ISO 일시, 정수/범위(`count`·`limit`·기간 파라미터), enum
  - 조합 규칙: 수량/금액 중 하나만, 지정가↔가격 필수/금지, 금액 주문은 MARKET 전용·`time_in_force` 불가, 소수점 수량은 MARKET SELL 전용(6자리), CLS 는 LIMIT 전용, 조건주문 SINGLE/OCO/OTO 별 `second`·방향·감시가 순서·LIMIT 전용 규칙, 만료일(오늘~1년), 조회 기간 from ≤ to, 랭킹 `realtime` 제약, 국채 분봉 불가 등
  - 관대한 타입 보정: `"5"`→5, 5→`"5"`, `"true"`→true, `"BUY,SELL"`→`["BUY","SELL"]`, 선택 필드의 `null`/빈 문자열은 미지정 처리

## 사용 예시

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

오늘 코스피 거래대금 상위 10개
→ get_rankings(type: "MARKET_TRADING_AMOUNT", market_country: "KR", duration: "1d", count: 10)

삼성전자 외국인 수급 최근 5일
→ get_stock_investor_trading(symbol: "005930", count: 5)

AAPL 10주 보유분 360달러 익절 / 320달러 손절 걸어줘 (OCO)
→ create_conditional_order(account_seq: 1, symbol: "AAPL", type: "OCO", quantity: "10", order_type: "LIMIT",
    expire_date: "2026-12-31",
    first:  { order_side: "SELL", trigger_price: "360", order_price: "360" },
    second: { order_side: "SELL", trigger_price: "320", order_price: "319.5" })
```

> 기술 지표의 5m/30m/60m 봉은 1분봉을, 1w/1mo 봉은 일봉을 집계해 계산합니다. 1분봉은 최대 8,000개(40페이지)까지 조회하므로 분봉 기반 장기 지표(예: 60m 일목균형표)는 데이터가 부족할 수 있습니다.

## 개발

### 프로젝트 구조

```
src/
├── index.ts              # 진입점: 환경변수 확인 → 서버 시작 → 토큰 사전 확보
├── server.ts             # MCP 서버 (서버 지침 instructions, tools/list · tools/call)
├── config.ts             # .env.local/.env 로딩, 클라이언트 키, 로컬 파일 경로
├── api/
│   ├── auth.ts           # 토큰 발급 · 파일 캐시 공유 · 자동 갱신
│   └── client.ts         # HTTP (result 언랩, 401 재발급, 429 재시도, 에러 envelope)
├── lib/
│   ├── args.ts           # 인자 변환 헬퍼 (decimal 문자열, optional 값)
│   ├── candles.ts        # 캔들 페이지 조회 · 5m/30m/60m/1w/1mo 집계
│   ├── indicators/       # 지표 계산 순수 함수 — 지표별 1파일 (+ index.ts)
│   │   └── ema · rsi · macd · bollinger-bands · ichimoku · atr · adx · stochastic · obv · parabolic-sar
│   ├── trade-log.ts      # 매매 로그 파일 저장소
│   └── schema.ts         # zod 공통 빌더(accountSeq·symbol·positiveDecimal·isoDate…) · JSON Schema 생성 · 인자 파싱
└── tools/
    ├── types.ts          # ToolDefinition · 툴 성격(kind) → annotations
    ├── index.ts          # 툴 레지스트리 (목록 순서, 이름 중복 검사, 검증 후 핸들러 실행)
    ├── indicators/       # 지표 도구 — 지표별 1파일 (+ index.ts 노출 순서)
    │   └── ema · rsi · macd · bollinger-bands · ichimoku · atr · adx · stochastic · obv · volume-ma · parabolic-sar
    ├── market-data.ts    ├── trading-support.ts
    ├── stock-info.ts     ├── stock-trends.ts     ├── market-info.ts
    ├── ranking.ts        ├── market-indicators.ts├── sector.ts
    ├── account.ts        ├── order.ts            ├── order-info.ts
    ├── conditional-order.ts ├── trade-log.ts     └── auth.ts
```

### 도구 추가 방법

각 도구는 스키마·제목·성격·조합 검증·핸들러를 한 객체(`ToolDefinition`)에 함께 정의합니다. 해당 카테고리 파일의 배열에 추가하면 되고, 새 카테고리라면 `tools/index.ts` 의 `toolDefinitions` 에 등록합니다.

새 기술 지표는 계산 함수를 `lib/indicators/<지표>.ts` 에, 도구를 `tools/indicators/<지표>.ts` 에 만들고 각 폴더의 `index.ts` 에 추가합니다.

```ts
import { z } from "zod";
import { count, enumOf, symbol } from "../lib/schema.js";
import { defineTool } from "./types.js";

defineTool({
  name: "get_something",
  title: "무언가 조회", // 한글 제목
  kind: "read", // read | trade | trade-cancel | local-read | local-write | auth
  description: "...",
  input: z.object({
    symbol: symbol.describe("종목 심볼 (예: 005930, AAPL)"),
    side: enumOf(["BUY", "SELL"]).describe("매수/매도"),
    count: count(50).optional().describe("조회 건수 (최대 50)"),
  }),
  // (선택) 필드 조합 규칙 — "field: 내용" 형태로 넣으면 해당 경로의 zod 이슈가 됩니다
  validate: (a, errors) => {
    if (a.side === "SELL" && !a.count) errors.push("count: SELL 이면 필수입니다");
  },
  // args 타입은 input 스키마에서 추론됩니다 ({ symbol: string; side: "BUY" | "SELL"; count?: number })
  handler: async (args) => apiRequest("GET", "/api/v1/something", { symbol: args.symbol, count: args.count }),
});
```

공통 빌더(`lib/schema.ts`)는 토스증권 스펙의 형식·범위를 담고 있고, LLM 이 보내는 느슨한 입력을 보정합니다: `"5"`→5, 5→`"5"`, `"true"`→true, `"A,B"`→`["A","B"]`, 앞뒤 공백 제거, 선택 필드의 `null`/빈 문자열은 미지정 처리, 알 수 없는 키는 무시.

```bash
pnpm dev          # TypeScript watch 모드
pnpm build        # 빌드
pnpm start        # 빌드된 서버 실행

pnpm lint         # ESLint (typescript-eslint, 타입 기반 규칙)
pnpm lint:fix     # ESLint 자동 수정
pnpm format       # Prettier 포매팅
pnpm format:check # Prettier 포맷 검사
pnpm typecheck    # tsc --noEmit
pnpm check        # typecheck + lint + format:check (커밋 전 확인용)
```

### 코드 스타일

- **Prettier** (`.prettierrc.json`): 120자, 큰따옴표, 세미콜론, trailing comma. `openapi.json`(외부 스펙 원본)은 제외
- **ESLint** (`eslint.config.js`, flat config): `@eslint/js` recommended + `typescript-eslint` recommendedTypeChecked + `eslint-config-prettier`
  - 추가 규칙: `no-floating-promises`(주문 API 호출 await 누락 방지), `consistent-type-imports`, `eqeqeq`, 미사용 변수(`_` 접두사 허용)
- **[es-toolkit](https://es-toolkit.dev)**: 반올림(`round`)·합/평균(`sum`·`mean`·`sumBy`·`meanBy`)·그룹핑(`groupBy`)·배열(`last`·`takeRight`·`uniq`)·객체(`omitBy`·`mapValues`·`isPlainObject`)·비동기(`delay`·`Mutex`) 등 유틸리티는 직접 구현하지 않고 es-toolkit 을 사용합니다

## 라이선스

MIT
