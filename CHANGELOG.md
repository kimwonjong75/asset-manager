# 변경 이력 (CHANGELOG)

## 2026-09-05: (후속) 이력 스냅샷 단가 쌍 정합 + 표 재계산 누락 — `051ed13` 보정

바로 앞 커밋 `051ed13`(수익률 기준 전환)의 적대적 재검토에서 확인된 결함 5건을 고쳤다.
전부 **달러 기준(`plBasis:'native'`) 모드에서만** 나타나며, 저장 데이터·원화 기준 화면은 무변경이다.
같은 검토에서 원화 기준 경로는 무작위 44,000 케이스 대조로 이전 커밋과 **차이 0건**임을 확인했다.

1. **백필이 JPY/CNY 스냅샷의 단가 쌍을 어긋나게 했다** (`utils/historyUtils.ts`)
   - 스냅샷에는 환율 필드가 없어서, 달러 기준 차트는 `currentValue / unitPriceOriginal = 수량 × 그날 환율`이라는
     **내부 정합성**으로 환율을 약분한다. 이 등식은 `unitPrice = unitPriceOriginal × 환율`일 때만 성립한다.
   - 그런데 USD·KRW가 아닌 외화 경로는 `unitPriceOriginal`만 그날 종가로 바꾸고 `unitPrice`(→ `currentValue`)는
     장중 옛값으로 남겼다. 쌍이 깨지면서 손익 차트의 투자 원금이 부풀었다
     (JPY 100주·평균단가 ¥2,000 예시: 올바른 **1,900,000원** → 잘못된 **2,159,090.91원**).
   - 교정 규칙을 순수 함수 **`correctSnapshotPricePair`** 하나로 모았다. 그날 환율 시계열이 없는 통화는
     **스냅샷 자신의 내재 환율(`unitPrice / unitPriceOriginal`)을 이어 쓴다**(장중→종가 사이 환율 불변 근사).
     옛 쌍을 쓸 수 없으면 `unitPriceOriginal`도 **갱신하지 않는다** — 반쪽 교정보다 그대로 두는 편이 정합하다.
2. **손상 복구 "케이스 A"가 달러 모드에서 되살아났다** (`utils/historyUtils.ts`)
   - `unitPrice`도 기준 데이터도 없는 스냅샷은 `currentValue = purchaseValue`로 눌러 손익을 0으로 만든다(차트 폭발 방지).
     그런데 `purchaseUnitOriginal`이 살아남아 달러 모드에서는 파생이 다시 돌면서 **없는 수익 +326,262원(+7.96%)** 이 생겼다.
   - 이제 그 분기에서 `purchaseUnitOriginal`을 함께 비워 **두 모드 모두 손익 정확히 0**이 된다.
     반면 수량을 재구성하는 다른 분기는 쌍이 그대로 성립하므로 필드를 **보존**한다(무변경).
3. **표가 수익률 기준 변경을 놓칠 수 있었다** (`components/portfolio-table/usePortfolioData.ts`)
   - 정렬·enrich `useMemo`의 의존성 배열에 `calculateAssetMetrics`가 빠져 있었다. 지금은 상위가 매 렌더 새 `Set`을 넘겨
     우연히 가려져 있을 뿐, 그 한 줄을 메모이즈하는 순간 "설정을 바꿔도 표가 그대로"가 된다. 의존성 추가로 교정.
     `eslint-suppressions.json`의 해당 `react-hooks/exhaustive-deps` 억제 1건도 `npm run lint:prune`으로 제거됐다.

4. **업비트/빗썸 자산의 차트 원금이 표와 어긋날 수 있었다** (`hooks/usePortfolioHistory.ts`)
   - `computeAssetMetrics`는 업비트/빗썸이면 시세가 이미 원화라 달러 분기를 타지 않는다. 그런데 `AssetSnapshot`에는
     `exchange`가 없어 `deriveSnapshotPurchaseValue`가 그 예외를 재현할 수 없는데도, 기록 조건은 `currency !== KRW`뿐이라
     `purchaseUnitOriginal`이 남았다(통화가 USD인 업비트 자산에서 표 원금 140,000 vs 차트 원금 100).
   - 이제 **기록 단계에서 제외**해 차트가 저장값으로 폴백한다. 판정식은 새로 export한 `portfolioMetrics.isKRWExchange`
     하나만 쓴다(사본이 갈라지면 화면과 이력이 서로 다른 자산을 "외화"로 보게 된다).
