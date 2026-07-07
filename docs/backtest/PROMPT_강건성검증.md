# 작업지시서: 터틀 백테스트 강건성 검증 + 리포트 버그 수정

> 새 Claude Code 세션에 그대로 붙여넣어 실행하는 자립형 작업지시서다.
> 작성 2026-07-07. 3개 AI(코덱스·클로드·본 세션)가 리포트를 교차검증하고 결론이 수렴한 상태에서 작성됨.
> **이 백테스트의 성격**: 새 전략을 탐색하는 게 아니라, 이미 도달한 결론("현 기본값 유지")을 **반증 시도로 확정**하는 확인용이다. 목표는 "유닛 2·90:10을 깨뜨릴 수 있는가"를 적대적으로 검증하는 것.

---

## 0. 배경 — 확정된 사실 (재검증 불필요, 그대로 신뢰)

`scripts/backtest/turtlePortfolio.ts` + `lib/*`로 실행한 백테스트(2015~2026, 초기 1억, 편도 0.1%)의 리포트 `docs/backtest/REPORT_터틀백테스트.md`를 3자 교차검증한 결과:

**(A) 리포트 권고 3줄 중 2개가 버그/아티팩트다.**
1. **"전 종목 터틀 CAGR 46.67%"는 아티팩트.** all-turtle 모드는 코어 자산의 open/high/low를 close로 근사(`lib/portfolioRun.ts:66` 부근) → true range가 |종가차|로 축소 → N(ATR) 과소 → 과대 사이징. 거래수 44·승률 38.6%·최대연속손실 7이 "위성만 터틀"과 **완전히 동일** = 코어는 사실상 미거래, 실체는 "위성 9종목에 자본 100% 몰빵"(위성 단독 TWR +40.5%/-35.3%와 일치). **라우팅 근거로 사용 금지.**
2. **실험 C 라벨 버그.** expC는 코드상 전부 `routing: 'two-bucket'`로 실행(`turtlePortfolio.ts`의 expC 정의)했는데, 리포트 C 섹션 조건 문구는 `routingLabel(bestRouting)`(=all-turtle)을 출력 → 권고 2번(전종목터틀)과 3번(70:30)이 상호모순.
3. **"전 종목 B&H MDD -44%"는 32종목 동일가중**(위성 고변동 ~28% 비중)이라 실험 A(비례가중 코어)와 직접 비교 불가.

**(B) 표본 생존편향.** 위성 9종목 = 현재 보유분(BTC·ETH·SOL·SLV·PSLV·PPLT·구리HG=F·UEC·양자컴QTUM프록시). 유닛4 우위 대부분이 2019-21 크립토 불장 in-sample. holdout(2024~)에선 유닛 1/2/4 CAGR 25.4/25.9/26.7로 차이 미미, MDD 동일(-8.49%). 대신 유닛4는 위성 단독 MDD -35.3%·연속손실 7·승률 38.6%로 심리 부담이 급증.

**(C) 확정된 결론**: 앱 기본값(**90:10 two-bucket, 위성만 터틀, maxUnits 2, risk 0.5%, 한도 12/25%**) 유지가 데이터와 부합. maxUnits 4 및 20~30% 상향은 **본 강건성 검증을 통과한 뒤의 2단계 후보**로 유보.

**(D) 실제 배분은 목표와 크게 괴리** (universe.json 실보유 비중):
- CORE 60.2% (목표 90%) / SATELLITE_TURTLE 17.6% (목표 10%의 1.76배)
- **무전략 구간 22%·57종목**: AMBIGUOUS 19종목 12.2% + EXIT_LEGACY 38종목 7.1% + CASH 2.9%
- 백테스트는 90:10을 강제 재정규화해 돌리므로 "비율 최적화"는 실제 포트폴리오와 동떨어져 있음. **실제 최우선 과제는 파라미터가 아니라 57종목 정리** — 단, 그건 앱 운영 작업이지 이 백테스트의 범위가 아니다. 이 백테스트는 (C)의 확정과 (A) 버그수정에 집중한다.

