# 90/10 실행 시스템 구축 계획서

> **이 문서의 목적**: 새 구현 세션(Opus 4.8)이 이 문서만 읽고 구현을 시작할 수 있는 자립형 계획.
> 작성: 2026-07-04 (Claude Fable 5, 진단/계획 세션). 구현 전 필독: 이 문서 → `CLAUDE.md` → `RULES.md`.
> 터틀 규칙 원전: `C:\Users\beari\Desktop\dev\test\터틀트레이딩_통합검증_최종본.md` (교차검증 완료본, §14 규칙 카드가 구현 기준)

---

## 0. 배경 요약 (사용자 상황)

- 총평가 약 9.5억, 총손익 -1.35억(-12.4%). 94종목 중 60개 손실, 총자산 1% 미만 "먼지 포지션" 70개.
- **핵심 문제는 정보가 아니라 실행**: 감정 개입으로 매도 못함 → 시점 놓침 → 악순환.
- 전환 목표: 자산의 **90% 정적 자산배분**(목표 비중 고정 + 밴드 리밸런싱) + **10% 터틀 트레이딩**(55일 돌파 매수, N 기반 손절/청산).
- 앱의 역할 재정의: 신호 생산자 → **주문서 발행자 + 실행 감독자**. 판단은 규칙이, 사용자는 체크만.

기존 앱의 실패 원인 (진단 세션 결론, 2개 AI 교차진단으로 확정):
1. 신호가 구체적 주문(종목·수량·가격)으로 번역되지 않음
2. 신호가 휘발됨 (하루 1회 팝업, 닫으면 끝)
3. 실행 추적/에스컬레이션 없음 (신호와 SellRecord가 연결 안 됨)
4. 신호가 예측형이라 "이번엔 틀렸을 거야" 자기합리화 가능
5. **손절이 "결과 기준"이지 "약속 기준"이 아님** (코드 검증 완료): 손절 알림은 `수익률 ≤ -N%`(`constants/alertRules.ts`의 `LOSS_THRESHOLD`) — 배팅 규모에 따라 실손실이 달라지는, 터틀 문서 §7이 명시적으로 틀렸다고 지적하는 방식. `PositionSizingCalculator.tsx`는 리스크 기반 수량을 계산하지만 손절 프리셋이 진입가 대비 %(5/8/10%)이고 **계산된 손절가를 포지션에 저장하지 않음** → 약속이 안 됨. 추가매수(`useAssetActions.ts`)는 평균단가만 재계산 → 규칙 없는 물타기에 무방비.

---

## 1. 확정된 의사결정 (2026-07-04, 사용자 승인)

### D1. 기존 앱 확장 (재작성 아님)
- 근거: 어려운 부분(Cloud Run 시세/히스토리 파이프라인, Google Drive OAuth+JWT 동기화, 10년 OHLCV NaN 방어, 종목검색, 스냅샷 무결성 파이프라인, 환율 캐시)은 이미 구축·검증됨. 재작성 시 이것들을 전부 다시 풀어야 함.
- 신규 기능은 **추가 레이어**(신규 타입 + 순수 유틸 + 훅 + 신규 탭)라 기존 신호 코드와 결합도가 낮음.
- 전략: **스트랭글러 패턴** — 신규 "실행(Execution)" 탭을 기본 화면으로 만들고, 기존 화면은 유지하되 예측형 신호를 참고 지표로 강등(Phase 5). 사용자 체감상 "새 앱"이지만 인프라는 재사용.