5. **세금 폴백의 전제 조건을 문서화** (`utils/cleanupPlan.ts`)
   - `plannedForeignGainKRW`의 `?? c.profitLossKRW` 폴백은 현재 발동하지 않는다(후보와 맵을 같은 `data.assets`에서 만들고
     맵 제외 조건이 `flags.foreign`의 정확한 여집합이라서). 다만 그 안전성이 "두 술어가 우연히 같다"에 의존하므로,
     둘 중 하나를 바꾸면 **달러 기준 값이 세금에 조용히 섞인다**는 경고를 JSDoc에 명시했다. 코드 동작은 무변경.

- **새 파일**: `tests/historySnapshotParity.ts`(34단언, `npm run test:history`) — 위 불변식을 **명시 절대값**으로 고정하고,
  "수정 전 값"도 함께 핀으로 박아 버그의 크기·방향을 문서로 남겼다.
- **수정 파일**: `utils/historyUtils.ts` · `components/portfolio-table/usePortfolioData.ts` · `eslint-suppressions.json` · `package.json`(test:history) · `RULES.md`

## 2026-09-05: 수익률 기준 전환 — 증권사(달러) 방식 기본 + 원화(환율 포함) 방식 설정 유지

- **배경**: XLE(매수 $59.08 → 현재 $63.78)가 앱에서는 **−1.45%**, 키움에서는 **+7.5%**로 표시됐다. 원인은 버그가 아니라 **환산 규약 차이** — 앱은 매수 원가를 매수 당시 환율(1,498.8)로, 평가액을 오늘 환율(1,368)로 환산해 환차손 −8.7%가 수익률에 섞였다. 국내 증권사는 매입가·평가액을 **모두 오늘 환율**로 환산해 사실상 달러 수익률을 보여준다. 사용자는 보유 달러로 매수하고 매도 후에도 달러를 보유하므로(환전은 별도 판단) 종목 손익은 달러 기준이 맞다.
- **⚠ 2025-01-11 「수익률 계산 환율 기준 통일」의 후속 결정** (아래 항목 참조). 그때는 "대시보드와 차트가 서로 다르다"는 **내부 불일치**를 매수 당시 환율(`purchaseExchangeRate`)로 통일해 해결했다. 그 통일 자체는 유효하며 **원화 기준 모드로 그대로 보존**된다. 이번 변경은 그 위에 **"어느 기준으로 통일할 것인가"를 사용자 선택으로 올린 것**이고, 기본값을 증권사와 같은 달러 기준으로 바꾼 것이다. 즉 이전 결정을 되돌린 게 아니라 **한 단계 위에서 대체**한다.
- **선택 UI**: 설정 → 표시 설정 → 「수익률 기준」 세그먼트 — 「달러 기준 (증권사 방식)」(기본) / 「원화 기준 (환율 포함)」.
- **저장 데이터 무변경**: `purchaseExchangeRate`·매도환율은 어느 모드에서도 계속 수집·저장한다(원화 모드·세금·CSV에 필요). 마이그레이션 없음 — 계산 전환만으로 보유 종목 전부에 즉시 적용된다.
- **동기화**: 설정은 Drive 저장 도메인 `valuationSettings`(13번째). 두 PC에서 같은 수익률·같은 알림 판정이 되도록 localStorage가 아닌 Drive에 둔다.
  - **⚠ 두 PC의 빌드 버전이 다르면** 구 빌드의 자동 저장이 자기 스냅샷을 그대로 덮어쓰면서 `valuationSettings` 키를 떨어뜨릴 수 있다(설정이 기본값으로 되돌아간 것처럼 보임). 같은 배포 URL을 쓰면 무관하다.
