# [프롬프트 1] 포트폴리오 CSV → 백테스트 유니버스 정리

> 사용법: 이 파일 전체를 새 Claude Code 세션(이 리포지토리)에 붙여넣거나, "docs/backtest/PROMPT_1_데이터정리.md 를 읽고 그대로 수행해" 라고 지시.

---

## 역할과 목표

너는 이 리포지토리(개인 자산관리 앱)에서 **터틀 트레이딩 포트폴리오 백테스트의 사전 데이터 정리**를 수행한다.
백테스트 자체는 하지 않는다. 산출물은 다음 2개다.

1. `scripts/backtest/data/universe.json` — 백테스트 유니버스 (종목별 분류·심볼 매핑·데이터 가용성)
2. `docs/backtest/데이터정리_진단.md` — 집계·이슈·확인질문 요약 (개인 금액은 비중%로만 표기)

## 배경 (자립 컨텍스트)

- 사용자는 90/10 전환 중: 코어 90%(정적배분+반기 리밸런싱, 터틀 금지) + 위성 10%(투더문, 터틀 적용).
- 이후 [프롬프트 2]에서 이 유니버스로 터틀 백테스트(유닛 1/2/4, 라우팅, 코어:위성 비율)를 돌린다.
- 앱의 터틀 엔진: 55일 돌파 진입 / 20일 신저가 청산 / 2N 손절 / N(ATR20) 사이징. Donchian은 당일 제외(`excludeToday`), 가격은 원통화(`priceOriginal`) 기준.

## 입력

- 원본 CSV: `C:\Users\beari\Downloads\portfolio (3).csv`
  (컬럼: 종목명, 티커, 거래소, 자산구분, 보유수량, 매수단가(자국통화), 매수환율, 총매수금액(원화), 현재단가(원화), 현재평가금액(원화), 총손익(원화), 수익률(%))

## 확정된 기본 정책 (사용자 승인 완료 — 다시 묻지 말 것)

1. **소유자 범위**: `유선_`, `원종_`, `유선&원종_` 접두어를 `owner` 필드로 태깅하되 **전부 유니버스에 포함**. (본인 것만 걸러내지 않음)
2. **정리대상(legacy) 처리**: 손실 **-40%↓ 이면서 소형·테마 개별주**는 `EXIT_LEGACY` 로 분류해 백테스트 유니버스에서 **제외**(태그만). 단, 손실이 -40%↓ 여도 **대형주**(예: NAVER 035420, 셀트리온 068270, 유한양행 000100, 녹십자 006280 등)는 자동 제외하지 말고 **AMBIGUOUS 로 올려 확인**받을 것.
3. **금(金)의 소속**: 금현물(KRX-GOLD)/GLD 는 **CORE 기본**. 단 `notes` 에 "위성 터틀 후보로도 실험 가능"이라 명시하고, [프롬프트 2]가 금을 위성 실험에 추가로 넣을 수 있도록 `alsoSatelliteCandidate: true` 플래그를 부여.

위 3개는 확정 상태이므로 시작 시 재질문하지 말고 바로 진행한다. **AMBIGUOUS 종목(대형 개별주 분류)만** 3단계 후 표로 정리해 사용자 확인을 받는다.

## 알려진 데이터 이슈 (반드시 처리·보고)

| 이슈 | 상세 |
|---|---|
| 중복 종목 | BMNR 2건 (본인 594주 + 유선_ 14주) — 소유자 태깅 후 합산 또는 분리 |
| 자산구분 오류 | BMNR·CRCL="암호화폐"이나 실제 미국주식(암호화폐 관련주). 풍산(103140)·고려아연(010130)="실물자산"이나 실제 한국주식. TIGER글로벌AI사이버보안(418670)·TIGER미국테크TOP10(381170) 등 KRX 상장 해외테마 ETF의 구분 혼재 |
| 거래소 오류 | ACE 미국WideMoat(309230) 거래소가 "NASDAQ"으로 기재 — 실제 KRX |
| 비표준 티커 | `KRX-GOLD`(KRX 금현물), 신형 KRX 코드 `0067V0`·`0047A0`·`0141S0` — 가격 조달 프로브 필수 |
| 현금성 자산 | USDC는 스테이블코인 — 백테스트 제외(CASH 태그), 현금 비중으로만 집계 |
| 빈 값 | DIS 매수환율 공란 등 — 백테스트에는 영향 없음(보유내역은 참고용), 기록만 |

## 작업 단계

### 1단계: 파싱·정규화
- CSV를 파싱해 종목별로: `name, rawTicker, exchange, owner(접두어 추출), 자산구분(교정본), 평가금액KRW, 비중%` 산출.
- 소유자 접두어(`유선_`/`원종_`/`유선&원종_`)를 분리해 `owner` 필드로. 종목명에서 접두어 제거.
- 위 "알려진 데이터 이슈"를 전부 교정하고 교정 내역을 진단 문서에 표로 남길 것.

### 2단계: 버킷 분류 (핵심)
각 종목에 `class` 를 부여한다. 기준:

