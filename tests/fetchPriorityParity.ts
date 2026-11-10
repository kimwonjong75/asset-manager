// tests/fetchPriorityParity.ts
// "시세 갱신 우선" 게이트(utils/fetchPriority) — 대기/해제/멱등/안전 타이머/재시작.
let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));
function track(p: Promise<void>): { done: () => boolean } {
  let d = false;
  p.then(() => { d = true; });
  return { done: () => d };
}

const F = await import('../utils/fetchPriority');
check('안전 대기 상수 45s', F.PRICE_PRIORITY_MAX_WAIT_MS, 45000);

// 1. 게이트 없음 → 즉시 resolve
F.__resetFetchPriorityForTest();
{
  const w = track(F.waitForPriceRefreshPriority());
  await tick();
  check('게이트 없음: 즉시 resolve', w.done(), true);
  check('게이트 없음: inactive', F.isPriceRefreshPriorityActive(), false);
}

// 2. begin → 대기, end → 해제
{
  F.beginPriceRefreshPriority();
  check('begin 후 active', F.isPriceRefreshPriorityActive(), true);
  const w = track(F.waitForPriceRefreshPriority());
  await tick(5);
  check('begin 후 waiter 대기', w.done(), false);
  F.endPriceRefreshPriority();
  await tick();
  check('end 후 waiter 해제', w.done(), true);
  check('end 후 inactive', F.isPriceRefreshPriorityActive(), false);
}

// 3. 여러 waiter 모두 해제
{
  F.beginPriceRefreshPriority();
  const ws = [track(F.waitForPriceRefreshPriority()), track(F.waitForPriceRefreshPriority()), track(F.waitForPriceRefreshPriority())];
  await tick(5);
  check('waiter 3개 대기', ws.map(w => w.done()), [false, false, false]);
  F.endPriceRefreshPriority();
  await tick();
  check('waiter 3개 해제', ws.map(w => w.done()), [true, true, true]);
}

// 4. begin 두 번 + end 한 번 → 종료
{
  F.beginPriceRefreshPriority();
  F.beginPriceRefreshPriority();
  const w = track(F.waitForPriceRefreshPriority());
  F.endPriceRefreshPriority();
  await tick();
  check('begin x2 + end x1: 종료', F.isPriceRefreshPriorityActive(), false);
  check('begin x2 + end x1: waiter 해제', w.done(), true);
}

// 5. begin 없는 end = no-op
{
  F.endPriceRefreshPriority();
  F.endPriceRefreshPriority();
  check('end 단독: inactive 유지', F.isPriceRefreshPriorityActive(), false);
  const w = track(F.waitForPriceRefreshPriority());
  await tick();
  check('end 단독 후 wait 즉시', w.done(), true);
}

// 6. 안전 타이머가 waiter 를 해제
{
  F.beginPriceRefreshPriority(30);
  const w = track(F.waitForPriceRefreshPriority());
  await tick(5);
  check('타이머 전 대기', w.done(), false);
  await tick(60);
  check('타이머 후 waiter 해제', w.done(), true);
  check('타이머 후 inactive', F.isPriceRefreshPriorityActive(), false);
}

// 7. 종료 뒤 새 begin → 새 게이트
{
  F.beginPriceRefreshPriority();
  F.endPriceRefreshPriority();
  F.beginPriceRefreshPriority();
  check('재시작: active', F.isPriceRefreshPriorityActive(), true);
  const w = track(F.waitForPriceRefreshPriority());
  await tick(5);
  check('재시작: waiter 대기', w.done(), false);
  F.endPriceRefreshPriority();
  await tick();
  check('재시작: end 로 해제', w.done(), true);
}

// 8. end 후 이전 타이머가 새 게이트를 끊지 않는다
{
  F.beginPriceRefreshPriority(20);
  F.endPriceRefreshPriority();
  F.beginPriceRefreshPriority(10_000);
  await tick(50);
  check('이전 타이머가 새 게이트를 해제하지 않음', F.isPriceRefreshPriorityActive(), true);
  F.endPriceRefreshPriority();
}

F.__resetFetchPriorityForTest();
if (fails.length > 0) {
  console.error(`\n❌ 시세 우선 게이트 테스트 실패 (${fails.length}건 / 통과 ${pass}건)\n`);
  fails.forEach(x => console.error('  ' + x));
  process.exit(1);
}
console.log(`✅ 시세 우선 게이트 테스트 통과 — ${pass}건 단언`);