- **항상 원화 기준으로 남는 2곳**
  - **해외주식 양도세 추정**(대청소 화면): 양도세는 매수일·매도일 각각의 환율로 원화 환산해 과세하므로 환차손익이 과세 대상이다. 달러 기준으로 바꾸면 부호까지 뒤집힌다(XLE: 원화 −64,679원 vs 달러 +321,496원). 화면에 그 이유를 한 줄 표기.
  - **이력 스냅샷 저장**(`AssetSnapshot.purchaseValue`): 손상 복구 휴리스틱(`|currentValue/purchaseValue| >= 10`)과 기존 데이터의 의미를 지키기 위해 원화 기준 고정. 달러 기준 차트 값은 새 필드 `purchaseUnitOriginal`로 **표시 시점에 파생**한다(그날 환율이 정확히 약분됨). 필드가 없는 구 스냅샷은 원화 기준으로 남고 365일 캡으로 자연 소멸한다.
- **중복 계산 통일 (P3)**: 같은 원가 공식이 7곳에 복제돼 있었다. 전부 `utils/portfolioMetrics.ts` 하나로 모았고, `MAX_REASONABLE_EXCHANGE_RATES`(환율 이상치 상한)도 **저장소 전체에 정의 1개만** 남았다.
- **함께 고쳐진 기존 버그 5건**
  1. **대청소 세금 추정이 부분 매도분을 빠뜨림** — `sellHistory`만 보고 자산에 인라인된 `sellTransactions`를 병합하지 않아 대시보드와 값이 어긋났다. 병합을 `utils/sellRecords.mergeSellRecords`로 단일화하며 교정.
  2. **수익통계 탭의 "매수정보 없는 매도 건"** — 매수원가를 0으로 두어 매도금액 전액이 이익으로 집계됐다(대시보드 카드는 같은 건을 0으로 처리해 두 화면이 달랐다). 이제 두 곳 모두 실현손익 0.
  3. **`useTopBottomAssets`의 환율 폴백 `|| 1`** — 환율이 없을 때 1달러를 1원으로 취급해 수익률이 크게 왜곡됐다. `resolveRate`(현재 → 캐시 → 0)로 교체.
  4. **자산군별 요약의 "역산 환율" 분기** — `CategorySummaryTable`은 `purchaseExchangeRate`가 없는 외화 자산의 원가를 `currentPrice / priceOriginal`로 역산했는데, 외화 자산은 이 둘이 **항상 같아**(`useMarketData`가 `currentPrice = priceOriginal`로 채운다) 비율이 1이었다. 즉 달러 숫자를 원화로 착각해 원가를 잡고 있었다(XLE 50주 예시: **2,954원** → 올바른 **4,041,279원**). 분기 제거로 표·대시보드와 같은 규약이 됐다.
  5. **세금 추정의 "매수정보 없음 + 이상 매도환율"** — 매도금액은 이상치 보정을 거친 값인데 매수원가는 보정을 끈 값(`{USD:0, JPY:0}`)으로 계산해 둘이 어긋나며 가짜 이익이 잡혔다(예시 1건에서 세액 약 16만원 차이). 이제 두 값이 같아져 실현손익 정확히 0.
- **의도된 부수 변경**: 이력 스냅샷·자산군별 요약·CSV의 평가액이 이제 **업비트/빗썸 예외를 함께 적용**받는다(옛 공식들엔 이 예외가 없어 원화 시세에 환율을 한 번 더 곱했다). 통화가 KRW가 아닌 업비트 자산에서만 차이가 나는데, 시세를 한 번이라도 갱신하면 `useMarketData`가 통화를 KRW로 고정하므로 실사용 노출은 사실상 없다.
- **새로운 파일**
  - `types/valuation.ts`: `PLBasis`('native'|'krw')·`ValuationSettings`·`normalizeValuationSettings`(방어적 파싱)·UI 라벨
  - `utils/portfolioMetrics.ts`: 보유/매도 손익 계산의 단일 순수 모듈(구 `usePortfolioCalculator` 본체)
  - `utils/sellRecords.ts`: 매도 이력 병합의 단일 지점
  - `tests/portfolioMetricsParity.ts`(148단언) · `tests/sellRecordsParity.ts`(18단언)
