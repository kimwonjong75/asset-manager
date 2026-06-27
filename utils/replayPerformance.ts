// utils/replayPerformance.ts
// 규칙별 누적 성과 집계(순수 함수) — 현재 타임라인 윈도 안에서 각 규칙이 몇 번 발화했고,
// 그 신호 직후(복기 성과: 미래 종가 기반) 평균 수익률·방향 적중률이 얼마였는지 집계한다.
//
// 단일 신호일 성과(ReplayDay.outcome)는 이미 evaluateReplayDay가 계산해 둔다 — 이 모듈은 그걸
// 규칙 단위로 모으기만 한다(신호 계산엔 절대 미사용·새 엔진 없음). 구루 신호 + "검증 가능"
// 가격기반 알림 둘 다 집계(서버/보유가 의존 알림은 리플레이에서 신뢰 불가라 제외 — classifyReplayAlertScope).

import type { ReplayTimeline } from '../types/signalReplay';
import { classifyReplayAlertScope } from './replayEval';

export interface SignalPerformance {
  key: string;                 // `guru:<ruleId>` | `alert:<ruleId>` (충돌 방지)
  label: string;               // 규칙 표시명
  kind: 'guru' | 'alert';
  action: 'buy' | 'sell';
  signalCount: number;         // 윈도 내 발화 거래일 수
  avgRet20: number | null;     // 신호 후 20거래일 평균 수익률(%)
  avgMaxRise: number | null;   // 신호 후 [0,+60] 평균 최대 상승(%)
  avgMaxDrop: number | null;   // 신호 후 [0,+60] 평균 최대 하락(%)
  /** 방향 적중률(0~1) — 매수=ret20>0 비율 / 매도=ret20<0 비율. 분모는 미래 20일이 존재하는 신호(evaluable20). */
  hitRate20: number | null;
  evaluable20: number;         // ret20 != null 인 신호 수(적중률 분모)
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** 구루 action → 매수/매도 (마커 비대상 action은 null로 제외). */
function guruAction(action: string): 'buy' | 'sell' | null {
  if (action === 'sell-warning') return 'sell';
  if (action === 'buy-watch' || action === 'buy-setup') return 'buy';
  return null;
}

interface Acc {
  label: string;
  kind: 'guru' | 'alert';
  action: 'buy' | 'sell';
  count: number;
  ret20: number[];
  maxRise: number[];
  maxDrop: number[];
}

/**
 * 윈도(timeline.days) 전체에서 규칙별 성과 집계. 같은 규칙이 연속일 발화하면 각 일이 1건으로 카운트.
 * 정렬: 구루 먼저 → 발화 횟수 많은 순.
 */
export function computeSignalPerformance(timeline: ReplayTimeline): SignalPerformance[] {
  const accs = new Map<string, Acc>();

  const add = (key: string, label: string, kind: 'guru' | 'alert', action: 'buy' | 'sell',
    o: { ret20: number | null; maxRise: number | null; maxDrop: number | null }): void => {
    let a = accs.get(key);
    if (!a) { a = { label, kind, action, count: 0, ret20: [], maxRise: [], maxDrop: [] }; accs.set(key, a); }
    a.count++;
    if (o.ret20 != null) a.ret20.push(o.ret20);
    if (o.maxRise != null) a.maxRise.push(o.maxRise);
    if (o.maxDrop != null) a.maxDrop.push(o.maxDrop);
  };

  for (const day of timeline.days) {
    const o = day.outcome;
    for (const d of day.guruDiagnostics) {
      if (!(d.eligibility.eligible && d.evaluation === 'matched')) continue;
      const action = guruAction(d.action);
      if (!action) continue;
      add(`guru:${d.ruleId}`, d.ruleTitle, 'guru', action, o);
    }
    for (const al of day.alertDiagnostics) {
      if (!(al.enabled && al.evaluation === 'matched')) continue;
      if (classifyReplayAlertScope(al.filters.map(f => f.filterKey)) !== 'verifiable') continue;
      add(`alert:${al.ruleId}`, al.ruleName, 'alert', al.action, o);
    }
  }

  const rows: SignalPerformance[] = [];
  for (const [key, a] of accs) {
    const evaluable20 = a.ret20.length;
    const hit = a.ret20.filter(r => (a.action === 'buy' ? r > 0 : r < 0)).length;
    rows.push({
      key, label: a.label, kind: a.kind, action: a.action,
      signalCount: a.count,
      avgRet20: avg(a.ret20),
      avgMaxRise: avg(a.maxRise),
      avgMaxDrop: avg(a.maxDrop),
      hitRate20: evaluable20 ? hit / evaluable20 : null,
      evaluable20,
    });
  }

  // 구루 먼저 → 발화 횟수 많은 순 → 라벨 안정 정렬.
  rows.sort((x, y) =>
    (x.kind === y.kind ? 0 : x.kind === 'guru' ? -1 : 1)
    || (y.signalCount - x.signalCount)
    || x.label.localeCompare(y.label));
  return rows;
}
