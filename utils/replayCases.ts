// utils/replayCases.ts
// 신호 리플레이 — 검증 사례(VerificationCase) 빌드/diff/저장 순수 함수 + 얇은 localStorage 래퍼.
//
// 사례 = "이 종목·이 기간을, 이 규칙 스냅샷으로 재현했을 때의 신호일/판정/메모"를 동결 저장한 것.
//   · 시드 규칙이 나중에 바뀌어도 ruleSnapshot(conditionJson)으로 당시 조건을 알 수 있고,
//     rulesetHash 로 "같은 규칙으로 재실행됐는지" 동일성 비교가 가능하다.
//   · 재실행(re-run) = 같은 종목·같은 기간(anchorDate/windowTradingDays)을 다시 로드 → 현재 규칙으로 신호 재계산.
//   · diff = 저장 당시 perRuleResults(신호일) vs 재실행 결과의 added/removed signal dates.
//   · caseRole(research|holdout): P3 샌드박스에서 과적합 방지용 분리(holdout으로는 규칙 튜닝 금지).
// localStorage 전용(Drive 미동기화). 순수 함수는 state 인자/반환 — id·createdAt 은 호출부(훅)가 주입(결정론).

import { createLogger } from './logger';
import { setItemSafe } from './safeStorage';
import { flattenLeaves } from './conditionLeafId';
import { hashRuleset } from './ruleOverrides';
import type { KnowledgeRule } from '../types/knowledge';
import type {
  ReplayDay, ReplayTimeline, VerificationCase, SignalVerdict, RuleOverride, ReplayCaseRole,
} from '../types/signalReplay';

const log = createLogger('ReplayCases');

export const REPLAY_CASES_KEY = 'asset-manager-replay-cases-v1';

export interface PerRuleResult {
  ruleId: string;
  action: string;
  signalDates: string[];
}

const byRuleId = (a: { ruleId: string }, b: { ruleId: string }): number =>
  a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;

/**
 * 윈도 전체에서 규칙별 발화일 수집 — 마커 게이팅과 동일 기준(구루 eligible && matched).
 * 알림은 마커 비대상이므로 사례 perRuleResults 에도 포함하지 않는다(신호 발생일 = 구루 기준).
 */
export function collectPerRuleResults(days: ReplayDay[]): PerRuleResult[] {
  const map = new Map<string, { action: string; dates: string[] }>();
  for (const day of days) {
    for (const d of day.guruDiagnostics) {
      if (d.eligibility.eligible && d.evaluation === 'matched') {
        let e = map.get(d.ruleId);
        if (!e) { e = { action: d.action, dates: [] }; map.set(d.ruleId, e); }
        e.dates.push(day.date);
      }
    }
  }
  return [...map.entries()]
    .map(([ruleId, e]) => ({ ruleId, action: e.action, signalDates: e.dates.slice().sort() }))
    .sort(byRuleId);
}

/** 당시 규칙 원본 보존 — signal 규칙만(조건 있음). 시드가 변해도 재현 가능. */
export function buildRuleSnapshot(
  rules: KnowledgeRule[],
): { ruleId: string; conditionJson: string; leafIds: string[] }[] {
  return rules
    .filter(r => r.computability === 'signal' && r.condition)
    .map(r => ({
      ruleId: r.id,
      conditionJson: JSON.stringify(r.condition),
      leafIds: flattenLeaves(r.condition).map(l => l.leafId),
    }))
    .sort(byRuleId);
}

/** 사례 요약 지표 — 신호 발생일 수 + 신호일들의 평균 20거래일 수익률(없으면 null). */
export function computeResultMetrics(
  timeline: ReplayTimeline,
): { signalCount: number; avgRet20: number | null } {
  const signalSet = new Set(timeline.signalDates);
  const rets = timeline.days
    .filter(d => signalSet.has(d.date) && d.outcome.ret20 != null)
    .map(d => d.outcome.ret20 as number);
  const avgRet20 = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  return { signalCount: timeline.signalDates.length, avgRet20 };
}

export interface BuildCaseInput {
  id: string;
  createdAt: string;
  ticker: string;
  name: string;
  exchange: string;
  categoryId: number;
  caseRole: ReplayCaseRole;
  anchorDate: string;
  windowTradingDays: number;
  effectiveRules: KnowledgeRule[];   // 오버라이드 적용본(P2는 시드 그대로)
  overridesSnapshot: RuleOverride[]; // P2: []
  timeline: ReplayTimeline;
  verdicts: SignalVerdict[];         // 이 종목 판정만
  memo: string;
}

/** 현재 화면 상태 → 검증 사례. id/createdAt 은 호출부 주입(순수성·테스트 결정론).
 *  판정은 **이 사례의 종목 + 기간(timeline.days) 안의 날짜만** 저장 — 다른 종목/다른 기간 판정 오염 방지
 *  (호출부가 이미 종목 필터해도 유틸 자체로 단단하게 — P3 research/holdout 보정 시 데이터 정합 유지). */