- **주요 수정 파일**: `hooks/usePortfolioCalculator.ts`(얇은 래퍼) · `usePortfolioHistory.ts` · `usePortfolioExport.ts` · `useTopBottomAssets.ts` · `utils/cleanupPlan.ts` · `components/DisplaySettingsSection.tsx` · `dashboard/ProfitLossChart.tsx` · `dashboard/CategorySummaryTable.tsx` · `dashboard/SoldAssetsStats.tsx` · `SellAnalyticsPage.tsx` · `cleanup/CleanupView.tsx` · `layouts/DashboardView.tsx` · 저장 도메인 배선(`types/portfolioSave.ts`·`utils/parsePortfolioPayload.ts`·`hooks/useGoogleDriveSync.ts`·`hooks/usePortfolioData.ts`·`contexts/PortfolioContext.tsx`)
- **표시상 알아둘 점**: 달러 기준에서 수익통계 카드의 매도금액·매수금액은 **오늘 환율로 환산한 값**이지 매도 당시 실제 원화 수령액이 아니다(`매도금액 − 매수금액 = 손익` 항등식을 유지하기 위한 것). 카드에 한 줄로 표기했다. 손절·익절 알림 임계도 수익률 기준을 따라가므로 모드를 바꾸면 발화 종목이 달라질 수 있다(의도된 동작).

## 2026-02-05: AssetTrendChart에 사용자 커스텀 이동평균선(MA) 오버레이 추가
- **기능 추가 — 차트 MA 오버레이**:
  - 자산 차트에 MA5/10/20/60/120/200 이동평균선 오버레이
  - 사용자가 칩 토글로 MA 기간별 표시/숨김 선택 (기본: MA20, MA60 활성)
  - MA 활성 시: `/history` 과거 종가 기반 차트 + SMA 라인 오버레이
  - MA 비활성 시: 기존 PortfolioSnapshot 기반 차트 로직 유지 (폴백)
  - KRW 토글이 MA 데이터에도 동일 적용
  - 현금(CASH) 자산은 MA 토글 숨김
  - 과거 시세 모듈 레벨 캐시 (TTL 10분)
  - MA 토글 설정은 localStorage에 저장
- **새로운 파일**:
  - `utils/maCalculations.ts`: SMA 계산, 차트 데이터 빌드, MA 설정 상수 (순수 함수)
  - `hooks/useHistoricalPriceData.ts`: 과거 시세 fetch 훅 (주식/암호화폐 자동 분기, 캐시 내장)
- **수정된 파일**:
  - `components/AssetTrendChart.tsx`: MA 토글 UI, 과거 시세 기반 차트 데이터, 동적 MA 라인 렌더링 추가
  - `components/portfolio-table/PortfolioTableRow.tsx`: AssetTrendChart에 `ticker`, `exchange`, `category` props 전달
- **의존 관계 추가**:
  - `AssetTrendChart.tsx` → `useHistoricalPriceData`, `maCalculations`
  - `useHistoricalPriceData.ts` → `historicalPriceService.ts`, `maCalculations.ts`
  - `PortfolioTableRow.tsx` → `AssetTrendChart` (기존, props 3개 추가)

## 2026-02-02: 포트폴리오 테이블 툴팁 기능 추가
- **기능 추가 — 컬럼 계산 방법 툴팁**:
  - 테이블 헤더 및 데이터 셀에 마우스 오버 시 해당 항목의 계산 방법을 툴팁으로 표시
  - 예: 최고가 대비 → "(현재가 - 52주 최고가) / 52주 최고가 × 100"
- **기능 개선 — 메모 툴팁**:
  - 기존 브라우저 기본 `title` 속성을 커스텀 툴팁으로 교체 (빠른 반응 속도)
  - 긴 메모는 자동 줄바꿈, 입력 시 줄바꿈도 유지
- **새로운 파일**:
  - `components/common/Tooltip.tsx`: 공용 툴팁 컴포넌트 (CSS-only, `wrap` prop으로 줄바꿈 제어)
  - `constants/columnDescriptions.ts`: 컬럼별 계산 방법 설명 상수
- **수정된 파일**:
  - `components/PortfolioTable.tsx`: 헤더에 Tooltip 적용
  - `components/portfolio-table/PortfolioTableRow.tsx`: 데이터 셀 및 메모에 Tooltip 적용
