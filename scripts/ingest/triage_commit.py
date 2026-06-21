#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
지식 인제스트 — 2단계 후처리: triage 결과를 큐에 안전 기록 (commit guard)
---------------------------------------------------------------------------
triage(AI 분류)가 만든 후보 JSON을 받아:
  · 앱 스키마 enum/필수필드를 검증 (잘못된 후보는 큐 진입 차단 → rejected로)
  · computability='signal' 규칙이 '미구현 지표'를 쓰면 차단 (영원히 안 뜨는 신호 방지)
  · 통과한 정제 후보만 DB/queue/knowledge-inbox.jsonl 에 적재
  · 나머지(중복/노이즈/스키마위반)는 DB/staging/rejected/ 에 학습데이터로 보존
  · 원문 대장(sources.jsonl)의 해당 source 상태를 'triaged'로 갱신

입력 JSON 형식:
  {
    "sourceId": "260620_f4953b99",
    "queue":    [ { "kind":"claim"|"rule", "candidate": {...}, "reason": "...",
                    "dedup": "new"|"refines:<id>", "confidence": "high"|"medium"|"low" }, ... ],
    "rejected": [ { "kind":..., "statement":..., "bucket":..., "reason":..., "dedup":... }, ... ]
  }

사용:  python scripts/ingest/triage_commit.py <candidates.json>

이 스크립트는 신호를 활성화하지 않는다. 큐 적재까지만. 승인/promote는 앱에서 사람이 한다.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_ROOT = REPO_ROOT / "DB"
REGISTRY = DB_ROOT / "staging" / "registry" / "sources.jsonl"
REJECTED_DIR = DB_ROOT / "staging" / "rejected"
QUEUE = DB_ROOT / "queue" / "knowledge-inbox.jsonl"

# ── 앱 스키마 enum (types/knowledge.ts 와 1:1 — 변경 시 동기화) ───────────────
CATEGORY = {"market-regime", "screening", "entry-setup", "entry-timing",
            "exit-stoploss", "exit-profit", "position-sizing", "psychology"}
DECAY = {"risk-principle", "evergreen-reference", "strategy-rule",
         "market-regime", "stock-comment", "event-news"}
AUTHORITY = {"kang-direct-principle", "kang-recommendation", "kang-introduced-guru",
             "external-guru", "ai-inference"}
GURU = {"kang-hwanguk", "kullamagi", "oneil", "minervini", "weinstein", "darvas",
        "livermore", "frohlich", "russo", "breitstein", "generic"}
CONFIDENCE = {"strong", "qualified", "optional", "author-opinion"}
COMPUTABILITY = {"signal", "advisory"}
ACTION = {"buy-watch", "buy-setup", "sell-warning", "risk-sizing", "regime-filter", "review"}
STATUS = {"draft", "active", "archived"}
# guruSignalEngine.buildMetricValues 가 실제 산출하는 지표만 신호로 허용
IMPLEMENTED_METRICS = {"rsi14", "climaxFlags", "distributionCount", "volumeRatio50",
                       "priceToMa20Pct", "priceToMa60Pct", "priceToMa150Pct",
                       "pctBelow52wHigh", "maCompression", "assetTrendRegime",
                       "priceCrossAboveMa20Days"}


def _enum(val, allowed, field):
    return None if val in allowed else f"{field}='{val}' 은(는) 허용되지 않는 값"


def validate_claim(c: dict) -> list[str]:
    errs = []
    for f in ("id", "sourceId", "sourceDate", "statement"):
        if not c.get(f):
            errs.append(f"필수 누락: {f}")
    for f, allowed in (("category", CATEGORY), ("decayClass", DECAY),
                       ("authorityTier", AUTHORITY), ("guru", GURU),
                       ("confidence", CONFIDENCE)):
        e = _enum(c.get(f), allowed, f)
        if e:
            errs.append(e)
    v = c.get("verification") or {}
    if v.get("userApproved") is True:
        errs.append("후보는 userApproved=false 여야 함 (승인은 앱에서)")
    if v.get("rejected") is True:
        errs.append("rejected=true 후보는 큐에 넣지 않음")
    tags = c.get("tags") or []
    if "pending-ingest" not in tags:
        errs.append("claim 후보는 tags 에 'pending-ingest' 필요 (식별 마커)")
    return errs


