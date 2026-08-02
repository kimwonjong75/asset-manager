// scripts/backtest/lectureSignals/factorPanel.ts
// ---------------------------------------------------------------------------
// 공통 팩터 패널(§5.6) + 날짜별 횡단면(cross-section). 분해표와 매칭이 공유한다.
//
// 신호일 D에 알 수 있는 값만 사용(§5.6 "구간 정의에 미래 수익률을 사용하지 않는다").
// 횡단면 분위(유동성·상승률·변동성)는 그날 적격 유니버스 안에서 결정론적으로 계산한다.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import type { Market, SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import { percentileSorted } from '../conditionalChannel/statistics';
import {
  dailyReturn,
  priorMean,
  realizedVol,
  returnK,
  volumeMultiple,
} from './features';

/** 신호일 D에 알 수 있는 종목 특성(횡단면 원소). */
export interface StockFeatures {
  code: string;
  market: Market;
  mktcapPercentile: number; // PIT 월말 백분위(0~100)
  ret5: number | null;
  ret21: number | null;
  ret63: number | null;
  dailyRet: number | null;
  vol20: number | null;
  vol63: number | null;
  amount20Avg: number | null; // 직전20일 평균 거래대금(원)
  volMultiple: number | null;
}

/**
 * 종목 bars의 bar index i에서 신호일 특성을 계산한다. PIT 백분위는 외부에서 주입.
 */
export function stockFeaturesAt(
  bars: SecurityBars,
  i: number,
  market: Market,
  mktcapPercentile: number
): StockFeatures {
  return {
    code: bars.code,
    market,
    mktcapPercentile,
    ret5: returnK(bars.adjClose, i, 5),
    ret21: returnK(bars.adjClose, i, 21),
    ret63: returnK(bars.adjClose, i, 63),
    dailyRet: dailyReturn(bars.adjClose, i),
    vol20: realizedVol(bars.adjClose, i, 20),
    vol63: realizedVol(bars.adjClose, i, 63),
    amount20Avg: priorMean(bars.amount, i, CONST.amountAvgWindow),
    volMultiple: volumeMultiple(bars.adjVolume, i, CONST.volBaselineWindow),
  };
}

/** 오름차순 정렬값에서 내부 컷포인트(nbins-1개) 기준 bin(0..nbins-1). x가 null이면 -1. */
export function quantileBin(
  sortedAsc: readonly number[],
  x: number | null,
  nbins: number
): number {
  if (x === null || !Number.isFinite(x) || sortedAsc.length === 0) return -1;
  let bin = 0;
  for (let k = 1; k < nbins; k++) {
    const cut = percentileSorted(sortedAsc, (100 * k) / nbins);
    if (x >= cut) bin = k;
  }
  return bin;
}

/** 날짜 하나의 횡단면: 적격 종목 특성 + 분위 컷용 정렬 배열. */
export interface CrossSection {
  date: string;
  byCode: Map<string, StockFeatures>;
  sortedRet63: number[];
  sortedVol63: number[];
  sortedVol20: number[];
  sortedAmount20: number[];
  sortedMktcapPct: number[];
}

function sortedFinite(values: Iterable<number | null>): number[] {
  const out: number[] = [];
  for (const v of values) if (v !== null && Number.isFinite(v)) out.push(v);
  out.sort((a, b) => a - b);
  return out;
}

/** 특성 배열로부터 CrossSection 조립(분위 컷 정렬 배열 포함). */
export function buildCrossSection(date: string, feats: readonly StockFeatures[]): CrossSection {
  const byCode = new Map<string, StockFeatures>();
  for (const f of feats) byCode.set(f.code, f);
  return {
    date,
    byCode,
    sortedRet63: sortedFinite(feats.map((f) => f.ret63)),
    sortedVol63: sortedFinite(feats.map((f) => f.vol63)),
    sortedVol20: sortedFinite(feats.map((f) => f.vol20)),
    sortedAmount20: sortedFinite(feats.map((f) => f.amount20Avg)),
    sortedMktcapPct: sortedFinite(feats.map((f) => f.mktcapPercentile)),
  };
}

