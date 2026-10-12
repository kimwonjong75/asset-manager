# V1 원천 데이터 라이선스 및 커밋 정책

검토일: 2026-10-12

## 결론

원천 payload는 모두 로컬에 보존하고 Git 커밋에서는 제외한다. 연구 스크립트, 테스트, 파생 게이트 결과, 보고서, 원천별 체크섬과 출처 메타데이터만 커밋한다.

이 결정은 원천을 삭제하거나 이용권을 단정하는 것이 아니라, 재배포 권한이 명확하지 않은 자료를 저장소에 배포하지 않기 위한 보수적 커밋 정책이다.

## 원천별 검토

| 원천 | 확인한 조건 | 커밋 결정 |
|---|---|---|
| Yahoo Finance chart API | Yahoo 일반 이용약관은 별도 명시가 없으면 서비스의 상업적 재사용을 허용하지 않으며, Yahoo 및 데이터 공급자의 데이터로 대체 데이터베이스를 만드는 행위를 제한한다. 제3자 시세 권리도 별도일 수 있다. | JSON 시세 payload 제외. URL·조회시각·요청기간·열 정의·SHA-256만 보존 |
| Naver Finance KRX 금 표시 API | 공개 화면/API에서 시세 payload의 재배포를 명시적으로 허용하는 조건을 확인하지 못했다. KRX 원천 표시가 있어도 재배포 권한을 의미하지 않는다. | JSON payload 제외. 출처 URL·조회시각·SHA-256만 보존 |
| GoldNow KRX 금 보조 OHLC 화면 | 보조 표시 사이트에서 수집 payload의 재배포를 허용하는 명확한 라이선스를 확인하지 못했다. | HTML 및 meta payload 제외. 출처 URL·조회시각·SHA-256만 보존 |
| 한국은행 ECOS CD91 | 한국은행 작성 통계는 출처를 명시하면 상업 목적을 포함해 자유로운 사용·가공·재배포가 가능하다. 이용자는 출처를 명확히 표시해야 한다. | 재배포 가능성이 있으나 원천 최소화 정책을 일관되게 적용해 JSON payload 제외. 출처·통계코드·항목코드·조회시각·SHA-256 보존 |

## 확인한 정책 문서

- Yahoo Terms of Service: https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html
- Yahoo Permissions 안내: https://legal.yahoo.com/us/en/yahoo/permissions/requests/index.html
- 한국은행 ECOS 통계정보이용지침: https://ecos.bok.or.kr/
- Naver 이용약관: https://policy.naver.com/rules/service.html
- Naver Finance KRX 금 조회 출처: https://api.stock.naver.com/marketindex/metals/M04020000/prices
- GoldNow 조회 출처: https://goldnow.infovista.kr/gold/history

## 감사 추적

- 실제 원천 파일은 `scripts/backtest/core6SignalRotation/data/raw/`에 로컬 보존한다.
- 같은 디렉터리의 `.gitignore`가 payload를 제외하고 `checksums.json`만 추적 대상으로 남긴다.
- `output/DATA_MANIFEST.json`에는 각 원천의 URL, 조회시각, 관측기간, 스키마, 통화, 시간대 및 체크섬이 기록돼 있다.
- 원천 파일을 다시 수집하면 기존 V1 체크섬과 다른 별도 수집본으로 취급해야 하며 V1 증거를 덮어쓰지 않는다.