### D2. 기존 손실종목 처리 정책
- 전 종목을 3분류: **① 코어 편입**(자산배분 구성요소: ETF/실물/채권/메이저코인) **② 터틀 후보**(일단 매도, 55일 돌파 신호 시에만 재진입) **③ 청산 대상**.
- 판단 테스트: "오늘 이 가격에 신규 매수하겠는가?" — No면 보유 근거 없음. **정적 자산배분에 개별주 자리는 없다** → 개별주는 원칙적으로 ② 아니면 ③.
- CSV 기준 분류 수치(2026-07-04): 코어 후보 29종목 6.94억(72.8%) / 개별주·알트·테마 65종목 2.59억(27.2%, 이 중 손실 51종목 미실현손실 -1.18억).
- 세금 통산 카드: 해외주식 양도세는 연간 이익-손실 통산. 이익 실현(인텔 +857만, 미쓰비시 +446만 등)과 손실 실현을 **같은 해에** 묶을 것. ⚠️ **BMNR(-2,919만), 유선_BMNR(-76만), CRCL(-256만)은 앱 분류상 '암호화폐'지만 실제로는 NYSE 상장 미국주식** → 양도세 통산 대상. 이 손실 카드만으로 해외 이익 대부분 상계 가능.
- 국내주식은 (대주주 아니면) 양도세 없음 → 세금 장벽 자체가 없음. -50% 이하 23종목의 현재 평가액 합은 총자산의 3.7%뿐.
- 앱 역할: Phase 3 대청소 위저드가 분류 → 절세 시뮬레이션 → `CLEANUP_SELL` 주문을 실행 큐에 일괄 생성.

### D3. 신규 기능 범위 — 신규매수 / 불타기(피라미딩) / 규칙성매도 모두 포함
- 상세 스펙은 §5. 불타기는 터틀 원본 피라미딩 규칙(직전 체결가 +0.5N마다 추가, 손절 동반 상향)으로 구현하되 **기본 최대 2유닛**(설정으로 4까지). **물타기(하락 시 추가매수)는 구조적으로 불가능하게** — 추가매수 조건이 "직전 체결가보다 0.5N 위"이므로 자동 차단되나, UI에서도 수동 물타기 진입점을 만들지 말 것.

### D4. 1% 손실규칙의 적용 범위 = **투더문(위성 10%) 전용**
- **코어(90%)에는 손절 없음.** 정적 자산배분의 리스크 관리는 자산군 분산 + 밴드 리밸런싱이며, 손절과 리밸런싱은 논리적으로 모순임(리밸런싱은 떨어진 자산군을 "사라"고 하고, 손절은 "팔라"고 함 — 코어에 2N 손절을 붙이면 자산배분이 추세추종으로 변질되어 두 시스템 모두 망가짐).
- 유닛 사이징의 "계좌" = **위성 예산**(총자산의 10%, 최초 약 0.95억). 거래당 리스크 = 위성 예산의 0.5%(시작값, ~48만원) → 2N 손절 시 실손실 = 위성 예산의 1%.
  - 분모 표기 주의: "위성 예산의 0.5%" = "총자산의 0.05%". 총자산을 분모로 쓰는 표기(교차검토 AI 제안: 총자산 0.25~0.5%)는 같은 규칙의 다른 표현이지만 값이 5~10배 커서 위성 내부에서는 과대 베팅이 됨. **혼동 방지를 위해 코드와 UI의 분모는 위성 예산으로 통일**하고, 설정 화면에 "= 총자산의 ○%" 환산을 병기.
- 동시 전멸 한도 12%도 위성 예산 기준(~1,140만원) = **총자산 기준 최대 피해 약 1.2%**. 터틀이 전부 손절당해도 전체 자산은 흔들리지 않는 격리 구조.
- 드로다운 감쇄(위성 예산 -10%마다 계산 기준 20% 축소)도 위성에만 적용.
- 권장(앱 밖): 위성 자금은 별도 증권 계좌로 물리 분리.

### D5. 신호 다이어트
- 행동 신호(주문 생성 권한)는 **터틀 3종(진입/청산/손절) + 리밸런싱 밴드 이탈 + 대청소 주문**만.
- 구루 신호 4종·스마트필터 매매신호·리스크 매트릭스는 "참고 지표"로 강등(제거 아님, 접힌 섹션/설정 토글로 이동). 리플레이·지식DB·진단 패널은 불변.

### D6. 통화 규약 (2026-07-05 확정, 2개 AI 교차검토 합의) — **엔진 정확성의 핵심**
포트폴리오는 KRW/USD/JPY/코인이 섞이므로, 터틀 엔진 입력을 통화별로 엄격히 구분한다. 규칙: **돈=KRW / 가격=종목통화 / FX는 두 지점에서만.**
- **가격-공간 (종목 통화 원본, priceOriginal — KRW 환산·역환산 금지):** `entryPrice`, `stopPrice`, `donchianHigh/Low`, 피라미딩 트리거, `nAtFill`(=N). **Drive 저장·차트·주문 UI 전부 원통화.**
  - 이유: **손절가는 앱 내부 지표가 아니라 증권사에 거는 실제 주문 가격이자 "약속"이다.** KRW로 저장 후 역환산하면 환율이 움직일 때 손절선이 흔들린다(예: NVDA 손절 $99를 진입 시 1400으로 138,600원 저장 → 환율 1478 시 역환산하면 $93.8로 $5 어긋남). 약속은 환율 따라 움직이면 안 된다.
