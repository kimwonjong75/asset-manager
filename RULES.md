# 프로젝트 개발 원칙 (RULES.md)

> **이 문서의 목적**: AI 코딩 도구(Claude, Cursor 등)가 코드 수정/추가 시 참고하는 개발 규칙 및 의존관계 문서

## 1. 프로젝트 정체성 및 기술 스택

- **목표:** 개인 투자용 퀀트 자산 관리 시스템 (주식, 코인, 실물자산 통합)
- **Frontend:** React 19.2+, TypeScript, Vite, Tailwind CSS
- **Data Source:**
  - 주식/ETF: Cloud Run `/` (Python + FinanceDataReader)
  - 암호화폐: Cloud Run `/upbit` (Upbit API 프록시)
  - 환율: Cloud Run `/exchange-rate` (FinanceDataReader)
  - AI 검색/분석: Gemini API (종목 검색, 포트폴리오 AI 분석만)
  - 데이터 저장소: Google Drive (JSON 동기화, LZ-String 압축)
- **State Management:** Context API (PortfolioContext)

---

## 2. 아키텍처 및 코드 작성 원칙

### 구조 분리 원칙
| 영역 | 책임 | 금지 사항 |
|------|------|----------|
| `App.tsx`, 컴포넌트 | UI 렌더링만 | 비즈니스 로직, API 호출 금지 |
| `hooks/` | 데이터 처리, API 호출, 상태 관리 | UI 렌더링 금지 |
| `utils/` | 순수 함수, 계산 로직 | 상태 변경, side effect 금지 |
| `services/` | 외부 API 호출 | 상태 관리 금지 |

### 상태 관리 규칙
- **3단계 이상 Props Drilling 금지** → `PortfolioContext` 사용
- 전역 데이터(자산 목록, 환율, 설정 등)는 `PortfolioContext`를 통해 접근

### 타입 안전성
- **`any` 타입 사용 절대 금지**
- 모든 데이터 구조는 `types/` 디렉토리의 interface/enum 사용
- 컴포넌트 Props는 반드시 타입 명시
- 서버 지표/신호는 `types/api.ts`의 `Indicators`, `SignalType` 사용

### API 연동 원칙
- 외부 API 호출은 `hooks/useMarketData.ts` 등 전용 훅에서만 수행
- API 실패 시 `try-catch`와 `fallback` 데이터 필수 (부분 성공 허용)
- 변동률(어제대비) 계산은 `usePortfolioCalculator`의 `yesterdayChange` 사용 (현재가-전일종가 기반 직접 계산)

---

## 3. 파일/폴더별 책임 범위

### hooks/ (커스텀 훅)
| 파일 | 책임 | 의존 | 수정 시 확인 |
|------|------|------|-------------|
| `usePortfolioData.ts` | 핵심 데이터 상태, Google Drive 동기화 | `useGoogleDriveSync`, `historyUtils` | `PortfolioContext` |
| `useMarketData.ts` | 시세/환율 업데이트, 암호화폐 분기, **관심종목 시세도 함께 갱신** | `priceService`, `upbitService` | `PortfolioContext` |
| `useAssetActions.ts` | 자산 CRUD, 매도/매수/CSV 처리 | `priceService`, `geminiService` | 모달 컴포넌트들 |
| `usePortfolioCalculator.ts` | 수익률/손익 계산 (구매 환율 기준) | `types/index` | 대시보드, 통계 |
| `useHistoricalPriceData.ts` | 차트용 과거 종가 데이터 (MA 여부 무관, 캐시 내장, `displayDays` 기반 기간 제어) | `historicalPriceService`, `maCalculations` | `AssetTrendChart` |
| `useGlobalPeriodDays.ts` | 글로벌 기간(`GlobalPeriod`) → `{ startDate, endDate, days }` 변환 유틸 훅 | `types/store` | `AssetTrendChart`, `DashboardView`, `AnalyticsView` |
| `useEnrichedIndicators.ts` | 전 종목 배치 과거 데이터 조회 → MA 전 기간(5~200) + RSI(금일/전일) 계산 | `historicalPriceService`, `maCalculations` | **`PortfolioContext`** (Context 레벨에서 호출, enrichedMap을 전역 공유), `geminiService` (타입만) |
| `useAutoAlert.ts` | 자동 알림 트리거 + AlertSettings localStorage 영속 | `alertChecker`, `types/alertRules` | `PortfolioContext` (derived/actions에 노출) |
| `usePortfolioHistory.ts` | 포트폴리오 스냅샷 저장 | `types/index` | 차트 데이터 |
| `useRebalancing.ts` | 리밸런싱 계산 및 저장 | `PortfolioContext` | `RebalancingTable` |
| `useGoogleDriveSync.ts` | Google Drive 저장/로드, 토큰 갱신, **인증 상태 변경 콜백 등록** | `googleDriveService`, `lz-string` | `usePortfolioData` |

