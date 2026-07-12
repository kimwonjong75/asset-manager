// tests/actionQueueCompactionParity.ts
// ---------------------------------------------------------------------------
// compactResolvedActions 골든 테스트 (Phase 5, P5).
// 핵심: done/skipped + resolvedDate < cutoff(today-90일)만 제거. pending/snoozed·90일 이내·
//   resolvedDate 없는 done/skipped는 유지. 경계값(정확히 90일 전=유지, 91일 전=제거). 순서 보존.
// 수동 실행: npm run test:actioncompact (tsx). 통과 시 exit 0.

import type { ActionItem, ActionStatus } from '../types/actionQueue';
import {
  compactResolvedActions,
  ACTION_QUEUE_RETENTION_DAYS,
} from '../utils/actionQueueCompaction';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const TODAY = '2026-07-12';
// TODAY - 90일 = 2026-04-13 (수기 계산 골든: 4/13→7/12 = 17+31+30+12 = 90일).
const CUTOFF = '2026-04-13';

let seq = 0;
function mk(status: ActionStatus, resolvedDate?: string): ActionItem {
  seq += 1;
  return {
    id: `a${seq}`,
    createdDate: '2026-01-01',
    kind: 'TURTLE_ENTRY',
    ticker: 'AAA',
    name: 'A',
    quantity: 1,
    refPrice: 100,
    reasonText: '',
    ruleSnapshot: {},
    status,
    ...(resolvedDate ? { resolvedDate } : {}),
  };
}

// 상수 확인
check('보존기간 상수 90', ACTION_QUEUE_RETENTION_DAYS, 90);

// ── (a) 90일 초과 done/skipped 제거 · pending/snoozed · 90일 이내 유지 ──
{
  const oldDone = mk('done', '2026-01-01');       // 초과 → 제거
  const oldSkipped = mk('skipped', '2026-02-01');  // 초과 → 제거
  const pending = mk('pending');                    // 항상 유지
  const snoozed = mk('snoozed');                    // 항상 유지
  const recentDone = mk('done', '2026-07-01');      // 90일 이내 → 유지
  const { kept, removed } = compactResolvedActions(
    [oldDone, oldSkipped, pending, snoozed, recentDone],
    { today: TODAY }
  );
  check('(a) removed ids', removed.map(r => r.id), [oldDone.id, oldSkipped.id]);
  check('(a) kept ids', kept.map(k => k.id), [pending.id, snoozed.id, recentDone.id]);
  check('(a) removed count', removed.length, 2);
}

// ── (b) resolvedDate 없는 done/skipped(방어적) 유지 ──
{
  const doneNoDate = mk('done');
  const skippedNoDate = mk('skipped');
  const { kept, removed } = compactResolvedActions([doneNoDate, skippedNoDate], { today: TODAY });
  check('(b) removed 없음', removed.length, 0);
  check('(b) 둘 다 유지', kept.map(k => k.id), [doneNoDate.id, skippedNoDate.id]);
}

// ── (c) 경계값: 정확히 90일 전 = 유지, 91일 전 = 제거 ──
{
  const exactly90 = mk('done', CUTOFF);            // == cutoff → 유지 (< 아님)
  const { kept, removed } = compactResolvedActions([exactly90], { today: TODAY });
  check('(c) 정확히 90일 전 유지', kept.map(k => k.id), [exactly90.id]);
  check('(c) 정확히 90일 전 제거 없음', removed.length, 0);
}
{
  const day91 = mk('done', '2026-04-12');          // < cutoff → 제거
  const { kept, removed } = compactResolvedActions([day91], { today: TODAY });
  check('(c) 91일 전 제거', removed.map(r => r.id), [day91.id]);
  check('(c) 91일 전 유지 없음', kept.length, 0);
}

// ── (d) 빈 큐 ──
{
  const { kept, removed } = compactResolvedActions([], { today: TODAY });
  check('(d) 빈 kept', kept, []);
  check('(d) 빈 removed', removed, []);
}

// ── (e) 순서 보존 (제거 후에도 kept는 원본 상대순서 유지) ──
{
  const a = mk('pending');
  const b = mk('done', '2026-01-01');   // 제거
  const c = mk('snoozed');
  const d = mk('done', '2026-02-01');   // 제거
  const e = mk('done', '2026-07-05');   // 유지
  const { kept, removed } = compactResolvedActions([a, b, c, d, e], { today: TODAY });
  check('(e) kept 순서', kept.map(k => k.id), [a.id, c.id, e.id]);
  check('(e) removed 순서', removed.map(r => r.id), [b.id, d.id]);
}

// ── (f) olderThanDays 커스텀(30일) — 경계 재계산 없이 파라미터 반영만 확인 ──
{
  // today-30일 = 2026-06-12. 2026-06-11 제거, 2026-06-12 유지.
  const older = mk('done', '2026-06-11');
  const onCutoff = mk('done', '2026-06-12');
  const { removed, kept } = compactResolvedActions([older, onCutoff], { today: TODAY, olderThanDays: 30 });
  check('(f) 30일 초과 제거', removed.map(r => r.id), [older.id]);
  check('(f) 30일 경계 유지', kept.map(k => k.id), [onCutoff.id]);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ actionQueueCompaction parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
} else {
  console.log(`✅ actionQueueCompaction parity 전체 통과 (${pass} 단언)`);
}
