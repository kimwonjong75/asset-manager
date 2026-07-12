// utils/replayRecordsCompaction.ts
// 신호 리플레이 검증 기록(판정·사례) — createdAt 나이 기준 "오래된 것 정리" 순수 파티션.
//
// · 사용자 연구 데이터이므로 자동 캡/삭제는 절대 하지 않는다(정책). 이 유틸은 "무엇이 오래됐는가"를
//   계산만 하고, 실제 삭제는 호출부(훅)가 사용자의 명시적 확인 뒤에만 수행한다.
// · nowISO 는 반드시 인자로 주입(테스트 결정론) — Date.now()/인자 없는 new Date() 금지.
// · createdAt 이 없거나 파싱 불가(NaN)면 방어적으로 **유지**(연구 데이터 유실 방지).
// · 순서 보존 — keep/removed 각각 입력 순서를 그대로 유지.

import type { SignalVerdict, VerificationCase } from '../types/signalReplay';

/** 기본 보존 기간 — 365일(1년). 이보다 오래된 createdAt 만 정리 후보. */
export const REPLAY_RETENTION_DAYS = 365;

export interface ReplayCompactionResult {
  keptVerdicts: SignalVerdict[];
  removedVerdicts: SignalVerdict[];
  keptCases: VerificationCase[];
  removedCases: VerificationCase[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** createdAt 이 cutoffTime 보다 과거면 true(제거 대상). 없거나 파싱 불가면 false(유지). */
function isOlderThan(createdAt: string | undefined, cutoffTime: number): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return t < cutoffTime;
}

/**
 * createdAt 나이 기준으로 판정·사례를 유지/제거로 분할.
 * cutoff = nowISO 에서 olderThanDays(기본 365)일 감산한 시각. `createdAt < cutoff` 이면 removed.
 * 비파괴·순서 보존. 실제 저장/상태 변경은 호출부 책임.
 */
export function partitionReplayRecordsByAge(
  verdicts: SignalVerdict[],
  cases: VerificationCase[],
  opts: { nowISO: string; olderThanDays?: number },
): ReplayCompactionResult {
  const days = opts.olderThanDays ?? REPLAY_RETENTION_DAYS;
  const nowTime = new Date(opts.nowISO).getTime();
  // nowISO 자체가 파싱 불가면 아무것도 제거하지 않는다(방어적 — 전부 유지).
  const cutoffTime = Number.isNaN(nowTime) ? -Infinity : nowTime - days * MS_PER_DAY;

  const keptVerdicts: SignalVerdict[] = [];
  const removedVerdicts: SignalVerdict[] = [];
  for (const v of verdicts) {
    if (isOlderThan(v.createdAt, cutoffTime)) removedVerdicts.push(v);
    else keptVerdicts.push(v);
  }

  const keptCases: VerificationCase[] = [];
  const removedCases: VerificationCase[] = [];
  for (const c of cases) {
    if (isOlderThan(c.createdAt, cutoffTime)) removedCases.push(c);
    else keptCases.push(c);
  }

  return { keptVerdicts, removedVerdicts, keptCases, removedCases };
}