### services/ (외부 API 연동)
| 파일 | 책임 | API 엔드포인트 | 수정 시 확인 |
|------|------|----------------|-------------|
| `priceService.ts` | 주식/ETF 시세, 환율 | Cloud Run `/`, `/exchange-rate` | `useMarketData`, `useAssetActions` |
| `upbitService.ts` | 암호화폐 시세 | Cloud Run `/upbit` | `useMarketData` |
| `historicalPriceService.ts` | 과거 시세 (백필/차트용/AI분석용) | Cloud Run `/history`, `/upbit/history` | `useHistoricalPriceData`, `historyUtils`, `geminiService` |
| `googleDriveService.ts` | 클라우드 저장/로드, **401 자동 재인증** (`authenticatedFetch` 래퍼) | Google Drive API | `useGoogleDriveSync` |
| `geminiService.ts` | 종목 검색, AI 분석 (스트리밍 응답, 기술적 질문 시 Context의 enrichedMap 재활용 우선 → 폴백으로 직접 fetch) | Gemini API, `historicalPriceService`, `maCalculations`, `useEnrichedIndicators`(타입만) | `useAssetActions`, `PortfolioAssistant` |

### utils/ (순수 함수)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `portfolioCalculations.ts` | 포트폴리오 계산 유틸 | 전역 (계산 결과 변경) |
| `historyUtils.ts` | 히스토리 보간/백필/기존 스냅샷 종가 교정/오염 데이터 교정 | `usePortfolioData` |
| `maCalculations.ts` | SMA/RSI 계산, 차트 데이터 빌드 | `AssetTrendChart`, `useEnrichedIndicators`, `geminiService` |
| `signalUtils.ts` | 신호/RSI 배지 렌더링 | `PortfolioTableRow`, `WatchlistPage` |
| `smartFilterLogic.ts` | 스마트 필터 매칭 (그룹 내 OR, 그룹 간 AND), enriched 지표 참조, `PRICE_BELOW_*` 판정 포함. **`matchesSingleFilter()` export** — 알림 규칙 체커에서도 재활용 | `PortfolioTable`, `alertChecker.ts` |
| `alertChecker.ts` | 알림 규칙별 자산 매칭 (규칙 내 필터 AND 조합), 매칭 상세 문자열 생성 | `smartFilterLogic.matchesSingleFilter`, `types/alertRules` | `useAutoAlert`, 프리셋 버튼 |
| `migrateData.ts` | 데이터 마이그레이션 | 로드 시 자동 실행 |

### types/ (타입 정의)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `index.ts` | 핵심 타입 (`Asset`, `Currency`, `AssetCategory` 등) | **전역** - 거의 모든 파일 |
| `api.ts` | API 응답 타입 (`PriceItem`, `Indicators` 등) | `services/`, `hooks/` |
| `store.ts` | 상태 관리 타입 (`PortfolioContextValue`, `GlobalPeriod`, `UIState.activeTab` 등). `ActiveTab`에 `'settings'` 포함, `UIState`에 `alertSettings`, `DerivedState`에 `enrichedMap`/`alertResults`/`showAlertPopup` | `contexts/`, `hooks/`, `App.tsx`, `components/common/PeriodSelector`, `SmartFilterPanel`, `AlertSettingsPage` |
| `ui.ts` | UI 컴포넌트 Props 타입 | `components/` |
| `smartFilter.ts` | 스마트 필터 타입 (21개 키, MA 기간 설정 + `lossThreshold` 포함), 그룹 매핑, 칩 정의(`pairKey`/`pairColorClass` tri-state 지원), 초기값 | `utils/smartFilterLogic`, `SmartFilterPanel`(+ `PortfolioContext` 의존), `PortfolioTable`, `alertChecker` |
| `alertRules.ts` | 알림 규칙 타입 (`AlertRule`, `AlertResult`, `AlertSettings`, `AlertMatchedAsset`) | `constants/alertRules`, `utils/alertChecker`, `hooks/useAutoAlert`, `AlertSettingsPage`, `AlertPopup` |

### constants/ (상수 정의)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `columnDescriptions.ts` | 포트폴리오 테이블 컬럼 툴팁 텍스트 | `PortfolioTable`, `PortfolioTableRow` |
| `smartFilterChips.ts` | 스마트 필터 칩 정의 (19개 칩, 동적 라벨, 색상). MA 현재가 칩 2개는 `pairKey`로 ABOVE↔BELOW tri-state 토글 (off→>→<→off 순환, 칩 하나로 2개 필터 키 제어). `DAILY_DROP`/`LOSS_THRESHOLD` 추가 | `SmartFilterPanel` |
| `alertRules.ts` | 기본 알림 규칙 8개 (매도 5 + 매수 3), `DEFAULT_ALERT_SETTINGS` | `useAutoAlert`, `AlertSettingsPage` |

### components/layouts/ (탭별 뷰)
| 파일 | 책임 | 의존 |
|------|------|------|
| `DashboardView.tsx` | 대시보드 탭 | `PortfolioContext`, `useGlobalPeriodDays` |
| `PortfolioView.tsx` | 포트폴리오 상세 탭 | `PortfolioContext`, `PortfolioTable` |
| `AnalyticsView.tsx` | 수익 통계 탭 | `PortfolioContext`, `useGlobalPeriodDays` |
| `WatchlistView.tsx` | 관심종목 탭 | `PortfolioContext`, `WatchlistPage` |
| `InvestmentGuideView.tsx` | 투자 가이드 탭 (순수 UI, 외부 의존 없음) | - |

