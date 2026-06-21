#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
지식 인제스트 — 1단계: 새 파일 검증·추출 (intake validator)
---------------------------------------------------------------------------
DB/inbox/ 에 떨궈진 파일을 검사하고, 중복이 아니면 본문을 추출해 staging에 등록한다.

이 스크립트가 하는 일 (검증):
  · 킬 스위치(DB/STOP_INGEST.flag) 확인 — 있으면 즉시 중단
  · 지원 형식(.txt/.md/.pdf)·비어있지 않음 검사
  · sha256 해시로 중복 검사 (이미 처리한 파일은 스킵)
  · 본문 텍스트 추출 (pdf는 pdftotext → 실패 시 pypdf 폴백)
  · 추출 본문이 충분한지(최소 길이) 검사
  · 원문 대장(registry/sources.jsonl)에 등록 + 추출본 저장

이 스크립트가 '하지 않는' 일:
  · AI triage(원칙/전략/노이즈 분류) — 다음 단계(Claude)가 staging/extracted를 읽어 수행
  · 후보를 신호로 활성화 — 절대. 사용자 승인 전엔 어떤 것도 신호가 되지 않는다.

종료 코드: 0=정상(처리/스킵 포함), 1=설정 오류
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Windows 콘솔(cp949)에서도 한글·이모지를 깨짐 없이 출력
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ── 경로 (이 파일: <repo>/scripts/ingest/validate_inbox.py) ──────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
DB_ROOT = REPO_ROOT / "DB"
INBOX = DB_ROOT / "inbox"
STAGING = DB_ROOT / "staging"
EXTRACTED = STAGING / "extracted"
REGISTRY_DIR = STAGING / "registry"
REGISTRY = REGISTRY_DIR / "sources.jsonl"
REJECTED = STAGING / "rejected"
QUEUE = DB_ROOT / "queue"
KILL_SWITCH = DB_ROOT / "STOP_INGEST.flag"

SUPPORTED_EXT = {".txt", ".md", ".pdf"}
MIN_CHARS = 200  # 추출 본문이 이보다 짧으면 '빈약'으로 표시(스캔 이미지 PDF 등)


def ensure_dirs() -> None:
    for d in (INBOX, EXTRACTED, REGISTRY_DIR, REJECTED, QUEUE):
        d.mkdir(parents=True, exist_ok=True)
    if not REGISTRY.exists():
        REGISTRY.touch()


def load_processed_hashes() -> set[str]:
    seen: set[str] = set()
    if REGISTRY.exists():
        for line in REGISTRY.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if rec.get("sha256"):
                    seen.add(rec["sha256"])
            except json.JSONDecodeError:
                continue
    return seen


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in (".txt", ".md"):
        return path.read_text(encoding="utf-8", errors="replace")
    if ext == ".pdf":
        # 1순위: pdftotext (-layout 로 표 구조 보존)
        try:
            out = subprocess.run(
                ["pdftotext", "-layout", str(path), "-"],
                capture_output=True, timeout=120,
            )
            if out.returncode == 0:
                txt = out.stdout.decode("utf-8", errors="replace")
                if len(txt.strip()) >= MIN_CHARS:
                    return txt
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        # 2순위: pypdf (한글 인코딩이 더 나을 때가 있음)
        try:
            import pypdf  # type: ignore
            reader = pypdf.PdfReader(str(path))
            return "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception:
            return ""
    return ""


def slug_and_date(filename: str) -> tuple[str, str]:
    """파일명 앞 YYMMDD를 sourceDate로 파싱. 없으면 빈 문자열."""
    m = re.match(r"^(\d{2})(\d{2})(\d{2})[_\.\- ]", filename)
    if m:
        yy, mm, dd = m.groups()
        return filename[: m.end() - 1], f"20{yy}-{mm}-{dd}"
    return "", ""


def make_id(sha: str, source_date: str) -> str:
    prefix = source_date.replace("-", "")[2:] if source_date else "nodate"
    return f"{prefix}_{sha[:8]}"


def main() -> int:
    if KILL_SWITCH.exists():
        print(f"⛔ 킬 스위치 감지({KILL_SWITCH.name}) — 인제스트 중단. "
              f"재개하려면 이 파일을 지우세요.")
        return 0

    ensure_dirs()
    seen = load_processed_hashes()

    candidates = sorted(
        p for p in INBOX.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXT
    )
    skipped_unsupported = sorted(
        p.name for p in INBOX.iterdir()
        if p.is_file() and p.suffix.lower() not in SUPPORTED_EXT
    )

    print(f"📂 inbox 스캔: {INBOX}")
    print(f"   지원 파일 {len(candidates)}개 / 미지원(무시) {len(skipped_unsupported)}개\n")

    n_new = n_dup = n_weak = n_empty = 0
    now_iso = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")

    for path in candidates:
        size = path.stat().st_size
        if size == 0:
            print(f"  ⚠️  빈 파일 스킵: {path.name}")
            n_empty += 1
            continue

        sha = sha256_of(path)
        if sha in seen:
            print(f"  ⏭️  이미 처리됨(중복) 스킵: {path.name}")
            n_dup += 1
            continue

        text = extract_text(path)
        char_count = len(text.strip())
        slug, source_date = slug_and_date(path.name)
        source_date = source_date or datetime.fromtimestamp(
            path.stat().st_mtime
        ).strftime("%Y-%m-%d")
        src_id = make_id(sha, source_date)

        if char_count == 0:
            print(f"  ❌ 추출 실패(본문 0자): {path.name} — rejected에 기록")
            (REJECTED / f"{src_id}.extract-failed.txt").write_text(
                f"원본: {path.name}\n사유: 텍스트 추출 실패(스캔 PDF 등)\n",
                encoding="utf-8",
            )
            n_empty += 1
            continue

        status = "validated-awaiting-triage"
        if char_count < MIN_CHARS:
            status = "validated-weak-extract"  # 추출은 됐으나 본문이 빈약 — triage 때 주의
            n_weak += 1
            print(f"  ⚠️  본문 빈약({char_count}자) 등록: {path.name}")
        else:
            n_new += 1
            print(f"  ✅ 검증·추출 완료({char_count:,}자): {path.name}  →  id={src_id}")

        # 추출본 저장
        (EXTRACTED / f"{src_id}.txt").write_text(text, encoding="utf-8")

        # 대장 등록
        record = {
            "id": src_id,
            "filename": path.name,
            "originalPath": str(path),
            "sha256": sha,
            "sizeBytes": size,
            "charCount": char_count,
            "sourceDate": source_date,   # 파일명 YYMMDD 또는 수정시각
            "ingestedAt": now_iso,
            "status": status,            # → 다음 단계(triage)가 이 상태를 읽음
            "extractedPath": str((EXTRACTED / f"{src_id}.txt").relative_to(REPO_ROOT)),
        }
        with REGISTRY.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        seen.add(sha)

    print("\n── 요약 ─────────────────────────────")
    print(f"  신규 검증 완료 : {n_new}")
    print(f"  본문 빈약      : {n_weak}")
    print(f"  중복 스킵      : {n_dup}")
    print(f"  빈/실패 스킵   : {n_empty}")
    if skipped_unsupported:
        print(f"  미지원 형식 무시: {', '.join(skipped_unsupported)}")
    print(f"\n  대장: {REGISTRY.relative_to(REPO_ROOT)}")
    print(f"  추출본: {EXTRACTED.relative_to(REPO_ROOT)}/")
    print("\n  다음 단계: Claude가 staging/extracted 를 읽어 triage(분류) → queue/ 후보 생성")
    return 0


if __name__ == "__main__":
    sys.exit(main())