// ===========================================================================
// 고정 경계 bin(횡단면 불필요) — §5.6
// ===========================================================================

/** 시가총액 구간(§5.6): 대형 상위20%(pct>=80) / 중형 20~80 / 소형 하위20%(pct<20). */
export function sizeBucket(pct: number): 'LARGE' | 'MID' | 'SMALL' {
  if (pct >= 80) return 'LARGE';
  if (pct < 20) return 'SMALL';
  return 'MID';
}

/** 거래량 과다 bin(§5.6): <1 / 1~2 / 2~5 / >=5. null이면 'NA'. */
export function volumeMultipleBin(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return 'NA';
  if (m < 1) return '<1x';
  if (m < 2) return '1-2x';
  if (m < 5) return '2-5x';
  return '>=5x';
}

/** 1일 수익률(부호 있음) bin(§5.6): <=-10 / -10~-5 / -5~5 / 5~10 / >=10 (%). */
export function dailyReturnBin(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return 'NA';
  if (r <= -0.1) return '<=-10%';
  if (r < -0.05) return '-10~-5%';
  if (r < 0.05) return '-5~5%';
  if (r < 0.1) return '5~10%';
  return '>=10%';
}

/** 1일 절대충격(부호 없음) bin(§5.6): <3 / 3~5 / 5~10 / >=10 (%). 1일 수익률과 별도 열. */
export function dailyAbsShockBin(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return 'NA';
  const a = Math.abs(r);
  if (a < 0.03) return '<3%';
  if (a < 0.05) return '3-5%';
  if (a < 0.1) return '5-10%';
  return '>=10%';
}

/** 3분위 라벨. bin(0/1/2) → 하/중/상. -1 → 'NA'. */
export function tertileLabel(bin: number): string {
  return bin === 0 ? 'Low' : bin === 1 ? 'Mid' : bin === 2 ? 'High' : 'NA';
}

/** 한 이벤트의 §5.6 분해 팩터 라벨 집합. */
export interface FactorPanelLabels {
  market: Market;
  size: string;
  liquidityTertile: string;
  volumeMultiple: string;
  ret5Tertile: string;
  ret21Tertile: string;
  ret63Tertile: string;
  dailyReturn: string;
  dailyAbsShock: string;
  vol20Tertile: string;
  vol63Tertile: string;
  regime: string; // 'RISK' | 'NORMAL'
}

/**
 * 이벤트 종목의 §5.6 팩터 라벨. cross는 신호일 D의 횡단면, f는 이벤트 종목 특성.
 * regimeRisk는 KOSPI MA150 아래 여부(외부 주입).
 */
export function factorLabels(
  f: StockFeatures,
  cross: CrossSection,
  regimeRisk: boolean
): FactorPanelLabels {
  return {
    market: f.market,
    size: sizeBucket(f.mktcapPercentile),
    liquidityTertile: tertileLabel(quantileBin(cross.sortedAmount20, f.amount20Avg, 3)),
    volumeMultiple: volumeMultipleBin(f.volMultiple),
    ret5Tertile: tertileLabel(quantileBin(sortedFromCross(cross, 'ret5'), f.ret5, 3)),
    ret21Tertile: tertileLabel(quantileBin(sortedFromCross(cross, 'ret21'), f.ret21, 3)),
    ret63Tertile: tertileLabel(quantileBin(cross.sortedRet63, f.ret63, 3)),
    dailyReturn: dailyReturnBin(f.dailyRet),
    dailyAbsShock: dailyAbsShockBin(f.dailyRet),
    vol20Tertile: tertileLabel(quantileBin(cross.sortedVol20, f.vol20, 3)),
    vol63Tertile: tertileLabel(quantileBin(cross.sortedVol63, f.vol63, 3)),
    regime: regimeRisk ? 'RISK' : 'NORMAL',
  };
}

/** ret5/ret21은 CrossSection에 정렬 배열을 미리 두지 않아 필요 시 생성(호출 빈도 낮음). */
function sortedFromCross(cross: CrossSection, key: 'ret5' | 'ret21'): number[] {
  const out: number[] = [];
  for (const f of cross.byCode.values()) {
    const v = f[key];
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}