- **의존 관계**:
  - `PortfolioTable.tsx` → `Tooltip`, `COLUMN_DESCRIPTIONS`
  - `PortfolioTableRow.tsx` → `Tooltip`, `COLUMN_DESCRIPTIONS`

## 2026-02-02: 히스토리 백필(Backfill) 기능 구현
- **기능 추가 — 실제 과거 시세로 히스토리 채우기**:
  - 앱을 안 열었던 날의 데이터를 **실제 과거 종가**로 채움 (기존: 마지막 스냅샷 복사)
  - 주식/ETF: Cloud Run `/history` 엔드포인트 (FinanceDataReader)
  - 암호화폐: Cloud Run `/upbit/history` 엔드포인트 (Upbit Candles API)
  - **데이터 소스 분리 원칙 준수**: 실시간 시세와 동일한 API 소스 사용 (일관성)
- **폴백 처리**:
  - API 실패 시 기존 `fillAllMissingDates()`로 자동 폴백
  - 90일 초과 누락 시 API 부하 방지를 위해 기존 보간 방식 사용
- **새로운 파일**:
  - `services/historicalPriceService.ts`: 백필 API 호출 서비스
- **수정된 파일**:
  - `main.py` (Cloud Run): `fetch_historical_prices()`, `fetch_upbit_candles()` 함수 및 `/history`, `/upbit/history` 엔드포인트 추가
  - `utils/historyUtils.ts`: `backfillWithRealPrices()`, `getMissingDateRange()` 함수 추가
  - `hooks/usePortfolioData.ts`: 로드 시 자동 백필 로직 추가
- **의존 관계 변경**:
  - `usePortfolioData.ts` → `historyUtils.ts`의 `backfillWithRealPrices`, `getMissingDateRange` 사용
  - `historyUtils.ts` → `historicalPriceService.ts`의 백필 API 함수들 사용

## 2026-02-02: 환율 조회를 Gemini API에서 Cloud Run으로 이전
- **기능 변경 — 환율 조회 API 이전**:
  - Gemini API 사용을 줄이기 위해 환율 조회를 Cloud Run (FinanceDataReader)으로 이전
  - 현재 환율 및 과거 날짜 환율 모두 지원
- **새로운 엔드포인트**: Cloud Run `/exchange-rate`
  - 요청: `{ "from": "USD", "to": "KRW", "date": "2024-01-15" }` (date는 선택)
  - 응답: `{ "rate": 1350.5, "date": "2024-01-15", "from": "USD", "to": "KRW" }`
- **영향받는 파일**:
  - `main.py` (Cloud Run): `fetch_exchange_rate()` 함수 및 `/exchange-rate` 엔드포인트 추가
  - `services/priceService.ts`: `fetchCurrentExchangeRate()`, `fetchHistoricalExchangeRate()` 함수 추가
  - `hooks/useMarketData.ts`: import 경로 변경 (geminiService → priceService)
  - `hooks/useAssetActions.ts`: import 경로 변경 (geminiService → priceService)
  - `services/geminiService.ts`: 환율 관련 함수 제거
- **의존 관계 변경**:
  - 환율 조회: `geminiService.ts` → `priceService.ts` (Cloud Run `/exchange-rate`)
  - Gemini API 사용처: 종목 검색(`searchSymbols`), 포트폴리오 AI 분석(`askPortfolioQuestion`)만 유지

## 2026-01-31: Google Drive 저장 최적화 및 자동 업데이트
- **기능 추가 — LZ-String 압축**:
  - 저장 시 LZ-String UTF16 압축 적용으로 파일 크기 70-80% 감소
  - 레거시 호환: 압축되지 않은 기존 파일도 정상 로드
- **기능 추가 — 앱 시작 시 자동 시세 업데이트**:
  - 마지막 업데이트 날짜(`lastUpdateDate`) 확인
  - 오늘 업데이트 안 했으면 자동으로 시세 갱신
- **기능 추가 — 히스토리 보간(Interpolation)**:
  - 앱을 안 열었던 날의 데이터를 마지막 스냅샷으로 자동 채움
  - `fillAllMissingDates()` 함수로 중간 빈 날짜도 보간
