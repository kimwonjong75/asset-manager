// utils/fetchPriority.ts
// "시세 갱신 우선" 게이트 (순수 TS, React 없음, 모듈 상태).
//  · 앱 시작 시 시세 갱신(/)과 히스토리(/history, /upbit/history)가 동시에 나가면 백엔드(약 10종목/초)가 줄을 서
//    사용자가 기다리는 "가격"이 늦어진다. 시세 갱신이 진행 중인 동안 히스토리 요청은 이 게이트에서 대기한다.
//  · 안전장치: PRICE_PRIORITY_MAX_WAIT_MS 가 지나면 게이트가 자동으로 풀린다(갱신이 멈춰도 지표가 영원히 안 오는 일 방지).
//  · 시세 갱신 "안에서" 부르는 히스토리 호출은 반드시 skipPriorityWait 를 써야 한다(자기 자신을 기다리는 교착 방지).
//  · 어떤 경로에서도 throw 하지 않는다.

export const PRICE_PRIORITY_MAX_WAIT_MS = 45_000;

let active = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let waiters: Array<() => void> = [];

function release(): void {
  active = false;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) {
    try { resolve(); } catch { /* ignore */ }
  }
}

/** 시세 갱신 시작 표시. 멱등(이미 켜져 있으면 타이머도 그대로). maxWaitMs 는 테스트용. */
export function beginPriceRefreshPriority(maxWaitMs: number = PRICE_PRIORITY_MAX_WAIT_MS): void {
  if (active) return;
  active = true;
  timer = setTimeout(release, maxWaitMs);
}

/** 시세 갱신 종료(성공/실패 공통). 멱등. */
export function endPriceRefreshPriority(): void {
  if (!active) return;
  release();
}

/** 게이트가 없으면 즉시, 있으면 게이트가 끝날 때(또는 안전 타이머) resolve. */
export function waitForPriceRefreshPriority(): Promise<void> {
  if (!active) return Promise.resolve();
  return new Promise<void>(resolve => { waiters.push(resolve); });
}

export function isPriceRefreshPriorityActive(): boolean {
  return active;
}

export function __resetFetchPriorityForTest(): void {
  release();
}
