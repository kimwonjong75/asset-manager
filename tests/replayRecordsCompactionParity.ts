// tests/replayRecordsCompactionParity.ts
// ---------------------------------------------------------------------------
// replayRecordsCompaction 골든 테스트 — createdAt 나이 기준 유지/제거 파티션의 불변식을 절대값으로 고정.
//   · 365일 초과 → removed, 이내 → kept(verdicts·cases 각각).
//   · createdAt 없음/파싱 불가 → 유지(방어적).
//   · 경계(정확히 cutoff) → 유지(strict less-than).
//   · 빈 입력 → 빈 결과.
//   · 순서 보존(kept/removed 각각 입력 순서).
//   · olderThanDays 커스텀 / nowISO 파싱 불가 시 전부 유지.
// 수동 실행: npx --yes tsx tests/replayRecordsCompactionParity.ts. 통과 시 exit 0, 실패 시 exit 1.
// React/DOM import 없음 — 순수 함수만 검증(주입형 nowISO).

import {
  partitionReplayRecordsByAge,
  REPLAY_RETENTION_DAYS,
} from '../utils/replayRecordsCompaction';
import type { SignalVerdict, VerificationCase } from '../types/signalReplay';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const NOW = '2026-07-12T00:00:00.000Z';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 판정 최소 빌더 — 식별용 date 만 다르게.
function v(date: string, createdAt: string | undefined): SignalVerdict {
  return { ticker: 'AAPL', date, kind: 'good', createdAt: createdAt as string };
}
// 사례 최소 빌더 — id 로만 구분(불필요 필드는 결정론 기본값).
function c(id: string, createdAt: string | undefined): VerificationCase {
  return {
    id, ticker: 'AAPL', name: 'Apple', exchange: 'NASDAQ', categoryId: 1,
    caseRole: 'research', anchorDate: '2020-01-01', windowTradingDays: 252,
    rulesetHash: 'h', ruleSnapshot: [], overridesSnapshot: [], perRuleResults: [],
    verdicts: [], memo: '', createdAt: createdAt as string,
  };
}

// (0) 상수 확인
check('REPLAY_RETENTION_DAYS = 365', REPLAY_RETENTION_DAYS, 365);

// (a) 365일 초과 제거 · 이내 유지 — verdicts
{
  const verdicts = [
    v('d-old', '2024-01-01T00:00:00.000Z'),   // 1년 훨씬 초과 → removed
    v('d-new', '2026-07-01T00:00:00.000Z'),   // 11일 전 → kept
  ];
  const r = partitionReplayRecordsByAge(verdicts, [], { nowISO: NOW });
  check('(a) kept verdicts = [d-new]', r.keptVerdicts.map(x => x.date), ['d-new']);
  check('(a) removed verdicts = [d-old]', r.removedVerdicts.map(x => x.date), ['d-old']);
  check('(a) cases 빈 입력 kept', r.keptCases, []);
  check('(a) cases 빈 입력 removed', r.removedCases, []);
}

// (a2) 365일 초과 제거 · 이내 유지 — cases
{
  const cases = [
    c('c-old', '2023-05-01T00:00:00.000Z'),   // removed
    c('c-new', '2026-06-30T00:00:00.000Z'),   // kept
  ];
  const r = partitionReplayRecordsByAge([], cases, { nowISO: NOW });
  check('(a2) kept cases = [c-new]', r.keptCases.map(x => x.id), ['c-new']);
  check('(a2) removed cases = [c-old]', r.removedCases.map(x => x.id), ['c-old']);
}

// (b) createdAt 없음/파싱 불가 → 유지
{
  const verdicts = [v('d-missing', undefined), v('d-bad', 'not-a-date')];
  const cases = [c('c-missing', undefined), c('c-bad', 'garbage')];
  const r = partitionReplayRecordsByAge(verdicts, cases, { nowISO: NOW });
  check('(b) 파싱불가 verdicts 전부 kept', r.keptVerdicts.map(x => x.date), ['d-missing', 'd-bad']);
  check('(b) 파싱불가 verdicts removed 없음', r.removedVerdicts, []);
  check('(b) 파싱불가 cases 전부 kept', r.keptCases.map(x => x.id), ['c-missing', 'c-bad']);
  check('(b) 파싱불가 cases removed 없음', r.removedCases, []);
}

// (c) 경계 — 정확히 cutoff 는 유지, cutoff-1ms 는 제거(strict less-than)
{
  const cutoffTime = new Date(NOW).getTime() - REPLAY_RETENTION_DAYS * MS_PER_DAY;
  const atCutoff = new Date(cutoffTime).toISOString();
  const justBefore = new Date(cutoffTime - 1).toISOString();
  const verdicts = [v('d-at', atCutoff), v('d-before', justBefore)];
  const r = partitionReplayRecordsByAge(verdicts, [], { nowISO: NOW });
  check('(c) 경계 정확히 cutoff → kept', r.keptVerdicts.map(x => x.date), ['d-at']);
  check('(c) 경계 cutoff-1ms → removed', r.removedVerdicts.map(x => x.date), ['d-before']);
}

// (d) 빈 입력 → 빈 결과
{
  const r = partitionReplayRecordsByAge([], [], { nowISO: NOW });
  check('(d) 빈 kept verdicts', r.keptVerdicts, []);
  check('(d) 빈 removed verdicts', r.removedVerdicts, []);
  check('(d) 빈 kept cases', r.keptCases, []);
  check('(d) 빈 removed cases', r.removedCases, []);
}

// (e) 순서 보존 — kept/removed 각각 입력 순서 유지
{
  const verdicts = [
    v('n1', '2026-07-01T00:00:00.000Z'), // kept
    v('o1', '2020-01-01T00:00:00.000Z'), // removed
    v('n2', '2026-06-01T00:00:00.000Z'), // kept
    v('o2', '2021-01-01T00:00:00.000Z'), // removed
    v('n3', '2026-05-01T00:00:00.000Z'), // kept
  ];
  const r = partitionReplayRecordsByAge(verdicts, [], { nowISO: NOW });
  check('(e) kept 순서 보존', r.keptVerdicts.map(x => x.date), ['n1', 'n2', 'n3']);
  check('(e) removed 순서 보존', r.removedVerdicts.map(x => x.date), ['o1', 'o2']);
}

// (f) olderThanDays 커스텀 — 30일 기준이면 (a)의 d-new(11일)도 유지, 40일 전은 제거
{
  const verdicts = [
    v('d-11', '2026-07-01T00:00:00.000Z'), // 11일 전 → 30일 기준 kept
    v('d-40', '2026-06-01T00:00:00.000Z'), // 41일 전 → 30일 기준 removed
  ];
  const r = partitionReplayRecordsByAge(verdicts, [], { nowISO: NOW, olderThanDays: 30 });
  check('(f) 30일 기준 kept', r.keptVerdicts.map(x => x.date), ['d-11']);
  check('(f) 30일 기준 removed', r.removedVerdicts.map(x => x.date), ['d-40']);
}

// (g) nowISO 파싱 불가 → 전부 유지(방어적)
{
  const verdicts = [v('d-old', '2020-01-01T00:00:00.000Z')];
  const r = partitionReplayRecordsByAge(verdicts, [], { nowISO: 'invalid' });
  check('(g) nowISO 불가 → 전부 kept', r.keptVerdicts.map(x => x.date), ['d-old']);
  check('(g) nowISO 불가 → removed 없음', r.removedVerdicts, []);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ replayRecordsCompactionParity: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
} else {
  console.log(`✅ replayRecordsCompactionParity: ${pass} assertions passed`);
}