- **돈-공간 (KRW):** `satelliteBudgetKRW`, `riskAmountKRW`, `positionValueKRW`, `openRiskKRW`, 그리고 `maxTotalRiskPct`(12%)·`positionValueCapPct`(25%) 판정.
- **FX 다리는 딱 두 지점:**
  1. 수량 산정: `qty = riskAmountKRW / (nOriginal × fxRate × dollarPerPoint)`
  2. 오픈 리스크 합산: `riskKRW = qty × max(0, fillPriceOriginal − stopPriceOriginal) × fxRate × dollarPerPoint`
- **환율 스냅샷**: `fxRateAtFill`을 유닛에 저장(감사·추적용)하되, **저장된 KRW 손절가를 역환산해 원통화 손절가를 만들지 않는다.** 리스크 게이지(openRiskKRW)는 **최신 환율**로 재환산 OK — 손절선 자체는 불변.
- KRW 자산은 `fxRate = 1`이라 규약이 항등으로 성립(기존 단일통화 테스트 불변).
- 구현: `computeUnitSize`/`evaluateEntry`는 `fxRate` 파라미터 수신, `computeTotalOpenRisk`는 포지션별 현재 환율 resolver 수신. Phase 2 호출부(useActionQueue)가 자산→통화→환율을 매핑해 주입.

---

## 2. 기존 인프라 재사용 맵 (구현 세션이 먼저 확인할 것)

| 필요 기능 | 이미 있는 것 | 위치 |
|---|---|---|
| N (20일 ATR) | `calculateATR(highs, lows, closes, period=14)` — Wilder smoothing, period 파라미터만 20으로 | `utils/maCalculations.ts` |
| OHLCV 히스토리 | 전 종목 ~440일 자동 수집(`useEnrichedIndicators`), 차트용 10년(`useHistoricalPriceData`), 서비스 `historicalPriceService.ts`(open/high/low optional — 미수신 폴백 주의) | `hooks/`, `services/` |
| 52주 신고가 | `calculate52WeekHigh`, enriched `high52w` — 55일 돌파는 **별도 유틸 신규 필요** | `utils/maCalculations.ts` |
| 포지션 사이징 | `positionSizing.ts` (1% 리스크 계산) — 터틀 공식으로 확장/재사용 | `utils/` |
| 코어/위성 구분 | `Asset.bucket`('CORE'\|'SATELLITE'), `types/bucket.ts`, `utils/bucketRebalancing.ts`, `useRebalancing`(2단 리밸런싱, 목표비중·차액 계산까지 구현됨 — 수량 번역/주문 생성만 없음) | 각 파일 |
| 매도 기록 | `SellRecord`/`sellHistory`, `handleEditSellRecord` 등 | `useAssetActions.ts` |
| 관심종목 | `WatchlistItem` + 시세 갱신 + 52주 최고가 — 터틀 후보 플래그 추가해 재사용 | `useMarketData.ts` |
| Drive 영속 | `LoadedData`/load파싱/`autoSave` 시그니처/`exportData` — **새 최상위 키 추가 시 4곳 동시 수정** (knowledgeBase 추가 때와 동일 패턴) | `useGoogleDriveSync.ts`, `usePortfolioData.ts` |
| 알림/팝업 | `useAutoAlert` 파이프라인 — 실행 큐는 이것과 **별개 축**으로 (팝업은 휘발, 큐는 영속) | `hooks/useAutoAlert.ts` |
| 수량 계산기 UI | `PositionSizingCalculator.tsx` — 리스크→수량 계산 UI 존재. 터틀 진입 시 손절가에 `진입가−2N` prefill + 결과를 `TurtlePosition.stopPrice`로 **저장**하도록 확장 (현재는 %프리셋·미저장) | `components/common/` |
| CSV 왕복 | ⚠️ **불일치 확인됨**: 내보내기는 한글 헤더(`종목명,티커,...`, `usePortfolioExport.ts:157`), 업로드는 영문 헤더(`ticker,exchange,quantity,...`, `useAssetActions.ts:582`) — 왕복 불가. Phase 3에서 해결 | `hooks/` |

