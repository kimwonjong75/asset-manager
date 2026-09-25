// scripts/backtest/holdingsTurtleCycle/episodeAnalysis.ts
// 하락 에피소드 분석(순수) — §재검증 과제4(b). "고점 대비 −20%+ 하락 구간마다 터틀이 피한 하락폭(%)과
// 이후 반등에서 놓친 폭(%)"을 계산한다. 가격 계열에서 에피소드를 독립적으로 찾고, 그 구간을
// simulateCell(includeSeries=true)의 실제 터틀 자본비율 궤적에 겹쳐 분해한다 — 별도 근사 모델이 아니라
// 엔진이 실제로 낸 결과를 그대로 재사용(재발명 금지).

import { SecurityData } from './data';
import { simulateCell, isSkip, VariantRules } from './engine';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export interface DrawdownEpisode {
  peakIdx: number;
  peakDate: string;
  peakPrice: number;
  troughIdx: number;
  troughDate: string;
  troughPrice: number;
  /** 고점 대비 하락폭(%) — 양수. */
  drawdownPct: number;
  /** 고점 재돌파(회복) 인덱스. 데이터 끝까지 회복 못 했으면 null. */
  recoveredIdx: number | null;
  recoveredDate: string | null;
}

/**
 * 종가 계열에서 고점 대비 −thresholdPct% 이상 하락한 에피소드를 전부 찾는다(현재 봉 포함, 미래 참조 없음
 * — 전체 계열을 한 번에 훑지만 각 에피소드의 peak/trough/recovered는 시간 순서상 실제로 그 시점에 결정되는
 * 값들이라 룩어헤드가 아니다. "회복" 판정만 사후적으로 알 수 있으므로 recoveredIdx=null인 에피소드는
 * "아직 회복 전"으로 표시한다).
 */
export function detectDrawdownEpisodes(
  dates: readonly string[],
  closes: readonly (number | null)[],
  thresholdPct = 20
): DrawdownEpisode[] {
  const episodes: DrawdownEpisode[] = [];
  let peakIdx = -1;
  let peakPrice = -Infinity;
  let troughIdx = -1;
  let troughPrice = Infinity;

  const flushIfQualifies = (recoveredIdx: number | null): void => {
    if (peakIdx < 0 || troughIdx < 0 || troughPrice >= peakPrice) return;
    const ddPct = ((peakPrice - troughPrice) / peakPrice) * 100;
    if (ddPct >= thresholdPct) {
      episodes.push({
        peakIdx, peakDate: dates[peakIdx], peakPrice,
        troughIdx, troughDate: dates[troughIdx], troughPrice,
        drawdownPct: ddPct,
        recoveredIdx, recoveredDate: recoveredIdx !== null ? dates[recoveredIdx] : null,
      });
    }
  };

  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (!isNum(c)) continue;
    if (c > peakPrice) {
      // 새 고점 — 직전까지 진행 중이던 하락이 기준을 넘었다면 "회복"으로 마감한다.
      flushIfQualifies(i);
      peakIdx = i; peakPrice = c; troughIdx = i; troughPrice = c;
      continue;
    }
    if (c < troughPrice) { troughIdx = i; troughPrice = c; }
  }
  // 데이터 끝까지 고점을 재돌파하지 못했다면 "미회복" 에피소드로 기록.
  flushIfQualifies(null);
  return episodes;
}

export interface EpisodeDecomposition extends DrawdownEpisode {
  /** B&H가 고점→저점 구간에서 실제로 겪은 하락폭(%, 양수). drawdownPct와 동일(정의상). */
  bhDeclinePct: number;
  /** 터틀이 같은 구간(고점 인덱스→저점 인덱스)에서 실제로 겪은 하락폭(%, 양수. 현금 대기 중이었다면 0에 가까움). */
  turtleDeclinePct: number;
  /** 피한 하락폭(%) = bhDeclinePct − turtleDeclinePct. 양수=터틀이 덜 잃었다. */
  avoidedDeclinePct: number;
  /** 저점 이후 구간(저점→회복 인덱스 또는 데이터 끝) B&H 반등폭(%). */
  bhReboundPct: number;
  /** 같은 구간 터틀 반등폭(%) — 재진입 신호를 기다리느라 초반 상승을 놓치면 이 값이 더 작다. */
  turtleReboundPct: number;
  /** 놓친 반등폭(%) = bhReboundPct − turtleReboundPct. 양수=터틀이 반등을 그만큼 덜 누렸다. */
  missedReboundPct: number;
  /** 반등 구간의 끝(회복 인덱스 또는 데이터 끝) 시점 인덱스·날짜. */
  reboundEndIdx: number;
  reboundEndDate: string;
}

