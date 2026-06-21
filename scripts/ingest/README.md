# 지식 인제스트 파이프라인 (scripts/ingest/)

주간 투자 강의록(`.txt/.md/.pdf`)을 **지식 DB 승인 후보**로 가공하는 로컬 파이프라인.
데이터는 전부 `DB/`(깃 제외)에 적재되고, **승인 전엔 어떤 것도 신호로 활성화되지 않는다.**

## 구성
| 파일 | 단계 | 역할 |
|------|------|------|
| `validate_inbox.py` | ① 검증·추출 | inbox 스캔 → sha256 중복검사 → 본문 추출 → 대장 등록 |
| `triage.workflow.js` | ② triage | 색인 → 4버킷 추출 → 적대적 검증 → **통합(중복병합·정책제외)** → 후보 산출 |
| `triage_commit.py` | ② 커밋 | 후보를 스키마 검증 후 큐 기록 (잘못된 enum·미구현지표 signal 차단) |

## 실행 순서
```bash
# 1) 파일을 DB/inbox/ 에 넣고 검증·추출
python scripts/ingest/validate_inbox.py
#   → DB/staging/registry/sources.jsonl 에 status:'validated-awaiting-triage'

# 2) triage (Claude 워크플로). sourceId/extractedRel 은 1)의 대장에서 확인
#    Workflow 도구로 실행:
#      scriptPath: scripts/ingest/triage.workflow.js
#      args: { "sourceId":"<id>", "sourceDate":"YYYY-MM-DD",
#              "extractedRel":"DB/staging/extracted/<id>.txt" }
#    → 반환 { sourceId, queue:[정제후보], rejected:[중복·노이즈·정책제외] }

# 3) 워크플로 결과를 candidates.json 으로 저장 후 커밋
python scripts/ingest/triage_commit.py <candidates.json>
#   → DB/queue/knowledge-inbox.jsonl (승인 대기) + DB/staging/rejected/<id>.rejected.jsonl
```

## triage 4버킷
- **원칙**(risk-principle, 무감쇠) / **심리**(psychology) → advisory claim 후보
- **전략**(한국 개인 실행가능) → claim/rule 후보
- **참고**(비실행 교양) / **노이즈**(일화) → reject

## 안전장치 (코드에 박힘)
- **킬 스위치**: `DB/STOP_INGEST.flag` 있으면 검증 중단
- **중복방지**: 파일 sha256(`validate_inbox`) + 기존 DB 색인(triage 색인단계) + 후보 간 통합(통합단계)
- **정책 게이트**: 미국 소형주 숏 / 분봉 EP / 시점성 종목콜 = 큐 제외 (triage 통합단계)
- **스키마 게이트**(`triage_commit`): enum 위반·`userApproved=true`·미구현지표 signal 규칙은 큐 진입 차단
- **promote 게이트**(앱 예정, `canPromoteRule`): `rule.status=active` 직전 연결 claim 무결성까지 검사

## 매주 반복
1) 새 파일 inbox 투입 → `validate_inbox.py`
2) triage 워크플로 재실행(sourceId만 교체)
3) `triage_commit.py`
4) 앱 도감에서 큐 불러와 승인 → Drive 반영

> 대부분의 주는 **신규 0~소수**가 정상. 이미 아는 지식은 중복으로 걸러진다.

## 운영 방식 — 수동 트리거 (권장)
PC를 상시 켜두지 않으므로 **스케줄 자동화 대신 수동 트리거**를 쓴다.
`DB/inbox`에 파일을 넣고 **Claude Code에 "최신 파일을 인제스트 해줘"**라고 입력하면
Claude가 ①validate → ②triage 워크플로 → ③commit 까지 한 번에 수행한다(구독 기반, 별도 API 과금 없음).
사용자는 앱 도감에서 **승인만** 하면 된다.
