# 프로젝트 개발 원칙 (RULES.md)

> **이 문서의 목적**: AI 코딩 도구(Claude, Cursor 등)가 코드 수정/추가 시 참고하는 개발 규칙 및 의존관계 문서

## 1. 프로젝트 정체성 및 기술 스택

- **목표:** 개인 투자용 퀀트 자산 관리 시스템 (주식, 코인, 실물자산 통합)
- **Frontend:** React 19.2+, TypeScript, Vite, Tailwind CSS
- **Data Source:**
  - 주식/ETF: Cloud Run `/` (Python + FinanceDataReader)
  - 암호화폐: Cloud Run `/upbit` (Upbit API 프록시)
  - 환율: Cloud Run `/exchange-rate` (FinanceDataReader)
  - 종목 검색: Cloud Run `/symbols` 전체목록 → 클라이언트 필터 (**키리스 기본**, `symbolListService`)
  - AI 분석/보조검색: Gemini API (포트폴리오 AI 분석 + 키 있을 때 "AI로 더 찾기" 보조검색만)
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
| `usePortfolioData.ts` | 핵심 데이터 상태, Google Drive 동기화. **`knowledgeBase` 상태**(시드 `SEED_KNOWLEDGE_BASE`) — 로드 시 `mergeKnowledgeBase(SEED, loaded.knowledgeBase)`로 앱 시드⊕Drive 저장본 병합(정의는 시드, 승인/journal은 저장본 보존), 로그아웃 시 시드로 리셋. **`triggerAutoSave` 9번째 인자 `newKnowledgeBase`** 추가 — 미전달 시 `\|\| knowledgeBase`(state) 폴백이라 기존 호출부 무변경으로 항상 함께 저장. 백필 직접저장도 `loadedCategoryStore`+`mergedKnowledgeBase` 전달(누락 방지) | `useGoogleDriveSync`, `historyUtils`, `mergeKnowledgeBase`, `constants/knowledgeBase`(SEED) | `PortfolioContext` |
| `useMarketData.ts` | 시세/환율 업데이트, 암호화폐 분기, **관심종목 시세도 함께 갱신** (어제대비 `yesterdayChange` 선계산 포함), 관심종목 전용 갱신(52주 최고가 히스토리 기반 계산). **`patchMissingPrevClose(priceMap, items)`**: 모듈 레벨 헬퍼 — 해외종목 `prev_close=NaN` 시 히스토리 API(`/history`, 최근 7일)로 전일종가/변동률 보완. 4개 갱신 경로(`handleRefreshAllPrices`, `handleRefreshSelectedPrices`, `handleRefreshOnePrice`, `handleRefreshWatchlistPrices`) 모두에서 호출 | `priceService`, `upbitService`, `historicalPriceService` | `PortfolioContext` |
| `useAssetActions.ts` | 자산 CRUD, 매도/매수/CSV 처리. **매도 시 `fetchHistoricalExchangeRate` 결과 유효성 검증** (USD>3000, JPY>50, CNY>400이면 앱 현재 환율로 자동 대체). **`handleEditSellRecord(recordId, patch)`** — 매도 기록 편집: `sellDate`/`sellPriceSettlement`/`sellQuantity` 변경, 날짜 변경 시 환율 재조회(상한 보정 포함), KRW 값 재계산, `sellHistory` + `asset.sellTransactions` 동기 갱신, 부분매도 자산이 유지 중이면 수량 차이만큼 보유수량 조정(음수 방지). **`handleDeleteSellRecord(recordId)`** — `sellHistory` + 자산 `sellTransactions` 양쪽 제거, 보유수량 자동 복구 없음 | `priceService`, `geminiService` | 모달 컴포넌트들 |
| `usePortfolioCalculator.ts` | 수익률/손익 계산 (구매 환율 기준). **`getSellAmountKRW(record, exchangeRates)`** 모듈 레벨 헬퍼로 비정상 환율 감지 후 KRW 매도금액 보정. `calculateSoldAssetsStats(sellHistory, assets, exchangeRates)` — `exchangeRates` 세 번째 파라미터 추가 (기본값 `{ USD: 1450, JPY: 9.5 }`) | `types/index` | 대시보드, 통계 |
| `useHistoricalPriceData.ts` | 차트용 과거 OHLCV 데이터 (MA 여부 무관, 캐시 내장, 항상 전체 10년 fetch). 반환값: `{ historicalPrices(종가), historicalVolumes, historicalOpens, historicalHighs, historicalLows, isLoading, error }` — **OHLC 3종은 백엔드 미수신 시 null (캔들차트 라인 폴백 트리거)**. `CacheEntry`도 open/high/low 포함하도록 확장 | `historicalPriceService` | `AssetTrendChart` |
| `useGlobalPeriodDays.ts` | 글로벌 기간(`GlobalPeriod`) → `{ startDate, endDate, days }` 변환 유틸 훅 | `types/store` | `AssetTrendChart`, `DashboardView`, `AnalyticsView` |
| `useMarketDistributionDays.ts` | 시장 지수(S&P500/NASDAQ/KOSPI/KOSDAQ) 디스트리뷰션 데이 카운트. `MARKET_INDEX_DEFS` 기반 fetch → `buildDistributionMeta` → `countDistributionDays`. severity 매핑: 0~2=safe(미표시), 3=attention(노랑), 4=warning(주황), 5+=exit(빨강). 1시간 모듈 캐시(`refreshKey` 변경 시 무효화). fetch 실패/데이터 부족 시 count=null → severity='safe'. 반환: `{ data: MarketDistributionEntry[], isLoading }` | `services/marketIndexService`, `utils/marketDistribution` | `MarketDistributionBanner` |
| `useEnrichedIndicators.ts` | 전 종목 배치 OHLCV 조회 (lookback **`getRequiredHistoryDaysForOHLCV()` ≈ 440일**) → 분류/프록시 적용/정렬 후 **`buildEnrichedIndicator()` 호출로 단일 종목 enrichment 위임** (백테스트와 동일 알고리즘 보장). 출력 `EnrichedIndicatorData`는 MA 전 기간(**5/10/20/60/120/150/200**) + RSI(금일/전일) + MA 교차 경과일 + `prevClose` + 이벤트 경과일(`priceCrossMaDays`/**`priceBreakBelowMaDays`** (와인스타인 매도 트리거)/`rsiBounceDay`/`rsiOverheatEntryDay`) + **클라이맥스 보강 필드 2개**: `isBullishCandle`, `longTrendUp` + **추세 종료 필드**: `recentSwingLow` + **OHLCV 기반 신규 필드 9개**: `atr14`, `high52w`, `volume52wMax`, `slopeRatio`, `dayRangeOverAtr`, `priceIsAt52wHigh`, `volumeIsAt52wMax`, `distributionDayMeta[]` (최근 30일 — `volRatio`/`isBearish`/`isLowerHalfClose`/`changeRatio`), `ohlcvAvailable`. **거래량 프록시 자동 적용**: `VOLUME_PROXY_MAP[ticker]`이 존재하면 fetch 배치에 프록시 ticker dedup 추가 → 본 자산의 거래량 시계열을 프록시의 것으로 대체 (가격은 본 자산 그대로). **룩어헤드 편향 방지**: 디스트리뷰션 메타의 50일 trailing 평균은 i 미포함 (`trailingVolumeAvg`). 종목별 50일 중 80% 미만 데이터면 신뢰 불가로 null. **OHLCV 미수신 시 자동 폴백**: `ohlcvAvailable=false`면 `dayRangeOverAtr`/`isBearish`/`isLowerHalfClose`는 null → 의존 룰 dormant. **포트폴리오 + 관심종목 통합**: `useEnrichedIndicators(assets, watchlistItems?)` | `historicalPriceService`, `maCalculations`, **`constants/commodityProxyMap`** | **`PortfolioContext`** (Context 레벨 호출, 전역 공유), `geminiService` (타입만) |
| `useAutoAlert.ts` | 자동 알림 트리거 + AlertSettings localStorage 영속. **관심종목 매수 기회 포함**: `watchlistItems` prop 수신 → `checkBuyRulesForWatchlist()` 결과를 포트폴리오 결과와 병합. **filterConfig 자동 병합**: 기존 저장된 규칙에 없는 신규 필드(withinDays/climax/distribution 등)를 기본값에서 backfill. **`riskMatrix: RiskMatrixRow[]` 반환** — `useMemo`로 enrichedMap+enrichedAssets+watchlistItems 순회, `computeRiskTier`로 티어 산출, `sortByRiskPriority`로 위험 우선 정렬 (관심종목은 포트폴리오에 없는 ticker만 포함). **P4.5 D1**: `attachDistributionTiers()` 후처리 — `runAlertCheck` 마지막 단계에서 distribution-high 룰 매칭 자산마다 enriched에서 count 재계산 후 `classifyDistributionTier`로 tier(new/ongoing) 첨부 → `AlertMatchedAsset.distributionTier` 채움. 룰 매칭 로직 자체는 건드리지 않음 (count<3은 룰 미매칭이므로 후처리 비대상). **자동 팝업 트리거는 공유 순수 게이트 `alertDiagnostics.evaluateAutoPopupGate` 사용**(진단 패널과 동일 판정). **`lastAutoCheckDate` state**가 localStorage `POPUP_DATE_KEY`를 반응형 미러 — effect가 일자 기록 시 함께 갱신해 **`autoPopupDiagnosis`(반응형 노출, derived)가 stale 안 됨**. **결과 계산과 자동 팝업 게이트를 한 effect로 묶어** 방금 계산한 `results`(local) 기준으로 판정 — 별도 effect가 stale `alertResults`(state)를 읽어 실제 매칭이 있어도 no-matches로 일자/triggered를 기록해 팝업을 누락하던 레이스 제거. 부수효과(setItem·setShowAlertPopup·hasTriggeredRef·setLastAutoCheckDate)는 effect가 수행(기존 동작 보존: not-ready/disabled/already-checked는 트리거·기록 안 함, 그 외는 일자 기록+발화>0이면 표시) | `alertChecker`, `utils/riskMatrix`, `utils/marketDistribution`, `utils/distributionTierState`, `utils/alertDiagnostics`(evaluateAutoPopupGate), `types/alertRules`, `types/alertDiagnostics` | `PortfolioContext` (derived에 `riskMatrix`/`autoPopupDiagnosis` 노출) |
| `usePortfolioHistory.ts` | 포트폴리오 스냅샷 저장 | `types/index` | 차트 데이터 |
| `useRebalancing.ts` | **2단(2-tier) 리밸런싱 계산 및 저장**. ① 버킷 tier(코어 vs 투더문, 전체 자산 기준) ② 코어 카테고리 tier(코어 버킷 내부, **코어 합계 기준 비중 + 코어 목표금액[=총목표×코어비중] 기준 목표금액**). 순수 계산은 `utils/bucketRebalancing`에 위임(`sumByBucket`/`sumCategoryValuesForBucket`/`buildRebalanceRows`/`sumRows`). 상태 3종: `targetTotalAmount`·`bucketTargetWeights`({CORE,SATELLITE}%)·`categoryTargetWeights`(코어 내부 카테고리%, =기존 `weights`). 초기화: 저장본(`allocationTargets.bucketWeights`/`.weights`) → 현재비중 → 기본(코어100/위성0). `handleSave`는 `{weights, targetTotalAmount, bucketWeights}` 저장. 반환: `bucket`/`core`(각 rows+합계+handleWeightChange)·`satelliteHoldings`(위성 종목 참고)·`hasSatellite`. `CategoryData extends RebalanceRow`에 `categoryKey`(=key)/`category`(=label) 매핑(기존 호환) | `PortfolioContext`, `utils/bucketRebalancing`, `types/bucket` | `RebalancingTable` |
| `useGoogleDriveSync.ts` | Google Drive 저장/로드, **`needsReAuth` 상태 관리**(세션 만료 시 데이터 유지+배너), 인증 상태 변경 콜백 등록. **`LoadedData.knowledgeBase`**(로드 파싱) + **`autoSave` 9번째 인자 `knowledgeBase`** → `exportData`에 `knowledgeBase` 키로 직렬화(categoryStore와 동일 패턴). 새 단일 JSON 키 추가 시 LoadedData/load파싱/autoSave시그니처/exportData 4곳 동시 반영 | `googleDriveService`, `lz-string`, `types/knowledge` | `usePortfolioData` |
| `useBackup.ts` | 1일 1회 자동 백업, 수동 백업/복원/삭제, retention 관리 | `googleDriveService` | `PortfolioContext` |
| `useGoldPremium.ts` | 금 김치 프리미엄 상태 관리. `PortfolioContext.data.exchangeRates.USD`를 환율로 사용 (별도 환율 API 호출 없음) | `goldPremiumService` | `GoldPremiumWidget` |
| `usePortfolioExport.ts` | 포트폴리오 CSV/JSON 내보내기, Google Drive에서 가져오기 | `googleDriveService`, `types/index`, `getCategoryName` | `Header` |
| `usePortfolioStats.ts` | 포트폴리오 합산 메트릭 (총 평가액, 총 손익, 전체 수익률, 알림 수) | `usePortfolioCalculator`, `types/index` | `DashboardView`, `Header` |
| `useTopBottomAssets.ts` | 자산별 수익률 순위 (상위/하위 N개 추출) | `types/index`, `ExchangeRates` | `TopBottomAssets` |
| `useOnClickOutside.ts` | 외부 클릭 감지 유틸 훅 (모달/드롭다운 닫기용) | React | 모달/팝업 컴포넌트 |
| `useKnowledgeInbox.ts` | 지식 인제스트 승인 큐 — 로컬 `DB/queue/knowledge-inbox.jsonl`을 **파일 선택**으로 import(브라우저는 로컬 폴더 직접 못 읽음), 후보 검토·승인. `importFromFile/importFromText`(이미 DB에 있는 id 제외), `approveClaim`/`approveRule(activateAsSignal)`/`dismiss`/`clearAll`/`checkRule`. 승인 시 `applyApproval` → **`actions.updateKnowledgeBase(kb)`**(상태 갱신+Drive 저장). 보류는 목록에서만 제거(로컬 큐 파일 불변) | `knowledgeIngest`, `PortfolioContext`(updateKnowledgeBase), `types/knowledge` | `KnowledgeInboxPanel` |
| `useSignalReplay.ts` | **신호 리플레이 오케스트레이션** — OHLCV fetch(주식/코인 분기, 10년, requestId 레이스 가드, 실패 폴백) + 종목검색(debounce 250ms) + 타임라인 계산(`buildReplayTimeline`, 한 틱 양보 후 동기 빌드 — 252일/단일종목 기준 충분, 느리면 후속 청크화) + as-of 네비(slider/click/이전·다음 날/이전·다음 신호/최신) + 모드(replay/review)·윈도(6M/1Y/2Y/3Y) + **P2 판정/사례**: `verdictFor/setVerdict/clearVerdict`(SignalVerdict upsert·삭제, **localStorage `-verdicts-v1`**, 종목·날짜·ruleId? 키)·`verdictDates`(구분표시)·`tickerVerdicts` + `saveCurrentCase(role,memo)`(현재 타임라인→`buildVerificationCase`, id=`Date.now`+seq, **localStorage `-cases-v1`**, overridesSnapshot=현재 샌드박스)·`loadCase`(종목·`anchorDate`·윈도 세팅 + **overridesSnapshot 샌드박스 복원** 후 재실행)·`deleteCase`·`comparingCase`/`caseDiff`(저장당시 vs 재실행 `diffCaseResults`, **종목·윈도 일치 시만**)·`endComparison`. **P3 샌드박스**: `sandboxRules`(시드 signal 규칙)·`sandboxSetValue/SetBetween/SetEnabled`(between은 prev에서 현재 leaf 재조회로 반대쪽 bound 보존)·`sandboxResetLeaf/ResetRule/ResetAll` + **`baselineTimeline`**(샌드박스 적용 *전* 시드결과, **샌드박스 활성일 때만·값 tweak엔 미재계산**)·**`sandboxDiff`**(기준 대비 신호일 변화 `diffCaseResults`). **as-of 보존**: 종목/윈도/기간/데이터 변경 시만 최신일로, 샌드박스 tweak(규칙만 변경)이면 selectedIndex 유지(클램프). **`anchorDate` settable**(selectSymbol/endComparison이 undefined로 리셋=최신). **윈도/종목 변경 시 비교 종료**. **유효 규칙=`applyRuleOverrides(시드, sandbox)`(영구 오버라이드 없음). 라이브 구루 신호/KnowledgeBase/Drive 절대 불변**. **③ `performance`**(`computeSignalPerformance(timeline)` 메모 — 규칙별 복기 성과). **④ `missedVerdicts`**(전 종목 missed-buy/sell, 최신순) + **`selectSymbolAtDate(sym,date)`**(종목+as-of 동시 점프 — 같은 종목이면 즉시 selectDate, 새 종목이면 `pendingDateRef`에 담아 타임라인 준비 시 그 날짜 이하 가장 가까운 거래일로 이동; 일반 selectSymbol은 ref clear=최신일). **⑤ `exportReplayRecords()`**(판정+사례 JSON Blob 다운로드)·**`importReplayRecords(file)`**(`parseReplayExport`→upsert 병합·localStorage 저장, `{verdicts,cases}` 건수 반환) | `signalReplay`, `ruleOverrides`, `ruleSandbox`, `replayVerdicts`, `replayCases`, `replayPerformance`, `replayExport`, `historicalPriceService`, `symbolListService`, `PortfolioContext`(data.knowledgeBase, ui.alertSettings.rules) | `SignalReplayView` |
| `useGuruDiagnostics.ts` | **구루 신호 진단 패널 상태/계산 (5A-⑤)**. 평가/진단 대상은 `derived.guruSignalTargets`(신호 카드와 동일 소스) 사용. **선택 종목 상태 보유**(useState) + **온디맨드**: 선택된 1종목에 대해서만 `diagnoseAssetRules`+`summarizeDiagnostics`+`describeRuleStatus` 계산(useMemo, `new Date()` 내부 1회 — claim 만료 판정용). 결과를 **발화 근접 순**(`STATUS_ORDER`: firing→firing-partial→not-met→…→inactive→no-condition, 안정 정렬)으로 정렬해 `rows: {diagnostic, status}[]` 반환. 미선택/사라진 종목이면 첫 종목 폴백(렌더 중 파생). 컴포넌트는 렌더만(프로젝트 규칙). **반환/조합 타입(`DiagnosticRow`/`GuruDiagnosticsView`)은 `types/guruDiagnostics.ts`** | `PortfolioContext`(usePortfolio), `utils/guruDiagnostics`, `types/guruDiagnostics`, `types/knowledge` | `GuruDiagnosticsPanel` |
| `useAlertDiagnostics.ts` | **일반 알림 진단 패널 상태/계산 (5B-①)**. 대상 = `derived.enrichedAssets`(포트폴리오) + 관심종목(`watchlistToPseudoAsset`, 가격≤0 제외) — **enriched 없어도 포함**(데이터 부족도 진단). 선택 종목 1개만 온디맨드 `diagnoseAssetAlerts`(관심종목=buy-only) + `describeAlertRuleStatus`, **발화 근접 순**(`STATUS_ORDER`) 정렬해 `rows:{diagnostic,status}[]` 반환. **팝업 전달 상태는 `derived.autoPopupDiagnosis`(useAutoAlert가 공유 게이트로 산출·반응형 노출)를 그대로 사용** — 훅이 localStorage를 직접 읽지 않아 stale 없음(규칙 발화와 직교 축). 컴포넌트는 렌더만. 타입은 `types/alertDiagnostics` | `PortfolioContext`(derived.enrichedAssets/autoPopupDiagnosis), `utils/alertDiagnostics`, `alertChecker`(watchlistToPseudoAsset), `types/alertDiagnostics` | `AlertDiagnosticsPanel` |

### services/ (외부 API 연동)
| 파일 | 책임 | API 엔드포인트 | 수정 시 확인 |
|------|------|----------------|-------------|
| `priceService.ts` | 주식/ETF 시세, 환율. **NaN 방어**: 응답 텍스트에서 `NaN` → `null` 치환 후 파싱, `toNumber()` 헬퍼로 null/NaN → 0 변환. **`changeRate` 초기값은 `undefined`** (API가 `change_rate`/`changeRate`를 number로 안 주고 `prev_close`도 없으면 `undefined` 유지 → calculator 폴백 허용). **해외종목 보정**: `change_rate===0 && prev<=0 && priceOrig>0`이면 `changeRate`를 `undefined`로 리셋 (백엔드가 `prev_close=NaN`일 때 `change_rate=0`을 기본값으로 반환하는 패턴 대응) | Cloud Run `/`, `/exchange-rate` | `useMarketData`, `useAssetActions`, `symbolListService`(validateTicker) |
| `upbitService.ts` | 암호화폐 시세. **`fetchUpbitPrice(symbol)`**(단일 코인, `validateTicker` 검증용) | Cloud Run `/upbit` | `useMarketData`, `symbolListService`(validateTicker) |
| `historicalPriceService.ts` | 과거 시세+거래량 (백필/차트용/AI분석용/리스크 매트릭스용). `HistoricalPriceResult`에 optional `volume`, **`open`/`high`/`low`** 필드 포함 (백엔드 OHLCV 확장 후 수신, 미수신 시 undefined로 자동 폴백 → 클라이맥스(b)/디스트리뷰션 윗꼬리 dormant). **NaN 방어**: `parseJsonSafe()` → `sanitizeResult()` / `stripNullPrices()`가 data/volume/open/high/low 5개 시계열 모두에 적용 — `HistoricalPriceData`에는 `number`만 보장 | Cloud Run `/history`, `/upbit/history` | `useHistoricalPriceData`, `historyUtils`, `geminiService`, `useMarketData`(전일종가 보완), `useEnrichedIndicators`(OHLCV 기반 ATR/52주 신고가/클라이맥스 플래그) |
| `googleDriveService.ts` | 클라우드 저장/로드, **Authorization Code Flow + Backend JWT 기반 인증** (**OAuth 스코프 `drive.file` — 앱이 생성/소유한 파일만 접근(최소권한), `auth/drive` 전체권한 금지**), `authenticatedFetch` 래퍼(401 시 백엔드 `/auth/refresh`로 갱신), 백업 파일 관리(`deleteFileById`, `loadFileById`, `listFilesByPattern`). **`DRIVE_FOLDER_ID`는 `VITE_DRIVE_FOLDER_ID` env 우선, 미설정 시 기본값** | Google Drive API, Cloud Run `/auth/*` | `useGoogleDriveSync`, `useBackup` |
| `geminiService.ts` | AI 보조 종목검색(`searchSymbolsAI`, 선택), AI 분석 (스트리밍 응답, 기술적 질문 시 Context의 enrichedMap 재활용 우선 → 폴백으로 직접 fetch). **BYOK: 사용자가 설정에서 입력한 자기 Gemini 키로 클라이언트 SDK(`@google/genai`) 직접 호출.** 키/모델은 `services/geminiSettings`(localStorage `asset-manager-gemini-api-key-v1`/`-model-v1`)에서만 읽음 — **빌드 env·Drive 동기화에 절대 미포함**. `getAI()`=키 기준 클라이언트 캐시, `canUseAI()`=키 존재 여부, 미설정 시 mock/스킵 폴백. 모델은 `getGeminiModel()`(기본 `gemini-2.5-flash`), UI(`AiSettingsSection`)에서 `fetchAvailableModels(key)`로 실사용 가능 모델 동적 선택. `fetchTechnicalIndicators` 폴백 시 `useEnrichedIndicators`와 동일한 `EnrichedIndicatorData` 구조 반환. **MA_PERIODS는 `[5,10,20,60,120,150,200]`** (useEnrichedIndicators와 동기). 폴백은 MA/RSI/교차/이벤트 경과일까지만 계산하고, **OHLCV 의존 9필드(`atr14`/`high52w`/`volume52wMax`/`slopeRatio`/`dayRangeOverAtr`/`priceIsAt52wHigh`/`volumeIsAt52wMax`/`distributionDayMeta`/`ohlcvAvailable`)는 null/false/[]로 stub** — AI 분석은 클라이맥스/디스트리뷰션 신호가 불필요하므로 의도적 미산출. **종목검색 함수는 `searchSymbolsAI`(AI 보강 전용, 키 있을 때만 "AI로 더 찾기"로 호출)** — 기본 키리스 검색은 `symbolListService.searchSymbols`가 담당(분리됨). **검색 실패를 빈 배열로 삼키지 않음**: `searchSymbolsAI`는 키 미설정·API 오류 시 `SymbolSearchError`(export) throw → 모달이 사유를 화면에 표시. 그라운딩 응답이 설명문에 감싸여 와도 `parseJsonArrayLoose`로 첫 `[...]` 블록 추출(파싱 불가는 결과 없음=`[]` 처리). `callGeminiWithSearch`도 오류를 삼키지 않고 throw로 전파(`fetchAssetData`/`fetchBatchInternal`은 자체 try-catch로 mock 폴백하므로 무영향). 특수종목(KRX 금)은 `specialAssets.ts`로 분리 | Gemini API, `historicalPriceService`, `maCalculations`, `useEnrichedIndicators`(타입만), `geminiSettings`, `specialAssets` | `AddNewAssetModal`/`WatchlistAddModal`(AI 버튼), `useAssetActions`, `PortfolioAssistant` |
| `geminiSettings.ts` | BYOK Gemini 키/모델 저장·조회 (전용 localStorage 키 `asset-manager-gemini-api-key-v1`/`-model-v1` — **Drive 동기화 payload에 미포함**). `getGeminiApiKey`/`setGeminiApiKey`/`getGeminiModel`/`setGeminiModel`, `DEFAULT_GEMINI_MODEL='gemini-2.5-flash'`, **`fetchAvailableModels(key)`** — Generative Language API `/v1beta/models`에서 `generateContent` 지원 모델만 반환(동적 모델 선택용) | Generative Language API (모델 목록) | `geminiService`, `AiSettingsSection` |
| `symbolListService.ts` | **키리스 기본 종목검색**. 백엔드 `GET /symbols`에서 전체 종목목록(주식·ETF·코인)을 **1회만** fetch → 메모리+localStorage(`asset-manager-symbol-index-v1`, 24h TTL) 캐시 → 검색 매칭은 **브라우저에서 즉시**(키스트로크당 서버호출 없음). `loadSymbolList()`(동시호출 inflight 공유, 실패 시 throw), `searchLocalSymbols(q, list, limit=12)`(점수: 정확티커>티커접두>이름접두>이름부분>티커부분), **`searchSymbols(query)`**(특수종목 우선 → 로컬필터; 4개 모달이 import하는 기본 검색), **`validateTicker(ticker, exchange, isCrypto)`**(직접 티커 추가 검증 — 코인=Upbit `trade_price>0`, 그 외=`fetchAssetData` `isMocked=false && 가격>0`. 잘못된 티커/종목명 입력 방지). 사용자 키 불필요 | Cloud Run `/symbols`, `specialAssets`, `priceService`(fetchAssetData), `upbitService`(fetchUpbitPrice), `constants/api` | `AddNewAssetModal`/`WatchlistAddModal`/`EditAssetModal`/`WatchlistEditModal` |
| `specialAssets.ts` | 앱 전용 특수종목(`SPECIAL_ASSETS`=KRX 금현물) + `findSpecialAsset(query)` 키워드 매핑. 키리스/AI 검색 양쪽에서 공유(geminiService에서 분리). **'금'/'gold'는 정확일치만**(부분일치 시 '금융'/'예금'/'goldman' 오탐), `krx-gold`/`m04020000`만 부분일치 허용 | `types` | `symbolListService`, `geminiService` |
| `marketIndexService.ts` | 시장 지수 OHLCV 조회 — `historicalPriceService.fetchStockHistoricalPrices`의 thin wrapper. `MARKET_INDEX_DEFS` 상수(`^GSPC`/`^IXIC`/`^KS11`/`^KQ11`) export. `fetchMarketIndicesOHLCV(tickers, days)` — 지수 fetch (실패 시 빈 객체 반환, 배너 자동 dormant) | Cloud Run `/history` (재활용) | `useMarketDistributionDays` |
| `goldPremiumService.ts` | 금 김치 프리미엄 계산. `KRX-GOLD`(KRW/g)와 `GC=F`(USD/oz) 시세를 `fetchBatchAssetPrices()`로 조회 → `usdKrwRate`로 환산 → 프리미엄 계산 | Cloud Run `/` (기존 엔드포인트 재사용) | `useGoldPremium` |

### utils/ (순수 함수)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `portfolioCalculations.ts` | 포트폴리오 계산 유틸. **`mapToNewAssetStructure`가 로드 파이프라인의 자산 기본값 단일 보정점** — categoryId fallback + **전략 버킷 기본값 보정(`bucket = bucket ?? 'CORE'`, 레거시=전부 코어)**. 모든 Drive 자산이 이 함수를 통과(`usePortfolioData` 로드)하므로 신규 Asset 기본 필드는 여기서 채울 것 | 전역 (계산 결과 변경) |
| `bucketRebalancing.ts` | **전략 버킷 2단 리밸런싱 순수 계산** — 카테고리(종류)와 직교한 코어/투더문 축. `assetValueKRW`(KRW=1·외화=환율)·`sumByBucket`(`{CORE,SATELLITE,total}`)·`sumCategoryValuesForBucket(assets,rates,bucket)`(특정 버킷만 categoryId별)·`buildRebalanceRows`(범용: currentWeight=현재/분모×100[0분모 가드], targetValue=목표총액×목표비중/100, difference=목표−현재 — 버킷·코어 tier 양쪽 재사용)·`sumRows`(합계). side effect/any 없음. 회귀 `tests/bucketRebalancingParity.ts`(24단언, `npm run test:bucket`) | `types`(Asset/Currency/ExchangeRates), `types/bucket`(getAssetBucket) ← `useRebalancing`, `tests/bucketRebalancingParity` |
| `historyUtils.ts` | 히스토리 보간/백필/기존 스냅샷 종가 교정/오염 데이터 교정 | `usePortfolioData` |
| `maCalculations.ts` | SMA/RSI/교차경과일/ATR/52주 신고가/기울기 계산. `calculateSMA(sortedPrices, period)` — `(number|null)[]` 반환. `calculateCrossDays(shortSma, longSma)` — 두 SMA 배열 역순회하여 교차 시점까지 거래일 수 반환 (양수=골든, 음수=데드, null=미확인). **`calculatePriceCrossMaDays(sortedPrices, smaValues)`** — 가격이 MA를 상향돌파한 경과 거래일 반환 (현재 MA 아래면 null). **`calculatePriceBreakBelowMaDays(sortedPrices, smaValues)`** — 가격이 MA를 하향이탈한 경과 거래일 반환 (현재 MA 위면 null) — 와인스타인 매도 트리거용 대칭 함수. **`calculateRsiCrossDays(rsiValues, threshold)`** — RSI가 임계값을 상향돌파한 경과 거래일 반환. **`calculateATR(highs, lows, closes, period=14)`** — Wilder smoothing True Range. **`calculate52WeekHigh(closes, lookback=252)`** / **`calculate52WeekMaxVolume(volumes, lookback=252)`** — 끝에서 lookback개 윈도우 최댓값. **`calculateLinearRegressionSlope(values, period)`** — OLS 기울기 / 평균값 정규화 (무차원). **`calculateSlopeRatio(closes, short=10, long=60)`** — short_slope/long_slope, long ≤ 0이면 null. **`getRequiredHistoryDaysForOHLCV()`** — 252×1.5+60 = 440일 (52주 룰 + MA200 워밍업). `buildChartDataWithMA()`는 현재 미사용 (Lightweight Charts 전환). **`MALineConfig`에 `id`(ma1~ma6 슬롯 식별자) 필드** — period가 사용자 편집 대상이라 슬롯 정체성 유지용. `DEFAULT_MA_CONFIGS`는 id 포함 6슬롯. **`clampMAPeriod(value)`** — MA 기간을 1~400 정수로 보정 | `AssetTrendChart`(`calculateSMA`), `useEnrichedIndicators`, `geminiService`, `PortfolioContext`(MALineConfig/DEFAULT_MA_CONFIGS/clampMAPeriod), `store.ts`(타입), `tests/walkForwardBacktest.ts` |
| `smartFilterLogic.ts` | 스마트 필터 매칭 (그룹 내 OR, 그룹 간 AND), enriched 지표 참조, `PRICE_BELOW_*` 판정 포함. 거래량 필터(`VOLUME_SURGE/HIGH/LOW`)는 `indicators.volume_ratio` 사용. **`PRICE_CROSS_ABOVE_MA`**: `withinDays > 0`이면 `priceCrossMaDays[period] <= withinDays && price >= MA`, 미설정 시 당일 돌파만. **`PRICE_CROSS_BELOW_MA`** (와인스타인 매도 트리거): 대칭 — `withinDays > 0`이면 `priceBreakBelowMaDays[period] <= withinDays && price < MA`, 미설정 시 당일 이탈만. **`SWING_LOW_BREAK`** (와인스타인 매도 트리거): `enriched.recentSwingLow > 0` AND `asset.priceOriginal < recentSwingLow` — 현재가가 직전 swing low 아래. **`CLIMAX_TOP` 게이팅 토글 2개**: `climaxRequireLongTrendUp` (기본 true) — true일 때 `enriched.longTrendUp === false`면 즉시 false; `climaxRequireBullishCandle` (기본 true) — true일 때 (b) ATR 폭발은 `isBullishCandle !== false`일 때만 카운트. **P4.5 C1**: `slopeMul` 기본값 2.5 (3 → 2.5). **P4.5 C3**: (c) 조건 확장 — `priceIsAt52wHigh AND (volumeIsAt52wMax OR todayVolRatio >= CLIMAX_C_VOL_SURGE_RATIO)` — 52w 거래량 최대가 아니어도 50일 평균의 2배 이상이면 인정 (`distributionDayMeta` 마지막 항목의 `volRatio` 사용). **골든/데드크로스 필터는 상태 기반** (`MA_GOLDEN_CROSS`: shortMA > longMA, `MA_DEAD_CROSS`: shortMA < longMA — 경과일은 UI `CrossDaysBadge` 표시, `scaleY(0.8)` 축소 뱃지, 종목명 오른쪽 컬럼). **뱃지 사용 MA 페어는 `alertSettings.rules`의 `golden-cross`/`dead-cross` 룰 `filterConfig.maShort/LongPeriod` 참조**. **`evaluateSingleFilter()` (5B 단일 소스, 순수)** — 단일 필터를 **3치(true/false/null) + `FilterEvalReason` + actual/threshold**로 평가(타입은 **`types/smartFilter`** 단일 소스). **사유 5종**: `met`(충족)/`not-met`(평가됨·미충족)/**`event-not-found`**(지표는 있으나 대상 이벤트·구조 미발생: 최근 N일 내 돌파·반등 없음, swing low 미형성, 최근 교차 없음 — result=false)/**`no-data`**(지표 미수신, result=null)/`not-applicable`(알 수 없는 키, result=null). **no-data vs event-not-found 구분**이 "왜 안 떴나"의 핵심(예: `DAILY_DROP` changeRate 미수신=no-data≠0으로 not-met 오판). **`matchesSingleFilter()`는 이제 `evaluateSingleFilter(...).result === true` wrapper** — **null·false 모두 false로 매핑해 기존 boolean 발화를 1건도 바꾸지 않음**(발화 불변, `tests/smartFilterParity.ts` 90단언이 강제: 32키 골든 + 발화 동일성 + no-data/event-not-found 구분 + 기본 21규칙 발화집합·설정전달 + 규칙 AND/buy-only). reason code는 **필터 판정 전용**(팝업 전달 상태·"오늘 이미 표시됨"과 무관 — 진단 레이어에서 별도 축). 알림 체커도 `matchesSingleFilter` 재활용. **`ExtraFilterConfig`(types/smartFilter 정의)**에 `maCrossPeriod?`, `withinDays?`, `maxLookbackTradingDays?`, **`climaxFlagsRequired?`/`climaxSlopeMultiplier?`/`climaxAtrMultiple?`/`distributionWindow?`/`distributionVolumeRatio?`/`distributionThreshold?`** 포함. **`MA_DEAD_CROSS`는 `extraConfig.maxLookbackTradingDays` 주입 시 추가 검사**. **이벤트형 필터(`PRICE_CROSS_ABOVE_MA`, `RSI_BOUNCE`, `RSI_OVERHEAT_ENTRY`)는 `withinDays > 0`이면 경과일 기반 판정**. **`CLIMAX_TOP`** — **카운팅은 공유 `climaxFlags.countClimaxFlags`에 위임**(토글 `climaxRequireBullishCandle`/`climaxRequireLongTrendUp`를 프로필로 주입), `climaxFlagsRequired` 이상이면 매칭. **`DISTRIBUTION_HIGH`** — **카운팅은 공유 `marketDistribution.countDistributionDays`에 위임**(`distributionWindow`/`distributionVolumeRatio` 주입), `distributionThreshold` 이상이면 매칭. 두 카운터 모두 OHLCV 미수신·빈 메타는 보수적 0 → 자동 dormant | `PortfolioTable`, `alertChecker.ts`, `tests/smartFilterParity.ts` |
| `alertChecker.ts` | 알림 규칙별 자산 매칭 (규칙 내 필터 AND 조합), 매칭 결과 구조화 반환. **`matchesRule()` export** (단일 규칙 매칭 — 백테스트 스크립트 재활용). (`dailyChange`/`returnPct`/`dropFromHigh`/`rsi` + `details` 문자열). **`buildAssetInfo`에 이벤트 경과일 표시 포함**: `priceCrossMaDays` → "돌파 N일전", `rsiBounceDay` → "반등 N일전", `rsiOverheatEntryDay` → "과열진입 N일전". **당일 변동률은 `asset.metrics.yesterdayChange` 사용** (`changeRate` 사용 금지). **`matchesRule()`의 `extraConfig` 빌더에 신규 8키 전달**: `climaxFlagsRequired`/`climaxSlopeMultiplier`/`climaxAtrMultiple`/`climaxRequireBullishCandle`/`climaxRequireLongTrendUp`/`distributionWindow`/`distributionVolumeRatio`/`distributionThreshold` — `AlertRuleFilterConfig`에서 그대로 매핑. 신규 `filterConfig` 키 추가 시 이 빌더에 누락하면 룰이 기본값만으로 작동하므로 주의. **`checkBuyRulesForWatchlist()` export**: 관심종목을 pseudo-EnrichedAsset으로 변환(`watchlistToPseudoAsset`)하여 매수 규칙만 실행, 결과에 `source: 'watchlist'` 표시. **공유 빌더 export(5B, drift 차단)**: `buildExtraConfig(filterConfig)`(filterConfig→ExtraFilterConfig **14키** 매핑) / `ruleThresholds(filterConfig)`(maShort/maLong/drop/loss 기본값) / **`watchlistToPseudoAsset(w)`** — `matchesRule`과 `alertDiagnostics`가 동일 매핑을 쓰도록 단일화 | `smartFilterLogic.matchesSingleFilter`, `types/alertRules`, `types/smartFilter`(ExtraFilterConfig), `types/index`(WatchlistItem, Currency) | `useAutoAlert`, `alertDiagnostics`, 프리셋 버튼 |
| `migrateData.ts` | 데이터 마이그레이션 (기존 형식 변환 + 카테고리 ID 변환) | 로드 시 자동 실행 |
| `exchangeRateCache.ts` | 마지막 정상 환율 캐시. `loadLastKnownRates()`/`saveLastKnownRates(rates)`/`resolveRate(currency, exchangeRates)`(현재→캐시→0 폴백)/`hasResolvableRates(currencies, exchangeRates)`. `localStorage('asset-manager-last-known-rates-v1')`에 `{ USD, JPY, timestamp }` 저장. **USD<100, JPY<1은 비정상값으로 간주**(`MIN_VALID_RATE`). 메모리 캐시(`memoryCache`)로 반복 파싱 회피 | `usePortfolioCalculator`(getValueInKRW), `useMarketData`/`usePortfolioData`(저장), `PortfolioTable`(필터 안전성) |
| `logger.ts` | 중앙 로깅 유틸리티. `createLogger(module)` 팩토리 — 프로덕션 빌드에서 debug/info 자동 억제, warn/error만 출력. 모듈명 자동 프리픽스. **새 서비스/훅 추가 시 `console.*` 직접 사용 금지, 반드시 `createLogger` 사용**. **`import.meta.env?.PROD ?? false`로 방어** — Vite 빌드 외 tsx/Node(테스트) 경로에서 `import.meta.env` undefined여도 안전(logger를 import하는 순수 util을 테스트가 로드 가능) | 전체 services/, hooks/, utils/ |
| `distributionTierState.ts` | **P4.5 D1**: distribution-high 알림 일자 디듀프 (표시 레이어 전용). `classifyDistributionTier(assetId, count, today)` — localStorage 자동 상태 갱신 + `{status: 'new'\|'ongoing', tier: 3\|4\|5}` 반환. `classifyDistributionTierPure(state, ...)` — 순수 함수 (백테스트). 규칙: count<3이면 reset/null, 처음 도달=new, 단계 상승(3→4/5, 4→5)=new, 같은 단계 다른 날=ongoing, 단계 하강(5→4)=ongoing(state 유지), 6+는 tier 5에 묶임(반복 new 방지). localStorage 키: `asset-manager-dist-tier-state`. distribution 계산 로직은 건드리지 않음 | `useAutoAlert` (표시 레이어), `AlertPopup` (뱃지 렌더링) |
| `buildEnrichedIndicator.ts` | **단일 종목 OHLCV → EnrichedIndicatorData 빌더 (순수 함수)**. `useEnrichedIndicators` 훅(런타임)과 백테스트(`scripts/backtest/guruSignals.ts`)가 모두 이 함수를 호출하여 알고리즘 drift 차단. 입력: `{sortedDates, closes, opens, highs, lows, volumes}`. enrichment 상수(`MA_PERIODS`/`RSI_PERIOD`/`DISTRIBUTION_META_LENGTH`/`VOLUME_AVG_PERIOD_DISTRIBUTION`)도 이 파일에 정의/export (**`CLIMAX_C_VOL_SURGE_RATIO`는 빌더가 내부 미사용 → `utils/climaxFlags`로 이관**). 데이터 부족 시 가능한 필드만 채우고 나머지 null/false | `maCalculations`, `swingPointDetection`, `marketDistribution` | `useEnrichedIndicators`, 백테스트 |
| `marketDistribution.ts` | 오닐 디스트리뷰션 공용 유틸 — 종목/지수 공유. **`DistributionDayMeta` 타입의 정식 정의 위치** (useEnrichedIndicators에서는 type alias로 re-export). `buildDistributionMeta(opens, highs, lows, closes, volumes, {metaLength=30, volumeAvgPeriod=50})` — raw OHLCV → 최근 metaLength일치 메타 배열. trailing 평균거래량은 i 미포함 + 80% 데이터 신뢰 조건. `countDistributionDays(meta, windowDays, ratioThreshold)` — 윈도우 내 (음봉 OR 윗꼬리 OR 등락률<0.2%) AND volRatio≥임계 일수 카운트. OHLCV 일부 미수신 시 isBearish/isLowerHalfClose=null → 정체 조건만 평가 | `useEnrichedIndicators`, `riskMatrix`, `smartFilterLogic`(DISTRIBUTION_HIGH 위임), `useMarketDistributionDays` |
| `swingPointDetection.ts` | Swing low(직전 저점) 탐지 유틸. `detectRecentSwingLow(sortedPrices, lookback=60, leftBars=5, rightBars=5)` — 좌우 N거래일 동안 자기보다 낮은 종가가 없는 지점(동률 허용)을 찾아 윈도우 내 가장 최근 swing low 1개 반환. 종가 기준. 우측 rightBars개 보장 필요 → 마지막 rightBars일은 후보에서 제외. 데이터 부족(`n < leftBars+rightBars+1`)/윈도우 내 미형성 시 null. 와인스타인 매도 트리거 "직전 저점 이탈"용. 순수 함수 | `useEnrichedIndicators` |
| `climaxFlags.ts` | **클라이맥스 플래그 카운트 공유 순수 함수** — `riskMatrix`와 `smartFilterLogic CLIMAX_TOP`이 공용(이전 중복 로직 통합, drift 원천 차단). `countClimaxFlags(enriched, {slopeMultiplier, atrMultiple, requireBullishCandle, requireLongTrendUp})` → (a)`slopeRatio`≥mult + (b)`dayRangeOverAtr`≥mult(`requireBullishCandle` 시 양봉만, null 캔들 통과) + (c)`priceIsAt52wHigh` AND (`volumeIsAt52wMax` OR 직전일 `volRatio`≥`CLIMAX_C_VOL_SURGE_RATIO`). **엔진별 정책은 옵션 주입**(round-5 합의 "계산 공유+엔진별 프로필"): riskMatrix=게이트 항상 true / smartFilter=`extraConfig` 토글 전달. **`CLIMAX_C_VOL_SURGE_RATIO=2.0` 상수 소유**(빌더에서 이관). 회귀 가드 `tests/climaxDistributionParity.ts` | `EnrichedIndicatorData`(타입) ← `riskMatrix`, `smartFilterLogic`, `scripts/backtest/guruSignals`(상수) |
| `riskMatrix.ts` | 종합 리스크 매트릭스 — 클라이맥스 플래그 카운트 + 디스트리뷰션 카운트 + MA 근접도로 RED/AMBER/BLUE 티어 합성. `computeRiskTier(enriched, currentPrice, thresholds)` — 단일 자산 평가. `sortByRiskPriority(rows)` — RED→AMBER→BLUE, 동일 티어 내 `score=climaxFlags*10+distributionCount` 내림차순. `DEFAULT_RISK_MATRIX_THRESHOLDS` — RED:클라이맥스≥2 AND 디스트리뷰션≥5, AMBER:클라이맥스≥1 AND 3≤디스트리뷰션≤4, BLUE:MA150 ±5% 근접 AND 디스트리뷰션≥2. **`countDistributionDays`는 `utils/marketDistribution.countDistributionDays`로 위임** (종목/지수 공용 알고리즘). **클라이맥스 플래그는 `utils/climaxFlags.countClimaxFlags`에 위임**(smartFilterLogic CLIMAX_TOP과 공유, 이전 중복 통합) — riskMatrix는 `requireBullishCandle:true, requireLongTrendUp:true` 고정 주입(사용자 토글 없는 분류 프로필, null 데이터는 보수적 통과). **`DEFAULT_RISK_MATRIX_THRESHOLDS.climaxSlopeMultiplier`도 P4.5 C1으로 2.5** (smartFilterLogic과 동기). 순수 함수, side effect 없음 | `useAutoAlert`, `AlertPopup`, `types/store`, `utils/marketDistribution`, `utils/climaxFlags` |
| `knowledgeScoring.ts` | **구루 지식 점수 + 신호 활성 게이트 (v2, 순수 함수)**. `score = authority(강환국 초기신뢰도) × confidence × recency(유형별 감쇠) × performance(표본충분시)`. `AUTHORITY_WEIGHT`(kang-direct 1.30/kang-rec 1.20/kang-introduced 1.05/external 1.00/ai 0.60). **`DECAY_HALF_LIFE_WEEKS`** 유형별 반감기: risk-principle·evergreen=null(무감쇠), strategy=78주, market-regime=5, stock-comment=2.5, event-news=1.5. `recencyFactor(decayClass, sourceDate, now)`=무감쇠 1.0 / 그외 `exp(-age/halflife)`(0으로 만료). `isExpired`(<`EXPIRY_THRESHOLD`=0.05). **`getSignalEligibility(rule, claims, now)`** → `{eligible, reasons: InactiveReason[]}`(draft/archived/advisory/rejected/unverified/claim-expired) — 진단·게이트 **단일 소스**, **`isActiveSignal`은 `.eligible` 반환 wrapper**(사유 분류 복제 금지 → drift 방지). 게이트: status='active' AND computability='signal' AND !rejected AND (**userApproved OR dataVerified OR backtestVerified**) AND 근거 claim 미만료. **미검증/검증불가는 신호 자동활성 차단**. ('no-condition'은 getActiveSignalRules 층 게이트). `verificationAllowsSignal`, `claimPriorityScore`, `rulePriorityScore`(근거 claim 최고점×performance), `performanceMultiplier`(복기 표본<`MIN_PERFORMANCE_SAMPLE`=30이면 1.0 중립), `resolveRuleConflicts`(mappedSignalKey별 최우선 1개). **`now: Date` 호출부 주입** | `types/knowledge`, (지식 DB UI/신호 엔진) |
| `guruSignalEngine.ts` | **구루 신호 엔진 (⑤, 순수 함수)** — 지식 규칙의 typed condition을 종목별 지표에 평가해 매칭 산출. `evaluateCondition(ConditionNode, metrics)` **3치 논리**(true/false/**null=지표 미산출**) — all(false 우선)/any(true 우선)/not, **null은 절대 발화 안 함**(미검증·미구현 안전장치). `evaluateLeaf` 연산자(>=,<=,>,<,=,between,in / crossesAbove·Below는 단일스냅샷 평가불가→null). `buildMetricValues(enriched, currentPrice)` — **구현 지표만 매핑**: `rsi14`(enriched.rsi), `climaxFlags`/`distributionCount`(**`riskMatrix.computeRiskTier` 재사용**, drift 차단), `volumeRatio50`, **self-contained 지표**(라이브 priceOriginal 기준): `priceToMa20Pct`/`priceToMa60Pct`/`priceToMa150Pct`(=(price−maX)/maX×100), `pctBelow52wHigh`((high52w−price)/high52w×100), `maCompression`({ma20,60,150} 스프레드/price×100, **현재 어떤 규칙에도 미사용** — 압축률 정의가 신호를 좌우하므로 launchpad 규칙 작성 시 정의 확정 후 결합), `assetTrendRegime`(`computeAssetTrendRegime`: price>ma60>ma150 **AND `enriched.longTrendUp`(MA60 60일 상승)** =uptrend / price<ma60<ma150=downtrend / else neutral — 단순 배열만으론 하락 전환 이평선을 못 거르므로 longTrendUp 보강, false/null은 uptrend 불인정=매수 보수적), `priceCrossAboveMa20Days`(=`enriched.priceCrossMaDays[20]`, MA20 재돌파 경과 거래일, 당일 0, MA20 아래면 null). **이 지표들은 라이브 현재가 기준이라 buildEnrichedIndicator(과거 종가)가 아닌 여기서 계산** → 백테스트 무영향. 미매핑: rsRank(시장 유니버스 백분위)/marketRegime(지수기반)/gapPct(당일 시가 필요). 신규 지표는 어댑터 확장 시 해당 규칙 자동 발화. **`buildGuruSignalTargets({portfolioAssets, watchlist, enrichedMap})`** (순수) — 포트폴리오(enriched)→관심종목 순 `GuruSignalTarget[]` 빌드(같은 ticker 관심종목은 포트폴리오 우선 제외, enriched 없거나 관심종목 가격≤0 스킵). **신호 평가(`evaluateGuruSignals`)와 진단 패널(`useGuruDiagnostics`)이 동일 대상을 공유**하도록 PortfolioContext 인라인 useMemo를 추출한 단일 소스 — 분리 시 한쪽에만 보이는 종목이 생겨 진단이 신호 집합과 어긋남(회귀 핀 `guruDiagnosticsParity.ts` §8: 포트폴리오 우선·동일 ticker 제외·enrichment/가격 누락 스킵·priceOriginal→currentPrice fallback). `getActiveSignalRules(rules,claims,now)` — `isActiveSignal` 게이트 통과 + `condition` 보유 규칙만(condition 없는 자동마이그레이션 규칙은 비대상). `evaluateGuruSignals({rules,claims,targets,now})` → `GuruSignalMatch[]`(condition===true만, `riskPolicy` 포함). **`groupGuruSignals(matches)`** (순수) — 액션별(`GURU_ACTION_ORDER`: sell-warning>buy-setup>buy-watch>…) → **종목별 dedup**(같은 종목 여러 규칙은 `rules[]`로 묶어 UI 중복 방지), 각 그룹 `signalCount`(중복 포함). **`buildGuruSignalChartTargets({matches, portfolioAssets, watchlist, exchangeRates})`** (순수) — 신호 매칭 종목별 차트 props 맵(`Record<assetId, GuruSignalChartTarget>`, dedup) 생성: source 분기(`portfolio`→enrichedAssets/`Asset`, `watchlist`→watchlist 룩업, 관심종목은 수량0·매수가 undefined), 환율은 `resolveExchangeRate`(USD/JPY만, 그외 1). **GuruSignalCard 인라인 차트의 source 분기 룩업을 컴포넌트 밖(순수)으로 빼는 역할**. 타입: `GuruSignalTarget`/`GuruSignalMatch`(+riskPolicy)/`GroupedAssetSignal`/`GuruSignalActionGroup`/**`GuruSignalChartTarget`**/`MetricValues`. side effect·any 없음, now 주입 | `riskMatrix`(computeRiskTier), `knowledgeScoring`(isActiveSignal), `types/knowledge`, `types`(Asset/Currency/ExchangeRates/WatchlistItem), `EnrichedIndicatorData` | `PortfolioContext`(derived.guruSignals/guruSignalTargets/guruSignalChartTargets), `GuruSignalCard`, `useGuruDiagnostics`, `guruDiagnostics`, `types/store` |
| `conditionDescribe.ts` | **구루 신호 설명 레이어 (순수 함수)**. typed condition → 한국어. `METRIC_META`(지표별 표시명·단위·enum 라벨). `describeCondition(node)` → 구절 배열("언제 뜨나", all/any/not 재귀). `explainConditionLeaves(node, metrics)` → leaf별 `{label, condition, actual, passed}`(실제 지표값 vs 기준, `evaluateLeaf` 재사용; **`LeafExplain` 타입은 types/knowledge로 이전**). **`buildSignalExplanation({rule, claims, enriched, currentPrice})`** → `{basis(근거 claim statement), conditions(자동번역), leaves(종목별 실제값 충족), riskPolicy}` — enriched 있으면 `buildMetricValues`로 종목별 충족 산출, 없으면 규칙 일반 조건만. 엔진(`buildMetricValues`/`evaluateLeaf`) 재사용으로 drift 차단. **`metricLabel(metric)`** — 지표 표시명(미정의 시 원시 키) export, 진단 패널의 누락/미지원 지표 표기에 재사용. side effect/any 없음 | `GuruSignalCard`(ExplainBlock 렌더), `guruDiagnostics`(metricLabel) |
| `guruDiagnostics.ts` | **구루 규칙 진단 (5A, 순수 함수)** — "왜 안 떴나"를 **3축 직교** 분해. `diagnoseRule(rule, claims, metrics, ohlcvAvailable, now)` / `diagnoseAssetRules({rules, claims, target, now})`(computability='signal'만, `buildMetricValues` 1회 산출 공유) → `RuleDiagnostic{eligibility{eligible,reasons}, evaluation(matched/unmatched/unknown/not-evaluated), coverage(MetricCoverage[]), leaves}`. **eligibility=`getSignalEligibility`(+'no-condition')로 getActiveSignalRules 멤버십과 일치** → `diag.filter(eligible&&matched)` === `evaluateGuruSignals`(**매치셋 동일성**, 테스트 가드). **coverage는 조건 leaf 기준**, `classifyMetricAvailability`: unsupported(IMPLEMENTED_METRICS 외)/missing(값 없음)/**partial**(climaxFlags·distributionCount이 ohlcvAvailable=false: 0 degrade이지 missing 아님)/available. `summarizeDiagnostics`→**3축 독립 카운트**(eligibility/evaluation/readiness collapse 안 함 — partial이 미충족에 숨지 않음), `ruleReadiness`(규칙당 최악 availability; **조건 없으면 `not-applicable`** — complete 오분류 방지). **`describeRuleStatus(diag)`** → `RuleStatusDescriptor{kind, label, detail?, tone}` — 3축을 사용자용 단일 정밀 상태로 번역(5A-⑤ 패널 라벨). **우선순위(엔진결과 왜곡 금지)**: no-condition → inactive(자격X) → **matched 우선**(엔진이 발화한 사실을 unsupported/not-met로 강등 안 함; partial/missing이면 `firing-partial`='일부 데이터 기준 충족'까지만) → 미발화 시 unsupported('현재 앱에서 미지원') → unmatched(complete='미충족(조건 불일치)' / partial·missing='현재 계산상 미충족·일부 데이터 누락') → unknown='데이터 부족으로 판정 불가'. 라벨/사유 문자열은 `types/knowledge`의 `RULE_STATUS_LABELS`/`INACTIVE_REASON_LABELS`. **`evaluateGuruSignals` 미변경(additive)**. 회귀 `tests/guruDiagnosticsParity.ts`(83단언, matched+unsupported→firing-partial 왜곡금지 + buildGuruSignalTargets 대상 선정 핀 포함) | `knowledgeScoring`(getSignalEligibility), `guruSignalEngine`(evaluateCondition/buildMetricValues), `conditionDescribe`(explainConditionLeaves/metricLabel), `types/knowledge`(IMPLEMENTED_METRICS/RULE_STATUS_LABELS/INACTIVE_REASON_LABELS) → `useGuruDiagnostics`(진단 패널, 5A-⑤) |
| `alertDiagnostics.ts` | **일반 알림 진단 (5B-①, 순수 함수)** — "이 종목에 왜 이 알림이 떴나/안 떴나". 5A `guruDiagnostics`와 동형 2직교축: **evaluation**(filters AND 3치 — 하나라도 false=unmatched/전부 true=matched/그 외=unknown, **matched === `matchesRule`===true** 매치셋 동일성) + **dataQuality**(complete/partial/missing, 5A `MetricAvailability`와 정렬; climax/distribution은 OHLC 미수신 시 **partial**로 미충족에 숨기지 않음). `diagnoseAlertRule(asset, rule, enriched)` / `diagnoseAssetAlerts({asset, enriched, rules, source})`(**관심종목 source는 buy-only 정책**) → `AlertRuleDiagnostic`. `evaluateSingleFilter` + **`alertChecker.buildExtraConfig`/`ruleThresholds` 공유**로 drift 차단. **`classifyFilterQuality(filterKey, reason, enriched)`**: no-data=missing / **OHLC 복합필터(CLIMAX_TOP·DISTRIBUTION_HIGH)는 실제 입력 가용성(`compositeInputQuality`)** — climax 정량입력(slopeRatio·dayRangeOverAtr) 전부 null이거나 distribution volRatio 전부 null이면 **ohlcvAvailable=true여도 missing**, 일부만/ohlcv 미수신이면 partial(과대평가 방지) / 그외 complete. **`describeAlertRuleStatus(diag)`** → `AlertRuleStatusDescriptor`(disabled 최우선 → matched 발화 보존[품질저하=firing-partial] → unmatched[complete=not-met/그외=not-met-partial] → unknown=data-missing). **`evaluateAutoPopupGate(...)`** — 자동 브리핑 팝업 게이트(규칙 발화와 직교 축), **순수·side effect 없음**. **`useAutoAlert`의 실제 effect 조건을 그대로 반영**(disabled→not-ready[자동업데이트/로딩/자산0]→already-checked-today→no-matches→will-show)하고 **useAutoAlert와 동일 함수 공유**(진단≠실제 불일치 제거). **주의: 자동확인 일자 키는 발화 0건이어도 기록 → `already-checked-today`='표시함' 아님='확인 완료'**. 회귀 `tests/alertDiagnosticsParity.ts`(33단언) | `smartFilterLogic`(evaluateSingleFilter), `alertChecker`(buildExtraConfig/ruleThresholds), `types/alertDiagnostics` → `useAlertDiagnostics`, `useAutoAlert`(공유 게이트), `AlertDiagnosticsPanel` |
| `alertSensitivity.ts` | **② 민감도 프리셋 (순수 함수)** — 매수/매도를 분리해 둔감/기본/예민 3단계로 `AlertSettings.rules`의 filterConfig 임계값을 일괄 조정("알림 민감도 조절" 원질문 최종 해결). **`applySensitivityPreset(rules, action, level)`** — 해당 action 규칙의 **조정 가능 숫자 키만** 변경(다른 action 규칙은 참조 불변, 새 객체로 복제하되 enabled·filters·구조형 키[maShort/maLong/maCrossPeriod]·클라이맥스 게이트 토글·maxLookbackTradingDays는 **보존**). 값은 **공장 기본값(`DEFAULT_ALERT_RULES`) × 단계 계수**로 산출(절대적·멱등; 'default'는 공장값 복사 → "기본 프리셋 = 공장 filterConfig" 항등). 조정 키 11종(`ADJUST_TABLE`): 대부분 작을수록 예민(loss/dropFromHigh/profitTarget/dailyCrash/climaxFlagsRequired/climaxSlope/climaxAtr/distributionVolumeRatio/distributionThreshold), distributionWindow·withinDays는 클수록 예민. 각 키 round(int/tenth)+clamp(UI min/max 일치). **`detectSensitivityLevel(rules, action)`** → 현재 조정 키 스냅샷이 어느 단계와 일치하는지(없으면 null='사용자 지정'). **`describeSensitivityPlan(action, level)`** → `SensitivityActionPlan`('지금 할 행동' 결론/이유/행동/되돌리기/데이터 신뢰도, 매도/매수 × 3단계 = 9조합 정적 카피). 회귀 `tests/alertSensitivityParity.ts`(54단언, 골든 절대값+항등+격리+멱등+클램프+detect 라운드트립, `npm run test:sensitivity`). side effect/any 없음 | `types/alertRules`, `types/alertSensitivity`, `constants/alertRules`(DEFAULT_ALERT_RULES) → `AlertSettingsPage`, `tests/alertSensitivityParity` |
| `mergeKnowledgeBase.ts` | **지식 베이스 병합 (앱 시드 ⊕ Drive 저장본, 순수·결정론)**. `mergeKnowledgeBase(seed, saved)` — id 기준 union: 겹치는 항목은 **정의는 시드 우선**(릴리스 업데이트 반영), **사용자 소유 필드는 저장본 보존**(rule: `status`+`verification`, claim: `verification`), 저장본 전용 항목(사용자 신규 추가)은 유지. `journal`은 저장본 우선. `saved` 없거나 `version` 불일치/claims·rules 비배열이면 시드 그대로 반환. side effect/any 없음 | `usePortfolioData`(로드 병합) |
| `positionSizing.ts` | **리스크 기반 포지션 사이징 계산기 (순수 함수)**. 지식 근거 `rule-position-sizing-calc`(claim risk-1pct-per-trade + position-size-from-stop) 구현. `calculatePositionSize(input)` — 손절 시 손실이 (총자산 × 허용손실%)를 넘지 않는 최대 투자금액·수량 역산: `최대투자금 = (총자산 × 허용손실%) / 손절폭%`, `수량 = floor(투자금/진입가)`. 모든 화폐값은 **동일 통화 단위**로 전달(호출부가 환산 책임). `allowFractional`(암호화폐 소수 수량), `lotSize`(정수 라운딩), `allowLeverage`(기본 false → 손절폭이 좁아 투자금>총자산이면 `capped=true`로 총자산 캡). 반환: `{valid, reason?, stopLossPercent, riskAmount, rawInvestment, maxInvestment, maxQuantity, maxQuantityExact, actualRiskAmount, investmentRatio, capped}`. 입력검증 4종(`PositionSizingError` + `POSITION_SIZING_ERROR_LABELS`). 헬퍼 `stopPriceFromPercent`/`stopLossPercentFromPrice`. side effect 없음, any 없음 | `PositionSizingCalculator`(공용), `RiskCalculatorCard`, 매수 모달 2종 |
| `knowledgeIngest.ts` | **인제스트 승인 큐 처리 (순수 함수)**. `parseIngestQueue(jsonl)` → `IngestQueueEntry[]`(형식 불일치 줄 스킵). **`canPromoteRule(rule, kb, implemented?)`** → `PromoteCheck{ok, blockers[]}` — `rule.status='active'`(신호 활성화) 직전 무결성 검사: 연결 claim 실재·미거부(rejected)·sourceId 보유, rule.verification 게이트(userApproved‖dataVerified‖backtestVerified), **signal 규칙은 `IMPLEMENTED_METRICS`만**(미구현이면 차단). `isActiveSignal`이 rule만 게이트하므로 이 함수가 연결 claim 무결성의 **마지막 문지기**. `applyApproval(kb, entry, opts, today)` — 승인 후보 upsert(claim: userApproved=true + pending-ingest 태그 제거 / rule: activate&&canPromote면 status='active' 아니면 'draft'). `IMPLEMENTED_METRICS`는 **types/knowledge로 이전(단일 소스)** — guruSignalEngine.buildMetricValues·guruDiagnostics·`scripts/ingest/triage_commit.py` 공용. side effect/any 없음 | `useKnowledgeInbox` |
| `migrateKnowledge.ts` | **지식 v1→v2 마이그레이션 (순수·결정론)**. `migrateLegacyEntries(entries)` → `{claims, rules}`. 매핑: `deriveDecayClass`(카테고리 기본 + EVERGREEN_IDS/RISK_PRINCIPLE_IDS override), `deriveAuthorityTier`(kang-hwanguk→direct/recommendation, generic→external, 그외→kang-introduced), `deriveVerification`(구 enum→6플래그; 기존앱신호 climax-top/distribution-high/weinstein-150-break는 dataVerified). computability='signal'+mappedSignalKey면 rule도 생성(기존앱신호+dataVerified면 active, 그외 draft). 레거시 `parameters`는 claim.note에 보존 | `types/knowledge.legacy`, `types/knowledge` ← `constants/knowledgeBase` |
| `boundaryDistance.ts` | **조건 leaf 통과 경계까지 거리(근접도, 순수 함수)** — "거의 떴는데 왜 안 떴나"를 지표 단위·부호로 표시. `boundaryDistance(value, operator, threshold)`: `>=`/`>`→value−threshold, `<=`/`<`→threshold−value, between→내부 +최근접여유/외부 −부족분, `=`/`in`/crosses·string·미산출→null. **비율식((actual−T)/T) 미사용 → 음수·0 임계값 안전**. 신호 리플레이 신규 계산(코드에 없던 유일 부분) | `types/knowledge`(ConditionOperator) ← `utils/replayEval`, SignalReplayView |
| `conditionLeafId.ts` | **조건 leaf 안정적 식별자(leafId, 순수 함수)** — 샌드박스 오버라이드 타깃팅용. `deriveLeafId(leaf, occ)`=명시 `leaf.id` **우선**, 없으면 `metric__operator__중복순번`(**배열 index 금지** → 순서 변경·임계값 튜닝에 안정). `flattenLeaves(condition)`=DFS(all→any→not)로 `{leafId, leaf}[]`. **`mergeRule`이 condition을 항상 시드에서 가져와 leafId가 저장본에 보존조차 안 됨 → 드리프트 구조적 불가, 마이그레이션 불필요**. **주의: 같은 metric+operator leaf 다수+순서변경 시 순번 swap 가능 → P3 샌드박스 저장 전 curated rule 명시 id 부여 검토(현재 활성 규칙엔 그런 중복 없음)** | `types/knowledge` ← `utils/ruleOverrides`, `utils/replayEval` |
| `ruleOverrides.ts` | **구루 규칙 leaf 오버라이드 비파괴 적용(순수 함수)** — 리플레이 화면 내부 평가 전용(**라이브 신호 불변**). `applyRuleOverrides(rules, overrides)`=원본 condition 불변 복제, (ruleId, leafId)로 value/operator 패치·`enabled:false`면 leaf 제거(빈 그룹은 그룹째). **모든 leaf 제거 시 원본 유지(방어) — UI(P3)가 "최소 1개 조건" 가드 책임**. `mergeOverrides(perm, sandbox)`(sandbox 우선), `hashRuleset(rules)`(검증 사례 동일성 djb2). 빈 오버라이드=동일 참조. side effect/any 없음 | `conditionLeafId`, `types/knowledge`, `types/signalReplay` ← `utils/signalReplay`, useSignalReplay |
| `replayEval.ts` | **신호 리플레이 핵심 오케스트레이터(1일 단위, 순수 함수)** — `evaluateReplayDay({ticker,name,series,asOfIndex,guruRules,claims,alertRules,now})`. **asOf 인덱스까지만 OHLCV 슬라이스(이후 데이터 미유입 = 룩어헤드 0)** → `buildEnrichedIndicator` → 구루 `diagnoseAssetRules`(**자격=now 동결[오늘], 평가=과거 지표**) + 알림 `diagnoseAssetAlerts`(pseudo EnrichedAsset: priceOriginal/changeRate/yesterdayChange=과거값, dropFromHigh=high52w 복원, **returnPercentage=0**[PROFIT_*/LOSS_* 미발화], **indicators=undefined**[VOLUME_*/SIGNAL_*=서버지표→data-missing]) → leaf 근접도(`boundaryDistance`, RuleDiagnostic.leaves와 1:1) → outcome(미래 종가 ret5/20/60·최대상승/하락, **신호 계산엔 미사용**). `prepareSeries(history)`=HistoricalPriceResult→정렬 OHLCV 1회. **`classifyReplayAlertScope(filterKeys)`** → `'verifiable'|'holding-dependent'|'server-dependent'` — 리플레이에서 발화/미충족 판정이 신뢰 가능한 알림 구분(보유가 의존 PROFIT_*/LOSS_*=항상 0% 모의→holding, 서버 SIGNAL_*/VOLUME_*=미수신→server[우선], 그 외 가격·OHLCV=verifiable). UI가 '검증 불가' 분리·오태깅 방지에 사용. **새 엔진 없음 — 기존 진단/빌더 재사용**. now 주입 | `buildEnrichedIndicator`, `guruDiagnostics`, `alertDiagnostics`, `guruSignalEngine`(buildMetricValues), `conditionLeafId`, `boundaryDistance`, `types/{signalReplay,smartFilter}` ← `utils/signalReplay`, useSignalReplay, SignalReplayView |
| `signalReplay.ts` | **리플레이 타임라인 빌더(동기, 순수)** — `buildReplayTimeline({...,history,guruRules,claims,alertRules,now,anchorDate?,windowTradingDays?})` → `ReplayTimeline{days,chartPoints,markers,signalDates}`. 윈도(기본 252거래일) 각 거래일을 asOf로 `evaluateReplayDay` 반복(워밍업 60 미만 스킵). 마커=**구루 신호 게이팅**(구루 eligible&&matched만 마커/signalDates/이전·다음 신호 네비 기준; **알림 matched는 마커 비생성** — alertCount로 정보 기록만, 참고용 박스 전용 → 알림-only 날짜가 "신호 발생일"로 안 잡힘), 방향(buy/sell)별(sell-warning→sell, buy-watch·setup→buy). chartPoints=윈도 시작~최신(미래 포함, replay 모드에서 asOf 이후 가림). **각 chartPoint에 차트 오버레이 지표 부착**: `ma`(기간별 SMA, `CHART_MA_PERIODS`=**[5,20,60,120,150]**·MA200/10은 알림 규칙 미사용이라 제외) + `rsi`(14일) — 전체 시리즈로 `calculateSMA`/`calculateRSI` 1회 계산(trailing). **as-of 날의 값이 진단 패널 `enriched.ma/rsi`와 bit-동일**(같은 함수 재사용 → 차트 선=진단 숫자 보장, parity ⑨ 가드). **배치2a 툴팁용**: `volume`(series.volume) + `alerts`(**`verifiableAlertSummary(day)`**=그날 발화한 **classifyReplayAlertScope==='verifiable'** 알림 규칙명 action별·발화없음 null — 보유가/서버 의존 알림은 제외해 툴팁이 거짓신호처럼 보이는 것 방지) 부착(평가 윈도 날짜만, 미래 chartPoint는 null). **훅은 청크 실행하나 알고리즘 단일 소스는 이 함수** (회귀 `tests/signalReplayParity.ts`) | `replayEval`, `maCalculations`(calculateSMA/RSI), `buildEnrichedIndicator`(RSI_PERIOD), `types/signalReplay` ← useSignalReplay, SignalReplayView |
| `chartFormat.ts` | **차트 공용 포맷/색상 헬퍼(순수)** — `CANDLE_UP_COLOR`/`CANDLE_DOWN_COLOR`(한국식 빨강/파랑), `toChartTime`, `getCurrencySymbol`, `formatPrice`, `formatPct`. SignalReplayChart 전용(AssetTrendChart 마이그레이션은 회귀 위험 회피로 후속) | `types`(Currency) ← `SignalReplayChart`, `SignalReplayView` |
| `replayPerformance.ts` | **규칙별 누적 성과 집계(③, 순수)** — `computeSignalPerformance(timeline)` → `SignalPerformance[]`. 윈도(timeline.days) 전체에서 **구루(eligible&&matched) + "검증 가능" 가격기반 알림(enabled&&matched && classifyReplayAlertScope==='verifiable')** 별로 발화 거래일을 모아 신호 후 복기 성과 집계: `signalCount`·`avgRet20`·`avgMaxRise`·`avgMaxDrop` + **방향 적중률 `hitRate20`**(매수=ret20>0 / 매도=ret20<0 비율, 분모=`evaluable20`=ret20 not-null). 보유가/서버 의존 알림은 제외(리플레이 신뢰 불가). 정렬=구루 먼저→발화 많은 순. **성과는 미래 종가 기반 복기치(신호 계산 무관)**. `SignalPerformance` 타입 이 파일 export | `replayEval`(classifyReplayAlertScope), `types/signalReplay` ← `useSignalReplay`, `ReplayPerformancePanel`, `tests/signalReplayParity` |
| `replayExport.ts` | **검증 기록 백업 직렬화(⑤, 순수)** — `buildReplayExport(verdicts,cases,exportedAt)`→`ReplayExportBundle{schema,version,exportedAt,verdicts,cases}`, `serializeReplayExport`(들여쓰기 JSON), **`parseReplayExport(text)`**→`{verdicts,cases}`(스키마 불일치·깨진 JSON·잘못된 항목 안전 폐기 — **기존 `parseVerdicts`/`parseCases`에 JSON.stringify로 위임해 검증 단일 소스 유지**). localStorage 유실 대비 파일 export/import용(Drive 동기화는 범위 밖). `REPLAY_EXPORT_SCHEMA`/`VERSION` 상수 | `replayVerdicts`(parseVerdicts), `replayCases`(parseCases), `types/signalReplay` ← `useSignalReplay`, `tests/signalReplayParity` |
| `replayTooltip.ts` | **리플레이 차트 hover 툴팁 데이터(순수)** — `buildReplayTooltip({point,prevClose,markers,maPeriods})`→`ReplayTooltipData`: 날짜·종가·**전일대비 등락%**(prevClose)·OHLC(`hasOHLC`)·기간별 MA값+**이격%**(`maDistancePct`=종가대비)·**ma5vs20**(골든/데드크로스 상태)·RSI+**`rsiZone`**(과매도≤30/중립/과열근접60~69/과열≥70, `RSI_ZONE_LABEL`)·**구루 신호 요약**(markers의 guruCount>0만) + **배치2a: `volume`(point)·`alerts`(point의 검증가능 알림 요약 passthrough)·`verdicts`(verdictKinds prop)**. **미래정보 절대 미포함**(ReplayChartPoint/markers/판정만 입력 → 룩어헤드 0). 색상/위치/규칙명 최대 3개 절단은 컴포넌트 담당 | `types/signalReplay`(ReplayChartPoint/Marker/SignalVerdictKind) ← `SignalReplayChart`, `tests/signalReplayParity` |
| `replayVerdicts.ts` | **신호 사용자 판정 저장(P2, 순수 + 얇은 localStorage 래퍼)** — 키=`asset-manager-replay-verdicts-v1`. **순수**: `verdictKey(ticker,date,ruleId?)`(ruleId 생략=날짜 전반), `findVerdict`/`upsertVerdict`(같은 키 교체=수정·없으면 추가, **비파괴**)/`removeVerdict`/`verdictsForTicker`(최신 날짜 우선)/`datesWithVerdict`(구분표시 Set)/`isVerdictKind`/`parseVerdicts`(깨진 항목 폐기=부분성공)/`serializeVerdicts`. **놓친 매수/매도는 선택 날짜에만 의존 → 마커 없는 날도 태깅(false negative)**. **부수효과**: `loadVerdicts`/`saveVerdicts`(try-catch+logger). Drive 미동기화·라이브 불변 | `utils/logger`, `types/signalReplay` ← `useSignalReplay`, `tests/signalReplayParity` |
| `ruleSandbox.ts` | **샌드박스 leaf 조정(P3, 순수)** — "값 + on/off"만(operator·value 형태 변경 없음=P4). `classifyLeaf`→`single`(숫자1개)/`between`([min,max] number)/`fixed`(문자열·in·crosses=값편집 불가). `describeRuleLeaves(rule, overrides)`→`SandboxLeaf[]`(leafId·kind·baseValue·value[override머지]·enabled·overridden, **형태 보존**). **`wouldKeepActiveLeaf(rule, overrides, leafId, nextEnabled)`** — 마지막 활성 leaf off 차단 판정(**applyRuleOverrides가 전체 leaf 제거 시 원본 유지하는 착시 예방** — UI가 이 함수로 그 상태 자체를 막음), `countActiveLeaves`. 갱신: `setLeafValue`(number)·`setBetweenBound`(항상 길이2 number 배열 유지)·**`setLeafEnabled`(정규화: enabled=true로 되돌릴 때 value override 없으면 no-op override 제거·있으면 value만 보존 → 샌드박스 부풀림/사례 박제 방지)**·`clearLeafOverride`/`clearRuleOverrides`(비파괴, 키 (ruleId,leafId))·**`isBetweenInverted`**(min>max 감지=UI 경고). **시드/라이브 불변** | `conditionLeafId`(flattenLeaves), `types/{knowledge,signalReplay}` ← `useSignalReplay`, `ReplaySandboxPanel`, `tests/signalReplayParity` |
| `replayCases.ts` | **검증 사례 저장/diff(P2, 순수 + 얇은 localStorage 래퍼)** — 키=`asset-manager-replay-cases-v1`. **순수**: `collectPerRuleResults(days)`(구루 eligible&&matched만 규칙별 발화일=마커 게이팅 동일 기준), `buildRuleSnapshot`(signal 규칙만 conditionJson+leafIds, 시드 변해도 재현), `computeResultMetrics`(signalCount+신호일 avgRet20), `buildVerificationCase`(**id/createdAt 호출부 주입=순수**, rulesetHash=`hashRuleset`, **verdicts는 종목(`input.ticker`)+`timeline.days` 날짜 Set으로 필터 → 다른 종목/기간 밖 판정 오염 차단**), `diffSignalDates(prev,next)`→{added,removed}, `diffCaseResults`(전체+규칙별, 변화 없는 규칙 제외), `upsertCase`(같은 id 교체·없으면 **최신 우선 prepend**)/`removeCase`/`parseCases`(필수필드 없으면 폐기). **부수효과**: `loadCases`/`saveCases`. **caseRole(research|holdout)** — holdout은 P3 과적합 방지 게이트. **overridesSnapshot은 P2에서 항상 []**. Drive 미동기화 | `utils/logger`, `conditionLeafId`(flattenLeaves), `ruleOverrides`(hashRuleset), `types/{knowledge,signalReplay}` ← `useSignalReplay`, `tests/signalReplayParity` |