**주의**: `satelliteBudgetKRW`가 0이라는 판단은 코드 DEFAULT(fail-closed)를 본 것일 뿐, 사용자 실제 저장값은 미확인. 이 백테스트와 무관하나, 결론 보고 시 이 값은 앱에서 별도 확인이 필요함을 명시할 것.

---

## 1. 작업 범위 (반드시 준수)

- **수정 허용**: `scripts/backtest/**`, `docs/backtest/**`만.
- **수정 금지**: `utils/`·`types/`·`hooks/`·`components/` 등 앱 코드 일체. 백테스트는 앱 순수 함수를 **import만** 한다(현재도 export 추가 없이 동작). 앱 운용 파라미터는 이번 작업에서 절대 바꾸지 않는다.
- **가격 캐시 재사용**: `scripts/backtest/data/cache/*.json` 삭제 금지 (재실행 시 재다운로드 안 함 → 결정적·빠름).
- **커밋/푸시 금지**: 사용자가 GitHub Desktop으로 직접. 완료 시 변경파일 목록 + 검증결과 + 커밋메시지 추천만 보고.
- **룩어헤드 0 유지**: 체결 규칙(진입 fill=max(open,채널), 채널은 당일 제외, 손절 fill=min(open,stop) 등)을 변경하지 말 것.

---

## 2. 작업 ① — 리포트 생성기 버그 수정 (`turtlePortfolio.ts` 의 `buildReport`)

1. **실험 C 조건 문구**: `routingLabel(bestRouting)` → 실제 실행 라우팅(two-bucket = "위성만 터틀")을 출력.
2. **권고 3줄의 라우팅 권고**: `pickBest`에 all-turtle을 포함시켜 뽑지 말 것. 권고는 two-bucket 기준으로만. all-turtle/all-bh는 경고와 함께 **참고 행**으로만 표시.
3. **실험 B 섹션에 경고문 추가**(표 아래 인용문):
   - all-turtle은 코어 O/H/L을 종가로 근사 → N 과소 → 과대 사이징. 거래통계가 위성만 터틀과 동일 = 코어 미거래. "위성 전략에 자본 100%"의 근사치이며 라우팅 결정 근거로 **사용 불가**.
   - all-bh는 동일가중이라 실험 A(비례가중)와 직접 비교 불가.
4. **회귀 확인**: 캐시 재사용 시 실험 A/C/D의 2015~2023 연도별 수익률이 기존 리포트와 동일해야 함(마지막 구간은 `GLOBAL_END`=실행일이라 소폭 변동 가능 → 과거연도 동일성으로 판단).

---

## 3. 작업 ② — 강건성 실험 R (신규): "유닛 4 우위가 표본 의존인가"를 반증

모든 R은 **two-bucket·90:10·entry 55/exit 20·risk 0.5%·비례가중** 고정, **유닛 1/2/4만 변화**(실험 A와 동일 조건, 표본만 교체). 실험 A 결과를 비교 기준으로 나란히 표시.

- **R1 — 크립토 제외**: 위성에서 `BTC-USD`·`ETH-USD`·`SOL-USD` 제거(SLV·PSLV·PPLT·HG=F·UEC·QTUM 6종목). `satSeries` 구성 후 rawTicker 필터 한 줄.
- **R2 — 2018년 시작**: 유니버스 유지, 캘린더를 `2018-01-01`부터로 **슬라이스**(fetch 범위·캐시는 그대로 두어 재다운로드 방지). 첫 55거래일은 채널 미형성 워밍업 구간임을 명시.
- **R3 (선택)** — R1+R2 동시. 시간 여유 시.

산출 지표는 evalConfig와 동일(CAGR/MDD/Calmar/손익비/거래수/승률/최대연속손실/최악3년 + 구간분해 + **위성 단독 TWR**).

---

## 4. 작업 ③ — AMBIGUOUS 경계분석 (신규, 선택): 12% 미분류가 결론을 뒤집는가

AMBIGUOUS 19종목(12.2%)은 분류 미정으로 백테스트에서 제외돼 있다(universe.json의 `excluded` 배열). 이 미결정이 헤드라인 수치를 얼마나 흔드는지 **경계**를 재는 실험:

- **AMB-base**: 현행대로 제외 (하한선).
- **AMB-core**: AMBIGUOUS 19종목을 전부 CORE로 잠정 편입해 추천 config 1회 실행 (상한선 근사).
- 두 결과의 CAGR/MDD 차이가 작으면 "분류는 운영상 중요하되 백테스트 결론은 안 바뀜", 크면 "분류 전엔 비율 결론 유보"라고 리포트에 기록.
- **주의**: AMBIGUOUS 종목은 이번에 가격 fetch를 안 했으므로 신규 fetch 필요 → 일부 실패 가능. 실패 종목은 제외하고 목록을 리포트에 명시. fetch가 과도하게 실패하면 이 실험은 생략하고 그 사실만 보고.

---

## 5. 판정 기준 (리포트 맨 위 3줄 요약에 반영)

- **1차 Calmar, 보조 최악3년누적, 그리고 위성 단독 MDD·최대연속손실**을 반드시 병기. 사용자는 하루 10분만 보는 겸업 투자자 — **심리적 지속가능성이 CAGR보다 우선**.
- 유닛 판정 규칙:
  - 유닛 4 우위가 **R1·R2 둘 다에서 유지** → "표본 의존 아님", 유닛 상향을 2단계 검토 대상으로 승격.
  - **한쪽에서라도 우위 소멸/역전** → **유닛 2 유지 확정**(앱 기본값, 코드 변경 없음). ← 사전 예상 시나리오.
- 승률은 판정에 쓰지 말 것(참고만). 필터·유닛은 승률을 올리고도 기대값을 깎을 수 있음.

---

## 6. 산출물

1. 수정된 `scripts/backtest/turtlePortfolio.ts` (버그수정 + R실험 + 경계분석. R/경계는 `--robustness` 플래그 또는 기본 포함 중, 실행시간 짧으면 기본 포함).
2. 재생성된 `docs/backtest/REPORT_터틀백테스트.md` (버그수정 반영).
3. 신규 `docs/backtest/REPORT_강건성검증.md`:
   - 맨 위 판정 3줄 요약.
   - R1/R2(/R3) 표 + 실험 A 비교 기준 병기.
   - AMBIGUOUS 경계분석 결과(또는 생략 사유).
   - 한계 섹션(기존 한계 + R/경계 고유 한계 + 프록시 14종목·세금 미반영·`satelliteBudgetKRW` 실저장값 미확인).
4. 최종 보고: 변경파일 목록, 회귀 확인 결과(A 과거연도 동일 여부), 유닛 판정 결론, 커밋메시지 추천.

---

## 7. 실행 명령

```
npx --yes tsx scripts/backtest/turtlePortfolio.ts
```

타입 확인(선택): `npx tsc --noEmit` — 프로젝트 전체 기준이므로 스크립트 관련 신규 에러만 없으면 됨.

---

## 8. 참고 파일 지도

| 파일 | 역할 |
|---|---|
| `scripts/backtest/turtlePortfolio.ts` | 메인 — 실험 정의(A/B/C/D), `pickBest`, `buildReport` |
| `scripts/backtest/lib/portfolioRun.ts` | two-bucket / all-turtle / all-bh 일 단위 시뮬레이션 |
| `scripts/backtest/lib/satelliteTurtle.ts` | 터틀 시뮬레이터 (앱 `utils/turtleEngine.ts` 재사용, 체결가 규칙) |
| `scripts/backtest/lib/coreBasket.ts` | 코어 정적배분 + 반기 리밸런싱 |
| `scripts/backtest/lib/metrics.ts` | CAGR/MDD/Calmar/손익비/최악3년/연도별 |
| `scripts/backtest/lib/universe.ts` + `data/universe.json` | 유니버스 (CORE 23 / SATELLITE_TURTLE 9 / excluded: AMBIGUOUS 19·EXIT_LEGACY 38·CASH 1) |
| `scripts/backtest/lib/fetchHistory.ts` + `data/cache/` | 가격 조달 + 캐시 |
| `docs/backtest/REPORT_터틀백테스트.md` | 기존 리포트 (버그수정 후 재생성 대상) |
