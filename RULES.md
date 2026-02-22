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
- 변동률(어제대비) 계산은 `usePortfolioCalculator`의 `yesterdayChange` 사용 (API `changeRate` 우선, 없을 때 현재가-전일종가 폴백)

---

## 3. 파일/폴더별 책임 범위

### hooks/ (커스텀 훅)
| 파일 | 책임 | 의존 | 수정 시 확인 |
|------|------|------|-------------|
| `usePortfolioData.ts` | 핵심 데이터 상태, Google Drive 동기화 | `useGoogleDriveSync`, `historyUtils` | `PortfolioContext` |
| `useMarketData.ts` | 시세/환율 업데이트, 암호화폐 분기, **관심종목 시세도 함께 갱신** (어제대비 `yesterdayChange` 선계산 포함), 관심종목 전용 갱신(52주 최고가 히스토리 기반 계산) | `priceService`, `upbitService`, `historicalPriceService` | `PortfolioContext` |
| `useAssetActions.ts` | 자산 CRUD, 매도/매수/CSV 처리 | `priceService`, `geminiService` | 모달 컴포넌트들 |
| `usePortfolioCalculator.ts` | 수익률/손익 계산 (구매 환율 기준) | `types/index` | 대시보드, 통계 |
| `useHistoricalPriceData.ts` | 차트용 과거 종가+거래량 데이터 (MA 여부 무관, 캐시 내장, `displayDays` 기반 기간 제어). 반환값: `{ historicalPrices, historicalVolumes, isLoading, error }` | `historicalPriceService`, `maCalculations` | `AssetTrendChart` |
| `useGlobalPeriodDays.ts` | 글로벌 기간(`GlobalPeriod`) → `{ startDate, endDate, days }` 변환 유틸 훅 | `types/store` | `AssetTrendChart`, `DashboardView`, `AnalyticsView` |
| `useEnrichedIndicators.ts` | 전 종목 배치 과거 데이터 조회 → MA 전 기간(5~200) + RSI(금일/전일) 계산 | `historicalPriceService`, `maCalculations` | **`PortfolioContext`** (Context 레벨에서 호출, enrichedMap을 전역 공유), `geminiService` (타입만) |
| `useAutoAlert.ts` | 자동 알림 트리거 + AlertSettings localStorage 영속 | `alertChecker`, `types/alertRules` | `PortfolioContext` (derived/actions에 노출) |
| `usePortfolioHistory.ts` | 포트폴리오 스냅샷 저장 | `types/index` | 차트 데이터 |
| `useRebalancing.ts` | 리밸런싱 계산 및 저장. `CategoryData`에 `categoryKey`(ID 문자열)와 `category`(표시명)를 분리 — 가중치 변경 핸들러에는 `categoryKey` 전달 필수 | `PortfolioContext` | `RebalancingTable` |
| `useGoogleDriveSync.ts` | Google Drive 저장/로드, **`needsReAuth` 상태 관리**(세션 만료 시 데이터 유지+배너), 인증 상태 변경 콜백 등록 | `googleDriveService`, `lz-string` | `usePortfolioData` |
| `useBackup.ts` | 1일 1회 자동 백업, 수동 백업/복원/삭제, retention 관리 | `googleDriveService` | `PortfolioContext` |