> 설정 탭(`AlertSettingsPage`)은 layouts/ 하위가 아닌 `components/AlertSettingsPage.tsx`에 직접 위치

### components/common/ (공용 컴포넌트)
| 파일 | 책임 | 의존 |
|------|------|------|
| `PeriodSelector.tsx` | 글로벌 기간 선택 버튼 (3개월/6개월/1년/2년/전체) | `types/store` (`GlobalPeriod`) |
| `AlertPopup.tsx` | "오늘의 투자 브리핑" 모달 — severity별 스타일, 매도/매수 섹션 분리, 매칭 자산 상세 표시 | `types/alertRules` (`AlertResult`) |
| `Toggle.tsx` | 토글 스위치 | - |
| `Tooltip.tsx` | 툴팁 | - |

### components/ (알림 설정)
| 파일 | 책임 | 의존 |
|------|------|------|
| `AlertSettingsPage.tsx` | 설정 탭 — 알림 규칙별 활성/비활성 토글, 임계값 인라인 편집, 자동 팝업 on/off | `PortfolioContext` (`ui.alertSettings`, `actions.updateAlertSettings`), `constants/alertRules` |

### components/ (관심종목 모달)
| 파일 | 책임 | 의존 |
|------|------|------|
| `WatchlistAddModal.tsx` | 관심종목 추가 모달 | `PortfolioContext` (`addWatchItemOpen`, `addWatchItem`) |
| `WatchlistEditModal.tsx` | 관심종목 수정/삭제 모달 | `PortfolioContext` (`editingWatchItem`, `updateWatchItem`, `deleteWatchItem`) |
| `WatchlistPage.tsx` | 관심종목 테이블 (행별 액션 메뉴 + 차트 확장) | `AssetTrendChart`, `signalUtils` |

> `WatchlistView.tsx`에서 세 컴포넌트를 함께 렌더링

### contexts/
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `PortfolioContext.tsx` | 전역 상태 Provider, 모든 훅 통합 | **전역** - App.tsx 및 모든 컴포넌트 |

---

## 4. 의존관계 매핑

### 핵심 데이터 흐름
```
App.tsx
  └─ PortfolioContext.tsx
       ├─ usePortfolioData.ts ──────┬─ useGoogleDriveSync.ts
       │                            ├─ historyUtils.ts
       │                            └─ migrateData.ts
       ├─ useMarketData.ts ─────────┬─ priceService.ts (주식/ETF/환율)
       │                            └─ upbitService.ts (암호화폐)
       ├─ useAssetActions.ts ───────┬─ priceService.ts
       │                            └─ geminiService.ts
       ├─ usePortfolioCalculator.ts ── types/index.ts
       ├─ useEnrichedIndicators.ts ── historicalPriceService, maCalculations
       └─ useAutoAlert.ts ─────────── alertChecker.ts → smartFilterLogic.ts
```

### 시세 조회 분기 흐름
```
useMarketData.ts → handleRefreshAllPrices()
    │
    └─ Promise.all() ── 6개 fetch 동시 실행
         ├─ fetchExchangeRate()       → /exchange-rate (USD/KRW, 5분 캐시)
         ├─ fetchExchangeRateJPY()    → /exchange-rate (JPY/KRW, 5분 캐시)
         ├─ 보유자산(일반)             → priceService.ts → Cloud Run /
         ├─ 보유자산(암호화폐)         → upbitService.ts → Cloud Run /upbit
         ├─ 관심종목(일반)             → priceService.ts → Cloud Run /
         └─ 관심종목(암호화폐)         → upbitService.ts → Cloud Run /upbit
              │
              └─ 모든 fetch 완료 후 결과 매핑
                   ├─ 현금 자산: 환율 결과로 즉시 계산
                   ├─ setAssets() + setWatchlist()
                   └─ triggerAutoSave()
```
> **주의**: `handleRefreshAllPrices`가 환율·보유자산·관심종목을 **하나의 Promise.all로 병렬 실행**함. 새 fetch를 추가할 때 이 Promise.all에 포함해야 함.

### 글로벌 기간 선택 흐름
```
PeriodSelector (App.tsx 탭 바 우측)
    │
    └─ PortfolioContext.globalPeriod (3M/6M/1Y/2Y/ALL, 기본 1Y)
         │   └─ localStorage 영속 ('asset-manager-global-period')
         │
         ├─ DashboardView → portfolioHistory 필터 → ProfitLossChart
         ├─ AssetTrendChart → useHistoricalPriceData(displayDays) + 차트 데이터 slice
         ├─ AnalyticsView → SellAnalyticsPage(periodStartDate, periodEndDate)
         └─ WatchlistPage → AssetTrendChart (동일)
```
- **탭 순서**: 대시보드 | 포트폴리오 상세 | 관심종목 | 수익 통계 | 투자 가이드 | **설정** (가이드·설정 탭에서는 PeriodSelector 숨김)
- **수익 통계 기간**: 자체 date input 삭제됨, 글로벌 기간 props로 전달받음