- **새로운 파일**: `utils/historyUtils.ts`
- **의존 관계**:
  - `googleDriveService.ts` → `lz-string` 패키지 의존성 추가
  - `usePortfolioData.ts` → `historyUtils.ts`의 `fillAllMissingDates` 사용
  - `PortfolioContext.tsx` → `shouldAutoUpdate` 플래그 기반 자동 업데이트 트리거

## 2026-01-30: Google Drive 공유 폴더 지원 추가
- **기능 추가 — 다중 계정 데이터 공유**:
  - OAuth scope를 `drive.file` → `drive`로 변경하여 공유 폴더 접근 권한 확보
  - Google Drive API 호출 시 `supportsAllDrives`, `includeItemsFromAllDrives` 파라미터 추가
  - 동일 폴더를 공유받은 계정들이 같은 `portfolio.json` 파일 참조 가능
- **설정 방법**:
  1. Google Cloud Console에서 OAuth 동의 화면에 `drive` scope 추가
  2. Google Drive에서 데이터 폴더를 다른 계정과 "편집자" 권한으로 공유
  3. 기존 로그인 세션 로그아웃 후 재로그인 (새 scope 적용)
- **영향받는 파일**:
  - `services/googleDriveService.ts` (scope 변경, API 파라미터 추가)

## 2026-01-28: 수익통계 매도 손익 계산 로직 개선
- **버그 수정 — 추가매수 후 과거 매도 손익이 잘못 계산되는 문제**:
  - **문제**: 보유 종목을 추가매수하면 평균 매수가가 변경되어, 과거 매도 기록의 손익이 변경된 평균가 기준으로 재계산됨 (예: 수익이었던 매도가 손실로 표시)
  - **원인**: `SellAnalyticsPage.tsx`의 `recordWithCalc`에서 보유 자산이 존재하면 스냅샷을 무시하고 현재 자산의 평균 매수가를 사용
  - **해결**: 스냅샷 필드(`originalPurchasePrice` 등)가 존재하면 **우선 사용**하고, 스냅샷이 없는 경우에만 현재 자산 정보로 폴백하도록 로직 변경
- **영향받는 파일**:
  - `components/SellAnalyticsPage.tsx` (수익률 계산 우선순위 변경)

## 2026-01-28: 보유 종목 추가매수 기능 추가
- **기능 추가 — 추가매수 모달 및 로직**:
  - 포트폴리오 테이블의 '관리' 드롭다운 메뉴에 '매수' 버튼 추가 (매도 버튼 위에 위치, 초록색 텍스트)
  - '매수' 클릭 시 추가매수 모달(`BuyMoreAssetModal.tsx`) 표시
  - 모달에서 매수일자, 매수가, 매수 수량 입력 → 예상 매수금액, 변경 후 평균단가, 변경 후 총 수량 실시간 미리보기
  - 추가매수 확인 시:
    - **가중평균 매수단가** 자동 계산: `(기존수량 × 기존단가 + 추가수량 × 추가단가) / 총수량`
    - **외화 자산 환율** 가중평균 재계산: 매수일 기준 환율 조회 후 기존 환율과 가중평균
    - **매수일자** 유지: 최초 매수일 변경 없음
    - **메모에 이력 기재**: `(YY.M.DD xx주 xxx원 추가매수)` 형식으로 자동 기록
- **새로운 파일**: `components/BuyMoreAssetModal.tsx`
- **의존 관계**:
  - `useAssetActions.ts` → `handleConfirmBuyMore` 함수 추가 (외화 환율 조회를 위해 `geminiService.fetchHistoricalExchangeRate` 사용)
  - `PortfolioContext.tsx` → `buyingAsset` 상태, `openBuyModal`/`closeBuyModal`/`confirmBuyMore` 액션 추가
  - `types/store.ts` → `ModalState.buyingAsset`, `PortfolioActions.confirmBuyMore`/`openBuyModal`/`closeBuyModal` 타입 추가
  - `types/ui.ts` → `PortfolioTableProps.onBuy` prop 추가
  - `PortfolioTableRow.tsx` → 드롭다운 메뉴에 `onBuy` 콜백 연결
  - `PortfolioTable.tsx` → `onBuy` prop 수신 및 Row로 전달
  - `PortfolioView.tsx` → `onBuy={actions.openBuyModal}` 연결
  - `App.tsx` → `BuyMoreAssetModal` 렌더링 추가

