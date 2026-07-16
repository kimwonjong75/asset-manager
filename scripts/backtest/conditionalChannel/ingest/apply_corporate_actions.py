#!/usr/bin/env python3
"""
apply_corporate_actions.py — marcap 원시 OHLCV로부터 분할 이벤트를 감지하고
split-adjusted OHLCV와 기업행위 레코드를 생성한다.

설계 원칙:
  · Stocks 컬럼의 비율 변화로 이벤트를 감지한다.
  · 단순히 'Stocks가 바뀌었다 → 분할'로 처리하지 않는다.
    비율·방향·가격 움직임을 교차검증해 사건 유형을 분류한다.
  · 공식 기업행위 데이터가 없거나 유형 판정이 불가능한 이벤트는
    UNKNOWN으로 플래그만 남기고 조정하지 않는다(→ 게이트 FAIL 기여).
  · 분할 감지 후 조정은 누적 소급 방식:
    가장 최근 날짜를 기준으로 과거로 갈수록 adj_factor를 누적 곱한다.
  · 현금배당은 별도 현금흐름으로만 기록(신호가 조정 금지).

사용:
  python scripts/backtest/conditionalChannel/ingest/apply_corporate_actions.py \\
      --raw scripts/backtest/data/conditionalChannel/kr/raw/marcap/ \\
      --out scripts/backtest/data/conditionalChannel/kr/processed/

출력:
  - processed/securities/{CODE}.json     : split-adjusted OHLCV 시계열
  - processed/corporate_actions.json    : 감지된 기업행위 레코드
  - processed/split_events_summary.json : 감지 통계
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

import pandas as pd

# Stocks 비율 변화 감지 임계치
# 비율 = new_stocks / old_stocks
SPLIT_RATIO_MIN = 1.5    # 이 이상이면 분할/무상증자 후보
SPLIT_RATIO_MAX = 1 / 1.5  # 이 이하이면 병합 후보
PRICE_CONSISTENCY_TOL = 0.30  # 가격 역비율과 주식수 비율의 허용 오차(30%)

def detect_split_events(df: pd.DataFrame) -> list[dict]:
    """
    한 종목의 일별 데이터에서 Stocks 급변일을 감지하고 이벤트를 반환한다.
    df: 날짜 오름차순, 컬럼 [Date, Code, Name, Open, High, Low, Close, Volume, Stocks]
    """
    events = []
    stocks = df["Stocks"].values
    dates  = df["Date"].astype(str).values
    closes = df["Close"].values
    names  = df["Name"].values

    for i in range(1, len(df)):
        old = stocks[i - 1]
        new = stocks[i]
        if old <= 0 or new <= 0:
            continue
        ratio = new / old

        # 비율이 임계치 범위 안이면 무시
        if SPLIT_RATIO_MAX < ratio < SPLIT_RATIO_MIN:
            continue

        # 이벤트 유형 판단: 가격 역비율과 주식수 비율 교차검증
        price_ratio = closes[i] / closes[i - 1] if closes[i - 1] > 0 else None
        if price_ratio is not None:
            expected_price_ratio = 1 / ratio  # 분할이면 가격은 반비례
            consistency = abs(price_ratio - expected_price_ratio) / abs(expected_price_ratio)
        else:
            consistency = None

        # 사건 유형 분류
        if ratio >= SPLIT_RATIO_MIN:
            if consistency is not None and consistency < PRICE_CONSISTENCY_TOL:
                event_type = "SPLIT"      # 주식수 증가 + 가격 감소 일치 → 분할
            elif price_ratio is not None and 0.70 <= price_ratio <= 1.30:
                event_type = "SHARE_INCREASE_NO_PRICE_BREAK"
            else:
                event_type = "SPLIT_OR_BONUS_UNKNOWN"  # 판별 불가
        elif ratio <= SPLIT_RATIO_MAX:
            if consistency is not None and consistency < PRICE_CONSISTENCY_TOL:
                event_type = "REVERSE_SPLIT"
            elif price_ratio is not None and 0.70 <= price_ratio <= 1.30:
                event_type = "SHARE_DECREASE_NO_PRICE_BREAK"
            else:
                event_type = "REVERSE_SPLIT_OR_BUYBACK_UNKNOWN"
        else:
            continue

        events.append({
            "code": str(df["Code"].iloc[i]),
            "name": str(names[i]),
            "event_date": dates[i],
            "prev_date": dates[i - 1],
            "stocks_before": int(old),
            "stocks_after": int(new),
            "ratio": round(ratio, 6),
            "close_before": float(closes[i - 1]),
            "close_after":  float(closes[i]),
            "price_ratio": round(price_ratio, 6) if price_ratio is not None else None,
            "price_consistency": round(consistency, 4) if consistency is not None else None,
            "event_type": event_type,
            "classifiable": event_type in (
                "SPLIT", "REVERSE_SPLIT",
                "SHARE_INCREASE_NO_PRICE_BREAK", "SHARE_DECREASE_NO_PRICE_BREAK",
            ),
        })

    return events

def compute_adj_factors(df: pd.DataFrame, events: list[dict]) -> list[float]:
    """
    날짜 오름차순 df에 대해 각 행의 누적 조정 배수를 반환한다.
    최신 데이터를 기준(adj_factor=1)으로 과거로 소급한다.
    미분류(UNKNOWN) 이벤트는 조정하지 않는다(adj_factor 그대로 유지).
    """
    n = len(df)
    adj_factors = [1.0] * n
    dates = df["Date"].astype(str).values

    # 분류 가능한 이벤트만 사용
    classifiable = {
        e["event_date"]: e["ratio"]
        for e in events
        if e["event_type"] in ("SPLIT", "REVERSE_SPLIT")
    }

    # 뒤에서 앞으로 누적
    cumulative = 1.0
    for i in range(n - 1, -1, -1):
        d = dates[i]
        if i < n - 1 and dates[i + 1] in classifiable:
            # i+1 날짜에 이벤트 → i 이전 데이터에 1/ratio 적용
            ratio = classifiable[dates[i + 1]]
            cumulative /= ratio  # 분할이면 과거가 현재보다 조정값이 낮아야 함
        adj_factors[i] = cumulative

    return adj_factors

def process_security(code: str, source: pd.DataFrame, out_dir: Path, all_events: list) -> Optional[dict]:
    """
    모든 연도의 parquet에서 한 종목 데이터를 추출·조정·저장한다.
    """
    if source.empty:
        return None
    df = source.sort_values("Date").reset_index(drop=True)
    df = df.drop_duplicates(subset=["Date"]).reset_index(drop=True)

    events = detect_split_events(df)
    all_events.extend(events)

    adj_factors = compute_adj_factors(df, events)

    bars = []
    for i, row in enumerate(df.itertuples(index=False)):
        af = adj_factors[i]
        bars.append({
            "date":        str(row.Date)[:10],
            "open":        float(row.Open),
            "high":        float(row.High),
            "low":         float(row.Low),
            "close":       float(row.Close),
            "volume":      int(row.Volume),
            "stocks":      int(row.Stocks) if pd.notna(row.Stocks) else None,
            "marketcap":   float(row.Marcap) if pd.notna(row.Marcap) else None,
            "market":      str(row.Market) if pd.notna(row.Market) else None,
            "adj_factor":  round(af, 8),
            "adj_open":    round(float(row.Open)  * af, 2),
            "adj_high":    round(float(row.High)  * af, 2),
            "adj_low":     round(float(row.Low)   * af, 2),
            "adj_close":   round(float(row.Close) * af, 2),
            # 거래량은 분할 역수(adj_factor의 역수로 비례 조정, 단 SPLIT만)
            "adj_volume":  int(float(row.Volume) / af) if af != 0 else int(row.Volume),
        })

    # 마지막 행의 Name
    name = str(df["Name"].iloc[-1])

    # 저장
    out_file = out_dir / "securities" / f"{code}.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({"code": code, "name": name, "bars": bars, "split_events": events},
                  f, ensure_ascii=False)

    return {"code": code, "name": name, "bar_count": len(bars), "events": len(events)}

def main():
    parser = argparse.ArgumentParser(description="기업행위 처리 및 split-adjusted OHLCV 생성")
    parser.add_argument("--raw", default="scripts/backtest/data/conditionalChannel/kr/raw/marcap/")
    parser.add_argument("--out", default="scripts/backtest/data/conditionalChannel/kr/processed/")
    parser.add_argument("--codes", help="쉼표 구분 종목코드 목록(미지정 시 전체)")
    parser.add_argument("--resume", action="store_true",
                        help="이미 생성된 종목 JSON은 재작성하지 않고 이벤트만 다시 감지")
    args = parser.parse_args()

    raw_dir = Path(args.raw)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not list(raw_dir.glob("marcap-*.parquet")):
        print("오류: parquet 파일이 없습니다. download_marcap.py 먼저 실행하세요.", file=sys.stderr)
        sys.exit(1)

    parquet_files = sorted(raw_dir.glob("marcap-*.parquet"))
    columns = [
        "Date", "Code", "Name", "Open", "High", "Low", "Close",
        "Volume", "Stocks", "Marcap", "Market",
    ]
    print(f"원시 parquet 일괄 로드: {len(parquet_files)}개")
    frames = [pd.read_parquet(path, columns=columns) for path in parquet_files]
    all_rows = pd.concat(frames, ignore_index=True)
    all_rows["Code"] = all_rows["Code"].astype(str).str.zfill(6)

    if args.codes:
        requested = {c.strip().zfill(6) for c in args.codes.split(",")}
        all_rows = all_rows[all_rows["Code"].isin(requested)]
    all_codes = sorted(all_rows["Code"].unique())
    grouped = all_rows.groupby("Code", sort=False)

    print(f"처리 대상 종목 수: {len(all_codes):,}")

    all_events: list[dict] = []
    summaries = []
    for idx, code in enumerate(all_codes):
        if idx % 500 == 0:
            print(f"  진행: {idx}/{len(all_codes)} ({idx*100//len(all_codes)}%)")
        source = grouped.get_group(code)
        existing_path = out_dir / "securities" / f"{code}.json"
        if args.resume and existing_path.exists():
            events = detect_split_events(source.sort_values("Date").drop_duplicates(subset=["Date"]))
            all_events.extend(events)
            summaries.append({
                "code": code,
                "name": str(source.sort_values("Date")["Name"].iloc[-1]),
                "bar_count": len(source),
                "events": len(events),
            })
            continue
        result = process_security(code, source, out_dir, all_events)
        if result:
            summaries.append(result)

    # 기업행위 레코드 저장
    corp_path = out_dir / "corporate_actions.json"
    with open(corp_path, "w", encoding="utf-8") as f:
        json.dump(all_events, f, ensure_ascii=False, indent=None)

    unresolved_codes = sorted({e["code"] for e in all_events if not e["classifiable"]})
    unresolved_path = out_dir / "unresolved_corporate_action_codes.json"
    with open(unresolved_path, "w", encoding="utf-8") as f:
        json.dump(unresolved_codes, f, ensure_ascii=False)

    # 분할 이벤트 통계
    total = len(all_events)
    classifiable = sum(1 for e in all_events if e["classifiable"])
    unknown = total - classifiable
    split_summary = {
        "total_events": total,
        "classifiable": classifiable,
        "unknown": unknown,
        "pct_unknown": round(unknown * 100 / total, 1) if total else 0,
        "event_types": {},
    }
    for e in all_events:
        t = e["event_type"]
        split_summary["event_types"][t] = split_summary["event_types"].get(t, 0) + 1

    summary_path = out_dir / "split_events_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(split_summary, f, ensure_ascii=False, indent=2)

    print(f"\n완료: {len(summaries):,}개 종목 처리")
    print(f"기업행위 감지: {total}건 (분류 가능 {classifiable}, 미분류 {unknown})")
    print(f"기업행위 저장: {corp_path}")
    print(f"미분류 사건 종목 제외목록: {unresolved_path} ({len(unresolved_codes)}개)")
    print(f"통계 저장: {summary_path}")

    # 미분류가 많으면 경고
    if total > 0 and unknown / total > 0.2:
        print(f"\n[WARN] 미분류 이벤트가 {split_summary['pct_unknown']}%입니다. "
              "build_manifest.py에서 UNRESOLVED_CORP_ACTION 게이트가 FAIL할 수 있습니다.")

if __name__ == "__main__":
    main()