### 차트 데이터 흐름
```
AssetTrendChart.tsx
    │
    ├─ ticker/exchange 있는 자산 (주식, 코인 등)
    │   └─ useHistoricalPriceData.ts (displayDays + MA warm-up 합산 fetch)
    │        └─ historicalPriceService.ts → /history 또는 /upbit/history
    │             └─ 실제 종가 기반 차트 + MA 오버레이 (활성 시)
    │                  └─ displayDays 기준으로 표시 범위 slice (MA warm-up 구간 제거)
    │
    └─ 현금 등 ticker 없는 자산
        └─ PortfolioSnapshot 기반 (폴백, 글로벌 기간으로 필터)
```

### 스마트 필터 확장 지표 흐름
```
PortfolioContext.tsx (Context 레벨에서 호출)
    │
    └─ useEnrichedIndicators.ts (전 종목 배치)
         ├─ historicalPriceService.ts → /history, /upbit/history (330일)
         ├─ maCalculations.ts → calculateSMA() (5/10/20/60/120/200)
         ├─ maCalculations.ts → calculateRSI() (14일)
         └─ 결과: Map<ticker, { ma, prevMa, rsi, prevRsi }>
              ├─ PortfolioTable → smartFilterLogic.ts (스마트 필터)
              ├─ useAutoAlert → alertChecker.ts (알림 규칙 체크)
              └─ PortfolioAssistant → geminiService.ts (AI 분석)
```
- **enrichedMap 위치**: `PortfolioContext.derived.enrichedMap`으로 전역 공유 (이전: PortfolioTable 로컬)
- **데이터 소스**: 차트와 동일한 과거 종가 API 사용 (10분 캐시)
- **계산 위치**: 프론트엔드 로컬 계산 (백엔드 수정 불필요)
- **폴백**: enriched 데이터 로딩 전 → 백엔드 `indicators.ma20/ma60/rsi` 사용

### 투자 시그널 알림 흐름
```
앱 접속 → 시세 업데이트 완료 → enrichedMap 로드 완료
    │
    └─ useAutoAlert.ts
         ├─ 조건 체크: enableAutoPopup && 오늘 미표시 && 데이터 준비 완료
         ├─ checkAlertRules(enrichedAssets, enrichedMap, rules)
         │    └─ alertChecker.ts → matchesSingleFilter() 재활용 (AND 조합)
         ├─ 결과 있으면 → AlertPopup 표시
         └─ localStorage('asset-manager-alert-popup-date')에 오늘 날짜 기록
```
```
프리셋 버튼 (PortfolioTable.tsx)
    │
    ├─ 프리셋 선택 → AlertRule.filters + filterConfig → SmartFilterState로 변환 → 스마트필터 적용
    ├─ "브리핑 다시 보기" → showBriefingPopup() (오늘 날짜 제한 무시)
    └─ "알림 설정" → setActiveTab('settings')
```
- **알림 규칙 vs 스마트 필터**: 알림 규칙은 필터를 **순수 AND** 조합 (스마트 필터의 그룹 내 OR과 다름)
- **설정 저장**: `localStorage('asset-manager-alert-settings')` — Google Drive 파이프라인 미사용
- **팝업 1일 1회**: `localStorage('asset-manager-alert-popup-date')`로 중복 방지, 수동 "브리핑 다시 보기"는 제한 없음

### AI 어시스턴트 기술적 분석 흐름
```
PortfolioAssistant.tsx
    │
    ├─ PortfolioContext.derived.enrichedMap (Context에서 공유, API 0회)
    │
    └─ geminiService.ts → askPortfolioQuestionStream()
         │
         ├─ containsTechnicalKeywords() → 기술적 질문 감지
         │   (이평선, 정배열, RSI, 골든크로스, 기술적, 추세 등)
         │
         ├─ [기술적 질문일 때] enrichedMap 재활용 (Zero-Fetch)
         │     └─ 폴백: enrichedMap 없으면 fetchTechnicalIndicators() 직접 호출
         │
         ├─ buildPortfolioPrompt() → 압축 JSON (pretty-print 제거)
         │
         └─ generateContentStream() → 스트리밍 응답 → onChunk 콜백 → UI 실시간 갱신
```
- **Zero-Fetch**: `PortfolioContext`가 로드한 `enrichedMap`을 재활용 → Cloud Run `/history` 중복 호출 제거
- **스트리밍**: `generateContentStream` 사용 → 첫 토큰부터 UI에 표시 (체감 TTFT 0.3~0.5초)
- **JSON 압축**: `JSON.stringify(data)` (pretty-print 제거로 토큰 ~30% 절감)
- **프롬프트 빌더**: `buildPortfolioPrompt()` 공용 헬퍼로 분리 (스트리밍/비스트리밍 공유)
- **현금 자산**: 기술적 분석에서 자동 제외
- **폴백 안전장치**: enrichedMap이 비어있으면 기존 `fetchTechnicalIndicators`로 폴백

### 수정 시 확인해야 할 의존관계