## 2026-01-27: 수익 통계 수익률 계산 오류 수정 및 매도 알림 설정 영구 저장
- **버그 수정 1 — 완전 매도 자산 수익률 0% 표시 문제**:
  - **문제**: 자산을 전량 매도(삭제)한 뒤, '수익 통계' 탭에서 해당 매도 기록의 수익률이 항상 `0.00%`로 표시됨
  - **원인**: `SellAnalyticsPage.tsx`의 `recordWithCalc`에서 현재 보유 자산(`assets`)만 참조하여 매수가를 조회했기 때문에, 전량 매도 후 삭제된 자산은 매수가를 `0`으로 계산
  - **해결**: `SellRecord`에 저장된 스냅샷 필드(`originalPurchasePrice`, `originalPurchaseExchangeRate`, `originalCurrency`)를 활용하는 `toKRWPurchaseFromRecord()` 함수 추가. 보유 자산에서 조회 실패 시 매도 기록의 스냅샷 데이터로 폴백
- **기능 추가 — 매도 기록 목록 테이블**:
  - '수익 통계' 탭 하단에 개별 매도 기록을 확인할 수 있는 테이블 추가
  - 매도일, 종목명, 티커, 수량, 매도금액, 매수금액, 실현손익, 수익률 컬럼 제공
  - 매도일 기준 최신순 정렬, 손익에 따른 색상 구분(녹색/빨간색)
- **버그 수정 2 — 매도 알림 하락률(`sellAlertDropRate`) 미저장 문제**:
  - **문제**: 매도 알림 '최고가대비' % 설정값이 페이지 새로고침 시 기본값(15%)으로 초기화됨
  - **원인**: `sellAlertDropRate`가 `PortfolioContext`의 로컬 `useState`로만 관리되어 Google Drive 저장/로드 체인에 포함되지 않음
  - **해결**: `useGoogleDriveSync` → `usePortfolioData` → `PortfolioContext` 전체 영속화 체인에 `sellAlertDropRate` 추가
- **영향받는 파일**:
  - `components/SellAnalyticsPage.tsx` (수익률 계산 수정 + 매도 기록 테이블 추가)
  - `hooks/useGoogleDriveSync.ts` (`LoadedData` 타입 및 `autoSave`/`loadFromGoogleDrive`에 `sellAlertDropRate` 추가)
  - `hooks/usePortfolioData.ts` (`sellAlertDropRate` 상태 관리 및 영속화)
  - `hooks/usePortfolioExport.ts` (`triggerAutoSave` 타입 시그니처 업데이트)
  - `contexts/PortfolioContext.tsx` (로컬 상태를 영속화된 값으로 교체)

## 2026-01-19: 매도 자산 통계 및 수익률 계산 개선
- **문제**: 자산 전량 매도 후 목록에서 삭제 시, 대시보드 매도 통계에서 제외되고 수익금 계산이 불가능한 문제 발생
- **해결**:
  1. `SellRecord` 타입에 매수 당시 정보(`originalPurchasePrice`, `originalPurchaseExchangeRate` 등) 필드 추가
  2. 매도 확정(`handleConfirmSell`) 시점에 매수 정보를 스냅샷하여 영구 저장
  3. `usePortfolioCalculator`의 매도 통계 로직을 `assets`(보유 자산) 기준에서 `sellHistory`(전체 매도 이력) 기준으로 변경
- **영향받는 파일**:
  - `types/index.ts`
  - `hooks/useAssetActions.ts`
  - `hooks/usePortfolioCalculator.ts`
  - `hooks/usePortfolioStats.ts`
  - `contexts/PortfolioContext.tsx`

## 2026-01-15: 리밸런싱 목표 금액 저장 기능 추가
- **기능 추가**: 목표 총 자산 금액(`targetTotalAmount`) 저장 기능 구현
  - `AllocationTargets` 타입 확장 (`weights` + `targetTotalAmount`)
  - Google Drive 연동 및 JSON 내보내기/가져오기 지원
  - 데이터 마이그레이션 로직 추가 (구버전 호환성 확보)
