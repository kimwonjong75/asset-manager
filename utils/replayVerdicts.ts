// utils/replayVerdicts.ts
// 신호 리플레이 — 사용자 판정(SignalVerdict) 저장/조회 순수 함수 + 얇은 localStorage 래퍼.
//
// · 키 = (ticker, date, ruleId?) — ruleId 생략 시 "그 날짜 전반" 판정.
// · 놓친 매수/매도(missed-buy/missed-sell)는 신호가 안 뜬 날에도 태깅 가능(false negative 기록).
//   → 저장은 선택 날짜에만 의존하므로 마커 유무와 무관하게 동작한다.
// · localStorage 전용(Drive 미동기화). 라이브 구루 신호/알림 동작 불변.
// · 순수 함수(upsert/remove/find/filter/parse/serialize)는 state를 인자로 받아 새 배열 반환 — 테스트 대상.
//   load/save 만 localStorage 부수효과(distributionTierState 패턴).

import { createLogger } from './logger';
import type { SignalVerdict, SignalVerdictKind } from '../types/signalReplay';

const log = createLogger('ReplayVerdicts');

export const REPLAY_VERDICTS_KEY = 'asset-manager-replay-verdicts-v1';

const VERDICT_KINDS: readonly SignalVerdictKind[] = [
  'good', 'too-early', 'too-late', 'false', 'missed-buy', 'missed-sell',
];

export function isVerdictKind(v: unknown): v is SignalVerdictKind {
  return typeof v === 'string' && (VERDICT_KINDS as readonly string[]).includes(v);
}

/** (ticker, date, ruleId?) 식별 키. ruleId 없으면 빈 슬롯 — 날짜 전반 판정. */
export function verdictKey(ticker: string, date: string, ruleId?: string): string {
  return `${ticker}::${date}::${ruleId ?? ''}`;
}

const keyOf = (v: SignalVerdict): string => verdictKey(v.ticker, v.date, v.ruleId);

/** 동일 (ticker,date,ruleId) 판정 조회. */
export function findVerdict(
  list: SignalVerdict[], ticker: string, date: string, ruleId?: string,
): SignalVerdict | undefined {
  const k = verdictKey(ticker, date, ruleId);
  return list.find(v => keyOf(v) === k);
}

/** 같은 키가 있으면 교체(수정), 없으면 추가(생성). 비파괴 — 새 배열 반환. */
export function upsertVerdict(list: SignalVerdict[], v: SignalVerdict): SignalVerdict[] {
  const k = keyOf(v);
  const idx = list.findIndex(x => keyOf(x) === k);
  if (idx < 0) return [...list, v];
  const next = list.slice();
  next[idx] = v;
  return next;
}

/** 키 일치 판정 삭제. 비파괴. */
export function removeVerdict(
  list: SignalVerdict[], ticker: string, date: string, ruleId?: string,
): SignalVerdict[] {
  const k = verdictKey(ticker, date, ruleId);
  return list.filter(v => keyOf(v) !== k);
}

/** 특정 종목의 판정만(최신 createdAt 우선 정렬). */
export function verdictsForTicker(list: SignalVerdict[], ticker: string): SignalVerdict[] {
  return list
    .filter(v => v.ticker === ticker)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 차트/패널 구분 표시용 — 판정이 존재하는 날짜 집합(해당 종목). */
export function datesWithVerdict(list: SignalVerdict[], ticker: string): Set<string> {
  const s = new Set<string>();
  for (const v of list) if (v.ticker === ticker) s.add(v.date);
  return s;
}

/** 안전 파싱 — 깨졌거나 형식이 안 맞는 항목은 버린다(부분 성공). */
export function parseVerdicts(raw: string | null): SignalVerdict[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is SignalVerdict => {
      if (!x || typeof x !== 'object') return false;
      const o = x as Record<string, unknown>;
      return typeof o.ticker === 'string'
        && typeof o.date === 'string'
        && isVerdictKind(o.kind)
        && (o.ruleId === undefined || typeof o.ruleId === 'string');
    });
  } catch {
    return [];
  }
}

export function serializeVerdicts(list: SignalVerdict[]): string {
  return JSON.stringify(list);
}

// ── localStorage 래퍼(부수효과 — 훅에서만 호출) ──
export function loadVerdicts(): SignalVerdict[] {
  try {
    return parseVerdicts(localStorage.getItem(REPLAY_VERDICTS_KEY));
  } catch (e) {
    log.error('판정 로드 실패', e);
    return [];
  }
}

export function saveVerdicts(list: SignalVerdict[]): void {
  try {
    localStorage.setItem(REPLAY_VERDICTS_KEY, serializeVerdicts(list));
  } catch (e) {
    log.error('판정 저장 실패', e);
  }
}
