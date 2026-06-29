// utils/winRateDiagnostics.ts
// 신호 리플레이 — "손익비 × 승률" 진단(순수 함수). 사용자 판정(SignalVerdict)을 승/패/제외로 분류하고,
// 각 판정일의 신호 후 실현 수익률(ret20, 복기치)을 크기(magnitude)로 묶어 손익비·손익분기 승률·기대값을 낸다.
//
// 닫는 루프: 지식 claim `low-winrate-high-payoff`(강환국, 3할 타자론)의 "손익분기 승률 = 1/(1+손익비)"를
//   사용자의 실제 판정으로 화면에 닫는다(앱이 실현 승률/손익비를 추적해 손익분기 대비 위치 표시).
//
// ── 설계 결정: 판정(verdict.kind) → 승/패/제외 매핑 ──────────────────────────────
//   · WIN   = good                    (사용자가 "적절한 신호"로 판정 = 이긴 거래)
//   · LOSS  = false / too-late / too-early
//       - false:     잘못된 신호 → 패.
//       - too-late:  이미 움직인 뒤 진입 → 통상 불리(고점 매수) → 패.
//       - too-early: 너무 일찍 진입 → 드로다운/흔들기 통과 → 패.
//       실현 승률은 이진(수익/비수익)이라 "good 외 진입판정"은 비-승으로 본다.
//   · EXCLUDED = missed-buy / missed-sell
//       놓친 신호 = false negative(발화 안 한 날 태깅). 실제로 "잡은 거래"가 아니므로 승률 표본에서 제외
//       (포함하면 신호 시스템의 실현 승률을 왜곡). 별도 카운트(excludedMissed)로만 노출 — 재현율 힌트.
//
// ── 크기(magnitude): 실현 수익률 |ret20| ────────────────────────────────────────
//   avgWinPct  = 승 판정들의 평균 |수익률|, avgLossPct = 패 판정들의 평균 |수익률|.
//   절대값을 쓰는 이유: 매수/매도 방향을 통일한다. "good" 매도경고는 가격이 빠져 ret<0이지만 올바른 콜이므로
//   |ret|이 "회피한 손실 = 이김 크기"다. "false" 신호의 |ret|은 "불리하게 움직인 크기 = 진 크기"다.
//   판정이 승/패를 정하고(verdict.kind), 실현 수익률이 크기를 정한다(ret20). 둘은 직교 — 부호 충돌 없음.
//
// 표본 주의(★): 판정은 localStorage·수작업·소표본이라 N이 작다("승률 100%(2건)" 착시). smallSample 플래그로
//   경고하고, 손익비(payoff)는 승·패 양쪽에 실현 수익률 표본이 모두 있어야만 산출(없으면 null → 배지 미표시).
//
// ret20(20거래일 후 수익률)이 없는 최근 판정은 승률 표본(n)엔 들어가도 크기 평균엔 빠질 수 있다
//   (winsWithReturn/lossesWithReturn로 분리 노출). 미래 미반영 — 신호 계산엔 절대 미사용.

import type { SignalVerdictKind } from '../types/signalReplay';

/** 신뢰 가능한 최소 표본 — 이 미만이면 승률을 신뢰하지 말 것(소표본 경고). */
export const MIN_RELIABLE_SAMPLE = 10;

export type VerdictClass = 'win' | 'loss' | 'excluded';

/** 판정 종류 → 승/패/제외. (설계 결정은 파일 상단 주석 참조) */
export function classifyVerdict(kind: SignalVerdictKind): VerdictClass {
  switch (kind) {
    case 'good':
      return 'win';
    case 'false':
    case 'too-late':
    case 'too-early':
      return 'loss';
    case 'missed-buy':
    case 'missed-sell':
      return 'excluded';
  }
}

/** 한 판정의 입력 단위 — 종류 + 신호 후 실현 수익률(%, 없으면 null). 호출부가 판정일↔outcome 조인. */
export interface VerdictReturn {
  kind: SignalVerdictKind;
  ret: number | null;
}

