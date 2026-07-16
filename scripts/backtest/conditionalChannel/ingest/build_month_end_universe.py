#!/usr/bin/env python3
"""
build_month_end_universe.py — 월말 point-in-time 종목군 스냅샷 생성.

각 월말 m에 대해 m+1월 투자가능 종목군과 시가총액 백분위를 계산한다.
이 스냅샷이 classifier.ts의 MonthlyGroupFlags[]에 해당한다.

종목 유형 필터(§5 제외 목록):
  - ETF/ETN: Market='ETF' 또는 Name에 'ETF'/'ETN' 포함
  - KONEX: Market='KONEX'
  - 우선주: 종목코드 끝자리가 5이고 Name에 '우' 포함 (패턴 기반, 완벽하지 않음)
  - SPAC: Name에 'SPAC' 또는 '기업인수목적' 포함
  - 관리종목·정리매매: 별도 이벤트 테이블 없으므로 패턴만(미완 — 게이트 PARTIAL 기여)

사용:
  python scripts/backtest/conditionalChannel/ingest/build_month_end_universe.py \\
      --raw scripts/backtest/data/conditionalChannel/kr/raw/marcap/ \\
      --out scripts/backtest/data/conditionalChannel/kr/processed/

출력:
  - processed/month_end/{YYYY-MM}.json   : 해당 월말 스냅샷
  - processed/securities_meta.json      : 전체 종목 메타(유형 분류 캐시)
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

# ── 보통주 판정 로직 ──

def is_preferred_share(code: str, name: str) -> bool:
    """KR 우선주 패턴: 종목코드 6자리에서 끝 두 자리 ≥ 50 또는 Name에 '우' 포함."""
    if len(code) >= 6 and code[-2:].isdigit():
        suffix = int(code[-2:])
        # 한국 관행: 보통주 00, 우선주 50/51/52...
        if suffix >= 50:
            return True
    if "우" in name and "우리" not in name:  # '우리금융' 등 오탐 방지
        return True
    return False

def is_etf_etn(code: str, name: str, market: str) -> bool:
    mkt = str(market).upper() if pd.notna(market) else ""
    if "ETF" in mkt or "ETN" in mkt:
        return True
    nm = str(name) if pd.notna(name) else ""
    return any(kw in nm for kw in ["ETF", "ETN", "인덱스펀드"])

def is_konex(market: str) -> bool:
    return str(market).upper() == "KONEX" if pd.notna(market) else False

def is_spac(name: str) -> bool:
    nm = str(name) if pd.notna(name) else ""
    return any(kw in nm for kw in ["SPAC", "기업인수목적"])

def classify_security_type(code: str, name: str, market: str) -> str:
    """
    반환값: 'COMMON_STOCK' | 'PREFERRED_STOCK' | 'ETF' | 'ETN' |
             'KONEX' | 'SPAC' | 'UNKNOWN'
    """
    if is_konex(market):
        return "KONEX"
    if is_etf_etn(code, name, market):
        return "ETF_ETN"
    if is_spac(name):
        return "SPAC"
    if is_preferred_share(code, name):
        return "PREFERRED_STOCK"
    # KOSPI/KOSDAQ 보통주로 간주
    mkt = str(market).upper() if pd.notna(market) else ""
    if "KOSPI" in mkt or "KOSDAQ" in mkt or mkt in ("KS", "KQ"):
        return "COMMON_STOCK"
    return "UNKNOWN"

# ── 월말 스냅샷 ──

def get_month_end_dates(df_all: pd.DataFrame) -> list[str]:
    """데이터에서 각 월의 마지막 거래일을 추출한다."""
    df_all["month"] = df_all["Date"].dt.to_period("M")
    month_ends = (
        df_all.groupby("month")["Date"]
        .max()
        .reset_index()
    )
    return sorted(month_ends["Date"].dt.strftime("%Y-%m-%d").tolist())

def build_month_end_snapshot(
    df_day: pd.DataFrame,
    month_end: str,
    securities_meta: dict,
    unresolved_codes: set[str],
    large_cap_percentile: float = 80.0,
) -> dict:
    """
    month_end 날짜의 종목군 스냅샷을 만든다.
    df_day: 해당 날짜의 전체 종목 데이터(Date, Code, Name, Close, Stocks, Marcap, Market)
    """
    records = []
    for _, row in df_day.iterrows():
        code = str(row["Code"])
        name = str(row["Name"]) if pd.notna(row["Name"]) else code
        market_field = str(row["Market"]) if pd.notna(row["Market"]) else ""

        sec_type = securities_meta.get(code, {}).get("type", "UNKNOWN")
        investable = sec_type == "COMMON_STOCK" and code not in unresolved_codes

        close = float(row["Close"]) if pd.notna(row["Close"]) else None
        stocks = float(row["Stocks"]) if pd.notna(row["Stocks"]) else None
        marketcap = float(row["Marcap"]) if pd.notna(row["Marcap"]) else None

        # 시가총액 재산출 (Marcap이 없으면 Close×Stocks로)
        if marketcap is None and close is not None and stocks is not None:
            marketcap = close * stocks

        records.append({
            "code": code,
            "name": name,
            "sec_type": sec_type,
            "investable": investable,
            "close": close,
            "stocks": int(stocks) if stocks is not None else None,
            "marketcap": marketcap,
            "market_field": market_field,
        })

    # 대형주 백분위 계산 (투자가능 종목, 시가총액 있는 것만)
    investable_with_cap = [r for r in records if r["investable"] and r["marketcap"] is not None]
    N = len(investable_with_cap)

    if N > 0:
        # 시총 내림차순 정렬
        sorted_cap = sorted(investable_with_cap, key=lambda r: (-r["marketcap"], r["code"]))
        rank_map = {r["code"]: (i + 1) for i, r in enumerate(sorted_cap)}
        # 백분위: (N - rank) / N * 100
        percentile_map = {code: (N - rank) / N * 100 for code, rank in rank_map.items()}
        large_threshold_rank = N * (100 - large_cap_percentile) / 100
    else:
        rank_map = {}
        percentile_map = {}
        large_threshold_rank = 0.0

    # 그룹 플래그 추가
    for r in records:
        if not r["investable"] or r["marketcap"] is None:
            r["unclassifiable"] = True
            r["rank"] = None
            r["percentile"] = None
            r["large"] = False
            r["group"] = None  # 미분류
        else:
            rank = rank_map.get(r["code"])
            r["unclassifiable"] = False
            r["rank"] = rank
            r["percentile"] = round(percentile_map.get(r["code"], 0.0), 4)
            r["large"] = (rank is not None and rank <= large_threshold_rank)
            r["group"] = "A" if r["large"] else "B"

    return {
        "month_end": month_end,
        "effective_month": _next_month(month_end[:7]),
        "total_count": len(records),
        "investable_count": sum(1 for r in records if r["investable"]),
        "classifiable_count": sum(1 for r in records if r["investable"] and not r["unclassifiable"]),
        "large_count": sum(1 for r in records if r.get("large")),
        "securities": records,
    }

def _next_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    if m == 12:
        return f"{y + 1}-01"
    return f"{y}-{m + 1:02d}"

def main():
    parser = argparse.ArgumentParser(description="월말 point-in-time 종목군 스냅샷 생성")
    parser.add_argument("--raw", default="scripts/backtest/data/conditionalChannel/kr/raw/marcap/")
    parser.add_argument("--out", default="scripts/backtest/data/conditionalChannel/kr/processed/")
    parser.add_argument("--large-pct", type=float, default=80.0,
                        help="대형주 백분위 임계치(기본 80 = 상위 20%%)")
    args = parser.parse_args()

    raw_dir = Path(args.raw)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "month_end").mkdir(exist_ok=True)
    unresolved_path = out_dir / "unresolved_corporate_action_codes.json"
    if unresolved_path.exists():
        with open(unresolved_path, encoding="utf-8") as f:
            unresolved_codes = set(json.load(f))
    else:
        unresolved_codes = set()

    parquet_files = sorted(raw_dir.glob("marcap-*.parquet"))
    if not parquet_files:
        print("오류: parquet 파일이 없습니다. download_marcap.py 먼저 실행하세요.", file=sys.stderr)
        sys.exit(1)

    # ── 전체 데이터 로드 (메모리 절약을 위해 필요 컬럼만) ──
    print(f"parquet 로드 중 ({len(parquet_files)}개 파일)...")
    frames = []
    for pf in parquet_files:
        df = pd.read_parquet(
            pf,
            columns=["Date", "Code", "Name", "Close", "Stocks", "Marcap", "Market"],
        )
        frames.append(df)
    df_all = pd.concat(frames).sort_values("Date").reset_index(drop=True)
    df_all["Date"] = pd.to_datetime(df_all["Date"])

    # ── 종목 메타(유형 분류) 빌드 ──
    print("종목 메타 분류 중...")
    # 각 종목의 가장 최근 Name/Market으로 유형 판정
    latest = (
        df_all.sort_values("Date")
        .groupby("Code")
        .last()
        .reset_index()[["Code", "Name", "Market"]]
    )
    securities_meta = {}
    for _, row in latest.iterrows():
        code = str(row["Code"])
        name = str(row["Name"]) if pd.notna(row["Name"]) else code
        market = str(row["Market"]) if pd.notna(row["Market"]) else ""
        sec_type = classify_security_type(code, name, market)
        securities_meta[code] = {"type": sec_type, "name": name, "market": market}

    # 종목 메타 저장
    meta_path = out_dir / "securities_meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(securities_meta, f, ensure_ascii=False)
    print(f"종목 메타 저장: {meta_path} ({len(securities_meta):,}개)")

    # ── 월말 날짜 목록 ──
    month_end_dates = get_month_end_dates(df_all)
    print(f"월말 날짜: {len(month_end_dates)}개 ({month_end_dates[0]} ~ {month_end_dates[-1]})")
    rows_by_date = df_all.groupby("Date", sort=False)

    # ── 월별 스냅샷 생성 ──
    for me in month_end_dates:
        df_day = rows_by_date.get_group(pd.Timestamp(me))
        if df_day.empty:
            continue
        snapshot = build_month_end_snapshot(
            df_day, me, securities_meta, unresolved_codes, args.large_pct
        )
        snap_path = out_dir / "month_end" / f"{me[:7]}.json"
        with open(snap_path, "w", encoding="utf-8") as f:
            # 배열이 크므로 indent 없이 저장
            json.dump(snapshot, f, ensure_ascii=False)

    print(f"\n월말 스냅샷 완료: {out_dir / 'month_end/'}")
    print("다음 단계: build_manifest.py 실행")

if __name__ == "__main__":
    main()
