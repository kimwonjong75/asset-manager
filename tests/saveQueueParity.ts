// tests/saveQueueParity.ts
// ---------------------------------------------------------------------------
// utils/saveQueue.createSaveQueue — 디바운스 코얼레싱 + pending 재저장 + 중복 스킵
// + 실패 비-재시도 + dispose 취소 시맨틱을 명시적 기대값으로 고정한다 (P1 가드).
// 실제 async 지연(짧은 디바운스 + 수동 resolve/reject 제어)으로 검증한다.
// 수동 실행: npx tsx tests/saveQueueParity.ts. 통과 시 exit 0.

import { createSaveQueue, type SaveQueueState } from '../utils/saveQueue';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fails.push(`✗ ${name}: got ${a}, expected ${e}`); }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 저장 함수를 수동 제어하는 컨트롤러.
 * - save 호출마다 payload를 calls에 기록하고 대기 중인 Promise를 만든다.
 * - resolveNext()/rejectNext() 로 FIFO 순서대로 in-flight 저장을 settle 한다.
 */
function createSaveController() {
  const calls: string[] = [];
  const settlers: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const save = (payload: string): Promise<void> => {
    calls.push(payload);
    return new Promise<void>((resolve, reject) => {
      settlers.push({ resolve, reject });
    });
  };
  return {
    save,
    calls,
    /** 가장 오래된 in-flight 저장을 성공 처리. */
    resolveNext(): void {
      const s = settlers.shift();
      if (s) s.resolve();
    },
    /** 가장 오래된 in-flight 저장을 실패 처리. */
    rejectNext(err: unknown = new Error('save failed')): void {
      const s = settlers.shift();
      if (s) s.reject(err);
    },
    pendingCount(): number { return settlers.length; },
  };
}

const DEBOUNCE = 20; // ms

async function run(): Promise<void> {
  // ══════════════════════════════════════════════════════════════════════════
  // 1. 기본 디바운스 코얼레싱 — 여러 request → 최신 payload 1회 저장
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('A1');
    q.request('A2');
    q.request('A3'); // 마지막이 이김
    await sleep(DEBOUNCE + 15);
    check('coalescing: 저장 1회', c.calls.length, 1);
    check('coalescing: 최신 payload 저장', c.calls[0], 'A3');
    c.resolveNext();
    await sleep(5);
    check('coalescing: 성공 후 상태 saved', q.getState(), 'saved');
    q.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. in-flight 중 request → pending으로 저장 (총 2회, 두번째는 최신 payload)
  //    (이전 버그: in-flight 중 요청이 조용히 드롭됨)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('B1');
    await sleep(DEBOUNCE + 10); // B1 저장 시작 (아직 resolve 안 함 → in-flight)
    check('pending: B1 저장 시작', c.calls.length, 1);
    check('pending: in-flight 중 상태 saving', q.getState(), 'saving');
    q.request('B2');
    await sleep(DEBOUNCE + 10); // B2 타이머 fire → pending에 저장 (아직 두번째 save 미발생)
    check('pending: in-flight라 아직 두번째 save 없음', c.calls.length, 1);
    c.resolveNext(); // B1 settle → pending B2 자동 저장
    await sleep(10);
    check('pending: settle 후 두번째 save 발생', c.calls.length, 2);
    check('pending: 두번째 save는 B2', c.calls[1], 'B2');
    c.resolveNext();
    await sleep(5);
    q.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. in-flight 중 다중 request → pending이 최신으로 코얼레싱 (여전히 총 2회)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('C1');
    await sleep(DEBOUNCE + 10); // C1 in-flight
    q.request('C2');
    q.request('C3');
    q.request('C4'); // pending은 최신 C4만 남음
    await sleep(DEBOUNCE + 10);
    check('pending-coalesce: 아직 2번째 save 없음', c.calls.length, 1);
    c.resolveNext(); // C1 settle → C4 저장
    await sleep(10);
    check('pending-coalesce: 총 2회 저장', c.calls.length, 2);
    check('pending-coalesce: 두번째는 최신 C4', c.calls[1], 'C4');
    c.resolveNext();
    await sleep(5);
    q.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. 성공 후 동일 payload → 스킵 (중복 저장 방지)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('D1');
    await sleep(DEBOUNCE + 10);
    c.resolveNext(); // D1 성공 저장
    await sleep(10);
    check('skip: 첫 저장 1회', c.calls.length, 1);
    q.request('D1'); // 동일 payload
    await sleep(DEBOUNCE + 15);
    check('skip: 동일 payload는 재저장 안 함', c.calls.length, 1);
    q.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. 실패 저장 → lastSaved 미갱신 → 동일 payload 재요청 시 다시 저장됨
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('E1');
    await sleep(DEBOUNCE + 10);
    c.rejectNext(); // E1 실패
    await sleep(10);
    check('fail-retry: 첫 시도 1회', c.calls.length, 1);
    check('fail-retry: 실패 후 상태 error', q.getState(), 'error');
    q.request('E1'); // 동일 payload지만 성공 저장이 아니었으므로 다시 시도돼야 함
    await sleep(DEBOUNCE + 15);
    check('fail-retry: 재요청 시 다시 저장', c.calls.length, 2);
    check('fail-retry: 재시도 payload E1', c.calls[1], 'E1');
    c.resolveNext();
    await sleep(5);
    q.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. 실패는 스스로 재시도하지 않음 (새 request 없이 세번째 save 없음)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('F1');
    await sleep(DEBOUNCE + 10);
    c.rejectNext(); // 실패
    await sleep(DEBOUNCE * 3); // 자동 재시도가 있었다면 이 시간 안에 발생했을 것
    check('no-auto-retry: 저장은 1회에 머무름', c.calls.length, 1);
    check('no-auto-retry: 남은 in-flight 없음', c.pendingCount(), 0);
    q.dispose();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. dispose는 대기 중 디바운스 타이머를 취소 (저장 발생 안 함)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const q = createSaveQueue({ debounceMs: DEBOUNCE, save: c.save });
    q.request('G1');
    q.dispose(); // 디바운스 만료 전 정리
    await sleep(DEBOUNCE + 15);
    check('dispose: 타이머 취소로 저장 0회', c.calls.length, 0);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. onStateChange 전이 관찰 (idle→saving→saved)
  // ══════════════════════════════════════════════════════════════════════════
  {
    const c = createSaveController();
    const states: SaveQueueState[] = [];
    const q = createSaveQueue({
      debounceMs: DEBOUNCE,
      save: c.save,
      onStateChange: (s) => states.push(s),
    });
    q.request('H1');
    await sleep(DEBOUNCE + 10);
    check('state: 저장 시작 시 saving 통지', states.includes('saving'), true);
    c.resolveNext();
    await sleep(10);
    check('state: 성공 시 saved 통지', states[states.length - 1], 'saved');
    q.dispose();
  }
}

run().then(() => {
  if (fails.length) {
    console.error(`\n❌ saveQueue parity 실패 (${fails.length})`);
    fails.forEach(f => console.error('  ' + f));
    process.exit(1);
  }
  console.log(`✅ saveQueue parity 전체 통과 (${pass} 단언)`);
}).catch((e) => {
  console.error('❌ saveQueue parity 실행 오류', e);
  process.exit(1);
});
