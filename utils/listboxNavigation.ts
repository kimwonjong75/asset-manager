// utils/listboxNavigation.ts
// ---------------------------------------------------------------------------
// 콤보박스/리스트박스 키보드 탐색 — 순수 함수(DOM·React 없음). Stage D2 P0.
//
//   · nextActiveIndex(current, move, {disabled}) → 다음 활성 인덱스
//       - move: 정수 delta(+1 아래, -1 위, |n|>1 이면 n칸) | 'first' | 'last'
//       - 끝에서 반대쪽 끝으로 **순환**, disabled 항목은 건너뜀
//       - current 가 없거나(-1) 범위를 벗어나면 "아무것도 선택 안 됨"으로 본다:
//         +방향은 첫 활성 항목에서, -방향은 마지막 활성 항목에서 시작
//       - delta 0 → current 가 유효한 활성 항목이면 그대로, 아니면 -1
//       - 활성 항목이 하나도 없으면(빈 목록 포함) 항상 -1
//   · resolveComboboxKey({key, open, activeIndex, optionCount}) → {intent, preventDefault}
//       - ↓/↑: 닫혀 있으면 open(기본동작 막음), 열려 있으면 move-next/move-prev(막음)
//       - Enter: 열림 + 유효한 활성 항목 → select(막음). 그 외 none(**막지 않음 — 폼 제출 그대로**)
//       - Escape: 열림 → close(막음 — 바깥 Modal 이 defaultPrevented 를 보고 무시). 닫힘 → none(Modal 이 닫힘)
//       - Tab: 열림 → close(막지 않음 — 포커스는 정상 이동). 닫힘 → none
//       - Home/End: 열림 **그리고** activeIndex ≥ 0 일 때만 first/last(막음). 아니면 none(입력칸 커서 이동)
//       - 그 외 키 → none
//     open 은 "목록이 실제로 보이는 상태"(호출부 조건 && 닫힘 해제 && 포커스)를 넘긴다.

export type ListboxMove = number | 'first' | 'last';

export interface ListboxNavigationOptions {
  /** 항목별 비활성 여부 — 길이가 곧 항목 수 */
  disabled: readonly boolean[];
}

export function nextActiveIndex(current: number, move: ListboxMove, options: ListboxNavigationOptions): number {
  const { disabled } = options;
  const n = disabled.length;
  const firstEnabled = disabled.findIndex(d => !d);
  if (firstEnabled < 0) return -1;
  let lastEnabled = firstEnabled;
  for (let i = n - 1; i >= 0; i--) {
    if (!disabled[i]) {
      lastEnabled = i;
      break;
    }
  }

  if (move === 'first') return firstEnabled;
  if (move === 'last') return lastEnabled;

  const valid = Number.isInteger(current) && current >= 0 && current < n;
  if (move === 0) return valid && !disabled[current] ? current : -1;

  const dir = move > 0 ? 1 : -1;
  const steps = Math.abs(Math.trunc(move));
  let index = valid ? current : -1;
  for (let s = 0; s < steps; s++) {
    if (index < 0) {
      index = dir > 0 ? firstEnabled : lastEnabled;
      continue;
    }
    for (let k = 1; k <= n; k++) {
      const j = (((index + dir * k) % n) + n) % n;
      if (!disabled[j]) {
        index = j;
        break;
      }
    }
  }
  return index;
}

export type ComboboxKeyIntent = 'open' | 'move-next' | 'move-prev' | 'first' | 'last' | 'select' | 'close' | 'none';

export interface ComboboxKeyInput {
  /** KeyboardEvent.key */
  key: string;
  /** 목록이 실제로 보이는가 */
  open: boolean;
  activeIndex: number;
  /** 탐색 가능한 전체 항목 수(옵션 + 동작 행) */
  optionCount: number;
}

export interface ComboboxKeyResult {
  intent: ComboboxKeyIntent;
  preventDefault: boolean;
}

const NONE: ComboboxKeyResult = { intent: 'none', preventDefault: false };

export function resolveComboboxKey({ key, open, activeIndex, optionCount }: ComboboxKeyInput): ComboboxKeyResult {
  const hasActive = activeIndex >= 0 && activeIndex < optionCount;
  switch (key) {
    case 'ArrowDown':
      return { intent: open ? 'move-next' : 'open', preventDefault: true };
    case 'ArrowUp':
      return { intent: open ? 'move-prev' : 'open', preventDefault: true };
    case 'Enter':
      return open && hasActive ? { intent: 'select', preventDefault: true } : NONE;
    case 'Escape':
      return open ? { intent: 'close', preventDefault: true } : NONE;
    case 'Tab':
      return open ? { intent: 'close', preventDefault: false } : NONE;
    case 'Home':
      return open && activeIndex >= 0 ? { intent: 'first', preventDefault: true } : NONE;
    case 'End':
      return open && activeIndex >= 0 ? { intent: 'last', preventDefault: true } : NONE;
    default:
      return NONE;
  }
}