### services/ (외부 API 연동)
| 파일 | 책임 | API 엔드포인트 | 수정 시 확인 |
|------|------|----------------|-------------|
| `priceService.ts` | 주식/ETF 시세, 환율 | Cloud Run `/`, `/exchange-rate` | `useMarketData`, `useAssetActions` |
| `upbitService.ts` | 암호화폐 시세 | Cloud Run `/upbit` | `useMarketData` |
| `historicalPriceService.ts` | 과거 시세+거래량 (백필/차트용/AI분석용). `HistoricalPriceResult`에 optional `volume` 필드 포함 | Cloud Run `/history`, `/upbit/history` | `useHistoricalPriceData`, `historyUtils`, `geminiService` |
| `googleDriveService.ts` | 클라우드 저장/로드, **Authorization Code Flow + Backend JWT 기반 인증**, `authenticatedFetch` 래퍼(401 시 백엔드 `/auth/refresh`로 갱신), 백업 파일 관리(`deleteFileById`, `loadFileById`, `listFilesByPattern`) | Google Drive API, Cloud Run `/auth/*` | `useGoogleDriveSync`, `useBackup` |
| `geminiService.ts` | 종목 검색, AI 분석 (스트리밍 응답, 기술적 질문 시 Context의 enrichedMap 재활용 우선 → 폴백으로 직접 fetch) | Gemini API, `historicalPriceService`, `maCalculations`, `useEnrichedIndicators`(타입만) | `useAssetActions`, `PortfolioAssistant` |

### utils/ (순수 함수)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `portfolioCalculations.ts` | 포트폴리오 계산 유틸 | 전역 (계산 결과 변경) |
| `historyUtils.ts` | 히스토리 보간/백필/기존 스냅샷 종가 교정/오염 데이터 교정 | `usePortfolioData` |
| `maCalculations.ts` | SMA/RSI 계산, 차트 데이터 빌드. `MAChartDataPoint`의 가격 키는 `'현재가'` (이전 `'가격'` 아님). `buildChartDataWithMA()`는 3번째 파라미터로 `volumeData`를 받아 `'거래량'` 키에 매핑 | `AssetTrendChart`, `useEnrichedIndicators`, `geminiService` |
| `signalUtils.ts` | 신호/RSI 배지 렌더링 | `PortfolioTableRow` |
| `smartFilterLogic.ts` | 스마트 필터 매칭 (그룹 내 OR, 그룹 간 AND), enriched 지표 참조, `PRICE_BELOW_*` 판정 포함. 거래량 필터(`VOLUME_SURGE/HIGH/LOW`)는 `indicators.volume_ratio` 사용. **`matchesSingleFilter()` export** — 알림 규칙 체커에서도 재활용 | `PortfolioTable`, `alertChecker.ts` |
| `alertChecker.ts` | 알림 규칙별 자산 매칭 (규칙 내 필터 AND 조합), 매칭 결과 구조화 반환 (`dailyChange`/`returnPct`/`dropFromHigh`/`rsi` + `details` 문자열). **당일 변동률은 `asset.metrics.yesterdayChange` 사용** (`changeRate` 사용 금지) | `smartFilterLogic.matchesSingleFilter`, `types/alertRules` | `useAutoAlert`, 프리셋 버튼 |
| `migrateData.ts` | 데이터 마이그레이션 (기존 형식 변환 + 카테고리 ID 변환) | 로드 시 자동 실행 |

### types/ (타입 정의)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `index.ts` | 핵심 타입 (`Asset`, `Currency`, `AssetCategory`(deprecated) 등) | **전역** - 거의 모든 파일 |
| `category.ts` | **카테고리 시스템 핵심** — `CategoryDefinition`, `CategoryStore`, `CategoryBaseType`, `DEFAULT_CATEGORIES`, `EXCHANGE_MAP_BY_BASE_TYPE`, 유틸(`isBaseType`, `getCategoryName`, `inferCategoryIdFromExchange`, `getAllowedCategories`) | **전역** — 모든 카테고리 참조 컴포넌트/훅 |
| `backup.ts` | 백업 타입 (`BackupInfo`, `BackupSettings`, `RETENTION_OPTIONS`) | `hooks/useBackup`, `BackupSettingsSection` |
| `api.ts` | API 응답 타입 (`PriceItem`, `Indicators` 등). `Indicators`에 거래량 3필드 포함: `volume`(당일), `volume_avg20`(20일 평균), `volume_ratio`(비율) | `services/`, `hooks/` |
| `store.ts` | 상태 관리 타입 (`PortfolioContextValue`, `GlobalPeriod`, `UIState.activeTab` 등). `PortfolioData`에 `categoryStore`, `PortfolioStatus`에 `needsReAuth`, `DerivedState`에 `backupList`/`isBackingUp` 포함 | `contexts/`, `hooks/`, `App.tsx`, `components/common/PeriodSelector`, `SmartFilterPanel`, `AlertSettingsPage` |
| `ui.ts` | UI 컴포넌트 Props 타입 | `components/` |
| `smartFilter.ts` | 스마트 필터 타입 (24개 키, 5개 그룹: ma/rsi/signal/portfolio/volume, MA 기간 설정 + `lossThreshold` 포함), 그룹 매핑, 칩 정의(`pairKey`/`pairColorClass` tri-state 지원), 초기값 | `utils/smartFilterLogic`, `SmartFilterPanel`(+ `PortfolioContext` 의존), `PortfolioTable`, `alertChecker` |
| `alertRules.ts` | 알림 규칙 타입 (`AlertRule`, `AlertResult`, `AlertSettings`, `AlertMatchedAsset`) | `constants/alertRules`, `utils/alertChecker`, `hooks/useAutoAlert`, `AlertSettingsPage`, `AlertPopup` |