---

## 3. 신규 데이터 모델

### `types/turtle.ts`
```ts
interface TurtleUnit { fillDate: string; fillPrice: number; quantity: number; nAtFill: number; }
interface TurtlePosition {
  id: string; ticker: string; name: string; assetId?: string;   // 실행 후 Asset과 연결
  units: TurtleUnit[];                                          // 최초 진입 = units[0]
  stopPrice: number;                                            // 마지막 체결가 - 2N (피라미딩 시 재계산)
  entryDonchianHigh: number;                                    // 진입 근거 스냅샷
  status: 'open' | 'closed';
  openedAt: string; closedAt?: string;
  exitReason?: 'stop' | 'channel-exit' | 'manual';
}
interface TurtleSettings {
  satelliteBudgetKRW: number;        // 위성 예산 (수동 입력, 기본 총자산 10%)
  riskPerUnitPct: number;            // 기본 0.5 (위성 예산 대비 %)
  maxUnitsPerPosition: number;       // 기본 2, 상한 4
  entryLookback: number;             // 기본 55
  exitLookback: number;              // 기본 20
  stopMultipleN: number;             // 기본 2
  pyramidStepN: number;              // 기본 0.5
  maxTotalRiskPct: number;           // 기본 12 (동시 전멸 한도, 위성 예산 대비)
  positionValueCapPct: number;       // 기본 25 (1종목 매수금액 ≤ 위성 예산의 25%)
  drawdownScalingEnabled: boolean;   // 드로다운 감쇄 (기본 true)
}
```

### `types/actionQueue.ts`
```ts
type ActionKind = 'TURTLE_ENTRY' | 'TURTLE_PYRAMID' | 'TURTLE_STOP' | 'TURTLE_EXIT'
                | 'REBALANCE_SELL' | 'REBALANCE_BUY' | 'CLEANUP_SELL';
interface ActionItem {
  id: string; createdDate: string;             // YYYY-MM-DD
  kind: ActionKind; ticker: string; name: string;
  quantity: number; refPrice: number;          // 생성 시점 기준가 (priceOriginal 기준)
  reasonText: string;                          // "55일 신고가(₩12,340) 돌파" 등 사람이 읽는 근거
  ruleSnapshot: Record<string, number>;        // 생성 당시 파라미터 (N, 돌파가, 손절가 등)
  status: 'pending' | 'done' | 'skipped' | 'snoozed';
  resolvedDate?: string; skipReason?: string;  // 건너뜀은 사유 필수
  snoozedUntil?: string;                       // "내일 재알림" — 해당 일자에 pending으로 복귀, 연속 스누즈 횟수는 에스컬레이션에 반영
  linkedSellRecordId?: string;                 // 실행 시 SellRecord와 연결
}
```
- **영속: Google Drive** (localStorage 아님 — 다기기·데이터 무결성). `LoadedData` 4곳 패턴 준수.
- `daysIgnored`는 파생값(오늘 - createdDate, pending만) — 저장하지 않고 계산.

---

## 4. Phase 계획 (각 Phase는 독립 커밋 가능 단위, 사용자가 GitHub Desktop으로 커밋)

### Phase 1 — 터틀 엔진 (순수 유틸 + 테스트, UI 없음)
- `utils/donchianChannel.ts`: `calculateDonchianHigh/Low(highs|lows, lookback, {excludeToday: true})` — **당일 제외** rolling max/min (당일 포함 시 돌파 판정 불능). high/low 미수신 종목은 종가 폴백(폴백 여부 반환).
- `utils/turtleEngine.ts` (전부 순수 함수):
  - `computeN(highs, lows, closes)` → `calculateATR(..., 20)` 재사용
  - `computeUnitSize(settings, n, price)` → 수량 + 25% 상한 적용 여부 + 예산 잔여 검증
  - `evaluateEntry(candidate, donchianHigh55, price, n, settings, currentTotalRisk)` → TURTLE_ENTRY 주문안 | null (12% 한도·예산 초과 시 사유와 함께 차단)
  - `evaluatePyramid(position, price, n, settings)` → 마지막 체결가 + 0.5N 상회 && units < max → TURTLE_PYRAMID 주문안
  - `recomputeStop(position)` → 전 유닛 손절 = 마지막 체결가 − 2N(체결 시 N)
  - `evaluateStop(position, price)` / `evaluateExit(position, donchianLow20, price)` → TURTLE_STOP/EXIT 주문안
  - `computeTotalOpenRisk(positions, settings)` → "전 포지션 동시 손절 시 손실 %" (대시보드 게이지용)
  - `applyDrawdownScaling(budget, peakBudget)` → -10%마다 20% 축소된 계산 기준