/**
 * simulateCell을 시작일(워밍업 충족 이후 가장 이른 own 인덱스)부터 데이터 끝까지 1회 돌려(includeSeries),
 * 가격 계열에서 찾은 하락 에피소드마다 B&H·터틀 실제 경로를 겹쳐 "피한 하락 vs 놓친 반등"으로 분해한다.
 * @param warmupStartIdx 시뮬레이션 시작 own 인덱스(터틀 궤적의 기준 — 이 이전 에피소드는 대상에서 제외됨).
 */
export function decomposeEpisodes(
  sec: SecurityData,
  rules: VariantRules,
  costMultiplier: number,
  warmupStartIdx: number,
  opts: { cashAnnualRatePct?: number; thresholdPct?: number } = {}
): { episodes: EpisodeDecomposition[]; skipped: boolean } {
  const thresholdPct = opts.thresholdPct ?? 20;
  const r = simulateCell(sec, warmupStartIdx, rules, costMultiplier, {
    cashAnnualRatePct: opts.cashAnnualRatePct, includeSeries: true,
  });
  if (isSkip(r) || !r.series) return { episodes: [], skipped: true };

  const priceEpisodes = detectDrawdownEpisodes(sec.ownDates, sec.ownClose, thresholdPct)
    .filter(e => e.peakIdx >= warmupStartIdx);

  const { bh, turtle } = r.series;
  const off = warmupStartIdx; // series[k] ↔ sec 원본 인덱스 (off + k)

  const out: EpisodeDecomposition[] = [];
  for (const e of priceEpisodes) {
    const reboundEndIdx = e.recoveredIdx ?? (sec.ownDates.length - 1);
    const kPeak = e.peakIdx - off, kTrough = e.troughIdx - off, kRebound = reboundEndIdx - off;
    if (kPeak < 0 || kTrough < 0 || kRebound < 0 || kRebound >= bh.length) continue;

    const bhAtPeak = bh[kPeak], bhAtTrough = bh[kTrough], bhAtRebound = bh[kRebound];
    const turtleAtPeak = turtle[kPeak], turtleAtTrough = turtle[kTrough], turtleAtRebound = turtle[kRebound];

    // 클램프 없음 — 터틀이 이 구간에서 오히려 자본비율이 올랐다면(예: 고점 근처에서 이미 매도해
    // 현금 상태였고 그 뒤 재진입도 안 함) turtleDeclinePct는 음수가 되고 avoidedDeclinePct는
    // bhDeclinePct를 넘어설 수 있다(하락을 100% 넘어 "그 이상" 피한 셈 — 실제로 일어날 수 있는 값).
    const bhDeclinePct = ((bhAtPeak - bhAtTrough) / bhAtPeak) * 100;
    const turtleDeclinePct = turtleAtPeak > 0 ? ((turtleAtPeak - turtleAtTrough) / turtleAtPeak) * 100 : 0;
    const avoidedDeclinePct = bhDeclinePct - turtleDeclinePct;

    const bhReboundPct = bhAtTrough > 0 ? ((bhAtRebound - bhAtTrough) / bhAtTrough) * 100 : 0;
    const turtleReboundPct = turtleAtTrough > 0 ? ((turtleAtRebound - turtleAtTrough) / turtleAtTrough) * 100 : 0;
    const missedReboundPct = bhReboundPct - turtleReboundPct;

    out.push({
      ...e,
      bhDeclinePct, turtleDeclinePct, avoidedDeclinePct,
      bhReboundPct, turtleReboundPct, missedReboundPct,
      reboundEndIdx, reboundEndDate: sec.ownDates[reboundEndIdx],
    });
  }
  return { episodes: out, skipped: false };
}