- **영향받는 파일**:
  - `types/index.ts`
  - `hooks/useRebalancing.ts`, `hooks/usePortfolioData.ts`, `hooks/usePortfolioExport.ts`
  - `contexts/PortfolioContext.tsx`

## 2026-01-14: 대시보드 리밸런싱 및 수익률 분석 개선
- **기능 추가**: 포트폴리오 리밸런싱 목표 비중(%) 저장 기능 구현
  - `allocationTargets` 데이터 필드 추가 및 Google Drive 동기화
  - `useRebalancing` 훅으로 로직 분리
- **버그 수정**: 수익률 TOP5/BOTTOM5 분석 오류 수정
  - 외화 자산의 원화 환산 수익률 계산 로직 정교화 (현재 환율 및 매수 환율 반영)
  - `useTopBottomAssets` 훅으로 로직 분리 및 평가손익(KRW) 표시 추가
- **영향받는 파일**:
  - `types/index.ts`, `types/store.ts`
  - `hooks/useGoogleDriveSync.ts`, `hooks/usePortfolioData.ts`
  - `components/dashboard/RebalancingTable.tsx`, `components/dashboard/TopBottomAssets.tsx`
  - `hooks/useRebalancing.ts`, `hooks/useTopBottomAssets.ts` (신규)

## 2025-01-13: 외화 자산 차트 개선
- **문제**: 외화 자산의 과거 데이터가 원화(KRW)로 저장되어 있어, 차트에서 외화 단위(USD/JPY)로 볼 때 값의 단위가 맞지 않는 문제 발생
- **해결**:
  1. `AssetTrendChart`에 원화/외화 보기 토글 기능 추가
  2. 외화 모드 시, 과거 데이터의 `unitPriceOriginal`(외화 원본) 우선 사용
  3. 원본 데이터가 없는 과거 구간은 현재 환율을 역산하여 외화 가치 추정 표시
  4. `PortfolioTableRow`에서 정확한 환율 정보를 차트로 전달하도록 구조 개선
- **영향받는 파일**:
  - `components/AssetTrendChart.tsx`
  - `components/portfolio-table/PortfolioTableRow.tsx`
  - `hooks/usePortfolioHistory.ts`

## 2025-01-11: 수익률 계산 환율 기준 통일
- **문제**: 대시보드 총 수익률과 손익분석 차트의 수익률이 다르게 표시됨
- **원인**: 대시보드는 실시간 환율로 매수가를 계산, 차트는 구매 당시 환율로 계산
- **해결**:
  1. `usePortfolioCalculator.ts`에 `getPurchaseValueInKRW()` 함수 추가
  2. 매수가 계산 시 `purchaseExchangeRate`(구매 당시 환율) 우선 적용
  3. 구매 환율이 없는 기존 자산은 현재 환율로 폴백 (하위 호환성)
- **영향받는 파일**:
  - `hooks/usePortfolioCalculator.ts`
- **결과**: 대시보드와 손익 차트의 수익률이 동일하게 표시됨
- **※ 후속(2026-09-05)**: 이 "매수 당시 환율로 통일" 규약은 폐기되지 않고 **「원화 기준 (환율 포함)」 모드로 보존**된다. 다만 기본값은 국내 증권사와 같은 **달러 기준**으로 바뀌었다 — 여기서 해결한 것은 화면 간 불일치였고, 남아 있던 문제는 "통일된 그 기준이 증권사 표기와 다르다"는 것이었다. 최상단 항목 참조

## 2024-XX-XX: 암호화폐 시세 조회 개선
- **문제**: Cloud Run 서버에서 암호화폐 시세 조회 실패 (빈 응답 반환)
- **원인**: FinanceDataReader가 암호화폐를 지원하지 않음
- **해결**:
  1. Cloud Run 서버에 `/upbit` 엔드포인트 추가 (업비트 API 프록시)
  2. `useMarketData.ts`에서 `exchange` 기준 분기 처리
  3. `upbitService.ts`가 Cloud Run 프록시 호출하도록 수정
- **영향받는 파일**:
  - `main.py` (Cloud Run 서버)
  - `hooks/useMarketData.ts`
  - `services/upbitService.ts`