- `tests/turtleEngineParity.ts`: 터틀 문서 §4·§7 예시(난방유 16계약, 금 피라미딩 310→313.75 손절 308.75)를 그대로 단언. 기존 테스트 스타일(`npm run test:*`) 준수.
- 수용 기준: 문서 예시 재현 + 경계(수량 0, N=0/null, 데이터 부족 시 주문 미생성 fail-closed) 단언.

### Phase 2 — "오늘의 주문서" 실행 큐 (핵심 UI)
- `hooks/useActionQueue.ts`: 큐 상태 + Drive 영속 + 생성기 실행(시세 갱신 후 터틀 평가 → 신규 ActionItem, 같은 (kind,ticker) pending 중복 생성 금지) + `markDone`/`markSkipped(사유 필수)`.
- `components/execution/ExecutionView.tsx`: **새 기본 탭**. pending 주문 카드(종목/행동/수량/기준가/근거/경과일), 액션은 3개뿐: **실행 완료 / 건너뜀(사유 필수) / 내일 재알림(스누즈)**. 3일+ 무시 또는 연속 스누즈 시 시각 에스컬레이션. 매도 실행 → 기존 `SellAssetModal` prefill, 매수 실행 → `AddNewAssetModal` prefill(bucket='SATELLITE'). 완료 시 SellRecord와 연결.
- 보유 위성 포지션마다 **손절선·청산선 상시 표시** (테이블 + `PortfolioMobileCard` 필수 반영).
- 위성 리스크 게이지: "동시 전멸 시 −N% / 한도 12%".
- 수용 기준: 주문이 하루가 지나도 남는다 / 스킵에 사유가 강제된다 / 실행-기록이 연결된다.

### Phase 3 — 대청소 위저드 (일회성 이행 도구)
- 전 종목 3분류 UI(코어/터틀 후보/청산). 기본 제안: `bucket`+카테고리로 자동 초안(ETF/실물/채권/메이저코인=코어, 개별주=청산, 사용자가 오버라이드).
- 절세 시뮬레이션: 해외주식(양도세 대상, **BMNR/CRCL처럼 카테고리='암호화폐'지만 거래소가 NYSE/NASDAQ인 종목은 주식으로 취급**) 이익/손실 통산 미리보기.
- 프레이밍 전환 표시: "이 종목들을 팔면 추가로 잃는 것: 0원 (손실은 이미 발생). 회수 현금: ○원".
- 결과 → `CLEANUP_SELL` 주문 일괄 생성 (전량/트랜치 선택). **"전부 즉시 손절"이 아님** — 유동성 낮은 종목·세금·계좌 사정은 트랜치/보류로 흡수하되, 보류에는 사유와 재검토일을 강제.
- **대량 분류 보강**: 94종목 분류의 마찰을 줄이기 위해 테이블에서 다중 선택 → bucket/분류 일괄 변경 UI. (선택 보강: CSV 왕복 — 이 경우 내보내기/업로드 헤더 불일치를 먼저 해결하고 `bucket`·`분류` 컬럼 추가. §2 CSV 왕복 행 참조.)
- 수용 기준: 분류 → 주문 생성까지 한 흐름, 청산 대상 재조정 가능, 위저드는 저장된 분류를 다시 열 수 있음.

### Phase 4 — 코어 리밸런싱 밴드 → 주문
- `useRebalancing` 확장: 카테고리별 **밴드**(기본 ±5%p) 이탈 감지 → 초과 자산군에서 "무엇을 몇 주" 팔고 부족 자산군에서 "무엇을 몇 주" 살지 번역(카테고리 내 대표 ETF 우선) → `REBALANCE_*` 주문 생성.
- 분기 리밸런싱 데이(설정 가능) 알림 + 밴드 이탈은 수시 감지.
- 수용 기준: 밴드 안이면 주문 0건(자주 안 건드리는 게 정상), 이탈 시에만 생성.