| 수정 대상 | 반드시 확인할 파일 |
|-----------|-------------------|
| `types/index.ts`의 `Asset` | `hooks/*`, `components/*`, `utils/portfolioCalculations.ts` |
| `types/index.ts`의 `Currency`/`AssetCategory` | `hooks/*`, `components/*`, `utils/*` |
| `priceService.ts` | `useMarketData.ts`, `useAssetActions.ts` |
| `upbitService.ts` | `useMarketData.ts` |
| `historyUtils.ts` | `usePortfolioData.ts` |
| `usePortfolioData.ts` | `PortfolioContext.tsx` |
| `useGoogleDriveSync.ts` | `usePortfolioData.ts`, `usePortfolioExport.ts` |
| `maCalculations.ts` | `AssetTrendChart`, `useEnrichedIndicators`, `useHistoricalPriceData`, `geminiService` |
| `useEnrichedIndicators.ts` | **`PortfolioContext`** (enrichedMap 전역 공유), `geminiService` (타입만) |
| `alertChecker.ts` | `useAutoAlert`, 프리셋 버튼 (`PortfolioTable`) |
| `constants/alertRules.ts` | `useAutoAlert`, `AlertSettingsPage` |
| `useGlobalPeriodDays.ts` | `AssetTrendChart`, `DashboardView`, `AnalyticsView` |
| `PortfolioContext.tsx` | `App.tsx`, 모든 Context 소비 컴포넌트 |

---

## 5. 핵심 타입 정의

### Asset (자산)
```typescript
interface Asset {
  id: string;                    // 고유 식별자
  category: AssetCategory;       // 자산 카테고리 (한국주식, 미국주식, 암호화폐 등)
  ticker: string;                // 티커 심볼 (005930, AAPL, BTC)
  exchange: string;              // 거래소 (KRX, NASDAQ, Upbit)
  name: string;                  // 자산명
  customName?: string;           // 사용자 지정명
  quantity: number;              // 보유 수량
  purchasePrice: number;         // 매수 단가
  purchaseDate: string;          // 매수일
  currency: Currency;            // 통화 (KRW, USD, JPY)
  purchaseExchangeRate?: number; // 매수 시 환율 (수익률 계산용)
  currentPrice: number;          // 현재가 (KRW 자산은 KRW, 외화 자산은 원본통화)
  priceOriginal: number;         // 외화 원본 가격 (항상 원본통화)
  highestPrice: number;          // 52주 최고가
  previousClosePrice?: number;   // 전일 종가
  sellAlertDropRate?: number;    // 매도 알림 하락률
  memo?: string;                 // 메모
  sellTransactions?: SellTransaction[]; // 매도 이력
}
```

### PortfolioSnapshot (스냅샷)
```typescript
interface PortfolioSnapshot {
  date: string;              // 날짜 (YYYY-MM-DD)
  assets: AssetSnapshot[];   // 자산별 스냅샷
}

interface AssetSnapshot {
  id: string;                // 자산 ID
  name: string;              // 자산명
  currentValue: number;      // 현재가치 (KRW)
  purchaseValue: number;     // 매수가치 (KRW)
  unitPrice?: number;        // 1주당 단가 (KRW) — 없으면 백필 교정 스킵됨
  unitPriceOriginal?: number; // 외화 원본 단가 (차트용)
  currency?: Currency;        // 통화 정보
}
```

### SellRecord (매도 기록)
```typescript
interface SellRecord {
  id: string;
  assetId: string;
  date: string;
  quantity: number;
  price: number;               // 매도 단가
  // 스냅샷 필드 (원본 자산 삭제되어도 계산 가능)
  originalPurchasePrice?: number;
  originalPurchaseExchangeRate?: number;
  originalCurrency?: Currency;
}
```

---

## 6. 핵심 로직 상세

### 암호화폐 분기 판단 (`shouldUseUpbitAPI`)
```typescript
// hooks/useMarketData.ts
const shouldUseUpbitAPI = (exchange: string, category?: AssetCategory): boolean => {
  const normalized = (exchange || '').toLowerCase();

  // 명확하게 Upbit/Bithumb인 경우
  if (normalized === 'upbit' || normalized === 'bithumb') return true;

  // 한글 거래소명 + 암호화폐 카테고리
  const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(exchange);
  if (hasKorean && category === AssetCategory.CRYPTOCURRENCY) return true;

  return false;
};
```

### 환율 적용 로직 (`getPurchaseValueInKRW`)
```typescript
// hooks/usePortfolioCalculator.ts
const getPurchaseValueInKRW = (asset: Asset, exchangeRates: ExchangeRates): number => {
  if (asset.currency === Currency.KRW) return asset.purchasePrice;

  // 구매 당시 환율 우선 사용
  if (asset.purchaseExchangeRate && asset.purchaseExchangeRate > 0) {
    return asset.purchasePrice * asset.purchaseExchangeRate;
  }

  // 폴백: 현재 환율 사용 (기존 자산 호환성)
  return getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);
};
```

