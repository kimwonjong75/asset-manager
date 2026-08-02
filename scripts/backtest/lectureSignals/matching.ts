// scripts/backtest/lectureSignals/matching.ts
// ---------------------------------------------------------------------------
// 매칭 대조군(§5.4): 같은 날짜의 비신호 종목 중 동일 시장·시총분위·직전63일 수익률분위·
// 직전63일 변동성분위·직전20일 거래대금분위로 최대 5개 매칭. 정확한 셀 매칭 실패 시
// 같은 시장·날짜 안에서 표준화 거리 최근접. 매칭 실패율 보고.
//
// 결정론: 후보 정렬은 (거리, 코드) 사전식. 입력 순서와 무관.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import type { Market } from './configTypes';
import { CONST } from './configTypes';
import type { CrossSection, StockFeatures } from './factorPanel';
import { quantileBin } from './factorPanel';
import { mean, stddevPop } from './features';

const NB = CONST.matchQuantileBins; // 5분위

/** 이벤트 종목의 매칭 셀 좌표(동일 시장 안). */
function cellOf(cross: CrossSection, f: StockFeatures): string {
  const capBin = quantileBin(cross.sortedMktcapPct, f.mktcapPercentile, NB);
  const ret63Bin = quantileBin(cross.sortedRet63, f.ret63, NB);
  const vol63Bin = quantileBin(cross.sortedVol63, f.vol63, NB);
  const amt20Bin = quantileBin(cross.sortedAmount20, f.amount20Avg, NB);
  return `${f.market}|${capBin}|${ret63Bin}|${vol63Bin}|${amt20Bin}`;
}

interface AxisStats {
  meanCap: number;
  sdCap: number;
  meanRet63: number;
  sdRet63: number;
  meanVol63: number;
  sdVol63: number;
  meanLogAmt: number;
  sdLogAmt: number;
}

function logAmt(a: number | null): number | null {
  return a !== null && a > 0 ? Math.log(a) : null;
}

function axisStats(cross: CrossSection): AxisStats {
  const logs = cross.sortedAmount20.filter((a) => a > 0).map((a) => Math.log(a));
  return {
    meanCap: mean(cross.sortedMktcapPct),
    sdCap: stddevPop(cross.sortedMktcapPct) || 1,
    meanRet63: mean(cross.sortedRet63),
    sdRet63: stddevPop(cross.sortedRet63) || 1,
    meanVol63: mean(cross.sortedVol63),
    sdVol63: stddevPop(cross.sortedVol63) || 1,
    meanLogAmt: mean(logs),
    sdLogAmt: stddevPop(logs) || 1,
  };
}

/** 표준화 거리(유클리드) — 결측 축은 큰 페널티. */
function zDistance(a: StockFeatures, b: StockFeatures, s: AxisStats): number {
  const PEN = 9; // 결측 축 페널티(표준편차 3배)²
  let d = 0;
  const pair = (x: number | null, y: number | null, sd: number): number =>
    x === null || y === null ? PEN : ((x - y) / sd) ** 2;
  d += pair(a.mktcapPercentile, b.mktcapPercentile, s.sdCap);
  d += pair(a.ret63, b.ret63, s.sdRet63);
  d += pair(a.vol63, b.vol63, s.sdVol63);
  d += pair(logAmt(a.amount20Avg), logAmt(b.amount20Avg), s.sdLogAmt);
  return Math.sqrt(d);
}

export interface MatchResult {
  controls: string[]; // 매칭된 대조군 코드(최대 5)
  method: 'CELL' | 'NEAREST' | 'NONE';
}

/**
 * 이벤트 종목 eventCode에 대한 대조군을 cross에서 고른다.
 * excludeCodes: 같은 날 같은 신호를 낸 종목(자기 포함) — 대조군에서 제외.
 */
export function matchControls(
  eventCode: string,
  cross: CrossSection,
  excludeCodes: ReadonlySet<string>
): MatchResult {
  const ev = cross.byCode.get(eventCode);
  if (!ev) return { controls: [], method: 'NONE' };
  const targetCell = cellOf(cross, ev);
  const s = axisStats(cross);

  // 후보: 같은 시장, 제외집합 밖.
  const candidates: StockFeatures[] = [];
  for (const f of cross.byCode.values()) {
    if (f.code === eventCode) continue;
    if (excludeCodes.has(f.code)) continue;
    if (f.market !== ev.market) continue;
    candidates.push(f);
  }
  if (candidates.length === 0) return { controls: [], method: 'NONE' };

  // 1) 정확한 셀 매칭
  const cellMatches = candidates.filter((f) => cellOf(cross, f) === targetCell);
  const rank = (arr: StockFeatures[]): string[] =>
    arr
      .map((f) => ({ code: f.code, dist: zDistance(ev, f, s) }))
      .sort((x, y) => (x.dist !== y.dist ? x.dist - y.dist : x.code < y.code ? -1 : 1))
      .slice(0, CONST.matchMaxControls)
      .map((x) => x.code);

  if (cellMatches.length > 0) {
    return { controls: rank(cellMatches), method: 'CELL' };
  }
  // 2) 폴백: 같은 시장·날짜 표준화 최근접
  return { controls: rank(candidates), method: 'NEAREST' };
}

export { cellOf };