### Phase 5 — 신호 다이어트
- 구루 신호 카드·스마트필터 매매신호·리스크 매트릭스를 "참고 지표" 섹션으로 강등(설정 토글로 복구 가능). 자동 팝업의 행동 신호는 실행 큐 기반으로 대체.
- **금지**: 리플레이/지식DB/진단 패널/알림 엔진 코드 삭제. 표시 계층만 이동.

### Phase 6 (선택) — 규율 스코어보드
- 주간 "주문서 준수율 %"(done / (done+skipped+expired)) 대시보드 최상단. 수익률이 아니라 준수율로 자기평가(터틀 §11).

---

## 5. 규칙성 매매 상세 스펙 (D3 상세)

| 기능 | 트리거 | 산출 | 가드 |
|---|---|---|---|
| 신규매수 | 터틀 후보 관심종목이 55일 최고가(당일 제외) 돌파 | 수량 = (위성예산×0.5%)÷N, 손절가 = 진입가−2N | 1종목 ≤ 위성예산 25% / 총 오픈리스크 ≤ 12% / 예산 잔여 / N 미산출 시 주문 안 냄(fail-closed) |
| 불타기 | 오픈 포지션 가격 ≥ 마지막 체결가 + 0.5N | 1유닛 추가 + **전체 손절가를 마지막 체결가−2N으로 상향** | 최대 유닛 수(기본 2) / 물타기 경로 원천 차단 |
| 규칙성매도① 손절 | 가격 ≤ stopPrice | 전량 매도 주문 (예외 없음) | — |
| 규칙성매도② 청산 | 가격 ≤ 20일 최저가(당일 제외) | 전량 매도 주문 | 손절과 별개 장치 (문서 §8) |
| 규칙성매도③ 리밸런싱 | 코어 카테고리 밴드 ±5%p 이탈 | 차액 → 수량 번역 매도/매수 | 밴드 안이면 침묵 |

- 스킵 필터·System 1(20일)은 **구현하지 않음** (문서 §14 초보 카드: 55일 단독).
- 앱은 실시간이 아님(앱 열 때/시세 갱신 시 평가) → 주문서의 손절가·청산가를 **증권사 자동감시주문에 등록하는 워크플로를 UI에 명시** (앱 = 계산·감독, 체결 = 증권사 예약주문). 단 스탑 주문은 갭 하락 시 체결가가 손절가보다 나쁠 수 있음(슬리피지) — 리스크 계산은 이를 감안해 보수적(0.5%)으로 시작.

## 5.5 Phase 2b-2 설계 (2026-07-05 조사 결과 — 머니패스 연결 전 확정)

### 조사 결론 (실제 코드 확인)
세 머니패스 액션 모두 **성공/실패를 반환하지 않고, 생성 id도 반환하지 않는다**:
- `handleAddAsset(newAssetData)` → `Promise<void>`. 에러 내부 catch(rethrow 없음). `Asset.id = Date.now()` **내부 생성** (호출부 미인지). 입력은 `NewAssetForm`(전체 Asset 아님).
- `handleConfirmSell(assetId, sellQuantity, sellPrice, sellDate, settlementCurrency?)` → `Promise<void>`. 에러 catch. **인자 순서가 context `confirmSell(id, sellDate, sellPrice, sellQuantity, currency)`와 달라 어댑터가 재배열**. `SellRecord.id = Date.now()` **내부 생성·미반환**. `finally { setSellingAsset(null) }`로 **성공/실패 무관 모달 닫힘**.
- `handleConfirmBuyMore(assetId, buyQuantity, buyPrice, buyDate)` → `Promise<void>`. 에러 catch. 가중평균 단가 갱신.
- **모달은 fire-and-forget**: `SellAssetModal`은 `onSell(...)`을 await 안 함 → 모달 내 "성공 시점" 후크가 없음.

### 결론: "저장 성공 콜백"을 만들려면 액션 반환값을 바꿔야 한다
현재로는 (a) 성공/실패도, (b) 생성 id(assetId/sellRecordId)도 알 수 없음. "최신 SellRecord 찾기"식 추정은 Codex 경고대로 추적이 깨짐 → **금지**.