### 히스토리 백필 + 종가 교정 로직
- **주식/ETF**: `/history` 엔드포인트 (FinanceDataReader)
- **암호화폐**: `/upbit/history` 엔드포인트 (Upbit Candles API)
- **기존 스냅샷 교정**: 장중 업데이트로 기록된 가격을 실제 종가로 소급 교정 (오늘 제외)
- **unitPrice 없는 스냅샷**: 수량 역산 불가하므로 교정 스킵 (오염 방지)
- **90일 초과**: 최근 90일만 교정/백필 (API 부하 방지)
- **API 실패**: `fillAllMissingDates()`로 폴백 (마지막 데이터 복사)

### 오염 스냅샷 자동 교정 (`repairCorruptedSnapshots`)
- **실행 시점**: Google Drive 로드 직후, 보간/백필 전에 실행
- **감지 기준**: `currentValue / purchaseValue` 비율이 10배(1,000%) 이상인 자산
- **교정 방식**: 정상 스냅샷(최신→과거 탐색)에서 `purchaseValuePerUnit`을 역산 → 오염 자산의 수량을 복원하여 `currentValue` 재계산
- **원인**: 과거 `unitPrice` 미저장 스냅샷에서 `currentValue / 1`로 수량이 역산되어 발생
- **데이터 저장**: 교정 후 백필→자동 저장으로 Google Drive에 반영

---

## 7. 에러 처리 패턴

### API 호출 표준 패턴
```typescript
try {
  const result = await fetchSomething();
  // 성공 처리
} catch (error) {
  console.error('[함수명] 에러:', error);
  // 폴백 데이터 반환 또는 부분 성공 처리
  return fallbackData;
}
```

### 부분 성공 허용
- 시세 조회 시 일부 자산 실패해도 성공한 자산만 업데이트
- `isMocked: true` 플래그로 모킹 데이터 여부 표시

### 사용자 알림
- 치명적 오류: `alert()` 또는 Toast
- 경고성 오류: `console.warn()` + UI 상태 표시
- 디버그 정보: `console.log()` (프로덕션에서 제거 고려)

---

## 8. 주의사항 및 오류 방지

### 시세 API 관련
| 항목 | 주의사항 |
|------|---------|
| **청크 크기** | 20개씩 요청 (API 제한), 청크 간 500ms 대기 (마지막 청크 후에는 대기 없음) |
| **환율 조회** | `fetchExchangeRate()`/`fetchExchangeRateJPY()`는 전용 `/exchange-rate` 엔드포인트 사용 (5분 캐시, 배치 API 경유하지 않음) |
| **모킹 데이터** | API 실패 시 `isMocked: true` 플래그와 함께 기본값 제공 |
| **부분 성공** | 일부 자산 실패해도 성공한 자산만 업데이트 |

### 암호화폐 분기 처리
- **Upbit/Bithumb 예외**: 업비트 API는 **항상 KRW 가격**을 반환
  - `currency` 설정과 무관하게 강제로 KRW로 처리
  - 수익률 계산 시 환율 변환 불필요
- **CORS 우회 필수**: 클라이언트에서 업비트 직접 호출 불가 → Cloud Run 프록시 경유

### 환율 처리
- **기본값**: USD 1450, JPY 9.5 (API 실패 시)
- **유효성 검사**: USD > 100, JPY > 1
- **현재가 vs 매수가**: 현재가는 실시간 환율, 매수가는 구매 당시 환율 사용

### Google Drive 동기화
- **자동 저장 디바운스**: 2초 (빈번한 저장 방지)
- **토큰 갱신**: 만료 5분 전 자동 갱신 (`scheduleTokenRefresh`)
- **401 자동 재인증**: 모든 Drive API 호출은 `authenticatedFetch()` 래퍼를 경유 — 401 응답 시 silent refresh → 실패 시 Google 로그인 팝업 자동 표시 → 성공하면 원래 요청 재시도, 팝업도 거부 시 `clearAuth()` → UI 자동 로그아웃
- **인증 상태 콜백**: `setAuthStateChangeCallback()`으로 UI 레이어(`useGoogleDriveSync`)가 인증 해제를 구독 — 재인증 완전 실패 시 React 상태 자동 동기화
- **새 Drive API fetch 추가 시**: 반드시 `this.authenticatedFetch()` 사용 (raw `fetch` 직접 호출 금지 — 401 복구 경로 누락됨)
- **공유 폴더 파라미터**: 새 Drive API 호출 시 `supportsAllDrives`, `includeItemsFromAllDrives` 필수

### 글로벌 기간 선택기 (GlobalPeriod)
- **상태 위치**: `PortfolioContext.ui.globalPeriod` (타입: `'3M' | '6M' | '1Y' | '2Y' | 'ALL'`)
- **기본값**: `'1Y'`, localStorage에 영속 (`'asset-manager-global-period'`)
- **영향 범위**: 모든 탭에 일관 적용 — 대시보드(ProfitLossChart 필터), 차트(AssetTrendChart fetch 기간), 수익 통계(매도 기록 필터)
- **차트 fetch 계산**: `totalDays = displayDays + MA warm-up days` (MA200 + 2년 = 730 + 330 = 1060일 fetch)
- **`ALL` 선택 시**: 최대 10년(3650일) fetch, 날짜 필터는 `'2000-01-01'`부터
- **수익 통계 탭**: 자체 date input이 **삭제됨** — 반드시 `periodStartDate`/`periodEndDate` props로 전달받아야 함

