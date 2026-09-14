// components/common/a11yKeys.ts
// 버튼이 아닌 요소(행·헤더 등, 안에 다른 버튼이 중첩돼 <button>으로 바꿀 수 없는 경우)를 키보드로도
// 누를 수 있게 하는 공용 헬퍼 (Stage B 접근성). 렌더 보조용 — 비즈니스 로직 없음.
// 단순 잎(leaf) 요소는 이 헬퍼 대신 <button type="button">으로 바꾸는 것이 원칙이다.

import type React from 'react';

/** Enter/Space로 handler를 실행하는 onKeyDown. 중첩된 버튼 등 자식에서 올라온 키 입력은 무시한다
 *  (자식 버튼이 자기 키 입력을 스스로 처리하므로 이중 실행 방지). */
export function onActivateKey(handler: () => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

/** 클릭 가능한 비버튼 요소에 펼쳐 넣는 props 묶음 — role/tabIndex/onClick/onKeyDown */
export function clickableProps(handler: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: handler,
    onKeyDown: onActivateKey(handler),
  };
}