### 권장 설계 (4b-2c에서 구현, **사용자 승인 필요**)
1. **세 핸들러를 구조화 결과 반환으로 변경(후방호환)**:
   - `handleAddAsset → Promise<{ ok: true; assetId: string } | { ok: false }>`
   - `handleConfirmSell → Promise<{ ok: true; sellRecordId: string; assetClosed: boolean } | { ok: false }>`
   - `handleConfirmBuyMore → Promise<{ ok: true } | { ok: false }>`
   - 모든 early-return·catch에서 `{ ok: false }`, 성공 지점에서 `{ ok: true, ...id }`. **기존 호출부는 반환 무시 → 일반 매수/매도 흐름 불변**. context 어댑터 + `store.ts` 반환 타입도 동반 수정.
2. **모달 turtle-mode 분기(최소)**: prefill에 `turtleActionId`가 있으면 submit에서 **await 결과** 후 `res.ok`일 때만 완료 처리. 일반 모드는 지금처럼 fire-and-forget(불변).
3. **lifecycle은 실제 저장값 기준**: 사용자가 수량/가격을 바꾸면 그 값으로 `createPositionFromEntry`/`addPyramidUnit`. `ActionItem.refPrice`로 포지션 만들기 **금지**. N·donchianHigh는 `ruleSnapshot`(생성시 원통화)에서, 손절가는 실제 체결가 − stopMultipleN×N로 `recomputeStop`.
4. **kind별 모달**: ENTRY=`AddNewAssetModal`(bucket=SATELLITE) / PYRAMID=`BuyMoreAssetModal` / STOP·EXIT=`SellAssetModal`.
5. **linkedSellRecordId**: confirmSell의 새 반환 `sellRecordId`로 정확 연결.

### 4b-2 하위 분할 (승인 대기)
- **2b-2b**: prefill 타입/상태(ModalState) + done이 kind별 prefilled 모달 열기 + 모달이 prefill로 폼 채움. **저장은 일반 경로(lifecycle 미연결)** — 단, 이 중간상태는 "자산 생성됐으나 포지션 없음"이 될 수 있어 **테스트 전용, 미배포**.
- **2b-2c**: 위 반환값 변경 + 모달 turtle-mode 분기 + 저장 성공 시에만 `done`+lifecycle+linkedSellRecordId. 취소/실패 시 pending 유지.

### 4b-2c/2d 구현 중 발견한 설계 이슈 2건 (2026-07-05, 승인 필요)

**이슈 A — 3개 기존 모달 개조는 위험/고비용.** `AddNewAssetModal`은 검색 기반이라 prefill이 크고 `onAddAsset`을 `(asset:any)=>void`로 캐스팅해 **반환값을 버림**. 3개 복잡 모달(Add/BuyMore/Sell)에 각각 prefill+turtle-mode submit+결과처리를 넣는 건 머니패스 위험이 큼.
- **권장: 전용 `TurtleExecuteModal` 신설.** 주문(kind·종목·제안수량·제안가·손절선·N)을 보여주고 사용자가 실제 체결일/가/수량을 확정 → **기존 context 액션(addAsset/confirmBuyMore/confirmSell) 그대로 호출**(로직 중복 없음, 새 반환 `{ok,id}` 사용) → 성공 시 lifecycle+done. **기존 3개 모달 무접촉(일반 흐름 완전 불변).** 오케스트레이션은 훅(useActionQueue 확장)에, 모달은 렌더+입력만.

