# 미국 개별주 백테스트용 데이터 소스 조사 (2026-07-26)

## 배경

한국 백테스트는 FinanceData/marcap(GitHub 공개, **완전 무료**)으로 3,858종목·상장폐지 873개 포함·2010~2025를 확보했다. 미국 개별주(RS90 품질, 절대주가 필터, 거래량 우대 등 강의 축E 전체)를 검증하려면 동급 데이터가 필요한데, **미국은 무료로 이 수준의 데이터를 제공하는 곳이 확인되지 않았다.**

## 요구 스펙 (검증 가능하려면 전부 필요)

- 일봉 OHLCV, 분할·배당 조정
- **상장폐지 종목 포함**(생존편향 없음) — 이게 핵심 제약
- 2010~2022 최소 커버(가능하면 더 길게)
- 종목당이 아니라 벌크/API로 수천 종목 일괄 수집 가능
- (있으면 좋음) S&P500 등 point-in-time 지수 구성종목 이력 — 없어도 개별종목 이벤트 스터디는 가능

## 비교표

| 소스 | 상장폐지 포함 | 가격 | 커버리지 시작 | 비고 |
|---|---|---|---|---|
| **Norgate Data** | ✅ Platinum 이상만 | **연 $630**(6개월 $346.50) | 1990년(Platinum) | 리테일 시스템트레이더 사이에서 가장 널리 쓰임. 지수 구성종목 이력도 Platinum부터 포함. Python 패키지 제공(`norgatedata`) — 자동화 파이프라인에 적합. **가장 균형 잡힌 선택지** |
| **Sharadar**(Nasdaq Data Link) | ✅ "생존편향 거의 없음" 공식 문구 | 비공개(로그인 필요, 커뮤니티 추정 월 $50~100대) | 1998년(주가), 1957년(S&P500 구성종목) | 가격 투명성 낮음. S&P500 point-in-time 구성종목까지 포함된 게 강점 |
| **EODHD** | ✅(플랜 불명확) | 최저 월 **$19.99**(연 $199), All-in-one 월 $99.99 | 2000년 이후 상장폐지 11,000개+ (2018년 이전은 EOD만) | 가장 저렴하나 **상장폐지 데이터가 정확히 어느 플랜부터 포함인지 문서상 불명확** — 구매 전 지원팀 확인 필수 |
| **Polygon.io**(2026년 "Massive"로 리브랜딩) | ✅ (active/inactive 티커 분리 제공) | 무료 티어(월 100콜, 실사용 불가) / 유료 월 $29~ | 명시 안 됨 | REST API 구조가 이 프로젝트가 이미 쓰는 Yahoo v8 패턴과 가장 유사해 통합이 쉬움. 단, $29 티어에 상장폐지 데이터가 포함되는지 미확인 |
| **Stooq**(무료) | ⚠️ **불확실** | 무료 | 30년+ (생존 종목 기준) | 완전 무료·벌크 다운로드 가능하나, 상장폐지 종목 커버리지가 검색 결과에 명확히 나오지 않음 — 검증 없이 신뢰하면 생존편향이 몰래 섞일 위험 |
| CRSP / Bloomberg / FactSet | ✅ 업계 표준 | 기관 라이선스(개인 불가 수준) | — | 학술·기관용, 개인 프로젝트 범위 밖 |

## 권고

**Norgate Data Platinum(연 $630, 약 87만원)**을 1순위로 권한다.
- 이유: 상장폐지 포함이 명시적이고, 지수 구성종목 이력까지 확보돼 강의의 "RS90 리스트 종목수" 같은 크로스섹션 축까지 검증 가능. Python 패키지가 있어 기존 marcap 파이프라인과 유사한 방식으로 통합 가능.
- EODHD($199~1200/년)는 더 싸지만 상장폐지 플랜 경계가 불명확해 **구매 전 지원팀에 직접 문의해 확답을 받아야** 확신 있게 쓸 수 있다.

**무료로는 이 수준을 확보할 수 없다.** Stooq은 상장폐지 커버리지를 검증 없이 쓰면 안 되고, Yahoo Finance(현재 ETF에 쓰는 소스)는 상장폐지 종목이 애초에 조회 자체가 안 된다(티커가 사라짐).

## 다음 단계 (결정 필요)

1. **예산 승인 여부** — 연 $630(Norgate) 또는 더 저렴한 대안을 확인 후 지출할지
2. 승인되면: 계정 생성 → Python 패키지로 종목별 데이터 벌크 다운로드 → 기존 `conditionalChannel/ingest/` 파이프라인과 유사한 구조로 `scripts/backtest/data/conditionalChannel/us/` 신설 → 게이트(G1~G11 상당) 재설계
3. 미보류: **결제·계정 생성은 사용자가 직접 해야 하는 항목**이다(카드 정보 입력을 대행할 수 없음). 계정 생성 후 API 키만 넘겨주시면 이후 파이프라인 구축은 진행 가능하다.

## Sources

- [Norgate Data - Stock Market Packages](https://norgatedata.com/stockmarketpackages.php)
- [Norgate Data - Delisted Stocks (AmiBroker Forum)](https://forum.amibroker.com/t/delisted-stocks-in-norgate-data/30049)
- [Sharadar Equity Prices - Nasdaq Data Link](https://data.nasdaq.com/databases/SEP)
- [Sharadar Data Pricing - QuantRocket](https://www.quantrocket.com/pricing/data/sharadar/)
- [EODHD Pricing](https://eodhd.com/pricing)
- [EODHD - Delisted Stock Companies Data](https://eodhd.com/financial-apis/delisted-stock-companies-data)
- [Polygon API providers overview](https://apis.io/providers/polygon/)
- [Stooq - Free Historical Market Data](https://stooq.com/db/h/)
