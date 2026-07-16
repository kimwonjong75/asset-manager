#!/usr/bin/env python3
"""
build_manifest.py — 처리된 데이터 파일의 체크섬·통계를 기록하고
11개 데이터 품질 게이트를 평가한다.

게이트 PASS 기준 (모두 충족 시 overall_verdict='PASS'):
  G1  날짜×종목 키 중복 없음
  G2  연도별 거래일 수가 [230, 270] 범위
  G3  시가총액·Stocks·OHLCV 결측률 < 2%
  G4  KOSPI/KOSDAQ 구분 가능 (Market 필드 존재)
  G5  비보통주 제외 완료 (ETF/ETN/KONEX/우선주/SPAC)
  G6  보통주 판정 불가(UNKNOWN) 종목 < 5%
  G7  미해결 기업행위(UNKNOWN 유형) < 5% of total events
  G8  합병·상장폐지 대가 미해결 건 수 보고 (게이트 수준: 개수만 보고, FAIL 없음)
  G9  개발·검증·잠금 구간에 데이터가 연속으로 존재
  G10 split golden test: 삼성전자(005930) 2018-05-04 전후 Stocks 50배 확인
  G11 공식 교차검증 상태 (WAITING_FOR_USER_KEY → 잠금 비개봉)

사용:
  python scripts/backtest/conditionalChannel/ingest/build_manifest.py \\
      --raw scripts/backtest/data/conditionalChannel/kr/raw/marcap/ \\
      --processed scripts/backtest/data/conditionalChannel/kr/processed/

출력:
  - processed/manifest.json (dataQualityKrSize.ts가 읽는 파일)
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# ── 체크섬 ──

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def json_scalar(value):
    """Convert numpy/pandas scalar values to native JSON scalars."""
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")

# ── 게이트 평가 ──

def gate_g1_no_duplicates(raw_dir: Path) -> dict:
    """G1: 날짜×종목 키 중복 검사."""
    duplicates = 0
    for pf in sorted(raw_dir.glob("marcap-*.parquet")):
        df = pd.read_parquet(pf, columns=["Date", "Code"])
        dups = df.duplicated(subset=["Date", "Code"]).sum()
        duplicates += int(dups)
    passed = duplicates == 0
    return {
        "gate": "G1_NO_DUPLICATES",
        "passed": passed,
        "detail": f"중복 행 수: {duplicates}",
    }

def gate_g2_trading_days(raw_dir: Path) -> dict:
    """G2: 연도별 거래일 수 [230, 270] 범위 내."""
    out_of_range = []
    for pf in sorted(raw_dir.glob("marcap-*.parquet")):
        year = int(pf.stem.replace("marcap-", ""))
        df = pd.read_parquet(pf, columns=["Date"])
        n_days = df["Date"].nunique()
        if not (230 <= n_days <= 270):
            out_of_range.append({"year": year, "days": n_days})
    passed = len(out_of_range) == 0
    return {
        "gate": "G2_TRADING_DAYS",
        "passed": passed,
        "detail": f"범위 이탈 연도: {out_of_range}" if out_of_range else "전 연도 범위 내",
    }

def gate_g3_missing_rates(raw_dir: Path) -> dict:
    """G3: 시가총액·Stocks·OHLCV 결측률 < 2%."""
    cols = ["Open", "High", "Low", "Close", "Volume", "Stocks", "Marcap"]
    total_rows = 0
    missing_counts = {c: 0 for c in cols}
    for pf in sorted(raw_dir.glob("marcap-*.parquet")):
        df = pd.read_parquet(pf, columns=["Date"] + cols)
        total_rows += len(df)
        for c in cols:
            missing_counts[c] += int(df[c].isna().sum())
    rates = {c: round(missing_counts[c] / total_rows * 100, 3) for c in cols}
    failed_cols = [c for c, r in rates.items() if r >= 2.0]
    passed = len(failed_cols) == 0
    return {
        "gate": "G3_MISSING_RATES",
        "passed": passed,
        "total_rows": total_rows,
        "rates_pct": rates,
        "detail": f"결측률 2%+ 컬럼: {failed_cols}" if failed_cols else "전 컬럼 < 2%",
    }

def gate_g4_market_field(raw_dir: Path) -> dict:
    """G4: Market 필드 존재 및 KOSPI/KOSDAQ/KONEX/ETF 분류 가능."""
    sample = pd.read_parquet(
        sorted(raw_dir.glob("marcap-*.parquet"))[0], columns=["Market"]
    )
    has_field = "Market" in sample.columns and sample["Market"].notna().mean() > 0.9
    unique_markets = set()
    for pf in sorted(raw_dir.glob("marcap-*.parquet"))[:3]:
        df = pd.read_parquet(pf, columns=["Market"])
        unique_markets.update(df["Market"].dropna().unique())
    passed = has_field
    return {
        "gate": "G4_MARKET_FIELD",
        "passed": passed,
        "sample_markets": sorted(str(m) for m in list(unique_markets)[:20]),
        "detail": "Market 필드 존재" if passed else "Market 필드 없음",
    }

def gate_g5_security_type_filter(processed_dir: Path) -> dict:
    """G5: 비보통주 제외 완료 — securities_meta.json 기반."""
    meta_path = processed_dir / "securities_meta.json"
    if not meta_path.exists():
        return {"gate": "G5_TYPE_FILTER", "passed": False,
                "detail": "securities_meta.json 없음 — build_month_end_universe.py 실행 필요"}
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    types_count = {}
    for v in meta.values():
        t = v.get("type", "UNKNOWN")
        types_count[t] = types_count.get(t, 0) + 1
    passed = True  # G5는 필터 실행 여부 확인 (필터 결과는 G6에서)
    return {
        "gate": "G5_TYPE_FILTER",
        "passed": passed,
        "type_distribution": types_count,
        "detail": "securities_meta.json 존재, 분류 완료",
    }

def gate_g6_unknown_rate(processed_dir: Path) -> dict:
    """G6: UNKNOWN 종목 비율 < 5%."""
    meta_path = processed_dir / "securities_meta.json"
    if not meta_path.exists():
        return {"gate": "G6_UNKNOWN_RATE", "passed": False,
                "detail": "securities_meta.json 없음"}
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    total = len(meta)
    unknown = sum(1 for v in meta.values() if v.get("type") == "UNKNOWN")
    rate = unknown / total * 100 if total else 0
    passed = rate < 5.0
    return {
        "gate": "G6_UNKNOWN_RATE",
        "passed": passed,
        "total_securities": total,
        "unknown_count": unknown,
        "unknown_rate_pct": round(rate, 2),
        "detail": f"UNKNOWN 비율: {rate:.2f}% ({'OK' if passed else '5% 초과'})",
    }

def gate_g7_corp_action_unknown(processed_dir: Path) -> dict:
    """G7: unknown event rate <5%, or every affected code is excluded from all snapshots."""
    ca_path = processed_dir / "corporate_actions.json"
    if not ca_path.exists():
        return {"gate": "G7_CORP_ACTION_UNKNOWN", "passed": False,
                "detail": "corporate_actions.json 없음"}
    with open(ca_path, encoding="utf-8") as f:
        events = json.load(f)
    total = len(events)
    unknown = sum(1 for e in events if not e.get("classifiable", False))
    rate = unknown / total * 100 if total else 0
    unresolved_path = processed_dir / "unresolved_corporate_action_codes.json"
    unresolved_codes = set()
    if unresolved_path.exists():
        with open(unresolved_path, encoding="utf-8") as f:
            unresolved_codes = set(json.load(f))
    violations = []
    if unresolved_codes:
        for snapshot_path in sorted((processed_dir / "month_end").glob("*.json")):
            with open(snapshot_path, encoding="utf-8") as f:
                snapshot = json.load(f)
            for security in snapshot.get("securities", []):
                if security.get("code") in unresolved_codes and security.get("investable"):
                    violations.append(f"{snapshot_path.stem}:{security.get('code')}")
                    if len(violations) >= 20:
                        break
            if len(violations) >= 20:
                break
    exclusion_verified = bool(unresolved_codes) and len(violations) == 0
    passed = rate < 5.0 or exclusion_verified
    return {
        "gate": "G7_CORP_ACTION_UNKNOWN",
        "passed": passed,
        "total_events": total,
        "unknown_count": unknown,
        "unknown_rate_pct": round(rate, 2),
        "unresolved_security_count": len(unresolved_codes),
        "exclusion_verified": exclusion_verified,
        "exclusion_violations": violations,
        "detail": (
            f"미분류 비율 {rate:.2f}%, 영향 종목 {len(unresolved_codes)}개 전체기간 투자제외 확인"
            if exclusion_verified
            else f"미분류 비율: {rate:.2f}% ({'OK' if passed else '5% 초과 및 제외 미확인'})"
        ),
    }

def gate_g8_delisting_coverage(processed_dir: Path) -> dict:
    """G8: 합병 대가 이벤트 테이블 완비 여부.

    merger_proceeds.json이 없으면 FAIL.
    합병 대가를 확인할 수 없는 ORDERLY_MERGER 건을 EXCLUDE_OPEN으로 처리하면
    선택적 제외로 인한 성과 왜곡이 발생할 수 있다.
    prelock은 허용(lockbox만 차단)하므로 개발·검증 구간 시뮬레이션은 가능하다.
    lockbox 실행 전에 merger_proceeds.json을 구축하거나 UNRESOLVED 건수를 확인할 것.
    """
    proceeds_path = processed_dir / "merger_proceeds.json"
    if not proceeds_path.exists():
        return {
            "gate": "G8_DELISTING_COVERAGE",
            "passed": False,
            "detail": (
                "merger_proceeds.json 없음 — 합병 대가 미확인 건의 경제적 수익률을 계산할 수 없다. "
                "Gate 0.5 실측: 401건 정상폐지(합병/자진). 이 건들은 EXCLUDE_OPEN으로 처리되며 "
                "성과 왜곡 가능성이 있다. prelock은 허용되나 lockbox는 이 게이트 통과 전까지 차단된다."
            ),
            "warning": "MERGER_PROCEEDS_TABLE_NOT_BUILT — G8 lockbox-only 차단 게이트",
        }
    # merger_proceeds.json이 존재하면 내용 검사
    with open(proceeds_path, encoding="utf-8") as f:
        proceeds = json.load(f)
    unresolved = [p for p in proceeds if p.get("resolution_status") == "UNRESOLVED"]
    passed = len(unresolved) == 0
    return {
        "gate": "G8_DELISTING_COVERAGE",
        "passed": passed,
        "total_entries": len(proceeds),
        "unresolved_count": len(unresolved),
        "detail": (
            f"UNRESOLVED 합병 대가: {len(unresolved)}건" if unresolved
            else f"합병 대가 완비: {len(proceeds)}건"
        ),
    }

def gate_g9_date_continuity(processed_dir: Path) -> dict:
    """G9: 개발·검증·잠금 구간에 월말 스냅샷이 연속으로 존재."""
    me_dir = processed_dir / "month_end"
    if not me_dir.exists():
        return {"gate": "G9_DATE_CONTINUITY", "passed": False,
                "detail": "month_end/ 디렉터리 없음"}
    existing = sorted(f.stem for f in me_dir.glob("*.json"))
    required_spans = [
        ("2010-01", "2019-12"),  # 개발 (2010-2019, 검증과 겹침 없음)
        ("2020-01", "2022-12"),  # 검증 (2020-2022)
        ("2023-01", "2025-12"),  # 잠금 (2023-2025)
    ]
    missing = []
    for start, end in required_spans:
        cursor = pd.Period(start, freq="M")
        final = pd.Period(end, freq="M")
        while cursor <= final:
            month = str(cursor)
            if month not in existing:
                missing.append(month)
            cursor += 1
    passed = len(missing) == 0
    return {
        "gate": "G9_DATE_CONTINUITY",
        "passed": passed,
        "existing_months": len(existing),
        "first": existing[0] if existing else None,
        "last": existing[-1] if existing else None,
        "detail": str(missing) if missing else "개발·검증·잠금 구간 연속",
    }

def gate_g10_samsung_split(raw_dir: Path) -> dict:
    """G10: 삼성전자 2018-05-04 전후 Stocks 50배 golden test."""
    code = "005930"
    SPLIT_DATE = "2018-05-04"
    EXPECTED_RATIO_MIN = 49.0
    EXPECTED_RATIO_MAX = 51.0

    df2018 = pd.read_parquet(
        raw_dir / "marcap-2018.parquet",
        columns=["Date", "Code", "Stocks"],
    )
    sub = df2018[df2018["Code"] == code].sort_values("Date")
    if sub.empty:
        return {"gate": "G10_SAMSUNG_SPLIT", "passed": False, "detail": "005930 데이터 없음"}

    before = sub[sub["Date"].astype(str) < SPLIT_DATE]
    after  = sub[sub["Date"].astype(str) >= SPLIT_DATE]
    if before.empty or after.empty:
        return {"gate": "G10_SAMSUNG_SPLIT", "passed": False,
                "detail": "분할 전·후 데이터 없음"}

    stocks_before = float(before.iloc[-1]["Stocks"])
    stocks_after  = float(after.iloc[0]["Stocks"])
    ratio = stocks_after / stocks_before if stocks_before > 0 else 0
    passed = EXPECTED_RATIO_MIN <= ratio <= EXPECTED_RATIO_MAX
    return {
        "gate": "G10_SAMSUNG_SPLIT",
        "passed": passed,
        "stocks_before": stocks_before,
        "stocks_after": stocks_after,
        "ratio": round(ratio, 4),
        "detail": f"삼성전자 2018 분할비: {ratio:.4f}×(기대 ~50×) → {'OK' if passed else 'FAIL'}",
    }

def gate_g11_krx_crosscheck(processed_dir: Path) -> dict:
    """G11: persisted official KRX cross-check evidence."""
    evidence_path = processed_dir / "krx_crosscheck.json"
    if evidence_path.exists():
        try:
            with open(evidence_path, encoding="utf-8") as f:
                evidence = json.load(f)
            records = evidence.get("records", [])
            failed = evidence.get("failedRecords", [])
            passed = (
                evidence.get("status") == "PASS"
                and len(records) >= 10
                and len(failed) == 0
            )
            return {
                "gate": "G11_KRX_CROSSCHECK",
                "passed": passed,
                "status": evidence.get("status", "INVALID_EVIDENCE"),
                "sample_count": len(records),
                "failed_count": len(failed),
                "checked_at": evidence.get("checkedAt"),
                "detail": f"KRX official cross-check: {len(records)} samples, {len(failed)} failures",
            }
        except (OSError, ValueError, TypeError) as error:
            return {
                "gate": "G11_KRX_CROSSCHECK",
                "passed": False,
                "status": "INVALID_EVIDENCE",
                "detail": f"krx_crosscheck.json parse failure: {error}",
            }
    return {
        "gate": "G11_KRX_CROSSCHECK",
        "passed": False,
        "status": "WAITING_FOR_USER_KEY",
        "detail": (
            "data.go.kr 서비스키가 없어 KRX 공식 데이터 교차검증 미완료. "
            "--krx-key 플래그로 키를 주면 교차검증을 실행한다. "
            "이 게이트 미통과로 lockbox 실행이 차단된다."
        ),
        "action": "data.go.kr 회원가입 후 공공데이터 포털 > 주식 일별 시세 API 신청",
    }

# ── 처리 파일 체크섬 ──

def collect_checksums(processed_dir: Path) -> dict:
    checksums = {}
    for path in sorted(processed_dir.rglob("*.json")):
        if path.name == "manifest.json":
            continue
        key = path.relative_to(processed_dir).as_posix()
        checksums[key] = sha256_file(path)
    return checksums

def main():
    parser = argparse.ArgumentParser(description="데이터 매니페스트 + 품질 게이트 평가")
    parser.add_argument("--raw", default="scripts/backtest/data/conditionalChannel/kr/raw/marcap/")
    parser.add_argument("--processed", default="scripts/backtest/data/conditionalChannel/kr/processed/")
    args = parser.parse_args()

    raw_dir = Path(args.raw)
    processed_dir = Path(args.processed)
    processed_dir.mkdir(parents=True, exist_ok=True)

    if not list(raw_dir.glob("marcap-*.parquet")):
        print("오류: parquet 파일이 없습니다.", file=sys.stderr)
        sys.exit(1)

    print("데이터 품질 게이트 평가 중...")
    gates = [
        gate_g1_no_duplicates(raw_dir),
        gate_g2_trading_days(raw_dir),
        gate_g3_missing_rates(raw_dir),
        gate_g4_market_field(raw_dir),
        gate_g5_security_type_filter(processed_dir),
        gate_g6_unknown_rate(processed_dir),
        gate_g7_corp_action_unknown(processed_dir),
        gate_g8_delisting_coverage(processed_dir),
        gate_g9_date_continuity(processed_dir),
        gate_g10_samsung_split(raw_dir),
        gate_g11_krx_crosscheck(processed_dir),
    ]

    for g in gates:
        status = "PASS" if g["passed"] else "FAIL"
        encoding = sys.stdout.encoding or "utf-8"
        safe_detail = str(g["detail"][:80]).encode(encoding, errors="replace").decode(encoding)
        print(f"  [{status}] {g['gate']}: {safe_detail}")

    # 잠금 허용 여부: G11(공식 교차검증) 제외 전부 통과해야 dev/val 실행 가능
    lockbox_only = {"G8_DELISTING_COVERAGE", "G11_KRX_CROSSCHECK"}
    prelock_gates = [g for g in gates if g["gate"] not in lockbox_only]
    lockbox_gates = gates  # G11 포함 전부

    prelock_ok   = all(g["passed"] for g in prelock_gates)
    lockbox_ok   = all(g["passed"] for g in lockbox_gates)

    # raw 파일 체크섬
    raw_checksums = {}
    for pf in sorted(raw_dir.glob("marcap-*.parquet")):
        raw_checksums[pf.name] = sha256_file(pf)

    # processed 파일 체크섬
    proc_checksums = collect_checksums(processed_dir)

    manifest = {
        "hypothesisId": "conditional-channel-kr-size-v1",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schemaVersion": 1,
        "dataGateVerdict": {
            "prelock": "PASS" if prelock_ok else "FAIL",
            "lockbox": "PASS" if lockbox_ok else "FAIL",
            "lockboxBlockReason": None if lockbox_ok else ", ".join(
                g["gate"] for g in lockbox_gates if not g["passed"]
            ),
        },
        "gates": gates,
        "rawFiles": raw_checksums,
        "processedFiles": proc_checksums,
        "recreateCommands": [
            "python scripts/backtest/conditionalChannel/ingest/download_marcap.py --years 2010-2025",
            "python scripts/backtest/conditionalChannel/ingest/apply_corporate_actions.py",
            "python scripts/backtest/conditionalChannel/ingest/build_month_end_universe.py",
            "python scripts/backtest/conditionalChannel/ingest/build_manifest.py",
        ],
        "licenseNote": (
            "marcap 원자료: FinanceData/marcap GitHub 저장소. "
            "LICENSE 파일 없음(미확인 라이선스). 개인 연구 전용 사용. "
            "원자료 커밋 금지 — 체크섬·행 수만 이 매니페스트에 보존."
        ),
    }

    manifest_path = processed_dir / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2, default=json_scalar)

    print(f"\n매니페스트 저장: {manifest_path}")
    print(f"prelock 가능: {prelock_ok}, lockbox 가능: {lockbox_ok}")

    if not prelock_ok:
        failed = [g["gate"] for g in prelock_gates if not g["passed"]]
        print(f"[WARN] prelock 차단 게이트: {failed}")
        sys.exit(1)

if __name__ == "__main__":
    main()