**이슈 B — 교차도메인 autosave 원자성(데이터 손실 위험).** ⚠️ ENTRY 실행은 `assets`(addAsset)+`turtlePositions`+`actionQueue` **3개 도메인**을 함께 바꾼다. 현재 autosave는 각 setter가 **호출부 클로저의 (stale) 형제 상태**로 `triggerAutoSave`를 부르고 2s 디바운스로 **마지막 호출만 저장**된다. addAsset이 새 asset으로 autosave 예약 후, 별도 position/queue 업데이트가 **stale assets로** autosave하면 → Drive에 **새 asset 누락 + 포지션이 없는 assetId 참조**(orphan) 발생 가능.
- **⚠️ 더 깊은 순서 문제(2026-07-05 추가 확인)**: 머니 핸들러들은 `triggerAutoSave`를 **`setAssets(prev => {…triggerAutoSave…})` 업데이터 안에서** 호출한다. 업데이터는 React flush 시점(T2)에 실행되는데, `await addAsset()` 직후의 동기 코드(원자 커밋, T1)는 **T2보다 먼저** 실행된다 → 커밋의 autosave(T1) 후 addAsset 업데이터의 autosave(T2)가 **나중에** 발화, **stale positions/queue로 덮어써 Drive에서 포지션·done이 유실**. 즉 "await 후 원자 커밋"만으로는 부족(디바운스 마지막 승자가 stale).
- **권장 해법(승인 필요)**: **오토세이브 배치 억제 + 지연 재개**.
  - 머니 핸들러는 Codex 안대로 생성 `Asset`/`SellRecord`(+갱신 asset)를 **반환**만 확장(내부 커밋·autosave·turtle 무결합 유지).
  - context에 **`commitPortfolioPatch({assets?, sellHistory?, actionQueue?, turtlePositions?})`** — 4도메인 set + **업데이터 밖에서 단일 triggerAutoSave**(전체 next state).
  - 터틀 실행 훅: **`autoSaveSuspended` 플래그 on** → `await` 머니액션(내부 autosave 억제됨) → 반환값+실제 입력으로 next state 계산 → `commitPortfolioPatch`(단일 저장) → **플래그 off는 flush 이후로 지연**(microtask/`setTimeout 0`)해 T2 업데이터의 autosave도 억제. 플래그는 generic(터틀 미인지).
  - 대안(근본): 머니 핸들러의 autosave를 **업데이터 밖으로** 이동(직접 set 후 triggerAutoSave) → 순서 결정적. 단 3개 핸들러 동작 변경이라 회귀 위험, 별도 승인.
- 결정 전까지 **4b-2d 오케스트레이션 구현 보류**. 순수 상태전이(`utils/turtleExecution.ts`)는 완료·테스트됨(교차도메인 저장과 무관).

## 6. 가드레일 (구현 세션 필수 준수)

1. `CLAUDE.md`/`RULES.md` 전 항목 (any 금지, `authenticatedFetch`, `createLogger`, `categoryId` PRIMARY, `priceOriginal`로 지표 비교, `PortfolioMobileCard` 동시 반영, overflow wrapper 금지).
2. **RULES.md 갱신은 파일 수정 직후 즉시** (세션 말미로 미루지 말 것).
3. **커밋/푸시 금지** — 사용자가 GitHub Desktop으로 직접. Claude는 변경 목록·검증 결과·커밋 메시지 추천만 보고.
4. Drive 스키마 확장 시 `LoadedData`/load파싱/`autoSave`/`exportData` 4곳 동시 수정.
5. 기존 기능(리플레이, 지식DB, 알림 엔진, 진단 패널) 동작 불변 — Phase 5도 표시 계층만.
6. 각 Phase마다 순수 로직은 `tests/` 회귀 테스트 추가 (기존 `npm run test:*` 스타일), `tsc` 클린 확인.
7. 구현 순서는 Phase 번호 순. 각 Phase 완료 시 사용자 검증 후 다음 진행.

## 7. 앱 밖 실행 체크리스트 (사용자 직접, 앱과 무관하게 진행 가능)

- [ ] 해외주식 손익 통산 계획: 올해 실현할 이익(인텔·미쓰비시 등)과 손실(BMNR·CRCL·디즈니 등) 같은 해 매도로 묶기
- [ ] 국내 깊은 손실 개별주(세금 장벽 없음)는 대청소 위저드 기다리지 말고 매도 가능 (-50%↓ 23종목 = 총자산 3.7%)
- [ ] 위성(터틀) 자금 별도 증권 계좌 분리 (~0.95억)
- [ ] '유선' 가족 자산 28종목 의사결정 단위 분리 (별도 포트폴리오 또는 버킷)
- [ ] 코어 목표 비중 확정 필요 (예: 주식/채권/금·실물/현금·메이저코인 — **앱이 정할 수 없는 유일한 판단**, Phase 4 전까지 결정)
- [ ] 터틀은 실자금 전 1~2개월 페이퍼 트레이딩 (Phase 2 완료 시 관심종목+주문서로 가능)
