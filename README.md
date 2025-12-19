<div align="center">

# 자산-관리-시트

React + TypeScript + Vite 기반의 주식/코인 포트폴리오 관리 앱입니다. Google Drive에 데이터를 저장/로드하며, 실제 금융 API를 통해 가격 데이터를 가져옵니다.

</div>

## 개요
- Google Drive 연동으로 포트폴리오를 안전하게 저장/동기화
- 주식 가격은 Google Cloud Run API, 암호화폐 가격은 Upbit API로부터 수집
- 원화 환산과 분류/검색/정렬/차트 등 다양한 UI/UX 기능 제공

## 주요 기능
- Google 로그인 및 자동 저장/불러오기
- 배치 시세 조회(주식/코인), 실패 시 안전한 폴백 처리
- 포트폴리오 테이블 정렬 고도화: 수익률(%) ↓ → 수익률(%) ↑ → 평가손익(₩) ↓ → 평가손익(₩) ↑ → 해제
- 대시보드 차트 개선: 투자 원금/총 평가액/손익/수익률 표시
- 관심종목(Watchlist) 관리 및 일괄 업데이트
- CSV 내보내기/불러오기, 대량 업로드

## 폴더 구조
- `components/` UI 컴포넌트
  - `PortfolioTable.tsx` 포트폴리오 목록/정렬/필터/업데이트
  - `ProfitLossChart.tsx` 투자 원금/총 평가액/손익 라인 차트
  - 기타 대시보드/모달/차트/요약 컴포넌트
- `hooks/`
  - `useGoogleDriveSync.ts` Google Drive 인증/로드/자동 저장을 캡슐화한 커스텀 훅
- `services/`
  - `priceService.ts` 가격/환율 데이터 소스(Cloud Run/Upbit)
  - `geminiService.ts` 검색/챗 등 AI 보조 기능
- `types.ts` 도메인 타입 정의(Asset, Currency, ExchangeRates 등)
- `utils/` 마이그레이션 및 유틸
- `App.tsx` 앱 엔트리/상태 관리/페이지 구성

## 설치
- 요구사항: Node.js 18+, npm
```bash
npm install
npm run dev
```

## 환경 설정
루트에 `.env.local` 파일을 추가하세요.
```ini
# Google 로그인
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id

# 선택: 환율 조회(폴백)용 Gemini 키
VITE_GEMINI_API_KEY=your-gemini-api-key
```

## 데이터 소스
- 주식(Stocks): Google Cloud Run
  - 엔드포인트: `https://asset-manager-887842923289.asia-northeast3.run.app`
  - 서버 코드: `main.py` 기반이며, 모든 응답에 CORS 헤더를 포함하도록 수정됨
  - 요청: `POST` JSON 본문 예시
    ```json
    {
      "tickers": [
        { "ticker": "AAPL", "exchange": "NASDAQ" },
        { "ticker": "005930", "exchange": "KRX (코스피/코스닥)" }
      ]
    }
    ```
  - 응답이 없거나, 본문 없이 호출하면 `{"error": "No tickers provided"}`가 반환됩니다. 반드시 `tickers` 배열을 포함해야 합니다.
- 암호화폐(Crypto): Upbit
  - 엔드포인트: `GET https://api.upbit.com/v1/ticker?markets=KRW-<TICKER1>,KRW-<TICKER2>,...`
  - 예: `KRW-BTC`, `KRW-ETH` 등
  - 사용 필드: `trade_price`, `prev_closing_price`
- 조회 분기 로직
  - 사용자의 ‘자산 구분(Category)’ 설정과 무관하게, 입력된 ‘거래소(Exchange)’ 문자열을 파싱하여 API를 자동 분기합니다.
  - `exchange`에 `Upbit/Bithumb/Coin/주요 거래소`가 포함되면 Upbit, 그 외(`NASDAQ/KRX/NYSE/Foreign`)는 Cloud Run(FinanceDataReader)로 전송됩니다.

### 환율(Exchange Rate)
- 정확한 환율은 Cloud Run에서 조회합니다.
  - USD/KRW: `priceService.fetchExchangeRate()` → `ticker: "USD/KRW"`
  - JPY/KRW: `priceService.fetchExchangeRateJPY()` → `ticker: "JPY/KRW"`
- 앱 초기화 및 현금(KRW 외 통화) 자산 계산에 사용됩니다.
- AI(Gemini)는 검색/챗 보조에만 사용하며, 환율 조회에는 사용하지 않습니다.

## 정렬/차트 UX
- 테이블 수익률 헤더 클릭 시 순환 정렬:
  - 수익률(%) 내림차순 → 오름차순 → 평가손익(₩) 내림차순 → 오름차순 → 해제
  - 헤더에 현재 상태 아이콘/텍스트 표시
- 손익 차트(ProfitLossChart):
  - ‘투자 원금’, ‘총 평가액’, ‘손익’ 라인 동시 표시
  - 툴팁에 날짜, 투자 원금, 총 평가액, 총 수익률 (합산 평균) 표시

## Google Drive 동기화 훅
- `useGoogleDriveSync.ts`가 제공하는 기능:
  - `isSignedIn`, `googleUser`, `isInitializing`
  - `handleSignIn()`, `handleSignOut()`
  - `loadFromGoogleDrive()` → `{ assets, portfolioHistory, sellHistory, watchlist, exchangeRates }`
  - `autoSave(assets, history, sells, watchlist, exchangeRates)`
- `App.tsx`에서 훅을 사용하도록 통합되어 유지보수성이 향상되었습니다.

## 빌드/배포
```bash
npm run build
```
- 빌드 산출물은 `dist/`에 생성됩니다
- 정적 호스팅(Cloudflare Pages/Vercel 등) 또는 서버에 배포
- Cloud Run API 접근 권한/네트워크 허용을 확인하세요

## 데이터 모델 요약
- `Asset` 기본 필드:
  - `currency`: `KRW | USD | JPY | CNY`
  - `currentPrice`와 `purchasePrice`: 해당 통화 기준
  - 원화 환산은 `ExchangeRates` 상태를 활용
- `ExchangeRates`:
  - `{ USD: number; JPY: number }` 형태이며 UI에서 수정 가능

## 변경 사항 요약(로드맵)
1. Google Drive 로직 분리: `useGoogleDriveSync` 도입, `App.tsx` 통합
2. 시세 소스/분기 변경: 주식은 Cloud Run, 코인은 Upbit로 사용하며, ‘거래소(Exchange)’ 기준으로 자동 분기 (`services/priceService.ts`)
3. 포트폴리오 정렬 고도화: 수익률 헤더 클릭 시 순환 정렬
4. 대시보드 차트 보강: 투자 원금/총 평가액 라인 & 툴팁 라벨을 ‘총 수익률 (합산 평균)’으로 변경
5. 문서화: 프로젝트 개요/구조/설치/환경/데이터 소스/UX 정리

## 주의 사항
- Cloud Run API는 `tickers`가 비어있으면 오류를 반환합니다. 배치 요청 시 항상 유효한 틱커/거래소 페어를 전달하세요.
- 환율은 Cloud Run을 우선 사용합니다. 검색(`searchSymbols`)과 챗은 `geminiService`를 사용합니다.