- **CORE** — 완만 우상향 지수/대형 ETF/채권/실물 장기보유. 예: QQQ, IVV, VTV, 니케이225(241180), CSI300(283580), 항셍테크(372330), TLT, IEF, 국고채30년(385560), 미국채30(464470), 금현물(3번 질문 답변에 따름), GLD, K방산, WideMoat, 일본상사주(8001/8002/8031/8058), 미국테크TOP10 등
- **SATELLITE_TURTLE** — 고변동·추세성 자산, 터틀 후보. 예: BTC, ETH, SOL, SLV/PSLV(은), 구리실물(160580), UEC(우라늄), PPLT(백금), 양자컴퓨팅(498270) 등
- **EXIT_LEGACY** — 90/10 전환 정리대상(대부분 -40%↓ 소형 개별주 + 테마 잔재). 백테스트 유니버스 제외, 태그만.
- **CASH** — USDC 등 현금성. 제외.
- **AMBIGUOUS** — 판단이 갈리는 것(예: ALB, INTC, NVDA, AVGO, AMZN, GOOGL, MSFT, CPNG, XLE, 개별 대형주). 임의 배정하지 말고 표로 만들어 사용자 확인을 받을 것.

주의: 분류는 "현재 수익률"이 아니라 **자산의 성격(변동성·추세성·장기 우상향 여부)** 기준. 수익 중인 소형주도 EXIT일 수 있고, 손실 중인 코어자산(금현물 등)도 CORE다.

### 3단계: 가격 심볼 매핑 + 가용성 프로브
백테스트 대상(CORE + SATELLITE_TURTLE)의 각 종목에 대해:

- `dataSymbol`: Yahoo Finance 호환 심볼로 매핑.
  - KRX 숫자코드 → `{code}.KS` 또는 `{code}.KQ` (둘 다 프로브해서 되는 쪽)
  - 도쿄 → `{code}.T` (이미 그 형식)
  - 암호화폐 → `BTC-USD`, `ETH-USD`, `SOL-USD`
  - `KRX-GOLD` → 직접 조달 불가 시 프록시
- `proxySymbol` + `proxyReason`: 상장이 짧은 KRX ETF는 **긴 히스토리 프록시**를 별도 기재.
  - 예: 241180 → `^N225`, 283580 → `000300.SS` 또는 `ASHR`, 372330 → `3033.HK`, KRX-GOLD → `GC=F` 또는 `GLD`, 385560/464470 → 프록시 곤란 시 한계 명시
- **가용성 프로브**: 각 심볼에 대해 실제로 일봉 OHLC를 소량 fetch(Yahoo chart API 등)해서 `firstAvailableDate`, `ohlcAvailable(고저가 있는지)`, `probeOk` 를 기록. 실패한 종목은 실패 사유와 함께 보고(부분 성공 허용 — 전체 중단 금지).
- 환율 심볼도 프로브: `KRW=X`(USD/KRW), `JPYKRW=X`.

### 4단계: 산출물 작성

`scripts/backtest/data/universe.json` 스키마:
```json
{
  "generatedAt": "YYYY-MM-DD",
  "sourceCsv": "portfolio (3).csv",
  "fx": [{ "pair": "USDKRW", "symbol": "KRW=X", "probeOk": true }],
  "assets": [
    {
      "name": "비트코인",
      "rawTicker": "BTC",
      "owner": "본인",
      "class": "SATELLITE_TURTLE",
      "currency": "USD",
      "dataSymbol": "BTC-USD",
      "proxySymbol": null,
      "proxyReason": null,
      "firstAvailableDate": "2014-09-17",
      "ohlcAvailable": true,
      "probeOk": true,
      "weightPct": 0.0,
      "notes": ""
    }
  ],
  "excluded": [{ "name": "서클(USDC)", "class": "CASH", "reason": "스테이블코인" }],
  "openQuestions": ["..."]
}
```

`docs/backtest/데이터정리_진단.md` 에는:
- 현재 배분 요약: CORE / SATELLITE_TURTLE / EXIT_LEGACY / CASH 비중% (금액은 쓰지 말 것 — 커밋될 수 있는 문서이므로 비중만)
- 90/10 목표 대비 현재 괴리
- 교정한 데이터 이슈 표
- AMBIGUOUS 종목 표 + 각각에 대한 권고안
- 프로브 실패 종목과 대안
- [프롬프트 2] 진행 전 사용자가 답해야 할 잔여 질문 목록

## 제약·금지

- **앱 소스코드(`components/`, `hooks/`, `utils/`, `types/`) 수정 금지.** 이 작업은 `scripts/backtest/data/` 와 `docs/backtest/` 만 만진다.
- `scripts/backtest/data/` 는 개인 금융 데이터이므로 `.gitignore` 에 추가할 것 (이미 있으면 생략).
- 백테스트를 시작하지 말 것 — 유니버스 정리까지만.
- 커밋/푸시 금지 (사용자가 GitHub Desktop으로 직접).