export interface WinRateDiagnostics {
  /** 승/패로 분류된 표본 수(=승률 분모). missed-* 는 제외. */
  n: number;
  wins: number;
  losses: number;
  /** missed-buy/missed-sell 개수(표본 제외 — 별도 표시·재현율 힌트). */
  excludedMissed: number;
  /** 실현 승률(0~1) = wins/n. n=0 → null. */
  winRate: number | null;
  /** 승 표본의 평균 |수익률|(%). 수익률 있는 승 표본 없으면 null. */
  avgWinPct: number | null;
  /** 패 표본의 평균 |수익률|(%). */
  avgLossPct: number | null;
  /** 손익비 = avgWinPct/avgLossPct. 승·패 양쪽 평균이 있고 avgLoss>0일 때만(무한대 가드) — 아니면 null. */
  payoff: number | null;
  /** 손익분기 승률 = 1/(1+payoff). payoff=null → null. */
  breakevenWinRate: number | null;
  /** 기대값(% / 거래) = winRate*avgWin − (1−winRate)*avgLoss. 셋 다 있어야 산출. */
  expectancy: number | null;
  /** 손익분기 대비 위치 — winRate vs breakevenWinRate. 산출 불가(payoff null)면 null. */
  edge: 'profitable' | 'breakeven' | 'losing' | null;
  /** 평균 계산에 실제 쓰인 표본 수(ret 존재) — 크기 표본은 n보다 작을 수 있음. */
  winsWithReturn: number;
  lossesWithReturn: number;
  /** n>0 && n<MIN_RELIABLE_SAMPLE — 소표본 경고. */
  smallSample: boolean;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

const EMPTY: WinRateDiagnostics = {
  n: 0, wins: 0, losses: 0, excludedMissed: 0,
  winRate: null, avgWinPct: null, avgLossPct: null,
  payoff: null, breakevenWinRate: null, expectancy: null, edge: null,
  winsWithReturn: 0, lossesWithReturn: 0, smallSample: false,
};

const EDGE_EPS = 1e-9;

/**
 * 판정+실현수익률 표본 → 승률/손익비 진단. 순수 — 입력 배열 1패스. 각 판정 = 1표본(중복 디듀프 없음, 호출부 책임).
 * 0 분모·소표본·무한대 손익비를 모두 가드해 안전한 null 을 돌려준다(착시 배지 방지).
 */
export function computeWinRateDiagnostics(samples: VerdictReturn[]): WinRateDiagnostics {
  if (samples.length === 0) return EMPTY;

  let wins = 0, losses = 0, excludedMissed = 0;
  const winRets: number[] = [];
  const lossRets: number[] = [];

  for (const s of samples) {
    const cls = classifyVerdict(s.kind);
    if (cls === 'excluded') { excludedMissed++; continue; }
    if (cls === 'win') {
      wins++;
      if (s.ret != null && isFinite(s.ret)) winRets.push(Math.abs(s.ret));
    } else {
      losses++;
      if (s.ret != null && isFinite(s.ret)) lossRets.push(Math.abs(s.ret));
    }
  }

  const n = wins + losses;
  const winRate = n > 0 ? wins / n : null;
  const avgWinPct = mean(winRets);
  const avgLossPct = mean(lossRets);

  // 손익비 — 양쪽 평균이 있고 패 평균이 양수일 때만(0 또는 한쪽 누락이면 산출 불가).
  const payoff =
    avgWinPct != null && avgLossPct != null && avgLossPct > 0 ? avgWinPct / avgLossPct : null;
  const breakevenWinRate = payoff != null ? 1 / (1 + payoff) : null;

  const expectancy =
    winRate != null && avgWinPct != null && avgLossPct != null
      ? winRate * avgWinPct - (1 - winRate) * avgLossPct
      : null;

  let edge: WinRateDiagnostics['edge'] = null;
  if (winRate != null && breakevenWinRate != null) {
    if (winRate > breakevenWinRate + EDGE_EPS) edge = 'profitable';
    else if (winRate < breakevenWinRate - EDGE_EPS) edge = 'losing';
    else edge = 'breakeven';
  }

  return {
    n, wins, losses, excludedMissed,
    winRate, avgWinPct, avgLossPct,
    payoff, breakevenWinRate, expectancy, edge,
    winsWithReturn: winRets.length, lossesWithReturn: lossRets.length,
    smallSample: n > 0 && n < MIN_RELIABLE_SAMPLE,
  };
}