export function buildVerificationCase(input: BuildCaseInput): VerificationCase {
  const windowDates = new Set(input.timeline.days.map(d => d.date));
  return {
    id: input.id,
    ticker: input.ticker,
    name: input.name,
    exchange: input.exchange,
    categoryId: input.categoryId,
    caseRole: input.caseRole,
    anchorDate: input.anchorDate,
    windowTradingDays: input.windowTradingDays,
    rulesetHash: hashRuleset(input.effectiveRules),
    ruleSnapshot: buildRuleSnapshot(input.effectiveRules),
    overridesSnapshot: input.overridesSnapshot,
    perRuleResults: collectPerRuleResults(input.timeline.days),
    verdicts: input.verdicts.filter(v => v.ticker === input.ticker && windowDates.has(v.date)),
    memo: input.memo,
    resultMetrics: computeResultMetrics(input.timeline),
    createdAt: input.createdAt,
  };
}

export interface SignalDateDiff {
  added: string[];   // next 에만 있는 신호일
  removed: string[]; // prev 에만 있는 신호일
}

export function diffSignalDates(prev: string[], next: string[]): SignalDateDiff {
  const p = new Set(prev), n = new Set(next);
  return {
    added: next.filter(d => !p.has(d)).sort(),
    removed: prev.filter(d => !n.has(d)).sort(),
  };
}

function unionDates(results: PerRuleResult[]): string[] {
  const s = new Set<string>();
  for (const r of results) for (const d of r.signalDates) s.add(d);
  return [...s].sort();
}

export interface CaseDiff {
  overall: SignalDateDiff;
  perRule: { ruleId: string; action: string; added: string[]; removed: string[] }[];
}

/** 저장 당시(prev) vs 재실행(next) 신호일 비교 — 전체 + 규칙별. 변화 있는 규칙만 perRule 에 남긴다. */
export function diffCaseResults(prev: PerRuleResult[], next: PerRuleResult[]): CaseDiff {
  const overall = diffSignalDates(unionDates(prev), unionDates(next));
  const ruleIds = new Set<string>([...prev.map(r => r.ruleId), ...next.map(r => r.ruleId)]);
  const perRule = [...ruleIds]
    .sort()
    .map(ruleId => {
      const p = prev.find(r => r.ruleId === ruleId);
      const n = next.find(r => r.ruleId === ruleId);
      const d = diffSignalDates(p?.signalDates ?? [], n?.signalDates ?? []);
      return { ruleId, action: n?.action ?? p?.action ?? '', added: d.added, removed: d.removed };
    })
    .filter(r => r.added.length > 0 || r.removed.length > 0);
  return { overall, perRule };
}

// ── 사례 목록 CRUD(순수) ──
export function upsertCase(list: VerificationCase[], c: VerificationCase): VerificationCase[] {
  const idx = list.findIndex(x => x.id === c.id);
  if (idx < 0) return [c, ...list]; // 최신 우선
  const next = list.slice();
  next[idx] = c;
  return next;
}

export function removeCase(list: VerificationCase[], id: string): VerificationCase[] {
  return list.filter(c => c.id !== id);
}

/** 안전 파싱 — 필수 필드 없는 항목은 버린다(부분 성공). */
export function parseCases(raw: string | null): VerificationCase[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is VerificationCase => {
      if (!x || typeof x !== 'object') return false;
      const o = x as Record<string, unknown>;
      return typeof o.id === 'string'
        && typeof o.ticker === 'string'
        && Array.isArray(o.perRuleResults)
        && Array.isArray(o.verdicts);
    });
  } catch {
    return [];
  }
}

export function serializeCases(list: VerificationCase[]): string {
  return JSON.stringify(list);
}

// ── localStorage 래퍼(부수효과 — 훅에서만 호출) ──
export function loadCases(): VerificationCase[] {
  try {
    return parseCases(localStorage.getItem(REPLAY_CASES_KEY));
  } catch (e) {
    log.error('사례 로드 실패', e);
    return [];
  }
}

export function saveCases(list: VerificationCase[]): void {
  // 사용자 연구 데이터 — 조용한 실패 금지. 용량 초과 시 setItemSafe 가 재취득 캐시만 축출·재시도하고,
  // 그래도 실패하면 'asset-manager:storage-warning' 이벤트로 UI에 표면화한다(사례는 절대 자동 삭제 안 함).
  try {
    const result = setItemSafe(REPLAY_CASES_KEY, serializeCases(list));
    if (!result.ok) log.error('사례 저장 실패', result);
  } catch (e) {
    log.error('사례 저장 실패', e);
  }
}