### constants/ (상수 정의)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `columnDescriptions.ts` | 포트폴리오 테이블 컬럼 툴팁 텍스트 | `PortfolioTable`, `PortfolioTableRow` |
| `smartFilterChips.ts` | 스마트 필터 칩 정의 (22개 칩, 동적 라벨, 색상). MA 현재가 칩 2개는 `pairKey`로 ABOVE↔BELOW tri-state 토글 (off→>→<→off 순환, 칩 하나로 2개 필터 키 제어). `DAILY_DROP`/`LOSS_THRESHOLD` 추가. 거래량 그룹 3개 칩: `VOLUME_SURGE`(급증≥2x), `VOLUME_HIGH`(증가≥1.5x), `VOLUME_LOW`(감소<0.5x) | `SmartFilterPanel` |
| `alertRules.ts` | 기본 알림 규칙 8개 (매도 5 + 매수 3), `DEFAULT_ALERT_SETTINGS` | `useAutoAlert`, `AlertSettingsPage` |

### components/layouts/ (탭별 뷰)
| 파일 | 책임 | 의존 |
|------|------|------|
| `DashboardView.tsx` | 대시보드 탭 | `PortfolioContext`, `useGlobalPeriodDays` |
| `PortfolioView.tsx` | 포트폴리오 탭 | `PortfolioContext`, `PortfolioTable` |
| `AnalyticsView.tsx` | 수익 통계 탭 | `PortfolioContext`, `useGlobalPeriodDays` |
| `WatchlistView.tsx` | 관심종목 탭 | `PortfolioContext`, `WatchlistPage` |
| `InvestmentGuideView.tsx` | 투자 가이드 탭 (순수 UI, 외부 의존 없음) | - |

> 설정 탭은 `components/SettingsPage.tsx`가 래핑하며 3개 섹션으로 구성: `AlertSettingsPage` (알림), `BackupSettingsSection` (백업), `CategorySettingsSection` (카테고리 관리)

### components/common/ (공용 컴포넌트)
| 파일 | 책임 | 의존 |
|------|------|------|
| `PeriodSelector.tsx` | 글로벌 기간 선택 버튼 (3개월/6개월/1년/2년/전체) | `types/store` (`GlobalPeriod`) |
| `ActionMenu.tsx` | Portal 기반 액션 메뉴 — 데스크탑: `createPortal`로 body에 드롭다운 렌더링(공간 부족 시 위로 열림), 모바일(<768px): 바텀시트 | `react-dom/createPortal` |
| `AlertPopup.tsx` | "오늘의 투자 브리핑" 모달 (`max-w-3xl`) — severity별 스타일, 매도/매수 섹션 분리, **표 형식**(종목·당일·수익률·고점대비·RSI 컬럼) | `types/alertRules` (`AlertResult`, `AlertMatchedAsset`) |
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
| `WatchlistPage.tsx` | 관심종목 테이블 (행별 액션 메뉴 + 차트 확장, 종목명 hover 시 메모 툴팁, 전용 시세 업데이트 버튼) | `AssetTrendChart`, `Tooltip`, `onRefresh` prop from `WatchlistView` |