### 관심종목 (WatchlistItem)
- **매수존(buyZone) 필드 삭제됨** — `buyZoneMin`, `buyZoneMax` 없음
- **관심종목 UI는 모달 기반** — 인라인 폼 없음, `WatchlistAddModal`/`WatchlistEditModal` 사용
- **관심종목 가격 갱신은 포트폴리오와 통합** — `handleRefreshAllPrices`에서 자동 처리, 별도 새로고침 버튼 없음
- **차트 확장**: `AssetTrendChart`를 `history={[]}`로 호출 (스냅샷 없이 API 과거 시세만 사용)

### 자동 시세 업데이트 (하루 1회)
- **판단 기준**: Google Drive의 `lastUpdateDate` + `localStorage`의 `lastAutoUpdateDate` **이중 체크**
- **실행 흐름**: `usePortfolioData` → `shouldAutoUpdate` 플래그 → `PortfolioContext` useEffect → `handleRefreshAllPrices(true)`
- **중복 방지**: `localStorage`에 즉시 기록하여 Drive 저장 지연/새로고침 시에도 재실행 차단
- **수정 시 확인**: `usePortfolioData.ts` (플래그 설정), `PortfolioContext.tsx` (실행), `useGoogleDriveSync.ts` (날짜 저장)

### 투자 시그널 알림 시스템
- **알림 규칙 조합**: `alertChecker.ts`는 규칙의 filters를 **AND**로만 결합 (스마트 필터의 그룹 내 OR과 다름). `matchesSingleFilter()`를 `smartFilterLogic.ts`에서 import하여 재활용
- **설정 저장 위치**: `localStorage` (`asset-manager-alert-settings`) — Google Drive 저장 파이프라인 **미포함** (복잡도 회피)
- **enrichedMap 승격**: `useEnrichedIndicators`는 이제 `PortfolioContext`에서 호출. `PortfolioTable`/`PortfolioAssistant`는 Context에서 가져옴 (자체 호출 제거)
- **프리셋 → 스마트필터 변환**: `PortfolioTable`의 `handleApplyPreset()`이 `AlertRule`의 `filters`+`filterConfig`를 `SmartFilterState`로 변환하여 적용
- **새 알림 규칙 추가 시**: `constants/alertRules.ts`의 `DEFAULT_ALERT_RULES`에 추가, 필요한 필터가 없으면 `smartFilter.ts`/`smartFilterChips.ts`/`smartFilterLogic.ts`에 칩 추가 필요
- **`matchesSingleFilter` 시그니처 변경 시**: `smartFilterLogic.ts`(스마트 필터)와 `alertChecker.ts`(알림) **양쪽 모두** 영향 확인 필수

### 디버깅 로그 패턴
```typescript
// 표준 로그 형식
console.log('[useMarketData] 자산 분류:', { upbit: upbitAssets.length, general: generalAssets.length });
console.log('[useMarketData] 업비트 조회 심볼:', upbitSymbols);
console.log('[Upbit] BTC: 현재가=xxx, 전일종가=xxx');
console.error('[priceService] 시세 조회 실패:', error);
```

### 데이터 무결성
- **마이그레이션**: `migrateData.ts`에서 이전 버전 데이터 자동 변환
- **마이그레이션 멱등성**: 필드 이름 변경 시 기존 값 보존 필수 (`??` 연산자 사용, `=` 덮어쓰기 금지)
- **구조 검증**: 필수 필드 존재 여부 확인 후 로드
- **스냅샷 우선**: 매도 통계에서 스냅샷 필드(`originalPurchasePrice` 등) 우선 사용
- **스냅샷 수량 역산**: `currentValue / unitPrice`로 수량을 역산할 때, `unitPrice`가 0이나 undefined이면 반드시 스킵 (fallback 1 사용 금지 — 데이터 오염의 원인)
- **로드 파이프라인 순서**: `repairCorruptedSnapshots` → `fillAllMissingDates` → `backfillWithRealPrices` (repair가 반드시 먼저)

### 매도 기록 이중 저장 구조
- **저장 위치가 2곳**: 매도 시 동일한 거래가 `sellHistory[]`(글로벌)와 `asset.sellTransactions[]`(자산 내부) **양쪽에 저장**됨
  - 전량 매도: 자산 삭제 → `sellHistory`만 남음 (중복 없음)
  - 부분 매도: 자산 유지 → 양쪽 모두 존재 (중복 위험)
- **조회 시 `id` 기반 중복 제거 필수**: `SellAnalyticsPage`에서 양쪽을 합칠 때 `sellHistory`의 `id` Set으로 `inlineRecords` 중복 방지
- **수정 시 확인**: `useAssetActions.ts`(저장), `SellAnalyticsPage.tsx`(조회/집계)

---

## 9. 수정 시 체크리스트

### 새 자산 필드 추가 시
- [ ] `types/index.ts`의 `Asset` 인터페이스에 필드 추가
- [ ] `types/index.ts`의 `LegacyAssetShape`에 마이그레이션용 필드 추가
- [ ] `utils/migrateData.ts`에 마이그레이션 로직 추가
- [ ] `hooks/useGoogleDriveSync.ts`의 저장/로드 로직 확인
- [ ] 관련 컴포넌트 UI 업데이트

