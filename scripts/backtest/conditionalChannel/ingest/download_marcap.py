#!/usr/bin/env python3
"""
download_marcap.py — marcap 연도별 parquet 다운로드 및 체크섬 기록.

출처: github.com/FinanceData/marcap (GitHub Releases 또는 raw 파일)
원자료는 커밋하지 않는다(scripts/backtest/data/conditionalChannel/kr/raw/ 에 저장).
체크섬·행 수·날짜 범위만 매니페스트에 기록한다.

사용:
  pip install -r scripts/backtest/conditionalChannel/ingest/requirements.txt
  python scripts/backtest/conditionalChannel/ingest/download_marcap.py \\
      --years 2010-2025 --out scripts/backtest/data/conditionalChannel/kr/raw/marcap/

옵션:
  --years  YYYY 또는 YYYY-YYYY (기본: 2010-2025)
  --out    저장 경로 (기본: scripts/backtest/data/conditionalChannel/kr/raw/marcap/)
  --skip-existing  이미 존재하는 파일은 건너뜀
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import requests

# marcap GitHub raw URL 패턴
MARCAP_BASE_URL = (
    "https://raw.githubusercontent.com/FinanceData/marcap/master/data/"
)

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def parse_years(year_str: str) -> list[int]:
    if "-" in year_str and len(year_str) == 9:
        start, end = int(year_str[:4]), int(year_str[5:])
        return list(range(start, end + 1))
    return [int(year_str)]

def download_year(year: int, out_dir: Path, skip_existing: bool) -> dict:
    filename = f"marcap-{year}.parquet"
    url = MARCAP_BASE_URL + filename
    dest = out_dir / filename

    if skip_existing and dest.exists():
        print(f"  [SKIP] {filename} (이미 존재)")
        checksum = sha256_file(dest)
        return {"year": year, "file": filename, "status": "skipped", "sha256": checksum}

    print(f"  [DOWN] {url}")
    resp = requests.get(url, timeout=120, stream=True)
    if resp.status_code != 200:
        return {"year": year, "file": filename, "status": "error",
                "error": f"HTTP {resp.status_code}"}

    with open(dest, "wb") as f:
        for chunk in resp.iter_content(65536):
            f.write(chunk)

    checksum = sha256_file(dest)
    size = dest.stat().st_size
    print(f"  [OK]   {filename} ({size:,} bytes) sha256={checksum[:16]}...")
    return {"year": year, "file": filename, "status": "ok",
            "sha256": checksum, "size_bytes": size}

def main():
    parser = argparse.ArgumentParser(description="marcap parquet 다운로드")
    parser.add_argument("--years", default="2010-2025")
    parser.add_argument(
        "--out",
        default="scripts/backtest/data/conditionalChannel/kr/raw/marcap/",
    )
    parser.add_argument("--skip-existing", action="store_true")
    args = parser.parse_args()

    years = parse_years(args.years)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"marcap 다운로드 시작: {years[0]}~{years[-1]}, 출력={out_dir}")
    results = []
    for year in years:
        r = download_year(year, out_dir, args.skip_existing)
        results.append(r)

    # 다운로드 요약 저장
    summary_path = out_dir.parent / "download_log.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({"downloaded": results}, f, ensure_ascii=False, indent=2)

    errors = [r for r in results if r["status"] == "error"]
    if errors:
        print(f"\n⚠ 오류 {len(errors)}건:")
        for e in errors:
            print(f"  {e['year']}: {e.get('error')}")
        sys.exit(1)

    ok = [r for r in results if r["status"] in ("ok", "skipped")]
    print(f"\n완료: {len(ok)}/{len(results)}개 파일")
    print(f"요약 기록: {summary_path}")

if __name__ == "__main__":
    main()