### types/ (타입 정의)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `index.ts` | 핵심 타입 (`Asset`, `Currency`, `AssetCategory`(deprecated) 등). Asset에 `pinned?: boolean` 필드 포함. **`Asset.bucket?: BucketId`**(전략 버킷, 미지정=코어, categoryId와 직교). **`AllocationTargets.bucketWeights?: Record<string,number>`**(버킷 목표비중 'CORE'/'SATELLITE'%) + `weights`는 **코어 버킷 내부 카테고리 비중**(코어 합계=100 기준)으로 의미 명확화 | **전역** - 거의 모든 파일 |
| `category.ts` | **카테고리 시스템 핵심** — `CategoryDefinition`, `CategoryStore`, `CategoryBaseType`, `DEFAULT_CATEGORIES`, `EXCHANGE_MAP_BY_BASE_TYPE`, 유틸(`isBaseType`, `getCategoryName`, `inferCategoryIdFromExchange`, `getAllowedCategories`) | **전역** — 모든 카테고리 참조 컴포넌트/훅 |
| `bucket.ts` | **전략 버킷 축(카테고리와 직교)** — `BucketId`('CORE'\|'SATELLITE'), `DEFAULT_BUCKET`('CORE'), `ALL_BUCKETS`, `BUCKET_LABELS`(코어/투더문)/`BUCKET_DESCRIPTIONS`, `getAssetBucket(asset)`(미지정→코어)/`getBucketLabel`. 버킷은 시세/환율/거래소(=categoryId 결정)에 **영향 없음** — 배분/리밸런싱 집계·표시 전용. 종류 혼합 위성도 각 categoryId 정확 유지 → 시세 정상 | `useRebalancing`, `bucketRebalancing`, `AddNewAssetModal`/`EditAssetModal`, 포트폴리오 테이블/카드(투더문 뱃지) |
| `backup.ts` | 백업 타입 (`BackupInfo`, `BackupSettings`, `RETENTION_OPTIONS`) | `hooks/useBackup`, `BackupSettingsSection` |
| `api.ts` | API 응답 타입 (`PriceItem`, `Indicators` 등). `Indicators`에 거래량 3필드 포함: `volume`(당일), `volume_avg20`(20일 평균), `volume_ratio`(비율) | `services/`, `hooks/` |
| `store.ts` | 상태 관리 타입 (`PortfolioContextValue`, `GlobalPeriod`, `UIState.activeTab` 등). **`GlobalPeriod = 'THIS_MONTH' \| 'LAST_MONTH' \| '1M' \| '3M' \| '6M' \| '1Y' \| '2Y' \| 'ALL'`** (금월/전월/1개월 추가). `PortfolioData`에 `categoryStore` + **`knowledgeBase: KnowledgeBase`**(구루 지식 DB, Drive 동기화 노출), `PortfolioActions`에 **`updateKnowledgeBase(kb)`**(상태 갱신 + Drive 자동저장), `PortfolioStatus`에 `needsReAuth`, `DerivedState`에 `backupList`/`isBackingUp` + **`enrichedAssets: EnrichedAsset[]`** (메트릭 enrich된 포트폴리오 자산 — 알림/진단이 metrics·indicators까지 필요, Context 1회 계산 공유) + **`riskMatrix: RiskMatrixRow[]`** (위험 우선 정렬된 종합 리스크 매트릭스) + **`guruSignals: GuruSignalMatch[]`** (구루 신호 엔진이 활성 지식 규칙을 종목별 평가한 매칭, `utils/guruSignalEngine`) + **`guruSignalTargets: GuruSignalTarget[]`** (신호 평가/진단 공유 대상 종목 = 포트폴리오+관심종목, `buildGuruSignalTargets` — 신호 카드와 진단 패널 단일 소스) + **`guruSignalChartTargets: Record<string, GuruSignalChartTarget>`** (신호 종목별 차트 props 맵, assetId 키 — GuruSignalCard 인라인 차트용, `buildGuruSignalChartTargets`) + **`autoPopupDiagnosis: PopupDeliveryDiagnosis`** (자동 브리핑 팝업 게이트 진단 — 규칙 발화와 직교, 알림 진단 패널 표시, `types/alertDiagnostics`) 포함. `UIState`에 `focusedAssetId: string \| null` + `focusedWatchItemId: string \| null` + **`lowValueThreshold: number`** (소액 자산 숨김 임계값 KRW, 기본 1,000,000) + **`columnConfig: ColumnConfig[]`** (포트폴리오 테이블 컬럼 표시/순서/너비, 데스크탑 전용) + **`fixedColumnWidths: FixedColumnWidths`** (종목명 너비) + **`chartMAConfigs: MALineConfig[]`** (개별 차트 MA 6슬롯 설정 — 차트 표시 전용, 알림/스마트필터 MA와 무관) 포함. `ModalState`에 `editingSellRecord: SellRecord \| null` 포함. `PortfolioActions`에 `setFocusedAssetId`, `setFocusedWatchItemId`, `togglePinAsset`, **`setLowValueThreshold`**, **`setColumnConfig(config)`**, **`resetColumnConfig()`** (너비도 함께 리셋), **`setColumnWidth(key, width)`**, **`setFixedColumnWidth(key, width)`**, **`setChartMAConfigs(configs)`**, **`resetChartMAConfigs()`**, **`editSellRecord(recordId, patch)`**, **`deleteSellRecord(recordId)`**, `openEditSellRecord(record)`, `closeEditSellRecord()` 포함. **`ColumnConfig`/`FixedColumnWidths`는 `types/ui`에서 import, `MALineConfig`는 `utils/maCalculations`에서 import** | `contexts/`, `hooks/`, `App.tsx`, `components/common/PeriodSelector`, `SmartFilterPanel`, `AlertSettingsPage`, `DisplaySettingsSection`, `EditSellRecordModal`, `ColumnSettingsDropdown` |
| `ui.ts` | UI 컴포넌트 Props 타입 (`PortfolioTableProps`, `SortKey`, `AssetMetrics`, `EnrichedAsset`). **컬럼 커스터마이징 타입**: `ColumnKey`(설정 가능 11개 컬럼), `ColumnConfig {key, visible, width?}`, `DEFAULT_COLUMN_CONFIG`(기존 더보기 ON 상태와 동일), `COLUMN_LABELS`(키→한글명), `FixedColumnWidths {name?}`(종목명 너비), `DEFAULT_FIXED_COLUMN_WIDTHS`, `MIN_COLUMN_WIDTH=80`(px) | `components/`, `store.ts`, `PortfolioTable`, `PortfolioTableRow`, `columnDefinitions`, `ColumnSettingsDropdown`, `ColumnResizeHandle`, `useColumnResize` |
| `smartFilter.ts` | 스마트 필터 타입 (**32개 키** — ma 10 / rsi 4 / signal 4 / portfolio 8 / volume 3 + `CLIMAX_TOP`·`DISTRIBUTION_HIGH`·`SWING_LOW_BREAK`(signal 그룹) 3 = 32. `PRICE_CROSS_BELOW_MA`는 `ma` 그룹). 그룹 매핑, 칩 정의(`pairKey`/`pairColorClass` tri-state, `description` 툴팁), 초기값. **5B 진단 타입(단일 소스)**: `FilterEvalReason`(met/not-met/event-not-found/no-data/not-applicable) + `FilterEvalResult`(result `boolean\|null` + reason + actual?/threshold?) — `evaluateSingleFilter` 반환형 + **`ExtraFilterConfig`**(필터 임계값/옵션, smartFilterLogic→여기로 이전). utils 미참조라 순환 없음 | `utils/smartFilterLogic`, `SmartFilterPanel`, `PortfolioTable`, `alertChecker` |
| `alertRules.ts` | 알림 규칙 타입 (`AlertRule`, `AlertResult`, `AlertSettings`, `AlertMatchedAsset`). `AlertMatchedAsset`에 `source?: 'portfolio' \| 'watchlist'` + **`distributionTier?: DistributionTierClassification`** (P4.5 D1, distribution-high 룰 한정) 필드 포함. `AlertRuleFilterConfig`에 `maCrossPeriod?`, `withinDays?`, `maxLookbackTradingDays?`, **클라이맥스 임계값 3개**(`climaxFlagsRequired?`/`climaxSlopeMultiplier?`/`climaxAtrMultiple?`), **클라이맥스 게이팅 토글 2개**(`climaxRequireBullishCandle?`/`climaxRequireLongTrendUp?` — 둘 다 기본 true), **디스트리뷰션 임계값 3개**(`distributionWindow?`/`distributionVolumeRatio?`/`distributionThreshold?`) 포함 | `constants/alertRules`, `utils/alertChecker`, `hooks/useAutoAlert`, `AlertSettingsPage`, `AlertPopup` |
| `knowledge.ts` | **구루 지식 베이스 타입 (v2, 4컬렉션)**. `KnowledgeBase`(version=2/sources/claims/rules/journal/lastUpdated). **자연어 주장(`KnowledgeClaim`)과 실행규칙(`KnowledgeRule`, typed condition) 분리**. `KnowledgeSource`(원문 메타+sha256+priorityProfile), `KnowledgeClaim`(sourceId/sourceDate/statement/category/**decayClass**/**authorityTier**/guru/confidence/**verification**/citations/note), `KnowledgeRule`(claimIds/condition?/action/mappedSignalKey/**status**(draft·active·archived)/requiredMetrics/verification), `KnowledgeJournalEntry`(ruleIds/decisionType/plannedStop/positionSize/result/reviewNote). **`VerificationFlags`**=독립 6플래그(sourceVerified/factVerified/dataVerified/backtestVerified/userApproved/rejected) + `EMPTY_VERIFICATION`. **`AuthorityTier`** 5단(kang-direct-principle…ai-inference), **`DecayClass`** 6종(risk-principle/evergreen-reference 무감쇠 외). **typed condition**: `ConditionNode`(all/any/not), `ConditionLeaf`(metric/operator/value + optional **`id`**[신호 리플레이 leafId 명시용, 평가 엔진 미사용·시드 미부여 시 derive]), `ConditionOperator`(>=,<=,between,in,crossesAbove…), **`RequiredMetric`**(구현됨: rsi14/climaxFlags/distributionCount/volumeRatio50/**priceToMa20Pct·priceToMa60Pct·priceToMa150Pct·pctBelow52wHigh·maCompression·assetTrendRegime·priceCrossAboveMa20Days**[guruSignalEngine.buildMetricValues] + 미구현: rsRank[유니버스 백분위, Mansfield RS와 혼동 금지]/rsRank1m/marketRegime[지수기반]/priceToMa10Pct/gapPct/ma65/allTimeHigh/priceVsMa/swingLow). **`IMPLEMENTED_METRICS`**(=buildMetricValues 산출 11종 Set, **단일 소스** — knowledgeIngest·guruDiagnostics·triage_commit.py 공용). **진단 타입(5A)**: `MetricAvailability`(available/partial/missing/unsupported)·`InactiveReason`(draft/archived/advisory/rejected/unverified/claim-expired/no-condition)·`RuleEvaluation`(matched/unmatched/unknown/not-evaluated)·`MetricCoverage`·`RuleReadiness`·**`LeafExplain`**(conditionDescribe에서 이전)·`RuleDiagnostic`·`DiagnosticSummary`(3축 독립). **5A-⑤ 패널 라벨 타입**: `RuleStatusKind`(firing/firing-partial/not-met/not-met-partial/data-missing/unsupported/no-condition/inactive)·`StatusTone`(positive/neutral/caution/muted)·`RuleStatusDescriptor` + **`RULE_STATUS_LABELS`**(kind→한국어 정밀 라벨)·**`INACTIVE_REASON_LABELS`**(InactiveReason→라벨)·**`RULE_ACTION_LABELS`**(RuleAction→한국어, GuruSignalCard ACTION_STYLES와 일치) — `guruDiagnostics.describeRuleStatus`/진단 패널 공용. 표시명 LABELS 7종. **인제스트 승인 큐 타입**: `IngestQueueEntry`(queueId/kind/sourceId/triagedAt/reason/dedup/confidence/candidate — 로컬 `DB/queue` JSONL 1줄), `PromoteCheck`(ok/blockers — `canPromoteRule` 결과). **v1(`KnowledgeEntry`)은 `knowledge.legacy.ts`에 보존** | `constants/knowledgeBase`, `utils/knowledgeScoring`, `utils/knowledgeIngest`, (지식 DB UI/신호 엔진) |
| `knowledge.legacy.ts` | **레거시(v1) 타입 아카이브** — `KnowledgeEntry`(납작한 단일구조)/`KnowledgeBase`/`KnowledgeSource` 등. `constants/knowledgeBase.legacy.ts`의 원본 50개 데이터 보존 전용. **신규 코드 import 금지**, 전체 마이그레이션 후 삭제 예정 | `constants/knowledgeBase.legacy` (전용) |
| `guruDiagnostics.ts` | **진단 패널(5A-⑤) 조합/뷰 타입** — `DiagnosticRow`(`RuleDiagnostic`+`RuleStatusDescriptor`), `GuruDiagnosticsView`(useGuruDiagnostics 반환 뷰모델: targets/selectedId/selectTarget/rows/summary). 진단 결과(`types/knowledge`)와 평가 대상(`GuruSignalTarget`, `utils/guruSignalEngine`)을 엮어 양쪽 type-import — **`types/store.ts`와 동일한 "조합 타입 집결지가 utils를 type-import" 패턴**(guruSignalEngine은 이 파일 미import → 순환 없음). `types/knowledge`에 두면 guruSignalEngine과 순환되므로 분리 | `types/knowledge`, `utils/guruSignalEngine` ← `useGuruDiagnostics`, `GuruDiagnosticsPanel` |
| `alertDiagnostics.ts` | **일반 알림 진단 타입 (5B-①)** — 5A 어휘 정렬. `AlertDataQuality`(complete/partial/missing, ≈MetricAvailability)·`AlertRuleEvaluation`(matched/unmatched/unknown)·`FilterDiagnostic`·`AlertRuleDiagnostic`(evaluation×dataQuality 직교)·`AlertRuleStatusKind`(firing/firing-partial/not-met/not-met-partial/data-missing/disabled)+`ALERT_RULE_STATUS_LABELS`·`PopupDeliveryReason`/`PopupDeliveryDiagnosis`(규칙 발화와 직교 축). 뷰모델 `AlertDiagnosticsTarget`/`AlertDiagnosticRow`/`AlertDiagnosticsView`(EnrichedAsset·EnrichedIndicatorData type-import — store.ts 패턴) | `types/smartFilter`, `types/ui`, `hooks/useEnrichedIndicators` ← `utils/alertDiagnostics`, `useAlertDiagnostics`, `AlertDiagnosticsPanel` |
| `alertSensitivity.ts` | **② 민감도 프리셋 타입** — `SensitivityLevel`(insensitive/default/sensitive)·`SensitivityAction`(sell/buy)·`SENSITIVITY_ORDER`(둔감→기본→예민)·`SENSITIVITY_LABELS`/`SENSITIVITY_SUBLABELS`·**`SensitivityActionPlan`**('지금 할 행동' 5필드: conclusion/reason/action/invalidation/dataTrust). utils 미참조라 순환 없음 | `utils/alertSensitivity`, `AlertSettingsPage` |
| `signalReplay.ts` | **신호 리플레이 타입** — "현재/선택 규칙을 **과거 시점 데이터에 대입한 재현**"(실제 과거 팝업 복원 아님 — UI 면책 명시). `ReplayMode`(replay 미래가림 기본/review 복기), `SignalOutcome`(ret5/20/60·maxRise·maxDrop, **초보 라벨 "신호 후 최대 상승/하락"**), `ReplayMarker`/`ReplayChartPoint`/`ReplayDay`(**진단 재사용**: guruDiagnostics:RuleDiagnostic[]+alertDiagnostics:AlertRuleDiagnostic[]+guruLeafDistances+outcome)/`ReplayTimeline`. **보완 루프(1차 한정 — Drive 미동기화)**: `RuleOverride`(ruleId/leafId/value?/operator?/enabled?), `RuleVersion`(P4용 타입만), `VerificationCase`(종목·기간[anchorDate/windowTradingDays]·rulesetHash·ruleSnapshot·overridesSnapshot·perRuleResults·verdicts·memo·caseRole·resultMetrics?, **localStorage `asset-manager-replay-cases-v1`**), `ReplayCaseRole`(research|holdout), `SignalVerdict`(good/too-early/too-late/false/missed-buy/missed-sell, **localStorage `asset-manager-replay-verdicts-v1`**), `SignalVerdictKind`. 진단 타입 type-import(store.ts 패턴) | `types/knowledge`, `types/alertDiagnostics`, `hooks/useEnrichedIndicators` ← `utils/{replayEval,replayCases,replayVerdicts,signalReplay}`, useSignalReplay, SignalReplayView |

### constants/ (상수 정의)
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `columnDescriptions.ts` | 포트폴리오 테이블 컬럼 툴팁 텍스트 | `PortfolioTable`, `PortfolioTableRow` |
| `briefingDescriptions.ts` | 투자 브리핑(`AlertPopup`) 항목 타이틀 툴팁 텍스트 — 초보 관점 설명. 포맷: `[정의]\n📐 계산: …\n💡 의미`(Tooltip `wrap` 모드로 줄바꿈 렌더). `BRIEFING_SECTION_TOOLTIPS`(과열경고/매도/매수 섹션), `CLIMAX_SIGNAL_TOOLTIP`(클라이맥스 신호 3정황 정의 — 티어 툴팁에서 분리, 섹션 헤더 "클라이맥스란? ⓘ"에 부착), `RISK_TIER_TOOLTIPS`(red/amber/blue, 산식은 `riskMatrix.ts`와 동기화), `BRIEFING_COLUMN_TOOLTIPS`(종목/당일/수익률/RSI), `BRIEFING_RULE_TOOLTIPS`(rule.id별, `alertRules.ts`와 1:1 — **새 규칙 추가 시 설명도 함께 추가**) | `AlertPopup` |
| `smartFilterChips.ts` | 스마트 필터 칩 정의 (22개 칩, 동적 라벨, 색상, `description` 툴팁). MA 현재가 칩 2개는 `pairKey`로 ABOVE↔BELOW tri-state 토글 (off→>→<→off 순환, 칩 하나로 2개 필터 키 제어). `DAILY_DROP`/`LOSS_THRESHOLD` 추가. 거래량 그룹 3개 칩: `VOLUME_SURGE`(급증≥2x), `VOLUME_HIGH`(증가≥1.5x), `VOLUME_LOW`(감소<0.5x) | `SmartFilterPanel` |
| `alertRules.ts` | 기본 알림 규칙 — **매도 14개 + 매수 7개**(총 21, `enabled:false` 기본 비활성 2개). 이벤트형 규칙에 `withinDays` 기본값: 추세전환매수(5일), 바닥반등(3일), 급락반등(3일), 과열익절(3일). `dead-cross` 룰에 `maxLookbackTradingDays: 252` (1년) 기본값. **과열 리스크 매도 룰 2개**: `climax-top` (`climaxFlagsRequired:2`, **`climaxSlopeMultiplier:2.5`** (P4.5 C1: 3→2.5), `climaxAtrMultiple:2.5`, **`climaxRequireBullishCandle:true`**, **`climaxRequireLongTrendUp:true`** — 양봉/수개월 상승 전제 강제로 거짓 신호 차단), `distribution-high` (`distributionWindow:13`, `distributionVolumeRatio:1.5`, `distributionThreshold:5`) — 둘 다 severity:warning. **와인스타인 매도 룰 3개**: `weinstein-150-break` (`maCrossPeriod:150`, `withinDays:5`) — 30주(150일) 이평선 하향이탈, `ma120-break` (`maCrossPeriod:120`, `withinDays:5`) — 120일 이평선 하향이탈, `swing-low-break` (filterConfig 없음) — 현재가가 최근 60거래일 swing low 아래로 떨어진 경우(`SWING_LOW_BREAK` 필터 사용). 셋 다 severity:warning. `DEFAULT_ALERT_SETTINGS` | `useAutoAlert`, `AlertSettingsPage` |
| `commodityProxyMap.ts` | 원자재/현물의 거래량 프록시 매핑. `VOLUME_PROXY_MAP: Record<string, string>` (KRX-GOLD→GLD, GC=F→GLD, SI=F→SLV 기본). `COMMODITY_PROXY_LIST` (dedup된 프록시 ticker 배열, fetch 배치 추가용), `hasVolumeProxy(ticker)`, `resolveVolumeProxy(ticker)`. **거래량이 무의미한 현물/지수에 대해 가격은 본 자산, 거래량만 프록시 ETF/선물로 대체** — 클라이맥스 (c)/디스트리뷰션 거래량 비교에 사용 | `useEnrichedIndicators` |
| `api.ts` | Cloud Run 서버 URL 중앙 관리. `CLOUD_RUN_BASE_URL` export — **`VITE_CLOUD_RUN_BASE_URL` env 우선, 미설정 시 기본값**(`import.meta.env?.` 가드로 tsx/node 백테스트에서도 안전). 서버 URL 변경 시 이 파일 또는 env 수정 | `services/priceService`, `services/upbitService`, `services/historicalPriceService`, `services/googleDriveService`, `tests/walkForwardBacktest.ts` |
| `knowledgeBase.ts` | **구루 지식 베이스 시드 (v2, 전체 마이그레이션 완료)** (Drive JSON 병합 대상). `migrateLegacyEntries(LEGACY_ENTRIES)`로 레거시 **46개 → claims 46 + rules 23** 자동 변환 + `CURATED_RULES`(조건식 있는 핵심 7개)로 덮어쓰기. **self-contained 지표만 쓰는 buy-watch 신호 3개**(전부 active·userApproved·관찰 후보 수준, "매수 추천" 아님): `rule-ma20-pullback-watch`(uptrend AND priceToMa20Pct∈[-3,3] AND distributionCount≤4 AND **pctBelow52wHigh≤15**), `rule-near-high-breakout-watch`(uptrend AND **pctBelow52wHigh≤5**[신고가 갱신=음수 포함] AND volumeRatio50≥1.2 AND climaxFlags<2 — 근거 all-time-high-breakout·box-breakout·volume-confirms), `rule-ma20-reclaim-watch`(regime∈[neutral,uptrend] AND priceCrossAboveMa20Days∈[0,5] AND distributionCount≤4 AND **pctBelow52wHigh≤15** — 근거 ma-reclaim-entry, claim이 "기준 20일선 추천"이라 **MA20**[150 아님]). **`pctBelow52wHigh≤15` = 강세 필터**(rsRank 대용 근사, claim pick-among-already-up "이미 많이 오른 종목 중 고른다" — 시장 반등에 휩쓸린 약세 종목 제외, 실사용 튜닝으로 18→축소). 엄격판 `rule-ma-pullback-entry`/`rule-rs-90-screening`은 rsRank(시장 유니버스 백분위) 구현까지 draft 차단 유지(claim 무결성). **신규 buy 규칙은 self-contained metric만·null-safe·buy-watch 수준 원칙**. `SEED_KNOWLEDGE_BASE`(version 2), `KNOWLEDGE_SOURCES`(2), `KNOWLEDGE_CLAIMS`/`KNOWLEDGE_RULES`/`KNOWLEDGE_JOURNAL`([]). `vf()` 헬퍼. **게이트 결과**: 활성 신호 3개(전부 기존 앱신호 climax-top/distribution-high/weinstein-150-break, dataVerified) / 미검증(1.7만 백테스트)·신규지표 필요 규칙은 draft 차단. **legacy 의존은 전환기 한정** — 큐레이션 규칙이 자동본을 충분히 대체하면 `*.legacy.ts` 삭제. **지식 근거 접근자**: `POSITION_SIZING_RULE_ID`, `getPositionSizingBasis()` → `{title, riskPolicy?, claims[]}` (rule-position-sizing-calc + 근거 claim statement 조회, 포지션 사이징 UI가 근거 표시에 사용 — 규칙/주장 데이터를 컴포넌트에 흩지 않도록 단일 조회 제공) | `types/knowledge`, `utils/migrateKnowledge`, `utils/knowledgeScoring`, `constants/knowledgeBase.legacy`, `PositionSizingCalculator`, **Drive 동기화 배선 완료**(`usePortfolioData`가 `mergeKnowledgeBase`로 로드 병합 + autoSave로 영속, `PortfolioContext.data.knowledgeBase` 노출 + `actions.updateKnowledgeBase`로 갱신), (지식 DB UI는 ⑦에서) |
| `knowledgeBase.legacy.ts` | **레거시(v1) 데이터 아카이브** — 원본 50개 `KnowledgeEntry`(납작한 구조) 보존. `knowledge.legacy.ts` 타입 사용. **신규 코드 import 금지**, 전체 마이그레이션 후 삭제 예정 | `types/knowledge.legacy` (전용) |

### components/layouts/ (탭별 뷰)
| 파일 | 책임 | 의존 |
|------|------|------|
| `DashboardView.tsx` | 대시보드 탭 — 최상단에 `MarketDistributionBanner` (시장 지수 디스트리뷰션 경고, 모든 지수 safe면 자동 미렌더). `GoldPremiumWidget` 아래 **`RiskCalculatorCard`**(접힘형 풀폭) + **`GuruSignalCard`**(좌 신호/우 차트 분할 풀폭)를 `space-y-6`로 **세로 스택**(기존 2열 그리드 해제 — 리스크 계산기를 접어 공간을 비우고 구루 신호 카드가 풀폭 차트를 갖도록) | `PortfolioContext`, `useGlobalPeriodDays`, `GoldPremiumWidget`, `MarketDistributionBanner`, `RiskCalculatorCard`, `GuruSignalCard` |
| `PortfolioView.tsx` | 포트폴리오 탭 | `PortfolioContext`, `PortfolioTable` |
| `AnalyticsView.tsx` | 수익 통계 탭 | `PortfolioContext`, `useGlobalPeriodDays` |
| `WatchlistView.tsx` | 관심종목 탭 | `PortfolioContext`, `WatchlistPage` |
| `InvestmentGuideView.tsx` | 투자 가이드 탭. **첫 섹션 `inbox`('지식 인제스트')에 `KnowledgeInboxPanel`(승인 큐) 장착** — 나머지 섹션(매매시그널/MA/RSI/필터/실전/원칙)은 정적 교육 UI. **`SECTIONS`에 항목 추가 시 `Icons`/`SECTION_COLORS`(Record<SectionId>)도 동기 필요** (안 그러면 타입 에러). **콘텐츠 정합 가드레일**: ① 골든/데드크로스 **스마트필터 칩**은 상태 판정(shortMA><longMA)이라 설명도 상태 기반으로("어제→오늘 전환" 식 이벤트 표현 금지, 교차 시점은 `CrossDaysBadge` 경과일로). **단 데드크로스 알림 프리셋**(`dead-cross` 룰)은 `maxLookbackTradingDays`(≤252거래일) 최근 교차를 추가 확인 → 그 브리핑 카피는 "최근 1년 내 교차"가 정확(골든크로스 룰은 룩백 없어 순수 상태). ② 매수 시나리오 카드는 지식 DB **물타기 금지 원칙**(`knowledgeBase.legacy` '물타기 절대 금지')과 충돌 금지 — 손실 종목 추가매수 권고 금지. ③ RSI 카드/설명은 **단독 매수·매도 권고 금지**(지식 DB 'RSI 단독 판단 금지' = 보조 지표) — 추세(이평선) 동반 판단 명시 | `KnowledgeInboxPanel` |
| `SignalReplayView.tsx` | **"신호 리플레이" 탭** (신규 `'replay'` 탭) — 구루 신호를 과거 종목에 대입해 매수/매도 타이밍 검증(1차 연구도구). 종목 picker(보유/관심 퀵픽 + 검색) + 모드 토글(replay 미래가림/review 복기) + 윈도 + 전용 차트(`SignalReplayChart`: 외부 OHLCV 주입·자체 fetch/오늘현재가 없음·replay 모드 asOf 이후 가림·`createSeriesMarkers` 마커·`subscribeClick` 이동 + **MA 오버레이 5선(MA5/20/60/120/150, 5·20은 골든/데드크로스 쌍이라 굵게)·RSI(14) 하단 보조 pane(70/30 점선 기준선)·색상 범례** + **hover 툴팁(`subscribeCrosshairMove`→`buildReplayTooltip`: 날짜·종가·등락%·OHLC·MA값/이격%·MA5vs20·RSI존·구루 신호 요약 + **배치2a: 거래량(없으면 숨김)·검증가능 가격알림 요약[규칙명 최대 3개]·내 판정 뱃지[`verdicts` prop=날짜→판정종류 맵, 타임라인 무관 별도 prop]**; 날짜→포인트 맵 O(1) 조회·같은 봉 내 이동은 위치만 갱신·**replay 모드 asOf 이후 hover 차단=룩어헤드 0**)**, 기본 height 430) + 슬라이더/이전·다음 날·이전·다음 신호 + **구루 진단(중심): `describeRuleStatus` + leaf별 실제값/기준/통과 + 근접도(boundaryDistance)로 "왜 떴나/왜 안 떴나"** + 신호 후 성과(5/20/60일·최대상승/하락) + **가격기반 알림 진단(`AlertRuleRow`)**: 활성 규칙을 `classifyReplayAlertScope`로 분리 — **verifiable는 필터별 실제값/기준값 + `describeAlertRuleStatus` 상태(발화 근접 순 정렬)로 "왜 떴나/안 떴나" 상세**, **holding/server 의존은 "리플레이 검증 불가" 섹션으로 분리**(발화/미충족 신뢰 금지·'놓친 매도' 오태깅 방지). 자동 팝업 경로가 이쪽임을 안내(검증 무게중심). 꺼진 규칙은 제외 + **P2 판정 패널(`ReplayVerdictPanel`)·사례 패널(`ReplayCasesPanel`)** + **P3 샌드박스 패널(`ReplaySandboxPanel`)** + **③ 규칙별 성과 패널(`ReplayPerformancePanel`)** + **④ 놓친 매수/매도 모아보기(`ReplayMissedPanel`, onJump=현재종목 selectDate/퀵픽 selectSymbolAtDate)** + **⑤ 검증 기록 백업 바**(내보내기 `exportReplayRecords` / 가져오기 file input→`importReplayRecords`, 병합 건수 안내) + 시점 네비바 판정 뱃지(`VERDICT_KIND_LABELS`). **사례·모아보기·백업은 종목 미선택 상태에서도 항상 노출**(성과 패널은 선택+타임라인 시). 면책: "현재 활성 규칙을 과거 가격에 재적용·실제 발송 알림 아님". **라이브 구루 신호/기존 알림 불변** | `useSignalReplay`, `components/replay/{SignalReplayChart,ReplayVerdictPanel,ReplayCasesPanel,ReplaySandboxPanel,ReplayPerformancePanel,ReplayMissedPanel}`, `guruDiagnostics`(describeRuleStatus), `alertDiagnostics`(describeAlertRuleStatus), `replayEval`(classifyReplayAlertScope), `chartFormat`, `PortfolioContext` |
| `replay/ReplayVerdictPanel.tsx` | **신호 사용자 판정 입력 패널(P2, 렌더 전용)** — 선택 시점에 6종 판정(`VERDICT_KIND_LABELS`: 적절함/너무 빠름/너무 늦음/잘못된 신호/놓친 매수/놓친 매도) + 메모 + 저장/수정/삭제. **판정 대상 `<select>`**: "날짜 전체"(ruleId 없음) / 그 날 평가된 특정 구루 규칙(ruleId, `ruleOptions`) → 같은 날 규칙별 "이 규칙은 너무 늦다" 피드백 가능. 날짜 변경 시 대상=날짜전체 초기화, (date,target) 기존 판정으로 폼 동기화(useMemo+useEffect). 신호 없는 날엔 "놓친 매수/매도" 힌트. 하단 **이 종목 판정 목록**(규칙별은 `ruleTitleById` 라벨, 클릭 시 날짜 점프). 저장 로직은 훅(`onSet/onClear`에 ruleId 전달) | `types/signalReplay`(SignalVerdict/Kind) ← `SignalReplayView` |
| `replay/ReplayCasesPanel.tsx` | **검증 사례 패널(P2, 렌더 전용)** — caseRole 토글(연구용/검증용 holdout) + 메모 + "현재 화면 저장"(`canSave`=타임라인 존재 시) / 사례 목록(종목·기간·역할 뱃지·신호일수·평균20일후·판정수·메모, **재실행/삭제**) / **재실행 비교 diff**(comparingCase 활성 시 added/removed 신호일 전체+규칙별, 변화없음=동일재현 안내, "비교 종료") + **P3-④ holdout 과적합 경고**(holdout 사례 재실행 중 신호 변화 시 "규칙을 맞추지 말 것" amber 배너). 모든 동작은 훅 콜백 | `types/signalReplay`(VerificationCase/ReplayCaseRole), `utils/replayCases`(CaseDiff 타입) ← `SignalReplayView` |
| `replay/ReplaySandboxPanel.tsx` | **규칙 샌드박스 패널(P3, 렌더 전용)** — 시드 signal 규칙별 leaf를 `describeRuleLeaves`로 렌더: **single=숫자 입력 / between=min~max 입력 2개 / fixed(문자열·in·crosses)=값 read-only**, on/off 토글(**마지막 활성 leaf off는 `wouldKeepActiveLeaf`로 차단**), leaf/규칙/전체 초기화. 상단 **기준 대비 변화**(`sandboxDiff` added/removed 신호일). 면책: 라이브·저장규칙 불변·방향변경 P4. 계산/가드는 `utils/ruleSandbox`(순수), 저장은 훅 콜백 | `utils/ruleSandbox`(describeRuleLeaves/wouldKeepActiveLeaf), `conditionDescribe`(metricLabel), `utils/replayCases`(CaseDiff), `types/{knowledge,signalReplay}` ← `SignalReplayView` |
| `replay/ReplayPerformancePanel.tsx` | **규칙별 성과 표(③, 렌더 전용)** — `computeSignalPerformance` 결과를 표로: 규칙(구루/알림·매수/매도 뱃지)·발화수·**적중률(20일, 괄호=표본수)**·평균20일수익·평균최대상승/하락. 빈 윈도면 안내. 복기 성과(미래 종가 기반) 명시 | `utils/replayPerformance`(SignalPerformance 타입) ← `SignalReplayView` |
| `replay/ReplayMissedPanel.tsx` | **놓친 매수/매도 모아보기(④, 렌더 전용)** — 전 종목 `missed-buy`/`missed-sell` 판정을 **종목별 그룹**(건수 많은 순)으로. 행 클릭=현재 종목이면 날짜 점프, 퀵픽(보유/관심)에 있으면 종목+시점 점프(`onJump`), 둘 다 아니면 "점프 불가" 비활성. 라벨은 `VERDICT_KIND_LABELS` 재사용. 데이터=훅 `missedVerdicts` | `ReplayVerdictPanel`(VERDICT_KIND_LABELS), `types/signalReplay`(SignalVerdict) ← `SignalReplayView` |

> 설정 탭은 `components/SettingsPage.tsx`가 래핑하며 5개 섹션으로 구성: `DisplaySettingsSection` (표시 옵션), `AiSettingsSection` (Gemini BYOK 키·모델 입력 — `services/geminiSettings` 사용, 키는 localStorage 전용·동기화 미포함, 모델은 실사용 가능 목록 동적 선택), `AlertSettingsPage` (알림), `BackupSettingsSection` (백업), `CategorySettingsSection` (카테고리 관리)

### components/knowledge/ (구루 지식 DB)
| 파일 | 책임 | 의존 |
|------|------|------|
| `KnowledgeInboxPanel.tsx` | 지식 인제스트 승인 큐 UI(렌더 전용) — 큐 파일 불러오기 / 후보 카드(주장·규칙, 분류사유·dedup·confidence) / 승인·보류 버튼 / 규칙은 `checkRule` 차단사유 표시·`신호로 활성화`는 promote 통과 시만 활성. 로직은 `useKnowledgeInbox` 위임 | `useKnowledgeInbox`, `types/knowledge` |

### components/common/ (공용 컴포넌트)
| 파일 | 책임 | 의존 |
|------|------|------|
| `PeriodSelector.tsx` | 글로벌 기간 선택 버튼 (금월/전월/1개월/3개월/6개월/1년/2년/전체, 8개 옵션) | `types/store` (`GlobalPeriod`) |
| `ActionMenu.tsx` | Portal 기반 액션 메뉴 — 데스크탑: `createPortal`로 body에 드롭다운 렌더링(공간 부족 시 위로 열림), 모바일(<768px): 바텀시트 | `react-dom/createPortal` |
| `AlertPopup.tsx` | "오늘의 투자 브리핑" **플로팅 패널** (데스크탑: `fixed bottom-4 right-4 w-96`, 모바일: `left-4 right-4 w-auto`). severity별 스타일, **매도/매수 섹션 분리** + **종합 리스크 매트릭스 배너 섹션**(매도/매수 위, `riskMatrix.length>0`일 때만). 표 형식(종목·당일·수익률·RSI 컬럼). 리스크 배너: `RISK_TIER_STYLES`로 RED(🔴 강한 위험 · 정리 검토 — 단정 표현 '전량 매도/탈출' 지양, riskMatrix는 예측 아닌 경고)/AMBER(🟡 비중 축소)/BLUE(🔵 신규 진입 금지/관찰) 그룹 렌더 — 종목별 reasons("클라이맥스 N/3 · 디스트리뷰션 N일")와 함께. 배너 하단에 "참고용 경고이며 투자자문이 아닙니다" 면책. **`riskMatrix: RiskMatrixRow[]` prop 필수**. `onAssetClick(assetId, source?)`. **P4.5 D1**: distribution-high 룰 카드 특수 처리 — 신규 자산 위로/지속 자산 아래로 정렬, 카드 헤더에 "신규 N건 · 지속 M건" 표시, 자산명 옆 `TIER_NEW_STYLES`/`TIER_ONGOING_STYLES` 뱃지(3=노랑/주의, 4=주황/약세, 5=빨강/위험, ongoing=회색+행 opacity 60%). 다른 룰은 distributionTier 없음 → 뱃지 미표시. **P5 UX 카피**: `hasResults`일 때 패널 하단에 스크롤되지 않는 고정 footer (`shrink-0` + `border-t`) — "징후 ≠ 방아쇠" 안내 ("과열 상태 알림이지 폭락 시점 예측이 아닙니다"). **항목 타이틀 툴팁(초보 설명)**: 섹션 제목(과열경고/매도/매수)·리스크 티어 뱃지·규칙 카드 제목(`rule.name`, `BRIEFING_RULE_TOOLTIPS[rule.id]`)·표 컬럼 헤더(종목/당일/수익률/RSI) 모두 `common/Tooltip`(`wrap`, `cursor-help`)으로 hover 설명 — 텍스트는 `constants/briefingDescriptions.ts`. `renderSection`은 `tooltip` 인자(5번째) 수신 | `types/alertRules`, `utils/riskMatrix`, `utils/distributionTierState` (타입만), `constants/briefingDescriptions`, `common/Tooltip` |
| `MemoEditPopup.tsx` | 범용 메모 편집 팝업 — Portal 기반(`document.body`), Ctrl+Enter 저장, Esc 닫기, 미저장 변경 `confirm` 보호. Props: `title`, `memo`, `onSave(memo)`, `onClose`. 포트폴리오(`PortfolioTable`)와 관심종목(`WatchlistPage`) 양쪽에서 사용 | `react-dom/createPortal` |
| `MemoTooltip.tsx` | 메모 전용 마우스 추적 툴팁 — Portal 기반(`document.body`), 마우스 커서 추적(`onMouseMove`), `maxWidth: 500px`, 뷰포트 경계 자동 반전. `Tooltip.tsx`와 독립된 별도 컴포넌트 | `react-dom/createPortal` | `PortfolioTableRow`, `WatchlistPage` (메모 표시) |
| `UpdateStatusIndicator.tsx` | 시세 업데이트 상태 인라인 표시 — 탭바 우측에 배치. 로딩 중: 스피너+파란색 텍스트, 완료: 체크마크+초록색 텍스트(5초 후 소멸), idle: null 반환. **성공 메시지는 플로팅 토스트가 아닌 이 컴포넌트로 표시** (에러는 기존 플로팅 토스트 유지) | `PortfolioContext` (`status.isLoading`, `status.successMessage`) | `App.tsx` (탭바 영역) |
| `Toggle.tsx` | 토글 스위치 | - |
| `PositionSizingCalculator.tsx` | **리스크 기반 포지션 사이징 공용 계산기 (프레젠테이션)**. 계산은 `utils/positionSizing.calculatePositionSize`에 위임, 입력/결과 렌더만 담당. **배치 B(매수 모달 2종)·배치 C(`RiskCalculatorCard`) 공유**. Props: `totalEquityKRW`(총자산 KRW), `currency`(진입가/투자금액 통화), `exchangeRates`, `entryPrice`(number=외부 매수가 동기/null=자체 입력), `allowFractional`, `editableEquity`(총자산 직접 수정), `onApplyQuantity?`(있으면 "이 수량 적용" 버튼). 총자산은 KRW→`currency`로 `resolveRate` 환산 후 계산(환율 없으면 안내). 허용손실 프리셋(0.5/1/2%)·손절폭 프리셋(−5/−8/−10%), `capped` 시 경고. 하단 `<details>`로 지식 근거(`getPositionSizingBasis()`) + 면책 노출 | `utils/positionSizing`, `utils/exchangeRateCache`(resolveRate), `constants/knowledgeBase`(getPositionSizingBasis), `Currency`/`CURRENCY_SYMBOLS`/`ExchangeRates` |
| `Tooltip.tsx` | 범용 hover 툴팁 — **Portal 기반(`document.body`)**. hover/focus 시 trigger의 `getBoundingClientRect()`로 좌표 계산 후 `fixed z-[9999] pointer-events-none`로 렌더 → 테이블 `overflow-hidden`/sticky 헤더 stacking 컨텍스트에서 탈출(위 행/헤더에 가려지지 않음). `position` 4방향(top/bottom/left/right, `transform`으로 정렬) + 화살표, 표시 중 `scroll`(capture)/`resize` 시 자동 닫힘. wrapper는 `inline-flex` 유지(우측 정렬 의존). Props: `content`, `children`, `position`, `className`, `maxWidth`(기본400), `wrap`. 메모 이외 용도에 사용 | `react-dom/createPortal` |
| `ChartViewerModal.tsx` | 개별 차트 전체화면 뷰어 — `createPortal`(document.body)로 `AssetTrendChart`를 `fillParent`로 크게 렌더. Esc·백드롭 클릭 닫기, 열린 동안 body 스크롤 잠금, 우상단 X 닫기 버튼. Props: `AssetTrendChartProps` + `onClose`. **포트폴리오 테이블/모바일카드/관심종목(테이블·모바일카드)/구루 신호 엔진 카드 5곳 공용** — "차트 확대" 메뉴 또는 인라인 차트 헤더의 ⤢ 아이콘(`onExpand`)으로 호출. `useHistoricalPriceData` 모듈 캐시(10분 TTL) 덕에 인라인 차트 본 종목은 재fetch 없음 | `react-dom/createPortal`, `AssetTrendChart`, `lucide-react`(X) |
| `MarketDistributionBanner.tsx` | (components/ 루트, common/ 아님) 대시보드 최상단 시장 디스트리뷰션 배너. `useMarketDistributionDays`에서 데이터 수신, severity≠'safe'인 지수만 렌더 (count 3=노랑 attention, 4=주황 warning, 5+=빨강 exit). 모든 지수 safe면 `null` 반환(미렌더, 노이즈 차단). 등급 라벨 뱃지에 `ⓘ` + `Tooltip`(`BANNER_TOOLTIP` 상수, 산식·단계·면책 설명) 부착. 하단 면책 "참고용 경고이며 투자자문이 아닙니다" | `useMarketDistributionDays`, `Tooltip` |

### components/ (알림 설정)
| 파일 | 책임 | 의존 |
|------|------|------|
| `AlertSettingsPage.tsx` | 설정 탭 — 알림 규칙별 활성/비활성 토글, 임계값 인라인 편집, 자동 팝업 on/off. **P5 UX 카피**: 헤더 바로 아래에 "징후 ≠ 방아쇠" 안내 박스 (amber-950/30 bg) — "이 신호들은 과열 상태를 알리는 것이지 폭락 시점을 정확히 예측하지 않습니다 / 분할매도·비중조절 참고로만 사용하세요" 명시하여 사용자 과신 방지. `renderRuleCard()`는 `config.<key> !== undefined && (...)` 패턴으로 조건부 인풋 렌더. **`updateRuleConfig` 시그니처는 `value: number \| boolean`** (boolean 토글 지원). 지원 키: `lossThreshold`, `maShortPeriod`(5/10/20/60), `maLongPeriod`(**20/60/120/150/200**), `dropFromHighThreshold`, `profitTargetThreshold`, `dailySurgeThreshold`, `maCrossPeriod`(20/60/120/150/200), `dailyCrashThreshold`, `withinDays` (0~30, 이벤트형 필터), `maxLookbackTradingDays` 셀렉트(22/66/132/252거래일). **클라이맥스 임계값 3개 + 게이팅 토글 2개**: `climaxFlagsRequired`(1~3), `climaxSlopeMultiplier`(1~10, step 0.5), `climaxAtrMultiple`(1~5, step 0.5), **`climaxRequireBullishCandle`(boolean 토글, 양봉 동반 강제)**, **`climaxRequireLongTrendUp`(boolean 토글, MA60 +10% 우상향 전제 강제)**. **디스트리뷰션 임계값 3개**: `distributionWindow`(5~30일), `distributionVolumeRatio`(1~3, step 0.1), `distributionThreshold`(1~15일). **클라이맥스/디스트리뷰션 룰 제목 옆 + 임계값 라벨 옆에 lucide `Info` 아이콘 + `Tooltip` 표시** (`RULE_SUMMARY_TOOLTIPS` 맵 + 모듈 내 `FieldLabel` 헬퍼 컴포넌트). 새 임계값/토글 추가 시 동일 패턴 적용 — 설명 텍스트만 추가, 계산 로직과 무관. **5B-① "🔍 왜 이 알림이 안 떴나요?" 토글**(`showDiagnostics`) → 자동팝업 토글 아래·규칙 목록 위에 `AlertDiagnosticsPanel` 표시. **② 민감도 빠른 설정**(자동팝업 토글 아래·진단 토글 위): 모듈 내 렌더 전용 `SensitivityControl`(둔감/기본/예민 세그먼트 + '지금 할 행동' 5줄 포맷[결론/이유/행동/되돌리기/데이터], `PLAN_FIELDS` 상수) 2개(매도/매수 독립). `applyPreset(action, level)`=`applySensitivityPreset`(순수)→`actions.updateAlertSettings`(localStorage 영속). 현재 단계 표시는 `detectSensitivityLevel`(렌더 파생, 일치 단계 없으면 '사용자 지정' 뱃지+직접 조정 안내), 설명은 `describeSensitivityPlan`. **비파괴**(임계값만 일괄 조정, 규칙 삭제·enabled 변경 없음 — 규칙별 인라인 편집은 그대로 유지) | `PortfolioContext` (`ui.alertSettings`, `actions.updateAlertSettings`), `constants/alertRules`, `utils/alertSensitivity`, `types/alertSensitivity`, `AlertDiagnosticsPanel`, `lucide-react`(Info), `common/Tooltip` |
| `DisplaySettingsSection.tsx` | 설정 탭 — **소액 자산 숨김 임계값** 편집 (KRW 직접 입력 + 빠른 설정 5개 프리셋: 50만/100만/300만/500만/1,000만). `actions.setLowValueThreshold` 호출 → `localStorage('asset-manager-low-value-threshold')` 영속. **차트 이동평균선(MA) 6슬롯 설정** — 슬롯별 기간(일) 입력 + 표시/숨김 토글 + "기본값 복원". `actions.setChartMAConfigs(configs)`/`resetChartMAConfigs()` 호출. 라벨에 "알림·스마트필터 MA와 별개" 명시 (차트 표시 전용) | `PortfolioContext` (`ui.lowValueThreshold`/`ui.chartMAConfigs`, `actions.setLowValueThreshold`/`setChartMAConfigs`/`resetChartMAConfigs`) |

### components/ (관심종목 모달)
| 파일 | 책임 | 의존 |
|------|------|------|
| `WatchlistAddModal.tsx` | 관심종목 추가 모달. **키리스 검색**(`symbolListService.searchSymbols`)이 기본, 실패 시 `searchError`로 사유 표시. 검색 패널(`showSearchPanel`): 결과 리스트 + "✏ 티커로 직접 추가"(`handleManualAdd` — **`validateTicker`로 시세 검증 후에만 확정**, 실패 시 searchError) + **키 있을 때만** "✨ AI로 더 찾기"(`handleAiSearch`→`searchSymbolsAI` 결과 병합) | `symbolListService`(searchSymbols/validateTicker), `geminiService`(searchSymbolsAI), `geminiSettings`(getGeminiApiKey), `PortfolioContext` (`addWatchItemOpen`, `addWatchItem`) |
| `WatchlistEditModal.tsx` | 관심종목 수정/삭제 모달 (티커 재검색은 `symbolListService.searchSymbols` 키리스) | `symbolListService`, `PortfolioContext` (`editingWatchItem`, `updateWatchItem`, `deleteWatchItem`) |
| `WatchlistPage.tsx` | 관심종목 테이블 — **데스크탑/모바일 뷰 분기**: `hidden md:block`(테이블) / `block md:hidden`(카드 뷰, `WatchlistMobileCard`). 행별 액션 메뉴 + 차트 확장, 종목명 hover 시 메모 툴팁, 전용 시세 업데이트 버튼. 📝 아이콘 클릭 시 `MemoEditPopup` 팝업 열림 (`memoEditItem: WatchlistItem | null` 로컬 상태). `usePortfolio()` 직접 사용 — `ui.focusedWatchItemId` + `actions.setFocusedWatchItemId`로 브리핑 패널 클릭-투-포커스 구현 (차트 자동 펼침). **테이블에 새 기능 추가 시 `WatchlistMobileCard`에도 반영 필요** | `AssetTrendChart`, `MemoTooltip`, `MemoEditPopup`, `WatchlistMobileCard`, `PortfolioContext` (`actions` + `ui`), `onRefresh` prop from `WatchlistView` |

### components/watchlist/
| 파일 | 책임 | 의존 |
|------|------|------|
| `WatchlistMobileCard.tsx` | 관심종목 모바일 카드 뷰 — 종목명+현재가+어제대비+고가대비를 카드 형태로 표시, 탭하면 차트 펼침, 관리 메뉴는 `ActionMenu`(바텀시트). 체크박스로 선택, ★ 핀, 📝 메모 아이콘 클릭 시 `onMemoEdit` 콜백. `PortfolioMobileCard`와 동일 패턴 | `ActionMenu`, `MemoTooltip`, `AssetTrendChart` |

> `WatchlistView.tsx`에서 세 컴포넌트를 함께 렌더링

### components/ (핵심 테이블/차트)
| 파일 | 책임 | 의존 |
|------|------|------|
| `PortfolioTable.tsx` | 포트폴리오 메인 테이블 — 정렬, 검색, 스마트 필터, 핀 필터, **소액 자산 숨김 토글**, **더보기(추가 컬럼) 토글**, 메모 편집 통합. `memoEditAsset` 로컬 상태 관리. 프리셋 버튼으로 AlertRule→SmartFilterState 변환. `onRefreshSelected`(선택 업데이트 버튼)·`onRefreshOne`(개별 행 전달) props 수신. **헤더 우측 토글 그룹**: [소액 숨김] [더보기(데스크탑만)] [프리셋] [카테고리(데스크탑만)]. 소액 숨김 토글은 `ui.lowValueThreshold` 미만 자산을 `filteredAssets`에서 제외 (★ 핀 고정 자산은 예외로 항상 표시). 토글 상태는 `localStorage('asset-manager-hide-low-value')`/`localStorage('asset-manager-portfolio-show-more')`에 영속 | `portfolio-table/*`, `SmartFilterPanel`, `MemoEditPopup`, `PortfolioContext` |
| `AssetTrendChart.tsx` | **Lightweight Charts (Canvas)** — 가격 **LineSeries 또는 CandlestickSeries**(라인/캔들 토글) + MA 오버레이 + 거래량 HistogramSeries + 매수평균선(createPriceLine, `autoscaleInfoProvider`로 Y축 범위에 매수가 포함 보장, 라인/캔들 공통). **캔들 색은 한국식**(양봉=상승=빨강 `#F23645`, 음봉=하락=파랑 `#2962FF`), 거래량 막대도 봉 방향 색 분기. **OHLC 미수신 시 캔들→라인 자동 폴백**(`canShowCandle`/`effectiveChartType`), "캔들 데이터 없음" 안내. **오늘 현재가 오버레이는 캔들의 close만 갱신**(high/low 포함 확장). **MA 설정은 Context(`ui.chartMAConfigs`) 사용** — 칩 토글은 `actions.setChartMAConfigs`로 슬롯 `id` 기준 변경(설정 페이지에서 바꿔도 즉시 반영). 차트타입/VOL 토글은 localStorage 영속(`asset-manager-chart-type`/`-show-volume`, 모달이 마운트 시 동일 설정 상속). **`fillParent` prop**(true=부모 높이 채움, 풀스크린 모달용 / false=고정 280/220px 인라인). **`onExpand` prop**(전달 시 헤더에 lucide `Maximize2`(⤢) 아이콘 노출 → 전체화면 콜백, `fillParent=true`면 미노출 → 모달 내부 중복 방지). 차트 인스턴스 재생성 deps에 `effectiveChartType` 포함. 데이터 cutoff 없이 전체 로드 → `setVisibleRange()`로 초기 뷰만 제한. PC: `wheel` `passive:false`로 부모 스크롤 차단. 모바일: `touch-action:pan-y`. ResizeObserver 반응형. 커스텀 HTML 툴팁(subscribeCrosshairMove, 라인=value/캔들=close 분기) | `useHistoricalPriceData`(OHLC), `maCalculations`(`calculateSMA`), `PortfolioContext`(`ui.chartMAConfigs`/`actions`), `PortfolioSnapshot`. **`AssetTrendChartProps` export**(`ChartViewerModal` 재사용) |
| `SellAnalyticsPage.tsx` | 매도 기록 분석 대시보드 (기간별 집계, 카테고리 필터). `sellHistory[]`와 `asset.sellTransactions[]` 합산 시 `id` 기반 중복 제거. **모바일 대응**: 필터 `flex-col sm:flex-row`, 프리셋 버튼 `overflow-x-auto`, 차트 `h-72 sm:h-96`, 매도 기록 테이블 4컬럼(티커/수량/매도금액/매수금액) `hidden sm:table-cell`. **매도 기록 테이블 우측 "관리" 컬럼**: 행별 편집 버튼 → `actions.openEditSellRecord(record)`로 `EditSellRecordModal` 열기 | `SellRecord`, `CategoryDefinition`, Recharts, `PortfolioContext` |
| `PortfolioAssistant.tsx` | AI 어시스턴트 FAB + 채팅 패널 (Gemini 스트리밍 응답). **마크다운 렌더링은 `rehypeRaw` 미사용 — AI 응답의 raw HTML을 비활성화하여 XSS 방지 (재도입 금지, 필요 시 `rehype-sanitize` schema 동반)** | `geminiService`, `PortfolioContext.derived.enrichedMap` |

### components/ (자산/매도 CRUD 모달)
| 파일 | 책임 | 의존 |
|------|------|------|
| `AddNewAssetModal.tsx` | 새 자산 추가 모달 (심볼 검색, 카테고리 추론, 중복 검사). **키리스 검색**(`symbolListService.searchSymbols`)이 기본, 실패 시 `searchError`로 사유 표시. 검색 패널(`showSearchPanel`): 결과 리스트 + "✏ 티커로 직접 추가"(`handleManualAdd` — **`validateTicker`로 시세 검증 후에만 확정**, 실패 시 searchError) + **키 있을 때만** "✨ AI로 더 찾기"(`handleAiSearch`→`searchSymbolsAI` 결과 병합). **배치 B**: 매수일자 아래에 `PositionSizingCalculator`(진입가=매수가, 통화=선택 통화, 암호화폐면 소수 허용) → "이 수량 적용"으로 수량 자동 입력. **자산 구분 아래에 전략 버킷 토글(코어/투더문)** — 기본 코어, onAddAsset 페이로드에 `bucket` 전달 | `symbolListService`(searchSymbols/validateTicker), `geminiService`(searchSymbolsAI), `geminiSettings`(getGeminiApiKey), `PortfolioContext`, `CategoryDefinition`, `PositionSizingCalculator`, `types/bucket` |
| `EditAssetModal.tsx` | 자산 편집 모달 (isDirty 닫기 보호 적용, 티커 재검색은 `symbolListService.searchSymbols` 키리스). **전략 버킷 토글(코어/투더문) 포함** — `getAssetBucket`로 현재값 표시, isDirty 비교에 버킷 변경 포함 | `symbolListService`, `PortfolioContext`, `CategoryDefinition`, `types/bucket` |
| `BuyMoreAssetModal.tsx` | 추가 매수 모달 (수량, 단가, 날짜). 암호화폐 보유수량 소수점 표시. **배치 B**: 매수 수량 아래에 `PositionSizingCalculator`(진입가=매수가, 통화=`asset.currency`) → "이 수량 적용"으로 수량 자동 입력 | `PortfolioContext`, `Currency`, `isBaseType`, `formatQuantity`, `PositionSizingCalculator` |
| `SellAssetModal.tsx` | 매도 모달 (부분/전량 매도). 암호화폐: `min=0.00000001` (소수점 매도 허용), 보유수량 소수점 표시 | `PortfolioContext`, `Currency`, `isBaseType`, `formatQuantity` |
| `EditSellRecordModal.tsx` | 매도 기록 편집/삭제 모달. `modal.editingSellRecord`로 활성화 (`SellAnalyticsPage` "관리" 컬럼 ✏️에서 호출). 편집 필드: 매도일자 / 매도가(정산통화) / 매도수량. **원본 자산이 이미 삭제된 경우 수량 변경 시 경고**(보유수량 자동 복구 안 됨). 매도일 변경 시 해당 일자 환율 재조회(USD>3000 등 상한 보정). 좌측에 별도 **삭제** 버튼, `confirm` 다이얼로그 보호 | `PortfolioContext`, `SellRecord`, `Currency`, `CURRENCY_SYMBOLS` |
| `BulkUploadModal.tsx` | CSV 일괄 업로드 모달 (검증, 안내, 결과 표시) | `PortfolioContext`, `CategoryDefinition` |
| `DataConflictModal.tsx` | 로컬/Drive 데이터 충돌 해결 모달 (버전 선택) | `Asset` (순수 프레젠테이션) |

### components/ (공통 UI 부품)
| 파일 | 책임 | 의존 |
|------|------|------|
| `Header.tsx` | 상단 바 — 저장, 가져오기/내보내기, CSV, 일괄 업로드, 자산 추가 버튼 | 콜백 기반 (props) |
| `ExchangeRateInput.tsx` | USD→KRW, JPY→KRW 환율 입력 폼 | `ExchangeRates` |
| `StatCard.tsx` | 대시보드 메트릭 카드 (제목, 값, 색상) | React |

### components/dashboard/ (대시보드 하위 컴포넌트)
| 파일 | 책임 | 의존 |
|------|------|------|
| `DashboardStats.tsx` | 4대 지표 카드 (총 평가액, 총 투자액, 손익, 수익률) | `StatCard` |
| `DashboardControls.tsx` | 카테고리 필터 드롭다운 + 환율 입력 | `ExchangeRateInput`, `getAllowedCategories` |
| `AllocationChart.tsx` | 카테고리별 자산 배분 파이 차트 | `Asset`, `ExchangeRates`, `getCategoryName`, Recharts |
| `CategorySummaryTable.tsx` | 카테고리별 합계/수익률/비중 테이블 | `Asset`, `ExchangeRates`, `getCategoryName` |
| `ProfitLossChart.tsx` | 포트폴리오 손익 추이 라인 차트 (자산 필터 지원, `globalPeriod`/`onPeriodChange` props로 PeriodSelector 내장) | `Asset`, `PortfolioSnapshot`, `GlobalPeriod`, `PeriodSelector`, Recharts |
| `RebalancingTable.tsx` | **2단 리밸런싱 표** — ① 전략 배분(코어 vs 투더문) ② 코어 자산배분(카테고리별, 코어 합계 기준) ③ 투더문 현황(위성 보유 종목 참고, 합산 한 덩어리). 공용 `TierTable` 서브컴포넌트로 ①②를 렌더(목표비중 입력·합계·편차 색상), 목표총액 입력·저장은 공유. `useRebalancing` 반환의 `bucket`/`core`/`satelliteHoldings`/`hasSatellite` 사용 | `useRebalancing`, `PortfolioContext`, `utils/bucketRebalancing`(RebalanceRow) |
| `TopBottomAssets.tsx` | 수익률 상위/하위 5개 종목 리스트 | `useTopBottomAssets`, `PortfolioContext` |
| `GoldPremiumWidget.tsx` | 금 김치 프리미엄 표시 위젯 (KRX vs COMEX 비교) | `useGoldPremium`, `PortfolioContext` |
| `GuruSignalCard.tsx` | **⑤ 가시화** — 대시보드 "구루 신호 엔진" 카드(풀폭, `DashboardView`에서 단독 스택). **좌(신호 리스트)/우(선택 종목 차트) 분할**(`lg:flex`, 모바일은 차트가 리스트 아래로 쌓임). 좌측: `derived.guruSignals`를 **`groupGuruSignals`로 액션별→종목별 묶어** 렌더(같은 종목의 여러 규칙은 칩으로 한 줄 — 중복 줄 방지). 헤더 "활성 규칙 N개 평가" + "{종목수}개 종목·{신호수}개 신호" 요약, 그룹별 종목수(중복 시 신호수 병기). 종목 행: 이름/티커/관심뱃지 + 규칙 짧은라벨 칩(`RULE_SHORT_LABELS`) + "ⓘ 무효화:" 줄(rule.riskPolicy dedup) + **"왜 떴나 ▾" 토글**(행별 `explainAssetId`, 클릭 시 `stopPropagation`) → `conditionDescribe.buildSignalExplanation`로 **근거(claim statement) + 조건 자동번역("언제 뜨나") + 종목별 실제값 충족(✓/✗, `derived.enrichedMap`+chartTargets 현재가로 `buildMetricValues`) + 무효** 를 `ExplainBlock`(파일 내 렌더 전용)으로 표시. **행 클릭 → `selectedAssetId` 갱신**(선택 행 `ring-primary/60` 하이라이트), 미선택/사라진 종목이면 **우선순위 최상위(첫 그룹·첫 종목) 폴백**. 우측: `derived.guruSignalChartTargets[assetId]`로 `AssetTrendChart` 인라인 렌더(`key={assetId}`로 종목 전환 시 재마운트), ⤢는 공용 `ChartViewerModal` 전체화면. **차트 props의 source 분기 룩업은 컴포넌트가 아닌 `guruSignalEngine.buildGuruSignalChartTargets`(순수)→context derived에서 수행**(RULES: 컴포넌트는 렌더만). **폰트**: 설명/카운트류는 `text-xs`(12px), 칩·무효화·관심뱃지는 `text-[11px]`(이전 10px에서 +1px). **문구 안전장치**: 부제 "관찰 후보 · 매수 추천이 아닙니다" + 면책. 매칭 0건/활성 0개 분기. 평가·그룹핑은 `guruSignalEngine`(순수) 위임, 렌더만 담당. 현재 active+condition 4개(climax-top-sell 매도경고 + pullback/near-high/reclaim 관찰후보). rsRank 구현 시 엄격 RS 규칙 추가 확장. **헤더 "왜 신호가 안 뜨나요? ▾" 토글**(`showDiagnostics` 상태) → `GuruDiagnosticsPanel` 표시(신호 0건에도 노출, 헤더 우측 컬럼에 활성규칙 뱃지와 세로 스택) | `PortfolioContext`(derived.guruSignals/guruSignalChartTargets + data.knowledgeBase/portfolioHistory), `guruSignalEngine`(getActiveSignalRules, groupGuruSignals), `conditionDescribe`(buildSignalExplanation), `GuruDiagnosticsPanel`, `AssetTrendChart`, `ChartViewerModal`, `types/knowledge`(RuleAction) |
| `GuruDiagnosticsPanel.tsx` | **⑤ 진단 패널 (5A-⑤) — "왜 신호가 안 뜨나"**. `useGuruDiagnostics` 훅을 렌더만(프로젝트 규칙: 선택/계산/정렬은 훅, 컴포넌트는 UI). **진단 종목 `<select>`**(포트폴리오/관심종목 optgroup 분리) → 선택 종목의 **3축 요약**(활성/비활성 · 충족/미충족/판정불가 · 데이터 일부/없음/미지원[amber]) + **규칙별 행**(액션 뱃지 `RULE_ACTION_LABELS` + 제목 + `status.label`을 `TONE_CLASS`(positive/neutral/caution/muted) 색으로 + detail 부연 + "조건별 보기 ▾" 토글로 leaf별 ✓/✗/— 실제값vs기준). 신호 0건/타깃 0개에도 빈 안내 렌더. 하단 라벨 의미 범례. 모바일 세로 스택(가로 오버플로 없음, 격리 프리뷰 검증) | `useGuruDiagnostics`, `types/knowledge`(RULE_ACTION_LABELS/StatusTone/LeafExplain) |
| `AlertDiagnosticsPanel.tsx` | **알림 진단 패널 (5B-①) — "왜 이 알림이 떴나/안 떴나"**. `useAlertDiagnostics` 렌더만. **상단: 팝업 전달 상태 배너**(자동 브리핑 표시 예정/미표시 + 사유 + 발화 규칙 수 — 규칙 발화와 **직교 축으로 분리 표시**해 "규칙 미충족"과 "팝업 꺼짐/오늘 자동 확인 완료" 혼동 방지). 종목 `<select>`(보유/관심[매수규칙만] optgroup) → 규칙별 행(매도/매수 뱃지 + `status.label`을 tone 색으로 + "조건별 보기 ▾" → 필터별 ✓/✗/— 실제값vs기준, **품질 저하는 '데이터 일부'(amber)/'데이터 없음' 캐비엇**). 빈 상태/범례. 모바일 세로 스택(격리 프리뷰 검증: 가로 오버플로 없음, partial 축 노출 확인) | `useAlertDiagnostics`, `types/alertDiagnostics` |
| `RiskCalculatorCard.tsx` | **배치 C** — 대시보드 standalone "리스크 계산기" 카드(풀폭). **기본 접힘(자주 안 쓰는 도구) — 헤더 클릭 시 전개**, 펼침 상태는 `localStorage('asset-manager-risk-calc-open')`에 영속. 접힘 시 부제/통화토글/계산기 미렌더(헤더 바만, lucide `ChevronDown` 회전). `derived.totalValue`(총자산 KRW) 자동주입(수정 가능), 진입가 통화 선택(KRW/USD/JPY 토글), `entryPrice={null}`로 자체 입력 모드 → 공용 `PositionSizingCalculator`에 위임. 매수 없이 평상시 적정 수량 가늠용 | `PortfolioContext`, `PositionSizingCalculator`, `Currency`, `lucide-react`(ChevronDown) |

### components/portfolio-table/ (테이블 내부 모듈)
| 파일 | 책임 | 의존 |
|------|------|------|
| `PortfolioTableRow.tsx` | 테이블 행 렌더링 + 차트 펼침 + 브리핑 클릭-투-포커스. `usePortfolio()` 직접 사용 — `focusedAssetId`/`setFocusedAssetId`로 스크롤 이동. `onTogglePin`, `onMemoEdit`, `onRefreshOne`(ActionMenu "가격 업데이트") props 수신. **컬럼 셀은 `visibleColumns: ColumnConfig[]` prop 기반 동적 렌더** (`visibleColumns.filter(c=>c.visible).map(c => COLUMN_DEFINITIONS[c.key].renderCell(...))`). 양끝 체크박스/종목명/관리(액션)는 고정 렌더. ~~`showHiddenColumns`~~ prop 폐기됨(`visibleColumns`로 대체). 차트 펼침 행 `colSpan = totalColSpan(3 + 가시 컬럼 수)`. **GC/DC 뱃지: `gcCrossDays`/`dcCrossDays` props** (양수=GC, 음수=DC, null=미표시) — `maCrossDays` 컬럼의 `renderCell`에 전달됨 | `PortfolioContext`, `AssetTrendChart`, `ActionMenu`, `MemoTooltip`, `Tooltip`, `columnDefinitions`(COLUMN_DEFINITIONS) |
| `columnDefinitions.tsx` | 컬럼별 렌더 정의 `COLUMN_DEFINITIONS: Record<ColumnKey, ColumnDefinition>`. 각 정의에 `renderHeader(ctx)`/`renderCell(ctx)` 함수 포함. `HeaderRenderContext`(sortConfig/requestSort/toggleReturnSort/badgePairs/thClasses/SortIcon/getReturnHeaderLabel), `CellRenderContext`(asset/gcCrossDays/dcCrossDays). RSI/Volume 지표 컴포넌트도 여기 정의. `maCrossDays.renderCell`은 gc/dc props 의존 | `types/ui`(ColumnKey), `Tooltip`, `CrossDaysBadge`, `columnDescriptions`, `portfolio-table/utils`, `isBaseType` |
| `ColumnSettingsDropdown.tsx` | 컬럼 표시/순서 설정 드롭다운 (데스크탑 전용). dnd-kit 드래그앤드롭(`useSortable`) + visible 체크박스 + "기본값으로 초기화". `usePortfolio()`의 `ui.columnConfig` + `actions.setColumnConfig`/`resetColumnConfig` 사용. 양끝(종목명/관리)은 회색 `🔒` 행으로 잠금 표시(SortableContext 밖) | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `PortfolioContext`, `useOnClickOutside`, `types/ui` |
| `PortfolioMobileCard.tsx` | 모바일 카드 뷰 — 종목명+현재가+수익률+평가액+고가대비/전일대비. 탭하면 차트 펼침, 관리 메뉴는 `ActionMenu`(바텀시트). `onRefreshOne`(ActionMenu "가격 업데이트") props 수신. **GC/DC 뱃지: `gcCrossDays`/`dcCrossDays` 두 개 props** — ticker 옆에 `CrossDaysBadge` 2개 렌더. `SignalBadgeMini` 내부에 `SIGNAL_DESCRIPTIONS` + `Tooltip`으로 신호별 설명 표시 | `PortfolioContext`, `AssetTrendChart`, `ActionMenu`, `CrossDaysBadge`, `Tooltip` |
| `SmartFilterPanel.tsx` | 스마트 필터 칩 UI (22개 칩, tri-state 토글, 그룹별 색상, 칩별 `Tooltip` 설명 표시) | `types/smartFilter`, `constants/smartFilterChips`, `PortfolioContext`, `Tooltip` |
| `types.ts` | 테이블 전용 타입 (`PortfolioTableProps`, `SortKey`, `AssetMetrics`, `EnrichedAsset`) | `types/index` |
| `usePortfolioData.ts` | 자산 메트릭 enrichment (KRW 환산, 수익률, 고가대비) + 정렬/필터. GC/DC 2단계 정렬: `enrichedMap`, `badgePairs: BadgePairs` (gc/dc 각 enabled+short+long) optional props → `SortKey='maCrossDays'`로 두 페어 모두 평가 후 더 최근(절대값 작은) 신호로 정렬 (ascending=GC먼저, descending=DC먼저, null 맨 뒤). **⚠️ `hooks/usePortfolioData.ts`와 이름 겹침 주의** | `types/index`, `usePortfolioCalculator`, `useEnrichedIndicators`(타입) |
| `utils.ts` | 테이블 전용 포맷 유틸 (`formatKRW`, `formatOriginalCurrency`, `formatProfitLoss`, `getChangeColor`, `formatQuantity`, `formatNumber`). `formatQuantity(quantity, isCrypto)`: 암호화폐는 최대 소수점 8자리, 그 외 정수 표시. **⚠️ `getValueInKRW`도 export되어 있으나 미사용(orphaned) — 환율 폴백 미적용 버전이므로 신규 코드에서 쓰지 말 것. KRW 환산은 `usePortfolioCalculator.getValueInKRW`(→ `exchangeRateCache.resolveRate` 폴백) 사용** | `Currency`, `ExchangeRates` |

> **빈 스텁 파일** (미사용, 삭제 가능): `AddAssetForm.tsx`, `PortfolioModal.tsx`, `RegionAllocationChart.tsx`

### contexts/
| 파일 | 책임 | 수정 시 영향 범위 |
|------|------|------------------|
| `PortfolioContext.tsx` | 전역 상태 Provider, 모든 훅 통합. **브라우저 탭 제목 동적 변경**: `isInitializing` → "로그인 확인 중...", `isMarketLoading` → "시세 업데이트 중...", 그 외 → 기본 제목. **`useAutoAlert`에서 받은 `riskMatrix`를 `derived.riskMatrix`로 노출** — `AlertPopup`/`App.tsx`가 prop으로 소비. **구루 신호: `buildGuruSignalTargets`로 `guruSignalTargets`(포트폴리오+관심종목) useMemo 산출 → `evaluateGuruSignals`(guruSignals)와 진단 패널이 공유**, `derived`에 `guruSignals`/`guruSignalTargets`/`guruSignalChartTargets` 노출 | **전역** - App.tsx 및 모든 컴포넌트 |

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
       │                            ├─ historicalPriceService.ts (관심종목 52주 최고가 + 해외종목 전일종가 보완)
       │                            └─ patchMissingPrevClose() (해외종목 prev_close=NaN → 히스토리 API 폴백)
       ├─ useAssetActions.ts ───────┬─ priceService.ts
       │                            └─ geminiService.ts
       ├─ usePortfolioCalculator.ts ── types/index.ts
       ├─ useEnrichedIndicators.ts(assets, watchlist) ── historicalPriceService(OHLCV), maCalculations(ATR/slope/52w), constants/commodityProxyMap (거래량 프록시 fetch 통합)
       ├─ useAutoAlert.ts(watchlistItems) ──┬─ alertChecker.ts → smartFilterLogic.ts (rule matching)
       │                                    └─ utils/riskMatrix.ts (computeRiskTier → sortByRiskPriority → derived.riskMatrix)
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
              └─ 모든 fetch 완료 후
                   ├─ patchMissingPrevClose() ── 해외종목 prev_close=NaN 보완 (히스토리 API 7일)
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
                   └─ prevCloseMap 추출 → 해외종목 전일종가/changeRate 보완 (추가 API 호출 없음)
```

### 글로벌 기간 선택 흐름
```
PeriodSelector (App.tsx 탭 바 우측(데스크탑) / 탭 바 아래 별도 행(모바일) + SoldAssetsStats/ProfitLossChart 타이틀 우측)
    │
    └─ PortfolioContext.globalPeriod (THIS_MONTH/LAST_MONTH/1M/3M/6M/1Y/2Y/ALL, 기본 1Y)
         │   └─ localStorage 영속 ('asset-manager-global-period')
         │
         ├─ DashboardView → useGlobalPeriodDays(startDate+endDate) → portfolioHistory/filteredSellHistory 필터
         │    ├─ SoldAssetsStats (수익통계, PeriodSelector 내장)
         │    └─ ProfitLossChart (PeriodSelector 내장)
         ├─ AssetTrendChart → useHistoricalPriceData(displayDays) + 전체 로드 → setVisibleRange(기간)
         ├─ AnalyticsView → SellAnalyticsPage(periodStartDate, periodEndDate)
         └─ WatchlistPage → AssetTrendChart (동일)
```
- **탭 순서**: 대시보드 | 포트폴리오 | 관심종목 | 수익 통계 (4개 탭). **투자 가이드·설정**은 탭이 아닌 우측 컨트롤 영역의 아이콘 버튼(📖/⚙️)으로 배치. 가이드·설정·수익통계 활성 시 PeriodSelector 숨김
- **수익 통계 기간**: 자체 date input 삭제됨, 글로벌 기간 props로 전달받음
- **`LAST_MONTH` 기간 필터**: `endDate`가 전월 말일이므로, 기간 필터 시 반드시 `startDate`와 `endDate` 모두 적용해야 함 (startDate만 체크하면 이번 달 데이터까지 포함됨)

### 차트 데이터 흐름
```
AssetTrendChart.tsx (Lightweight Charts — Canvas 기반, 핀치 줌/드래그 팬 내장)
    │
    ├─ ticker/exchange 있는 자산 (주식, 코인 등)
    │   └─ useHistoricalPriceData.ts (항상 전체 10년 fetch, 캐시 재활용)
    │        └─ historicalPriceService.ts → /history 또는 /upbit/history
    │             ├─ historicalPrices → calculateSMA() 직접 호출 → LineSeries + MA LineSeries
    │             └─ historicalVolumes → HistogramSeries (별도 priceScale, 하단 20%)
    │                  └─ 전체 데이터 로드 → setVisibleRange(displayDays)로 초기 뷰 제한
    │
    └─ 현금 등 ticker 없는 자산
        └─ PortfolioSnapshot 기반 (폴백, 전체 로드)
```
- **차트 라이브러리**: `lightweight-charts` (TradingView 오픈소스, Canvas 렌더링). 이전 Recharts(SVG) 대비 대량 데이터 성능 우수
- **터치/마우스 인터랙션**: 핀치 줌(`handleScale.pinch`), 드래그 팬(`pressedMouseMove` + `horzTouchDrag`), 마우스 휠 줌(`handleScale.mouseWheel`). `handleScroll.mouseWheel: false` — 일반 휠은 줌 전용, 시간축 이동은 드래그로 수행. PC: **container 레벨** `wheel` 리스너(`passive:false`)로 페이지 스크롤만 차단 (document 레벨 금지 — lightweight-charts 내부 핸들러와 충돌). 모바일: 컨테이너에 `touch-action:pan-y` 설정하여 수평 터치를 차트가 처리
- **시리즈 구조**: 가격 `LineSeries` + MA별 `LineSeries` + 거래량 `HistogramSeries`(별도 `priceScaleId='volume'`, `scaleMargins: {top:0.8, bottom:0}`)
- **차트 인스턴스 생명주기**: `showVolume`, `enabledConfigs`, `displayCurrency` 변경 시 차트 재생성 (useEffect cleanup → `chart.remove()`, `hasInitializedRangeRef` 리셋). 데이터만 변경 시 `series.setData()`로 업데이트 (재생성 없음)
- **visibleRange 1회 적용 패턴**: `hasInitializedRangeRef`로 `"${assetId}-${displayDays}"` 조합당 한 번만 `setVisibleRange()` 적용. 사용자 줌/드래그 뷰를 보존하고, 기간 버튼 클릭(`displayDays` 변경) 또는 종목 변경(`assetId` 변경) 시에만 재적용. **데이터 업데이트 useEffect에서 매번 `setVisibleRange()`를 호출하면 사용자 인터랙션이 리셋되므로 금지**
- **VOL 토글**: MA 토글 영역에 거래량 표시/숨김 버튼 (기본: 표시). 토글 시 차트 인스턴스 재생성
- **매수평균선**: `purchasePrice` prop → `priceSeries.createPriceLine()` (금색 점선, 통화 토글 연동). `autoscaleInfoProvider`로 매수평균가를 Y축 범위에 항상 포함 (현재가와 괴리 시에도 보임). 관심종목은 `purchasePrice` 없으므로 자동 생략
- **커스텀 툴팁**: `subscribeCrosshairMove` → 절대 위치 HTML div (pointer-events-none). 뷰포트 경계 보정 포함
- **범례 위치**: MA 토글 칩 라인 오른쪽에 커스텀 HTML 범례 (현재가 + 활성 MA + 매수평균)
- **리사이즈 대응**: `ResizeObserver`로 컨테이너 크기 변경 감지 → `chart.applyOptions({width, height})`
- **모바일 레이아웃**: 차트 래퍼 패딩 최소화 (`pb-2`, 좌우 패딩 없음) → 가로 풀와이드

### 스마트 필터 확장 지표 흐름
```
PortfolioContext.tsx (Context 레벨에서 호출)
    │
    └─ useEnrichedIndicators.ts (포트폴리오 + 관심종목 통합 배치)
         ├─ 포트폴리오 assets + watchlistItems + 거래량 프록시 ticker (모두 중복 제거)
         ├─ historicalPriceService.ts → /history, /upbit/history (**약 440캘린더일**: `getRequiredHistoryDaysForOHLCV() = 252×1.5 + 60` — 52주 룰 + MA200 워밍업)
         ├─ maCalculations.ts → calculateSMA() (**5/10/20/60/120/150/200**)
         ├─ maCalculations.ts → calculateRSI() (14일) / calculateATR(14) / calculate52WeekHigh/MaxVolume / calculateSlopeRatio(10,60)
         ├─ 거래량 프록시 적용: VOLUME_PROXY_MAP[ticker]가 있으면 본 자산 volume을 프록시의 것으로 swap (가격은 본 자산 그대로)
         └─ 결과: Map<ticker, EnrichedIndicatorData> — `ma`/`prevMa`/`rsi`/`prevRsi`/`maCrossDays`/`prevClose`/`priceCrossMaDays`/`rsiBounceDay`/`rsiOverheatEntryDay` + OHLCV 9필드(`atr14`/`high52w`/`volume52wMax`/`slopeRatio`/`dayRangeOverAtr`/`priceIsAt52wHigh`/`volumeIsAt52wMax`/`distributionDayMeta[]`/`ohlcvAvailable`)
              ├─ PortfolioTable → smartFilterLogic.ts (스마트 필터, CLIMAX_TOP/DISTRIBUTION_HIGH 포함)
              ├─ useAutoAlert → alertChecker.ts (포트폴리오 매도/매수 + 관심종목 매수 체크) + utils/riskMatrix (티어 합성)
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
         ├─ runAlertCheck()
         │    ├─ checkAlertRules(enrichedAssets, enrichedMap, rules) — 포트폴리오 매도/매수
         │    ├─ checkBuyRulesForWatchlist(watchlistItems, enrichedMap, rules, portfolioTickers) — 관심종목 매수
         │    └─ mergeWatchlistResults() — 동일 rule.id 기준 병합, ticker 중복 제거
         ├─ riskMatrix (useMemo) — enrichedMap × enrichedAssets/watchlist → computeRiskTier → sortByRiskPriority
         │    └─ 포트폴리오에 이미 있는 ticker는 watchlist에서 중복 제외
         ├─ 결과 있으면 → AlertPopup 표시 (우하단 플로팅 패널, 리스크 매트릭스 배너가 매도/매수 위)
         └─ localStorage('asset-manager-alert-popup-date')에 오늘 날짜 기록
```
```
AlertPopup (플로팅 패널) → 종목 클릭
    │
    └─ App.tsx의 onAssetClick(assetId, source?) 콜백
         ├─ source === 'watchlist'
         │    ├─ actions.setActiveTab('watchlist')
         │    └─ actions.setFocusedWatchItemId(assetId) — WatchlistPage에서 차트 자동 펼침 + `[data-watch-id]` 기반 `scrollIntoView`(150ms 후, 보이는 뷰만 `offsetParent` 체크로 필터)
         └─ source !== 'watchlist' (기본)
              ├─ actions.setActiveTab('portfolio')   — 포트폴리오 탭 전환
              └─ actions.setFocusedAssetId(assetId)  — UIState.focusedAssetId 설정
                   └─ PortfolioTableRow.tsx (isFocused 감지)
                        ├─ setExpandedAssetId(asset.id)  — 차트 자동 펼침
                        ├─ rowRef.scrollIntoView()        — 스크롤 이동 (100ms 후)
                        └─ setFocusedAssetId(null)        — 2.5초 후 하이라이트 해제
```
```
프리셋 버튼 (PortfolioTable.tsx)
    │
    ├─ 프리셋 선택 → AlertRule.filters + filterConfig → SmartFilterState로 변환 → 스마트필터 적용
    ├─ "브리핑 다시 보기" → showBriefingPopup() (오늘 날짜 제한 무시)
    └─ "알림 설정" → setActiveTab('settings')
```
- **알림 규칙 vs 스마트 필터**: 알림 규칙은 필터를 **순수 AND** 조합 (스마트 필터의 그룹 내 OR과 다름)
- **관심종목 매수 기회 포함**: 관심종목에 대해 매수 규칙(3개)만 실행 → 포트폴리오 결과와 병합. `AlertMatchedAsset.source === 'watchlist'`로 구분, AlertPopup에서 teal `[관심]` 배지 표시. 포트폴리오에 이미 있는 ticker는 중복 방지
- **설정 저장**: `localStorage('asset-manager-alert-settings')` — Google Drive 파이프라인 미사용
- **팝업 1일 1회**: `localStorage('asset-manager-alert-popup-date')`로 중복 방지, 수동 "브리핑 다시 보기"는 제한 없음
- **플로팅 패널 위치**: `fixed bottom-4 right-4 z-[60]` — 전체화면 오버레이 없음, 포트폴리오 테이블과 동시 열람 가능
- **AI 어시스턴트 FAB 위치**: `fixed bottom-8 left-8` (브리핑 패널과 겹침 방지를 위해 좌측으로 이동)

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
| `maCalculations.ts` | `AssetTrendChart`, `useEnrichedIndicators`, `geminiService`, `tests/walkForwardBacktest.ts` |
| `useEnrichedIndicators.ts` | **`PortfolioContext`** (enrichedMap 전역 공유), `geminiService` (타입만) |
| `alertChecker.ts` | `useAutoAlert`, 프리셋 버튼 (`PortfolioTable`) |
| `constants/alertRules.ts` | `useAutoAlert`, `AlertSettingsPage` |
| `constants/commodityProxyMap.ts` | `useEnrichedIndicators` (자산 ticker에 거래량 프록시 dedup 추가 + 본 자산 volume 시계열 대체) |
| `utils/riskMatrix.ts` | `useAutoAlert` (riskMatrix 산출), `AlertPopup` (티어 배너 렌더), `types/store` (`DerivedState.riskMatrix` 타입) |
| `tests/walkForwardBacktest.ts` | 독립 실행 (`npm run backtest`). `maCalculations` + `constants/api`만 import — 프로덕션 코드 의존 최소화 |
| `tests/signalReplayParity.ts` | 독립 실행 (`npm run test:replay`, 117단언). 신호 리플레이 회귀 — **룩어헤드 방지**(full vs asOf까지 자른 시리즈 진단 동일, outcome만 상이) + `boundaryDistance`(between/음수/0) + `applyRuleOverrides`(leafId 패치·enabled=false 제거·비파괴) + `flattenLeaves` 안정 id + `buildReplayTimeline` 동작 + **마커 구루 게이팅**(markers.guruCount>0·signalDates가 구루 마커로만 뒷받침) + **P2 판정 저장**(verdictKey 키구분·upsert 수정/추가/비파괴·놓친매수 비신호일 태깅·삭제 day vs rule 분리·안전파싱) + **P2 사례**(collectPerRuleResults eligible&&matched만·computeResultMetrics avgRet20·buildVerificationCase rulesetHash 일치·**종목/기간 밖 판정 필터·규칙별 판정 보존**·diffSignalDates/diffCaseResults added/removed·upsertCase 최신우선·removeCase·parseCases 폐기) + **P3 샌드박스**(classifyLeaf single/between/fixed·describeRuleLeaves override머지·**setLeafValue/setBetweenBound 형태보존**[number/길이2배열]·**wouldKeepActiveLeaf 마지막 leaf off 차단**·단일leaf 규칙 차단·clear 복원·**setLeafEnabled 정규화**[off→on no-op override 제거·value 보존·identity]·**isBetweenInverted**·**baseline↔sandbox diff**[임계값 override로 발화 제거, added 0·subset]). 합성 OHLCV(네트워크 없음). 운영 함수만 호출(계산식 복제 금지) |
| `useGlobalPeriodDays.ts` | `AssetTrendChart`, `DashboardView`, `AnalyticsView` |
| `PortfolioContext.tsx` | `App.tsx`, 모든 Context 소비 컴포넌트 |
| `ActionMenu.tsx` | `PortfolioTableRow`, `PortfolioMobileCard`, `WatchlistPage`, `WatchlistMobileCard` (드롭다운 메뉴 사용처) |
| `MemoTooltip.tsx` | `PortfolioTableRow`, `WatchlistPage`, `WatchlistMobileCard` (메모 표시) |
| `PortfolioTableRow.tsx` 컬럼 추가 | `PortfolioMobileCard`에도 반영 필요 (데스크탑/모바일 뷰 동기화). **단, 컬럼 표시/순서 커스터마이징(`columnConfig`)은 데스크탑 전용 — 의도적 예외** (아래 "포트폴리오 테이블 컬럼 커스터마이징" 섹션 참조). 새 컬럼을 추가할 때는 `columnDefinitions.tsx`의 `COLUMN_DEFINITIONS`, `types/ui`의 `ColumnKey`/`DEFAULT_COLUMN_CONFIG`/`COLUMN_LABELS`에도 등록 필요 |
| `PortfolioTableRow.tsx` | **`usePortfolio()` 직접 사용** — `ui.focusedAssetId` + `actions.setFocusedAssetId`로 브리핑 패널 클릭-투-포커스 구현. `rowRef`(HTMLTableRowElement)로 `scrollIntoView` 수행. `onTogglePin`(★ 토글), `onMemoEdit`(메모 편집 팝업 열기), `onRefreshOne`(개별 가격 업데이트) props 수신 |
| `WatchlistPage.tsx` | **`usePortfolio()` 직접 사용** — `ui.focusedWatchItemId` + `actions.setFocusedWatchItemId`로 브리핑 패널 클릭-투-포커스 구현 (차트 자동 펼침 + 해당 행으로 `scrollIntoView`). 데스크탑 `<tr>`과 모바일 카드 래퍼 `<div>` 양쪽에 `data-watch-id={id}` 부여 → `document.querySelectorAll('[data-watch-id=…]')`로 보이는 뷰만 스크롤(`offsetParent !== null` 필터, 150ms 지연). `actions.updateWatchItem`으로 메모 저장 |
| `MemoEditPopup.tsx` | `PortfolioTable`(`memoEditAsset`)과 `WatchlistPage`(`memoEditItem`)에서 메모 아이콘 클릭 시 열림 |
| `usePortfolioCalculator.ts` | `usePortfolioStats`, `portfolio-table/usePortfolioData` (수익률/손익 계산 공유) |
| `useTopBottomAssets.ts` | `TopBottomAssets` (대시보드 상위/하위 종목 표시) |
| `portfolio-table/usePortfolioData.ts` | `PortfolioTable` — **⚠️ `hooks/usePortfolioData.ts`와 이름 겹침. 전자는 테이블 메트릭, 후자는 Drive 동기화** |
| `StatCard.tsx` | `DashboardStats` (대시보드 지표 카드) |
| `ExchangeRateInput.tsx` | `DashboardControls` (환율 입력 폼) |

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
  pinned?: boolean;              // 중요 종목 고정 (★ 토글)
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
import { createLogger } from '../utils/logger';
const log = createLogger('모듈명');

try {
  const result = await fetchSomething();
  // 성공 처리
} catch (error) {
  log.error('에러:', error);
  // 폴백 데이터 반환 또는 부분 성공 처리
  return fallbackData;
}
```

### 부분 성공 허용
- 시세 조회 시 일부 자산 실패해도 성공한 자산만 업데이트
- `isMocked: true` 플래그로 모킹 데이터 여부 표시

### 사용자 알림
- **시세 업데이트 상태**: 탭바 우측 인라인 `UpdateStatusIndicator` 컴포넌트로 표시 (플로팅 토스트 아님). 모든 업데이트 핸들러에서 "~중..." 메시지 즉시 표시 → 완료 후 5초간 "완료" 메시지 유지. **성공 메시지를 플로팅 토스트로 추가하지 말 것**
- 에러 메시지: 상단 플로팅 토스트 (`fixed top-4 left-1/2`, 닫기 버튼 포함)
- 치명적 오류: `alert()` 또는 Toast
- 경고성 오류: `log.warn()` + UI 상태 표시
- 디버그 정보: `log.debug()` (프로덕션 빌드에서 자동 억제됨)

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
- **`asset.changeRate`**: API 원본 비율값 (0.05 = 5%), **`undefined` = 데이터 없음** (0은 실제 변동 없음을 의미하는 유효값). **UI에 직접 `%` 표기 금지** (곱하기 100 누락 시 항상 0.0%로 보임). `priceService.ts`에서 API 응답에 `change_rate`/`changeRate`가 없고 `prev_close`도 없으면 `undefined` 유지. **추가 보정**: `change_rate===0 && prev_close≤0`이면 `undefined`로 리셋 (백엔드 NaN 기본값 패턴)
- **해외종목 전일종가 보완**: 백엔드가 해외종목의 `prev_close=NaN`, `change_rate=0`을 반환하는 경우, `useMarketData.ts`의 `patchMissingPrevClose()`가 히스토리 API(`/history`, 최근 7일)에서 전일종가를 가져와 `changeRate`와 `previousClosePrice`를 보완
- **`asset.metrics.yesterdayChange`**: `usePortfolioCalculator`에서 `changeRate * 100` (API 원본, `!= null`일 때 우선) 또는 `((현재가KRW - 전일종가KRW) / 전일종가KRW) * 100` (폴백: `changeRate`가 `undefined`일 때)으로 계산된 % 값. **UI 표시에는 이 값 사용**
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
- **초기화 시 갱신 실패 처리**: `googleDriveService.initialize()`는 저장된 JWT/user가 있지만 Access Token이 만료된 경우 백엔드 갱신을 시도. **갱신 실패 시 JWT/user는 localStorage에 그대로 보존하고 Access Token만 정리**. `useGoogleDriveSync` 초기화 effect가 `getCurrentUser()`로 user 존재를 감지하면 `setIsSignedIn(true) + setNeedsReAuth(true)`를 호출 → "Google Drive 로그인 필요" 화면 대신 amber 배너 표시. **이유**: 업데이트 알림에서 `window.location.replace()`로 페이지를 reload할 때 일시적 백엔드 장애로도 강제 로그아웃되는 문제 방지
- **초기화 로딩 화면**: App.tsx는 3분기 렌더링 — `isInitializing ? 로딩스피너("로그인 확인 중...") : isSignedIn ? 메인앱 : 로그인화면`. 초기화 중에는 로그인 버튼이 노출되지 않아 중복 로그인 시도 방지
- **`isInitializing` 전달 경로**: `useGoogleDriveSync` → `usePortfolioData`(`isInitializing`) → `PortfolioContext`(`isAuthInitializing` → `isInitializing`) → `App.tsx`(`status.isInitializing`). Context에서 하드코딩하지 말 것
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
- **백업 실패 시**: 앱 동작에 영향 없음 (try-catch, log.error만)
- **관련 파일**: `hooks/useBackup.ts`, `components/BackupSettingsSection.tsx`, `types/backup.ts`, `googleDriveService.ts`

### 글로벌 기간 선택기 (GlobalPeriod)
- **상태 위치**: `PortfolioContext.ui.globalPeriod` (타입: `'THIS_MONTH' | 'LAST_MONTH' | '1M' | '3M' | '6M' | '1Y' | '2Y' | 'ALL'`)
- **기본값**: `'1Y'`, localStorage에 영속 (`'asset-manager-global-period'`)
- **영향 범위**: 모든 탭에 일관 적용 — 대시보드(수익통계 SoldAssetsStats + ProfitLossChart 필터, `endDate`도 필터 적용), 차트(AssetTrendChart의 visibleRange 초기 뷰), 수익 통계(매도 기록 필터)
- **차트 fetch**: 항상 전체 10년(3650일) fetch (기간 변경 시 캐시 히트, 재호출 없음). `visibleRange`로 초기 뷰만 제한, 드래그/줌으로 자유 탐색 가능 (사용자 인터랙션 후에는 기간 버튼 클릭 또는 종목 변경 전까지 range 미갱신)
- **수익 통계 탭**: 자체 date input이 **삭제됨** — 반드시 `periodStartDate`/`periodEndDate` props로 전달받아야 함

### 관심종목 (WatchlistItem)
- **삭제된 필드/기능**: `monitoringEnabled`, `dropFromHighThreshold`, `lastSignalAt`, `lastSignalType`, 모니터링 토글, 최고가대비 하락 알림, 신호 배지(최고가대비/일중하락/매도/RSI) — `WatchlistItem` 타입에 해당 필드 없음
- **메모 표시**: 종목명에 마우스 hover 시 `MemoTooltip` 컴포넌트로 표시 (Portal 기반, 마우스 추적). 메모가 있는 종목 옆 📝 아이콘 표시. `WatchlistItem.notes` → `MemoTooltip`의 `memo` prop으로 전달
- **관심종목 UI는 모달 기반** — 인라인 폼 없음, `WatchlistAddModal`/`WatchlistEditModal` 사용
- **관심종목 가격 갱신 2가지 경로**:
  - `handleRefreshAllPrices`: 포트폴리오와 함께 자동 처리 (현재가/전일종가/지표 갱신, `highestPrice`도 갱신)
  - `handleRefreshWatchlistPrices` (전용 업데이트 버튼): 현재가 + **1년 히스토리 조회로 52주 최고가 계산** (`historicalPriceService` 사용)
- **52주 최고가(`highestPrice`) 계산**: 관심종목 전용 갱신 시 `fetchStockHistoricalPrices`/`fetchCryptoHistoricalPrices`로 1년 히스토리를 가져와 `Math.max(...prices)`로 산출. 백엔드 시세 API가 `high52w`를 제공하지 않는 종목도 커버
- **enrichedMap 통합**: `useEnrichedIndicators`가 관심종목 ticker도 포함하여 배치 조회 → MA/RSI 지표 계산. 알림 브리핑의 매수 기회 판정에 활용
- **브리핑 매수 기회 참여**: 관심종목은 `checkBuyRulesForWatchlist()`를 통해 매수 규칙에 매칭 → 브리핑 패널에 `[관심]` 배지와 함께 표시. 클릭 시 관심종목 탭으로 이동 + `focusedWatchItemId`로 차트 자동 펼침
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
- **새 알림 규칙 추가 시**: `constants/alertRules.ts`의 `DEFAULT_ALERT_RULES`에 추가, 필요한 필터가 없으면 `smartFilter.ts`/`smartFilterChips.ts`/`smartFilterLogic.ts`에 칩 추가 필요. 새 `filterConfig` 필드 추가 시 `alertChecker.ts`의 `matchesRule` → `extraConfig`에도 전달 필요. `useAutoAlert.ts`의 `loadAlertSettings()`가 기본값에서 신규 filterConfig 필드를 자동 backfill함
- **이벤트형 필터(PRICE_CROSS_ABOVE_MA, RSI_BOUNCE, RSI_OVERHEAT_ENTRY)**: `withinDays`로 감지 유지 일수 설정 가능. `withinDays=0` 또는 미설정이면 기존 당일만 감지. `withinDays > 0`이면 N거래일 이내 이벤트 + 현재 조건 유지(가격≥MA, RSI>30, RSI≥65) 확인
- **MA 교차류 룰의 lookback (`maxLookbackTradingDays`)**: `dead-cross` 룰 등에서 사용. `MA_DEAD_CROSS` 필터 자체는 *현재 역배열 상태* 만 검사하므로, 사용자가 "최근 발생한 교차" 의미를 원할 때 이 옵션이 추가 검사 — `enriched.maCrossDays[short][long]` 절댓값이 지정 거래일을 초과하면 미매칭. 단위: 거래일(1개월=22 / 3개월=66 / 6개월=132 / 1년=252). 스마트필터 칩 경로는 `extraConfig` 미주입이므로 영향 없음
- **`matchesSingleFilter` 시그니처 변경 시**: `smartFilterLogic.ts`(스마트 필터)와 `alertChecker.ts`(알림) **양쪽 모두** 영향 확인 필수
- **5B 알림 진단 (tri-state)**: `evaluateSingleFilter()`(순수)가 단일 필터를 `true/false/null` + `FilterEvalReason` + actual/threshold로 평가하는 **단일 소스**. `matchesSingleFilter()`는 `null→false` wrapper(발화 불변, `tests/smartFilterParity.ts`가 강제). **규칙 발화 평가(`matchesRule`/`checkAlertRules`)와 "팝업 전달 상태"(자동팝업 on/off·오늘 이미 표시됨 dedup)는 직교 축으로 분리할 것** — 진단이 둘을 섞으면 "규칙 미충족"과 "팝업 비활성"이 혼동됨. **진단 코드에서 `useAutoAlert.runAlertCheck`·`attachDistributionTiers`·`classifyDistributionTier` 등 side-effect 경로(localStorage 갱신) 직접 호출 금지** — 순수 `evaluateSingleFilter`/`matchesRule`만 사용

### 금 김치 프리미엄
- **KRX-GOLD 단위**: KRX 금시장 가격은 `KRW/g`으로 반환됨
- **GC=F 단위**: COMEX 금선물은 `USD/troy oz` → 환산: `USD/oz × USD/KRW ÷ 31.1035 = KRW/g`
- **GC=F 지원 미확인**: FinanceDataReader가 `GC=F`(Yahoo Finance 티커)를 처리하지 못하면 `isMocked: true` 반환 → 위젯에 `-` 표시. 실패 시 백엔드 신규 엔드포인트 필요
- **포트폴리오 자산 독립**: 금 자산 미보유 시에도 작동 (포트폴리오 자산 목록과 무관)
- **환율 중복 호출 방지**: `PortfolioContext.data.exchangeRates.USD` 재사용 (환율 API 별도 호출 없음)

### 거래량 지표 관련
- **`volume_ratio` 가용 범위**: 주식/ETF에만 `volume_avg20`과 `volume_ratio` 제공. 암호화폐(Upbit)는 당일 `volume`만 제공 (20일 평균/비율은 null) → 스마트 필터 거래량 칩은 주식/ETF에만 매칭됨
- **차트 거래량 막대**: `historicalVolumes`가 없거나 빈 객체이면 거래량 Bar 자동 생략 (VOL 토글도 숨김)
- **`historicalPriceService.ts`의 `HistoricalPriceResult`**: `volume` 필드는 optional — 백엔드가 거래량 데이터를 포함하지 않는 경우(레거시 응답)에도 하위호환
- **백엔드 NaN 응답 방어 (priceService, historicalPriceService 공통)**: Cloud Run 백엔드가 Python pandas 기반으로 NaN을 JSON에 포함하여 반환할 수 있음. `response.json()` 직접 호출 금지 → 반드시 텍스트로 받아 `NaN` → `null` 치환 후 `JSON.parse()`. `historicalPriceService`는 추가로 `stripNullPrices()`로 null 엔트리 제거하여 하위 소비자(`calculateSMA`, `calculateRSI` 등)에 숫자만 전달

### 레이아웃 및 반응형 제약사항
- **전체 레이아웃**: `App.tsx`는 `h-screen flex flex-col overflow-hidden`. 탭바만 `flex-shrink-0`으로 최상단 고정, Header와 콘텐츠는 `<main className="flex-1 overflow-y-auto">`에서 함께 스크롤
- **포트폴리오 테이블 sticky thead**: `<thead>`의 `sticky top-0`이 `<main>` 스크롤 컨테이너 기준으로 동작. **`<main>`과 `<thead>` 사이에 `overflow` CSS 속성을 가진 wrapper를 추가하면 sticky가 깨짐** — 새 wrapper div 추가 시 overflow 속성 금지
- **드롭다운 메뉴**: 인라인 `absolute` 포지션 메뉴 사용 금지 → `ActionMenu` 컴포넌트 사용 (`createPortal`로 body에 렌더링). 데스크탑: 버튼 위치 기반 드롭다운(공간 부족 시 위로 열림), 모바일(<768px): 바텀시트
- **테이블 셀 내 hover 툴팁**: 본문 `<td>`는 `overflow-hidden`(컬럼 폭 클리핑)이고 `<thead>`는 sticky stacking 컨텍스트라, 셀 내부 `absolute` 툴팁은 잘리거나 위 행/헤더에 가려짐. **셀 안에서 hover 툴팁이 필요하면 반드시 Portal 기반 컴포넌트(`Tooltip.tsx`/`MemoTooltip.tsx`) 사용** — 인라인 `absolute` 툴팁 신규 작성 금지 (`z-index` 상향으로는 해결 불가, 클리핑은 z-index와 무관)
- **데스크탑/모바일 뷰 분기**: `hidden md:block`(데스크탑 테이블) / `block md:hidden`(모바일 카드 뷰)로 분기. 적용 대상: `PortfolioTable`(`PortfolioMobileCard`), `WatchlistPage`(`WatchlistMobileCard`). **테이블에 새 기능 추가 시 대응 모바일 카드 뷰에도 반영 필요**
- **`PortfolioMobileCard`**: 종목명+현재가+수익률+평가액+고가대비/전일대비를 카드 형태로 표시, 탭하면 차트 펼침, 관리 메뉴는 `ActionMenu`(바텀시트) 사용
- **`WatchlistMobileCard`**: `PortfolioMobileCard`와 동일 패턴. 종목명+현재가+어제대비+고가대비, 체크박스 선택, `ActionMenu`(바텀시트), 📝 메모 아이콘 클릭 시 `onMemoEdit` 콜백
- **위로가기 버튼 z-index**: `App.tsx`의 스크롤 맨 위 버튼은 `z-[70]` (투자브리핑 팝업 `z-[60]`보다 위). 브리핑 팝업 표시 시 `bottom-20 sm:bottom-24`로 위로 이동하여 겹침 방지
- **모바일 PeriodSelector**: `App.tsx`에서 데스크탑은 탭바 우측(`hidden sm:flex`), 모바일은 탭바 아래 별도 행(`sm:hidden`)으로 분리 렌더링
- **모달 반응형 패턴**: 외부 `p-4` (모바일 여백), 내부 `p-4 sm:p-6 max-h-[90vh] overflow-y-auto` (모바일 패딩 축소 + 스크롤), `grid-cols-1 sm:grid-cols-2` (폼 그리드)
- **CSS 유틸리티** (`index.css`): `scrollbar-hide` (수평 스크롤 스크롤바 숨김), `overscroll-behavior: contain` (pull-to-refresh 차단), `-webkit-tap-highlight-color: transparent` (탭 하이라이트 제거), 모바일 input `font-size: 16px` (자동 확대 방지)

### 종목 고정(Pin) 기능
- **데이터 모델**: `Asset.pinned?: boolean` — Google Drive에 함께 저장됨 (autoSave 파이프라인 포함)
- **토글 액션**: `PortfolioActions.togglePinAsset(id)` → `PortfolioContext`에서 구현, `setAssets()` + `triggerAutoSave()`
- **UI**: `PortfolioTableRow`/`PortfolioMobileCard`에 ★/☆ 아이콘 (종목명 앞), `PortfolioTable`에 핀 필터 버튼 (검색바 옆)
- **필터**: `PortfolioTable`의 `showPinnedOnly` 로컬 상태 — `filteredAssets` useMemo에서 스마트 필터 전에 적용
- **소액 숨김 예외**: 소액 자산 숨김 토글이 켜져 있어도 `pinned=true` 자산은 항상 표시됨 (사용자가 명시적으로 중요 표시한 자산 보호)

### 소액 자산 숨김 기능
- **목적**: 보유 종목이 많을 때 평가총액이 낮은 자산을 일시적으로 가려 가독성 향상
- **임계값**: `UIState.lowValueThreshold` (KRW, 기본 1,000,000원). 환경설정 → 표시 설정에서 사용자가 조정. `localStorage('asset-manager-low-value-threshold')`에 영속
- **토글 위치**: `PortfolioTable` 헤더 우측, 프리셋 버튼 왼쪽. 모바일도 표시 (라벨은 `hidden sm:inline`로 모바일에서 숨김)
- **토글 상태**: `PortfolioTable`의 `hideLowValue` 로컬 상태 — `localStorage('asset-manager-hide-low-value')`에 영속 (`'1'`/`'0'`)
- **필터링 로직**: `filteredAssets` useMemo에서 `pinned || metrics.currentValueKRW >= ui.lowValueThreshold`로 통과 — 데스크탑 테이블/모바일 카드 모두에 자동 반영
- **`lowValueThreshold === 0`이면 필터 미적용** (전체 표시)
- **환율 미확보 자동 우회** (2026-05): 외화 자산이 있는데 현재 환율 + `lastKnownRates` 캐시 모두 미확보(USD<100 또는 JPY<1)인 경우, 잘못 환산된 0값으로 자산이 사라지는 것을 방지하기 위해 소액 숨김을 일시 정지함. `PortfolioTable.lowValueFilterReady` useMemo로 판정 (`utils/exchangeRateCache.hasResolvableRates` 호출). 토글이 켜진 상태에서 환율 미확보면 토글 색상이 amber로 변하고 `(환율 대기)` 라벨이 표시됨
- **환율 캐시 (last-known rates)**: `utils/exchangeRateCache.ts`에 `loadLastKnownRates`/`saveLastKnownRates`/`resolveRate`/`hasResolvableRates` 정의. `localStorage('asset-manager-last-known-rates-v1')`에 `{ USD, JPY, timestamp }` JSON 저장. 환율 fetch 성공 시(`useMarketData`), Drive 로드 시(`usePortfolioData`)에 캐시됨. `usePortfolioCalculator.getValueInKRW`가 현재 환율 → 캐시 환율 → 0 순으로 폴백 (USD < 100 또는 JPY < 1은 비정상값으로 간주)

### 포트폴리오 테이블 컬럼 커스터마이징 (2026-05, 데스크탑 전용)
- **목적**: 사용자가 컬럼 가시성과 순서를 자유롭게 조정
- **양끝 고정**: 종목명(좌), 관리(우)는 `ColumnConfig`에 포함되지 않으며 항상 첫/끝에 렌더링됨. 이동/숨김 불가
- **설정 가능 컬럼** (11개, `types/ui.ts:ColumnKey`): `maCrossDays`, `quantity`, `purchasePrice`, `currentPrice`, `returnPercentage`, `purchaseValue`, `currentValue`, `purchaseDate`, `allocation`, `dropFromHigh`, `yesterdayChange`
- **상태**: `UIState.columnConfig: ColumnConfig[]` (`{ key, visible, width? }` 배열, 순서가 표시 순서). `DEFAULT_COLUMN_CONFIG`는 기존 "더보기 ON" 상태와 동일. `width` 미지정 시 자동 너비
- **고정 컬럼 너비**: `UIState.fixedColumnWidths: FixedColumnWidths` (`{ name? }`) — 종목명만 사용자 리사이즈 가능. 체크박스/관리는 항상 자동
- **영속화**: `localStorage('asset-manager-column-config-v1')` JSON 배열 (중간 컬럼) + `localStorage('asset-manager-fixed-column-widths-v1')` JSON 객체 (종목명 너비). `PortfolioContext.mergeColumnConfig`가 스키마 호환 머지(없는 키 추가, 알 수 없는 키 제거, `width` 등 미지정 필드 보존)
- **UI**: `components/portfolio-table/ColumnSettingsDropdown.tsx` — `PortfolioTable` 헤더 우측 `컬럼` 버튼. dnd-kit(`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`) 사용. 양끝 잠금 컬럼은 회색 `🔒` 행으로 표시 (드래그 불가). **"기본값으로 초기화"는 가시성/순서 + 모든 너비 함께 리셋** (`resetColumnConfig` → `persistColumnConfig(DEFAULT_COLUMN_CONFIG)` + `persistFixedColumnWidths(DEFAULT_FIXED_COLUMN_WIDTHS)`)
- **렌더링**: 컬럼 정의는 `components/portfolio-table/columnDefinitions.tsx`의 `COLUMN_DEFINITIONS` 객체에 `renderHeader`/`renderCell` 함수로 분리. `PortfolioTable`의 `<thead>`와 `PortfolioTableRow`가 `visibleColumns.filter(c => c.visible).map(...)`로 동적 렌더. 너비는 `<colgroup>` + `<col style={{width}}>`로 적용 (체크박스+종목명+가시중간+관리 순)
- **컬럼 리사이즈** (헤더 우측 가장자리 드래그):
  - `components/portfolio-table/ColumnResizeHandle.tsx` + `hooks/useColumnResize.ts` (window-level mousemove/mouseup, 드래그 중 `document.body.cursor='col-resize'`/`userSelect='none'`)
  - 드래그 중 미리보기는 `PortfolioTable` 로컬 state `dragOverride: { key, width } | null` → `<colgroup>`만 재렌더, 행 영향 없음. mouseup 시점에 `actions.setColumnWidth` / `actions.setFixedColumnWidth`로 Context 커밋
  - `MIN_COLUMN_WIDTH = 80` (px) — 미만 자동 클램프
  - **정렬 차단**: 핸들 `onMouseDown`/`onClick` 모두 `stopPropagation` 필수 (부모 `<th onClick={requestSort}>` 차단)
  - **상위 컴포넌트 안정화**: `MiddleColumnResizeHandle`은 `useMemo([])`로 영구 안정. 콜백 내부에서 `actionsRef.current.setColumnWidth(...)` 호출 — Context 갱신 시 핸들 리마운트 방지 (드래그 중 state 손실 차단)
  - 대상: 종목명 + 중간 11개. 체크박스/관리는 자동 너비 유지
- **콜스팬**: 차트 확장 행과 empty 메시지는 `totalColSpan = 3 + visibleColumns.filter(c => c.visible).length` (체크박스+종목명+관리 3 + 가시 컬럼 수). `<colgroup>`은 콜스팬에 영향 없음
- **`table-layout: fixed` 강제**: `PortfolioTable.tsx`에서 `<table style={{ tableLayout: 'fixed' }}>`로 적용. 특정 PC 환경(폰트/배율 차이)에서 `auto`일 때 콘텐츠 min-content가 사용자 지정 width를 무시해 가로 스크롤바가 사라지지 않는 문제를 해결. **부작용**: 콘텐츠가 길면 잘림 — 모든 td는 `overflow-hidden` 처리 필수 (현 `PortfolioTableRow` / `columnDefinitions` 모두 적용됨). 컬럼 너비 미지정 시에도 동작하나, 시각적으로 좁아질 수 있어 `DEFAULT_COLUMN_CONFIG`에서 합리적 기본값 권장
- **백업 포함**: Drive 자동 저장/복원 시 `useGoogleDriveSync.autoSave`가 `tableLayout: { columns, fixedWidths }` 단일 객체로 묶어 페이로드 포함 (`columnConfig` 필드도 한 릴리스 동안 함께 저장 — 구 클라이언트 호환). `loadFromGoogleDrive`는 복원 시 두 localStorage 키 갱신 + `window.dispatchEvent('table-layout-restored', { detail: { columns, fixedWidths } })` 발행. 레거시 `columnConfig`(배열)만 있는 백업은 `'column-config-restored'` 폴백 경로로 복원 (한 릴리스 뒤 제거 예정). `PortfolioContext`가 두 이벤트 모두 리스닝하여 state 즉시 동기화
- **컬럼 변경 시 autoSave 트리거**: `PortfolioContext.persistColumnConfig` / `persistFixedColumnWidths`는 localStorage 저장 직후 `triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates)`를 호출. 호출 인자는 현재 상태 그대로 전달 (autoSave 본문이 localStorage에서 최신 tableLayout을 읽어 백업에 포함). **이유**: 컬럼 변경은 `usePortfolioData`의 `triggerAutoSave` deps에 포함되지 않아, 컬럼만 조절하고 세션 종료 시 Drive 백업에 반영되지 않고 다음 로드 시 옛 백업이 localStorage를 덮어쓰는 문제 발생 → 재부팅 시 초기화되는 것처럼 보임. autoSave는 디바운스되어 빠른 리사이즈에도 1회만 저장됨
- **모바일 미적용**: `PortfolioMobileCard`는 영향 없음 — 컬럼 개념이 카드 레이아웃과 맞지 않음 ("포트폴리오 테이블 기능 추가 시 PortfolioMobileCard에도 반영" 규칙의 의도적 예외)
- **기존 `더보기` 토글 제거**: `asset-manager-portfolio-show-more` localStorage 키는 더 이상 사용되지 않음 (자동 정리는 안 되며, 무시됨)

### 메모 편집 팝업 (MemoEditPopup)
- **범용 Props**: `title`, `memo`, `onSave(memo: string)`, `onClose` — Asset/WatchlistItem에 의존하지 않음
- **트리거(포트폴리오)**: `PortfolioTableRow`/`PortfolioMobileCard`의 📝 아이콘 클릭. `PortfolioTable`의 `memoEditAsset: Asset | null` 상태
- **트리거(관심종목)**: `WatchlistPage`/`WatchlistMobileCard`의 📝 아이콘 클릭. `WatchlistPage`의 `memoEditItem: WatchlistItem | null` 상태
- **아이콘 스타일**: `text-xl`(데스크탑)/`text-lg`(모바일), 메모 유무와 무관하게 항상 표시 (opacity 차등: 60%/20%)
- **닫기 보호**: `MemoEditPopup` 내부에서 `isDirty` + `confirm()` 패턴 적용 (모달 닫기 보호 패턴과 동일)
- **MemoTooltip과 분리**: 메모 아이콘은 `MemoTooltip` 바깥에 배치 → hover는 툴팁, click은 편집 팝업 (이벤트 충돌 없음)

### 모달 닫기 보호 (EditAssetModal, WatchlistEditModal)
- **적용 대상**: `EditAssetModal`(포트폴리오), `WatchlistEditModal`(관심종목) 모두 동일 패턴 적용
- **미저장 변경 감지**: `isDirty` (useMemo) + `initialRef`(useRef)로 모달 열릴 때 초기값 저장 → 현재 상태와 비교
- **overlay 클릭/취소 버튼/X 버튼**: 변경사항이 있으면 `window.confirm(...)` 확인 후 닫기. 변경 없으면 즉시 닫기. `handleClose` 래퍼로 통일
- **저장 버튼**: 확인 없이 저장 → 모달 자동 닫힘 (`onClose` 직접 호출)
- **삭제 버튼**: 기존 `window.confirm` 유지 (별도 흐름, `handleClose` 경유하지 않음)
- **`WatchlistEditModal`의 추적 필드**: `ticker`, `name`, `category`(categoryId), `notes`
- **새 모달 추가 시**: 동일 패턴 적용 권장 — `useRef`로 초기값 캡처 + `isDirty` useMemo + `handleClose` 래퍼

### 디버깅 로그 패턴
```typescript
// 중앙 로거 사용 (console.* 직접 사용 금지)
import { createLogger } from '../utils/logger';
const log = createLogger('MarketData');

log.debug('자산 분류:', { upbit: upbitAssets.length, general: generalAssets.length });
log.debug('업비트 조회 심볼:', upbitSymbols);
log.info('BTC: 현재가=xxx, 전일종가=xxx');
log.error('시세 조회 실패:', error);
// 레벨: debug(개발만) < info < warn < error(프로덕션도 출력)
```

### 데이터 무결성
- **마이그레이션**: `migrateData.ts`에서 이전 버전 데이터 자동 변환
- **마이그레이션 멱등성**: 필드 이름 변경 시 기존 값 보존 필수 (`??` 연산자 사용, `=` 덮어쓰기 금지)
- **구조 검증**: 필수 필드 존재 여부 확인 후 로드
- **스냅샷 우선**: 수익통계에서 스냅샷 필드(`originalPurchasePrice` 등) 우선 사용
- **스냅샷 수량 역산**: `currentValue / unitPrice`로 수량을 역산할 때, `unitPrice`가 0이나 undefined이면 반드시 스킵 (fallback 1 사용 금지 — 데이터 오염의 원인)
- **로드 파이프라인 순서**: `repairCorruptedSnapshots` → `fillAllMissingDates` → `backfillWithRealPrices` (repair가 반드시 먼저)

### 매도 기록 이중 저장 구조
- **저장 위치가 2곳**: 매도 시 동일한 거래가 `sellHistory[]`(글로벌)와 `asset.sellTransactions[]`(자산 내부) **양쪽에 저장**됨
  - 전량 매도: 자산 삭제 → `sellHistory`만 남음 (중복 없음)
  - 부분 매도: 자산 유지 → 양쪽 모두 존재 (중복 위험)
- **조회 시 `id` 기반 중복 제거 필수**: `SellAnalyticsPage`에서 양쪽을 합칠 때 `sellHistory`의 `id` Set으로 `inlineRecords` 중복 방지
- **수정 시 확인**: `useAssetActions.ts`(저장/편집/삭제), `SellAnalyticsPage.tsx`(조회/집계), `EditSellRecordModal.tsx`(편집 UI)
- **편집/삭제 시 양쪽 동기**: `handleEditSellRecord`/`handleDeleteSellRecord`는 `sellHistory`와 자산의 `sellTransactions`를 동일한 `id`로 매핑하여 함께 갱신 — 한쪽만 수정 금지

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
- [ ] Cloud Run URL은 `constants/api.ts`의 `CLOUD_RUN_BASE_URL` import (하드코딩 금지)
- [ ] `types/api.ts`에 응답 타입 정의
- [ ] `hooks/`에서 해당 서비스 호출
- [ ] 에러 핸들링 및 폴백 로직 구현
- [ ] 로깅은 `createLogger('모듈명')` 사용 (`console.*` 직접 사용 금지)

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

---

## 13. tests/ (오프라인 진단)

`tests/` 디렉토리는 **CI 미통합** — 수동 실행용 진단 스크립트만 존재.

| 파일 | 책임 | 실행 |
|------|------|------|
| `validation.js` | 등락률 계산식 수동 검산 (`percentChange()`) | `node tests/validation.js` |
| `walkForwardBacktest.ts` | 클라이맥스/디스트리뷰션 룰의 워크포워드 백테스트. 학습 구간(train=180거래일)에서 임계값 grid 평가 → 미지 구간(test=60거래일)에서 검증 → 신호 발생률·30거래일 평균 드로다운·거짓 신호율 리포트. **거래량 프록시 비교 모드** (`--proxy SLV`): 적용/미적용 결과 모두 출력. 오버피팅 가드: 단일 사건에 임계값 맞추지 말 것 — grid는 의도적으로 거칠게. CLI: `npm run backtest -- --ticker 005930 --from 2023-01-01 --to 2026-06-01 [--proxy GLD]` 또는 `--fixture <path>` | `npm run backtest` (내부적으로 `npx tsx`) |
| `climaxDistributionParity.ts` | **클라이맥스/디스트리뷰션 카운팅 회귀 핀**(96 단언). `utils/climaxFlags.countClimaxFlags`(공유) 기반의 `smartFilterLogic CLIMAX_TOP`·`riskMatrix.computeRiskTier().climaxFlagCount`, `DISTRIBUTION_HIGH`·`marketDistribution.countDistributionDays`를 **fixture별 명시적 골든 절대값에 핀**(예: slope 2.5→1, churn 5일→5). ⚠ 단순 경로-대-경로 동등성만 비교하면 공통 함수 추출 후 자기참조 타우톨로지가 되므로 **반드시 골든 절대값**을 둔다. 엔진별 정책 차이(`climaxRequireLongTrendUp`/`climaxRequireBullishCandle` 토글 off 시 의도적 분기)도 고정. **운영 함수만 호출·계산식 복제 안 함**(fixture는 `EnrichedIndicatorData` 핸드크래프트). 경계값·null·OHLCV 미수신·빈 메타 포함. **공통 함수 추출(리팩터) 전후 이 테스트가 통과해야 함** | `npm run test:parity` |
| `guruDiagnosticsParity.ts` | **구루 진단(5A) 회귀 핀**(83 단언). `guruDiagnostics`의 3축이 정확한지: evaluation의 all/any/not×{true/false/null} 정책, eligibility 사유별 분류 + **`getSignalEligibility().eligible === isActiveSignal()` 등가**, coverage 4분할(available/partial/missing/unsupported), **매치셋 동일성**(`diag.filter(eligible&&matched)`===`evaluateGuruSignals`), `now` 주입 결정성, **drift 가드**(buildMetricValues 산출 키 = IMPLEMENTED_METRICS **양방향 동일성** + **TS↔Python `triage_commit.py` 동기**), **partial 숨김 방지**(0-degrade가 readiness.partial로 노출), **`describeRuleStatus` 정밀 라벨**(matched+unsupported→firing-partial 왜곡금지), **`buildGuruSignalTargets` 대상 선정**(포트폴리오 우선·동일 ticker 제외·누락 스킵·price fallback). 운영 함수만 호출 | `npm run test:diagnostics` |
| `smartFilterParity.ts` | **알림 필터 진단(5B) 회귀 핀**(90 단언). ① 32키 boolean 골든(명시 기대값) ② `evaluateSingleFilter` 3치+reason — **발화 동일성**(`matchesSingleFilter===result===true`) + no-data/event-not-found 구분 + `ALL_KEYS===FILTER_KEY_TO_GROUP` 집합 ③ 규칙 층: `matchesRule` AND·`checkAlertRules` enabled-only·`checkBuyRulesForWatchlist` buy-only ④ **`DEFAULT_ALERT_RULES` 기본 21규칙** 발화집합(규칙별 발화 fixture true / 중립 false) + 설정 전달 경계(lookback·maCrossPeriod·climax longTrendUp·distribution threshold·withinDays). 운영 함수만 호출 | `npm run test:filters` |
| `alertDiagnosticsParity.ts` | **알림 진단(5B-①) 회귀 핀**(33 단언). **매치셋 동일성**(`diagnoseAlertRule().evaluation==='matched'` === `matchesRule()`===true), dataQuality 직교(complete/partial/missing — climax OHLC partial이 미충족에 숨지 않음 + **복합필터 입력 전부 null→missing** 과대평가 방지), `describeAlertRuleStatus`(disabled 최우선·matched 보존·partial 캐비엇), **`evaluateAutoPopupGate`(5사유, 0건도 already-checked 기록, 규칙 발화와 직교)**, 관심종목 buy-only. 운영 함수만 호출 | `npm run test:alertdiag` |
| `alertSensitivityParity.ts` | **② 민감도 프리셋 회귀 핀**(54 단언). **"프리셋 적용 = 특정 filterConfig 산출"을 골든 절대값으로 고정**(임계값 변경은 의도된 발화 변경이므로 박제). ① **기본 프리셋 = 공장 기본값 완전 동일**(비파괴 항등) ② 예민/둔감 골든 절대값 핀(stop-loss 3/8·climax [1,1.5,1.5]/[3,4,4]·distribution [18,1.2,3]/[9,2.1,8]·withinDays 등) ③ **비파괴**: action 격리(매도↔매수 독립)·enabled·MA 구조·게이트 토글·maxLookback 보존·**공장값 기준 절대 산출**(커스텀 99→예민 3) ④ 멱등 ⑤ 클램프(UI min/max) ⑥ `detectSensitivityLevel` 라운드트립+공장=default+사용자지정=null ⑦ `describeSensitivityPlan` 9조합 필드 채움. 운영 함수만 호출 | `npm run test:sensitivity` |

## 14. 백엔드 (Cloud Run, 별도 리포)

백엔드 Python 소스는 이 리포에 없음 — Cloud Run에 배포됨 (`asset-manager-887842923289.asia-northeast3.run.app`).

### `/history` 응답 (OHLCV 확장 후)
```json
{
  "<ticker>": {
    "data":   { "YYYY-MM-DD": close, ... },
    "open":   { "YYYY-MM-DD": open, ... },   // 신규
    "high":   { "YYYY-MM-DD": high, ... },   // 신규
    "low":    { "YYYY-MM-DD": low, ... },    // 신규
    "volume": { "YYYY-MM-DD": volume, ... },
    "ticker": "005930"
  }
}
```
- 기존 클라이언트는 `data`/`volume`만 읽으므로 하위 호환 유지.
- 시가/고가/저가가 0이거나 NaN인 날짜는 응답에서 제외.
- KRX-GOLD는 네이버 API 기반 — 시가/고가/저가가 0으로 오면 종가로 폴백 (Naver 한계).

### `/upbit/history` 응답
동일한 OHLCV 키 구조. `opening_price`/`high_price`/`low_price`/`trade_price`/`candle_acc_trade_volume`에서 추출.

### 백엔드 수정 절차
1. 로컬 `main.py` 수정 → Cloud Run 재배포 (사용자 책임).
2. 프론트는 OHLCV 필드 부재 시 자동 폴백 — 배포 전후 모두 동작.
