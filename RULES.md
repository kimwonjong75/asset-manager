# 프로젝트 개발 원칙 (RULES.md)

## 1. 프로젝트 정체성 및 기술 스택
- **목표:** 개인 투자용 퀀트 자산 관리 시스템 (주식, 코인, 실물자산 통합)
- **Frontend:** React 19.2+, TypeScript, Vite, Tailwind CSS
- **Data Source:**
  - 주식: Google Cloud Run (Python) + FinanceDataReader
  - 코인: Upbit API
  - 환율: Google Cloud Run + FinanceDataReader (`/exchange-rate` 엔드포인트)
  - AI 검색/분석: Gemini API (종목 검색, 포트폴리오 AI 분석만)
  - 데이터 저장소: Google Drive (JSON 동기화)
- **State Management:** Context API (PortfolioContext)

## 2. 아키텍처 및 코드 작성 원칙 (절대 준수)

### [구조 분리 원칙]
1. **UI와 로직의 분리:**
   - `App.tsx` 등 UI 컴포넌트는 화면 표시에만 집중한다.
   - 데이터 처리 및 비즈니스 로직은 반드시 `hooks/` 또는 `utils/`로 분리한다.
   - 복잡한 계산 로직(수익률, 환율 변환 등)은 `utils/portfolioCalculations.ts`에 작성하고 순수 함수(Pure Function)로 유지한다.
   - 지표/신호는 백엔드에서 계산하며, 프론트는 전달/표시에만 집중한다. 신호 배지 렌더링은 `utils/signalUtils.ts`에서 처리한다.
   - **예외 — 차트 MA 오버레이:** 차트에 표시하는 이동평균선(MA5~MA200)은 `/history` 엔드포인트의 과거 종가를 기반으로 프론트엔드(`utils/maCalculations.ts`)에서 SMA를 계산한다. 이는 백엔드가 제공하는 단일값 `indicators.ma20/ma60`과는 별개이며, 사용자가 임의 기간을 선택할 수 있도록 하기 위함이다.

2. **상태 관리 (Context API):**
   - 3단계 이상의 Props Drilling은 금지한다.
   - 전역 데이터(자산 목록, 환율, 설정 등)는 `PortfolioContext`를 통해 접근한다.

3. **타입 안전성 (TypeScript):**
   - **`any` 타입 사용을 엄격히 금지한다.**
   - 모든 데이터 구조는 `types/` 디렉토리에 정의된 interface와 enum(`AssetCategory` 등)을 사용한다.
   - 컴포넌트 Props는 반드시 타입을 명시한다.
   - 서버 지표/신호는 `types/api.ts`의 `Indicators`와 `SignalType`을 사용하고, `Asset`/`WatchlistItem`에 선택적으로 포함한다.

### [외부 연동 및 에러 처리 원칙]
1. **API 연동:**
   - 외부 API(Cloud Run, Upbit) 호출 로직은 `hooks/useMarketData.ts` 등 전용 훅 내에서만 수행한다.
   - API 실패 시 UI가 멈추지 않도록 `try-catch`와 `fallback` 데이터를 반드시 구현한다. (부분 성공 허용)
   - 변동률 계산 시 백엔드의 `prev_close`를 우선 사용하고, 보정/환산이 필요한 경우에는 `services/priceService.ts` 또는 `hooks/useMarketData.ts`에서만 처리한다. UI 컴포넌트 내부에서 계산하지 않는다.

3. **데이터 모델링 및 차트 원칙:**
   - **외화 데이터 보존:** 자산 데이터 저장 시 반드시 `currentPrice`(원화 환산값)와 `priceOriginal`(외화 원본값)을 모두 저장해야 한다. 특히 히스토리 저장 시 외화 원본 가격(`unitPriceOriginal`) 누락을 주의한다.
   - **차트 일관성:** 외화 자산 차트는 기본적으로 해당 통화(USD 등)로 표시하되, 사용자 편의를 위해 KRW 환산 보기 옵션을 제공해야 한다. MA 오버레이 데이터에도 동일한 KRW 토글을 적용한다.
   - **차트 MA 오버레이:** AssetTrendChart는 MA 활성 시 `/history` 과거 시세 기반, MA 비활성 시 기존 PortfolioSnapshot 기반으로 동작한다. 과거 시세 fetch는 `hooks/useHistoricalPriceData.ts`에서 전담하며, 모듈 레벨 캐시(TTL 10분)를 사용한다. MA 토글 설정은 localStorage(`asset-manager-ma-preferences`)에 저장한다(경량 UI 설정이므로 Google Drive 동기화 대상 아님).
   - **환율 처리:** 차트나 계산 로직에서 환율이 필요할 경우, 가급적 실시간 환율(`exchangeRates`)을 상위에서 주입받아 사용하며 컴포넌트 내부에서 임의의 상수를 사용하지 않는다.
   - **이력 데이터 영속성:** 매도 등 히스토리 성격의 데이터를 저장할 때는, 원본 자산이 삭제되더라도 계산이 가능하도록 필요한 참조 데이터(매수 단가, 환율, 통화 등)를 이력 레코드 자체에 스냅샷(복사)하여 저장해야 한다. 분석/통계 화면에서 이력 데이터를 표시할 때는 이력 레코드의 스냅샷 필드(`originalPurchasePrice`, `originalPurchaseExchangeRate`, `originalCurrency`)를 **우선 사용**하고, 스냅샷이 없는 경우에만 현재 보유 자산(`assets`)을 폴백으로 조회해야 한다. (추가매수로 인한 평균 매수가 변경이 과거 매도 손익에 영향을 주지 않도록 하기 위함)