> `WatchlistView.tsx`에서 세 컴포넌트를 함께 렌더링

### contexts/
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `PortfolioContext.tsx` | 전역 상태 Provider, 모든 훅 통합 | **전역** - App.tsx 및 모든 컴포넌트 |

---

## 4. 의존관계 매핑

### 핵심 데이터 흐름
```
App.tsx (needsReAuth 배너 포함)
  └─ PortfolioContext.tsx
       ├─ usePortfolioData.ts ──────┬─ useGoogleDriveSync.ts (categoryStore 포함 저장/로드, needsReAuth 상태)
       │                            │   └─ googleDriveService.ts (initCodeClient → /auth/callback → JWT+AccessToken)
       │                            ├─ historyUtils.ts
       │                            └─ migrateData.ts (runMigrationIfNeeded + migrateCategorySystem)
       ├─ useMarketData.ts ─────────┬─ priceService.ts (주식/ETF/환율)
       │                            ├─ upbitService.ts (암호화폐)
       │                            └─ historicalPriceService.ts (관심종목 52주 최고가)
       ├─ useAssetActions.ts ───────┬─ priceService.ts
       │                            └─ geminiService.ts
       ├─ usePortfolioCalculator.ts ── types/index.ts
       ├─ useEnrichedIndicators.ts ── historicalPriceService, maCalculations
       ├─ useAutoAlert.ts ─────────── alertChecker.ts → smartFilterLogic.ts
       └─ useBackup.ts ────────────── googleDriveService (자동 백업/복원/삭제)
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

```
useMarketData.ts → handleRefreshWatchlistPrices() (관심종목 전용)
    │
    └─ Promise.all() ── 4개 fetch 동시 실행
         ├─ 관심종목(일반)             → priceService.ts → Cloud Run /
         ├─ 관심종목(암호화폐)         → upbitService.ts → Cloud Run /upbit
         ├─ 1년 히스토리(일반)         → historicalPriceService.ts → Cloud Run /history
         └─ 1년 히스토리(암호화폐)     → historicalPriceService.ts → Cloud Run /upbit/history
              │
              └─ 히스토리에서 52주 최고가 계산 → highestPrice 갱신
```

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
- **탭 순서**: 대시보드 | 포트폴리오 | 관심종목 | 수익 통계 | 투자 가이드 | **설정** (가이드·설정 탭에서는 PeriodSelector 숨김)
- **수익 통계 기간**: 자체 date input 삭제됨, 글로벌 기간 props로 전달받음

### 차트 데이터 흐름
```
AssetTrendChart.tsx (ComposedChart — Line+Bar 동시 지원)
    │
    ├─ ticker/exchange 있는 자산 (주식, 코인 등)
    │   └─ useHistoricalPriceData.ts (displayDays + MA warm-up 합산 fetch)
    │        └─ historicalPriceService.ts → /history 또는 /upbit/history
    │             ├─ historicalPrices → buildChartDataWithMA() → Line 차트 + MA 오버레이
    │             └─ historicalVolumes → buildChartDataWithMA(volumeData) → Bar 차트 (하단 1/4)
    │                  └─ displayDays 기준으로 표시 범위 slice (MA warm-up 구간 제거)
    │
    └─ 현금 등 ticker 없는 자산
        └─ PortfolioSnapshot 기반 (폴백, 글로벌 기간으로 필터)