def validate_rule(r: dict) -> list[str]:
    errs = []
    for f in ("id", "title"):
        if not r.get(f):
            errs.append(f"필수 누락: {f}")
    if not isinstance(r.get("claimIds"), list) or not r["claimIds"]:
        errs.append("rule 은 최소 1개의 claimIds 필요")
    for f, allowed in (("ruleType", CATEGORY), ("computability", COMPUTABILITY),
                       ("action", ACTION), ("status", STATUS)):
        e = _enum(r.get(f), allowed, f)
        if e:
            errs.append(e)
    if r.get("status") != "draft":
        errs.append("후보 rule 은 status='draft' 여야 함")
    v = r.get("verification") or {}
    if v.get("userApproved") is True:
        errs.append("후보는 userApproved=false 여야 함")
    metrics = r.get("requiredMetrics") or []
    if r.get("computability") == "signal":
        unimpl = [m for m in metrics if m not in IMPLEMENTED_METRICS]
        if unimpl:
            errs.append(f"signal 규칙이 미구현 지표 사용: {unimpl} "
                        f"→ advisory 로 두거나 지표 구현 후 재시도 (영원히 안 뜨는 신호 차단)")
    return errs


def update_registry_status(source_id: str, today: str) -> None:
    if not REGISTRY.exists():
        return
    lines = REGISTRY.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            out.append(line)
            continue
        if rec.get("id") == source_id:
            rec["status"] = "triaged"
            rec["triagedAt"] = today
        out.append(json.dumps(rec, ensure_ascii=False))
    REGISTRY.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) < 2:
        print("사용: python scripts/ingest/triage_commit.py <candidates.json>")
        return 1
    in_path = Path(sys.argv[1])
    if not in_path.exists():
        print(f"입력 파일 없음: {in_path}")
        return 1

    data = json.loads(in_path.read_text(encoding="utf-8"))
    source_id = data.get("sourceId", "unknown")
    today = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)
    QUEUE.parent.mkdir(parents=True, exist_ok=True)

    accepted, blocked, rejected_out = [], [], list(data.get("rejected") or [])

    for entry in data.get("queue") or []:
        kind = entry.get("kind")
        cand = entry.get("candidate") or {}
        errs = validate_claim(cand) if kind == "claim" else (
            validate_rule(cand) if kind == "rule" else ["kind 은 'claim' 또는 'rule'"])
        if errs:
            blocked.append((cand.get("id", "?"), errs))
            rejected_out.append({
                "kind": kind, "id": cand.get("id"),
                "statement": cand.get("statement") or cand.get("title"),
                "bucket": "schema-blocked", "reason": "; ".join(errs),
                "dedup": entry.get("dedup", ""),
            })
            continue
        accepted.append({
            "queueId": f"{source_id}::{cand.get('id')}",
            "kind": kind,
            "sourceId": source_id,
            "triagedAt": today,
            "reason": entry.get("reason", ""),
            "dedup": entry.get("dedup", "new"),
            "confidence": entry.get("confidence", "medium"),
            "candidate": cand,
        })

    # 적재
    if accepted:
        with QUEUE.open("a", encoding="utf-8") as f:
            for a in accepted:
                f.write(json.dumps(a, ensure_ascii=False) + "\n")
    if rejected_out:
        rj = REJECTED_DIR / f"{source_id}.rejected.jsonl"
        with rj.open("a", encoding="utf-8") as f:
            for r in rejected_out:
                r.setdefault("rejectedAt", today)
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    update_registry_status(source_id, today)

    print(f"── triage 커밋 결과 (source={source_id}) ─────────")
    print(f"  큐 적재(승인 대기) : {len(accepted)}")
    print(f"  스키마 차단        : {len(blocked)}")
    print(f"  거부/중복/노이즈   : {len(data.get('rejected') or [])}")
    for cid, errs in blocked:
        print(f"    ⛔ {cid}: {errs[0]}")
    print(f"\n  큐: {QUEUE.relative_to(REPO_ROOT)}")
    print(f"  거부 로그: {(REJECTED_DIR / f'{source_id}.rejected.jsonl').relative_to(REPO_ROOT)}")
    print("\n  다음: 앱 도감에서 큐를 불러와 승인 → promote 무결성 검사 → Drive 반영")
    return 0


if __name__ == "__main__":
    sys.exit(main())