2. **Google Drive 동기화:**
   - 데이터 저장(`hooks/usePortfolioData.ts`) 시에는 로컬 상태와 구글 드라이브 간의 정합성을 최우선으로 한다.
   - **공유 폴더 지원**: 다중 계정 데이터 공유를 위해 `drive` scope와 `supportsAllDrives`/`includeItemsFromAllDrives` 파라미터가 필수다. 새로운 Drive API 호출 추가 시 해당 파라미터를 반드시 포함해야 한다.
   - **LZ-String 압축**: `googleDriveService.ts`에서 저장 시 `LZString.compressToUTF16()`, 로드 시 `LZString.decompressFromUTF16()`을 적용한다. 레거시 비압축 파일 호환을 위해 압축 해제 실패 시 원본 반환한다.
   - **히스토리 백필 및 보간**:
     - 데이터 로드 시 `backfillWithRealPrices()`를 호출하여 **실제 과거 시세**로 누락된 날짜를 채운다.
     - 주식/ETF: Cloud Run `/history` 엔드포인트 (FinanceDataReader)
     - 암호화폐: Cloud Run `/upbit/history` 엔드포인트 (Upbit Candles API)
     - API 실패 시 기존 `fillAllMissingDates()`로 폴백하여 마지막 데이터 복사.
     - 90일 초과 누락 시 API 부하 방지를 위해 기존 보간 방식 사용.
   - **자동 업데이트**: `lastUpdateDate`가 오늘이 아니면 `shouldAutoUpdate` 플래그를 설정하고, `PortfolioContext`에서 자동으로 시세 갱신을 트리거한다.

4. **사용자 설정 데이터 보존:**
   - 사용자가 입력하는 설정값(예: 리밸런싱 목표 비중 및 목표 금액, 알림 조건 등)은 반드시 영구 저장되어야 한다.
   - 이를 위해 `types/store.ts` 또는 `types/index.ts`의 데이터 모델에 필드를 추가하고, `hooks/useGoogleDriveSync.ts`, `hooks/usePortfolioData.ts`, `hooks/usePortfolioExport.ts`의 로드/저장/내보내기 로직에 포함시켜야 한다. `contexts/PortfolioContext.tsx`에서 해당 설정값을 로컬 `useState`로만 관리하지 않고, 반드시 `usePortfolioData` 훅의 영속화된 상태를 사용해야 한다.
   - 데이터 구조 변경 시 하위 호환성을 위한 마이그레이션 로직(`utils/migrateData.ts` 또는 훅 내부)을 반드시 구현해야 한다.

## 3. 작업 워크플로우 (AI 지침)

1. **영향도 분석 우선:**
   - 코드를 수정하기 전에, 해당 파일이 어디서 참조되고 있는지(`grep` 등 활용) 먼저 파악하고 사용자에게 보고한다.
   - 특히 `types/`나 `utils/`를 수정할 때는 프로젝트 전체에 미칠 영향을 분석해야 한다.

2. **기존 코드 보존:**
   - 잘 작동하는 기존 기능(특히 로그인, 자동저장)을 훼손하지 않는다.
   - 리팩토링 시 기존 함수의 입출력(Input/Output) 호환성을 유지한다.

3. **문서화:**
   - 새로운 파일이나 중요 로직이 추가되면 `README.md`의 관련 섹션도 함께 업데이트할 것을 제안한다.
   - 지표/신호와 전일종가 로직 변경 시 `README.md`와 `RULES.md`를 최신 상태로 유지한다.