### 새 API 엔드포인트 연동 시
- [ ] `services/`에 함수 추가 또는 기존 서비스 확장
- [ ] `types/api.ts`에 응답 타입 정의
- [ ] `hooks/`에서 해당 서비스 호출
- [ ] 에러 핸들링 및 폴백 로직 구현

### 시세 조회 로직 수정 시
- [ ] `useMarketData.ts`의 `shouldUseUpbitAPI()` 확인
- [ ] 주식/암호화폐 분기 로직 확인
- [ ] 병렬 조회 및 결과 병합 로직 확인
- [ ] 환율 변환 로직 확인

### 새 설정값 저장 시 (리밸런싱 목표 등)
- [ ] `types/index.ts` 또는 `types/store.ts`에 타입 추가
- [ ] `hooks/useGoogleDriveSync.ts`의 `LoadedData` 타입에 추가
- [ ] `hooks/usePortfolioData.ts`에 상태 관리 추가
- [ ] `hooks/usePortfolioExport.ts`의 내보내기/가져오기에 추가
- [ ] `contexts/PortfolioContext.tsx`에서 노출

### UI 컴포넌트 수정 시
- [ ] `types/ui.ts`의 Props 타입 확인/수정
- [ ] 부모 컴포넌트에서 props 전달 확인
- [ ] 반응형 디자인 테스트

### 데이터 구조 변경 시
- [ ] `utils/migrateData.ts`에 하위 호환성 마이그레이션 추가
- [ ] 기존 데이터 로드 테스트

---

## 10. 확장 가이드

### 새로운 자산 카테고리 추가
1. `types/index.ts`의 `AssetCategory` enum에 추가
2. `EXCHANGE_MAP`에 거래소 매핑
3. `inferCategoryFromExchange` 로직 업데이트
4. 관련 컴포넌트 UI 업데이트

### 새로운 거래소 추가
1. `COMMON_EXCHANGES` 또는 `ALL_EXCHANGES`에 추가
2. 카테고리 추론 로직 업데이트
3. 시세 API 지원 확인
4. **암호화폐 거래소인 경우**: `shouldUseUpbitAPI()` 함수에 조건 추가

### 통화 추가
1. `types/index.ts`의 `Currency` enum에 추가
2. `CURRENCY_SYMBOLS`에 심볼 추가
3. 환율 API 지원 확인 (`/exchange-rate`)
4. 환율 입력 UI 업데이트

### 새로운 암호화폐 거래소 추가
1. `shouldUseUpbitAPI()` 함수에 거래소명 조건 추가
2. 해당 거래소 API가 업비트와 호환되는지 확인
3. 호환되지 않는 경우:
   - `services/`에 별도 서비스 파일 생성
   - Cloud Run에 새 엔드포인트 추가
   - `useMarketData.ts`에 분기 로직 추가

---

## 11. 데이터 모델링 원칙

### 외화 데이터 보존
- 저장 시 `currentPrice`(KRW 자산은 KRW, 외화 자산은 원본통화)와 `priceOriginal`(항상 원본통화) **모두 저장**
- **MA/RSI 등 기술적 지표와 가격 비교 시 `priceOriginal` 사용** (통화 일치 보장)
- 히스토리 저장 시 `unitPriceOriginal`(외화 원본 가격) 누락 주의

### 이력 데이터 영속성
- 매도 등 히스토리 저장 시 원본 자산이 삭제되어도 계산 가능하도록 스냅샷 저장
- 스냅샷 필드: `originalPurchasePrice`, `originalPurchaseExchangeRate`, `originalCurrency`
- 분석/통계에서 **스냅샷 필드 우선 사용**, 없으면 현재 자산으로 폴백

### Google Drive 동기화
- **공유 폴더 지원**: `supportsAllDrives`, `includeItemsFromAllDrives` 파라미터 필수
- **LZ-String 압축**: 저장 시 압축, 로드 시 압축 해제 (레거시 호환)
- **자동 업데이트**: `lastUpdateDate`(Drive)와 `localStorage.lastAutoUpdateDate` **둘 다** 오늘이 아닐 때만 `shouldAutoUpdate` 플래그 설정. 실행 직전 `localStorage`에 날짜를 기록하여 Drive 저장 지연/실패 시에도 중복 실행 방지

---

## 12. 작업 워크플로우

### 코드 수정 전
1. 해당 파일이 어디서 참조되는지 `grep` 등으로 파악
2. `types/`나 `utils/` 수정 시 프로젝트 전체 영향도 분석
3. 수정 계획을 사용자에게 보고

### 코드 수정 시
- 잘 작동하는 기존 기능(로그인, 자동저장) 훼손 금지
- 리팩토링 시 기존 함수의 입출력(I/O) 호환성 유지

### 코드 수정 후
- 새로운 파일이나 중요 로직 추가 시 `README.md` 업데이트 제안
- 지표/신호 로직 변경 시 문서 함께 갱신