```
- **차트 컴포넌트**: Recharts `ComposedChart` 사용 (이전 `LineChart` 아님). 가격 `<Line>`과 거래량 `<Bar>`를 동시 렌더링
- **이중 Y축**: 좌측 `yAxisId="price"` (가격), 우측 `yAxisId="volume"` (거래량, 숨김, `domain=[0, max*4]`로 하단 1/4에 표시)
- **차트 dataKey**: `'현재가'` (가격 Line), `'거래량'` (거래량 Bar) — `MAChartDataPoint` 키와 일치 필수
- **VOL 토글**: MA 토글 영역에 거래량 표시/숨김 버튼 추가 (기본: 표시)
- **매수평균선**: `purchasePrice` prop → `ReferenceLine` (금색 점선, 통화 토글 연동). 관심종목(WatchlistPage)은 `purchasePrice` 없으므로 자동 생략
- **범례 위치**: Recharts `<Legend>` 미사용 → MA 토글 칩 라인 오른쪽에 커스텀 HTML 범례 (현재가 + 활성 MA + 매수평균)
- **X축 연도 표기**: 커스텀 tick 함수에서 `payload.index`(데이터 배열 인덱스) 사용 필수. **top-level `index`는 렌더된 tick 순번이므로 사용 금지**. `renderedYearsRef`로 각 연도 첫 등장 tick에만 표시

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
- **거래량 필터**: enrichedMap이 아닌 백엔드 `indicators.volume_ratio`를 직접 사용 (프론트 계산 불필요)

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
| `types/index.ts`의 `Currency` | `hooks/*`, `components/*`, `utils/*` |
| `types/category.ts` | **전역** — 카테고리 ID·이름·baseType 참조하는 모든 파일. 비즈니스 로직은 `isBaseType()`, UI는 `getCategoryName()` 사용 |
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
| `ActionMenu.tsx` | `PortfolioTableRow`, `PortfolioMobileCard`, `WatchlistPage` (드롭다운 메뉴 사용처) |
| `PortfolioTableRow.tsx` 컬럼 추가 | `PortfolioMobileCard`에도 반영 필요 (데스크탑/모바일 뷰 동기화) |

---

## 5. 핵심 타입 정의

### Asset (자산)
```typescript
interface Asset {
  id: string;                    // 고유 식별자
  categoryId: number;            // 카테고리 ID (types/category.ts의 CategoryDefinition.id 참조)
  category?: AssetCategory;      // [deprecated] 레거시 호환용, 새 코드에서 사용 금지
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
  changeRate?: number;           // API 원본 등락률 (비율, 0.05=5%). usePortfolioCalculator에서 yesterdayChange 계산의 1차 소스
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
  categoryId: number;            // 카테고리 ID
  category?: AssetCategory;      // [deprecated] 레거시 호환용
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
const shouldUseUpbitAPI = (exchange: string, categoryId?: number): boolean => {
  const normalized = (exchange || '').toLowerCase();

  // 명확하게 Upbit/Bithumb인 경우
  if (normalized === 'upbit' || normalized === 'bithumb') return true;

  // 한글 거래소명 + 암호화폐 카테고리 (isBaseType으로 판정)
  const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(exchange);
  if (hasKorean && categoryId != null && isBaseType(categoryId, 'CRYPTOCURRENCY')) return true;

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

### 당일 변동률 표시 주의
- **`asset.changeRate`**: API 원본 비율값 (0.05 = 5%). **UI에 직접 `%` 표기 금지** (곱하기 100 누락 시 항상 0.0%로 보임)
- **`asset.metrics.yesterdayChange`**: `usePortfolioCalculator`에서 `changeRate * 100` (API 원본, 우선) 또는 `((현재가 - 전일종가) / 전일종가) * 100` (폴백)으로 계산된 % 값. **UI 표시에는 이 값 사용**
- **원칙**: 변동률을 UI에 보여줄 때는 반드시 `metrics.yesterdayChange` 사용, `changeRate`는 내부 계산용으로만 참조

### 환율 처리
- **기본값**: USD 1450, JPY 9.5 (API 실패 시)
- **유효성 검사**: USD > 100, JPY > 1
- **현재가 vs 매수가**: 현재가는 실시간 환율, 매수가는 구매 당시 환율 사용

### Google Drive 동기화 및 인증
- **인증 방식**: Authorization Code Flow — 프론트에서 `initCodeClient`로 code 획득 → 백엔드 `/auth/callback`에서 Access Token + Refresh Token 교환 → JWT(30일) 발급
- **토큰 구조**: JWT(30일, localStorage) + Access Token(1시간, localStorage) + Refresh Token(영구, Firestore — 백엔드만 접근)
- **토큰 갱신**: Access Token 만료 5분 전 자동 갱신 (`scheduleTokenRefresh` → `/auth/refresh`)
- **401 자동 재인증**: 모든 Drive API 호출은 `authenticatedFetch()` 래퍼를 경유 — 401 응답 시 백엔드 `/auth/refresh` 호출 → 실패 시 `clearAuth()` → `needsReAuth` 배너 표시 (데이터 유지)
- **세션 만료 UX**: `needsReAuth=true` 시 App.tsx에 amber 배너 표시 + "다시 로그인" 버튼. `isSignedIn`은 유지되어 데이터/UI 보존. 재로그인 성공 시 `needsReAuth=false`
- **자동 저장 중단**: `needsReAuth=true`이면 `autoSave` 스킵 (Access Token 없으므로)
- **로그아웃**: 백엔드 `/auth/revoke`로 Refresh Token 폐기 + Firestore 삭제 + 로컬 JWT/Access Token 정리
- **동시 갱신 방지**: `refreshPromise`로 병렬 401 재시도 시 단일 갱신만 수행
- **새 Drive API fetch 추가 시**: 반드시 `this.authenticatedFetch()` 사용 (raw `fetch` 직접 호출 금지 — 401 복구 경로 누락됨)
- **공유 폴더 파라미터**: 새 Drive API 호출 시 `supportsAllDrives`, `includeItemsFromAllDrives` 필수
- **인증 상태 콜백**: `setAuthStateChangeCallback()`으로 UI 레이어(`useGoogleDriveSync`)가 인증 해제를 구독 — `needsReAuth` 플래그 설정
- **gapi 제거**: Google API Client Library(gapi) 미사용 — GIS `initCodeClient`만 로드. 사용자 정보는 백엔드에서 조회
- **자동 저장 디바운스**: 2초 (빈번한 저장 방지)

### 카테고리 시스템 (ID 기반)
- **핵심 원칙**: 자산 카테고리는 숫자 ID(`categoryId: number`)로 참조. 문자열 `category` 필드는 **deprecated** (마이그레이션 호환용으로만 남아있음)
- **기본 카테고리 ID 매핑**: 1=한국주식, 2=미국주식, 3=해외주식, 4=기타해외주식, 5=한국채권, 6=미국채권, 7=실물자산, 8=암호화폐, 9=현금
- **baseType**: 각 카테고리에 고정된 `CategoryBaseType` — 거래소 매핑(`EXCHANGE_MAP_BY_BASE_TYPE`), 시세 분기(`shouldUseUpbitAPI`), 환율 처리 등의 비즈니스 로직 결정. 사용자가 카테고리 이름을 바꿔도 baseType은 불변
- **비즈니스 로직에서 카테고리 판정**: `isBaseType(asset.categoryId, 'CASH')` 사용 (`asset.category === AssetCategory.CASH` 사용 금지)
- **표시 이름 조회**: `getCategoryName(categoryId, categories)` — `categories`는 `data.categoryStore.categories`에서 전달
- **새 카테고리 추가**: 사용자가 설정 탭에서 이름 + baseType 선택하여 추가. 코드 수정 불필요
- **카테고리 삭제**: 기본 카테고리(isDefault=true)는 삭제 불가. 삭제 시 소속 자산을 다른 카테고리로 재할당
- **필터 타입**: 카테고리 필터는 `number | 'ALL'` (이전의 `AssetCategory | 'ALL'` 아님)
- **드롭다운 옵션**: `getAllowedCategories(categories)` 사용 (CASH와 FOREIGN_STOCK 제외)
- **CategoryStore 저장**: Google Drive JSON에 `categoryStore` 필드로 함께 저장됨 (autoSave 파이프라인에 포함)
- **마이그레이션**: `migrateCategorySystem()`이 로드 시 자동 실행 — 기존 `category` 문자열을 `categoryId` 숫자로 변환, `categoryStore` 없으면 기본값 주입

### 자동 백업 시스템
- **트리거**: `PortfolioContext`의 자동 시세 업데이트 완료 후 `performBackup()` 호출 (1일 1회, `localStorage('asset-manager-last-backup-date')` 기준)
- **파일명**: `portfolio_backup_YYYY-MM-DD.json` (Google Drive 같은 폴더)
- **보관**: Rolling N개 (기본 10개), 초과 시 `createdTime` 기준 오래된 것 자동 삭제
- **설정**: `localStorage('asset-manager-backup-settings')` — `{ enabled, retentionCount }`
- **복원**: `loadFileById()` → 전체 데이터 교체 → `updateAllData()` + autoSave (현재 데이터 덮어쓰기)
- **백업 실패 시**: 앱 동작에 영향 없음 (try-catch, console.error만)
- **관련 파일**: `hooks/useBackup.ts`, `components/BackupSettingsSection.tsx`, `types/backup.ts`, `googleDriveService.ts`

### 글로벌 기간 선택기 (GlobalPeriod)
- **상태 위치**: `PortfolioContext.ui.globalPeriod` (타입: `'3M' | '6M' | '1Y' | '2Y' | 'ALL'`)
- **기본값**: `'1Y'`, localStorage에 영속 (`'asset-manager-global-period'`)
- **영향 범위**: 모든 탭에 일관 적용 — 대시보드(ProfitLossChart 필터), 차트(AssetTrendChart fetch 기간), 수익 통계(매도 기록 필터)
- **차트 fetch 계산**: `totalDays = displayDays + MA warm-up days` (MA200 + 2년 = 730 + 330 = 1060일 fetch)
- **`ALL` 선택 시**: 최대 10년(3650일) fetch, 날짜 필터는 `'2000-01-01'`부터
- **수익 통계 탭**: 자체 date input이 **삭제됨** — 반드시 `periodStartDate`/`periodEndDate` props로 전달받아야 함

### 관심종목 (WatchlistItem)
- **삭제된 필드/기능**: `monitoringEnabled`, `dropFromHighThreshold`, `lastSignalAt`, `lastSignalType`, 모니터링 토글, 최고가대비 하락 알림, 신호 배지(최고가대비/일중하락/매도/RSI) — `WatchlistItem` 타입에 해당 필드 없음
- **메모 표시**: 종목명에 마우스 hover 시 `Tooltip` 컴포넌트로 표시 (포트폴리오 테이블과 동일 방식)
- **관심종목 UI는 모달 기반** — 인라인 폼 없음, `WatchlistAddModal`/`WatchlistEditModal` 사용
- **관심종목 가격 갱신 2가지 경로**:
  - `handleRefreshAllPrices`: 포트폴리오와 함께 자동 처리 (현재가/전일종가/지표 갱신, `highestPrice`도 갱신)
  - `handleRefreshWatchlistPrices` (전용 업데이트 버튼): 현재가 + **1년 히스토리 조회로 52주 최고가 계산** (`historicalPriceService` 사용)
- **52주 최고가(`highestPrice`) 계산**: 관심종목 전용 갱신 시 `fetchStockHistoricalPrices`/`fetchCryptoHistoricalPrices`로 1년 히스토리를 가져와 `Math.max(...prices)`로 산출. 백엔드 시세 API가 `high52w`를 제공하지 않는 종목도 커버
- **최고가대비 표시**: `highestPrice`가 미설정(`undefined`)이면 `0.00%`가 아닌 `-` 표시
- **차트 확장**: `AssetTrendChart`를 `history={[]}`로 호출 (스냅샷 없이 API 과거 시세만 사용)
- **어제대비(`yesterdayChange`) 선계산**: `useMarketData.ts`에서 시세 갱신 시 `changeRate * 100`으로 사전 계산하여 `WatchlistItem.yesterdayChange`에 저장. `WatchlistPage.tsx`는 이 값을 렌더링만 함 (UI에서 직접 계산 금지). `changeRate`가 없는 레거시 데이터는 `??`로 폴백
- **테이블 컬럼**: 체크박스 | 종목명 | 현재가 | 어제대비 | 최고가대비 | 액션

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

### 거래량 지표 관련
- **`volume_ratio` 가용 범위**: 주식/ETF에만 `volume_avg20`과 `volume_ratio` 제공. 암호화폐(Upbit)는 당일 `volume`만 제공 (20일 평균/비율은 null) → 스마트 필터 거래량 칩은 주식/ETF에만 매칭됨
- **차트 거래량 막대**: `historicalVolumes`가 없거나 빈 객체이면 거래량 Bar 자동 생략 (VOL 토글도 숨김)
- **`historicalPriceService.ts`의 `HistoricalPriceResult`**: `volume` 필드는 optional — 백엔드가 거래량 데이터를 포함하지 않는 경우(레거시 응답)에도 하위호환

### 레이아웃 및 반응형 제약사항
- **전체 레이아웃**: `App.tsx`는 `h-screen flex flex-col overflow-hidden`. 탭바만 `flex-shrink-0`으로 최상단 고정, Header와 콘텐츠는 `<main className="flex-1 overflow-y-auto">`에서 함께 스크롤
- **포트폴리오 테이블 sticky thead**: `<thead>`의 `sticky top-0`이 `<main>` 스크롤 컨테이너 기준으로 동작. **`<main>`과 `<thead>` 사이에 `overflow` CSS 속성을 가진 wrapper를 추가하면 sticky가 깨짐** — 새 wrapper div 추가 시 overflow 속성 금지
- **드롭다운 메뉴**: 인라인 `absolute` 포지션 메뉴 사용 금지 → `ActionMenu` 컴포넌트 사용 (`createPortal`로 body에 렌더링). 데스크탑: 버튼 위치 기반 드롭다운(공간 부족 시 위로 열림), 모바일(<768px): 바텀시트
- **데스크탑/모바일 뷰 분기**: `PortfolioTable`에서 `hidden md:block`(데스크탑 테이블) / `block md:hidden`(모바일 카드 뷰)로 분기. **테이블에 새 기능 추가 시 모바일 카드 뷰(`PortfolioMobileCard`)에도 반영 필요**
- **`PortfolioMobileCard`**: 종목명+현재가+수익률+평가액+고가대비/전일대비를 카드 형태로 표시, 탭하면 차트 펼침, 관리 메뉴는 `ActionMenu`(바텀시트) 사용

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
사용자가 **설정 탭 → 카테고리 관리**에서 직접 추가 가능 (코드 수정 불필요). 단, 새 baseType이 필요한 경우:
1. `types/category.ts`의 `CategoryBaseType`에 추가
2. `EXCHANGE_MAP_BY_BASE_TYPE`에 거래소 매핑
3. `BASE_TYPE_LABELS`에 표시 이름
4. `inferBaseTypeFromExchange()` 로직 업데이트
5. 필요 시 `isBaseType()` 호출부에 새 분기 추가

### 새로운 거래소 추가
1. `COMMON_EXCHANGES` 또는 `ALL_EXCHANGES`에 추가
2. `types/category.ts`의 `EXCHANGE_MAP_BY_BASE_TYPE`에 해당 baseType으로 추가
3. `inferBaseTypeFromExchange()` 로직 업데이트
4. 시세 API 지원 확인
5. **암호화폐 거래소인 경우**: `shouldUseUpbitAPI()` 함수에 조건 추가

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
