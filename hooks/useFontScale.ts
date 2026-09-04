// hooks/useFontScale.ts
// P6 — "글자 크게" 표시 설정 오케스트레이션(RULES.md §2: 상태 관리는 hooks/). 순수 변환은
// utils/displayPrefs가 전담하고, 이 훅은 localStorage 읽기/쓰기 + document.documentElement에
// 실제로 적용하는 부수효과만 담당한다. `TradePlanIntro`/`PrepareSection` 등과 동일하게
// 단순 UI 플래그라 safeStorage 없이 일반 try-catch를 쓴다.

import { useCallback, useEffect, useState } from 'react';
import {
  FONT_SCALE_STORAGE_KEY,
  fontScaleToCssValue,
  isLargeFontScale,
  parseFontScale,
  toggleFontScale,
  type FontScale,
} from '../utils/displayPrefs';

function loadFontScale(): FontScale {
  try {
    return parseFontScale(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
  } catch {
    return 'normal';
  }
}

function applyFontScale(scale: FontScale): void {
  try {
    document.documentElement.style.fontSize = fontScaleToCssValue(scale);
  } catch {
    /* ignore — SSR/테스트 환경 등 document 없음 */
  }
}

export function useFontScale() {
  const [scale, setScale] = useState<FontScale>(loadFontScale);

  // 마운트 시(새로고침 포함) 저장된 값을 즉시 루트에 적용 — index.css의 15px 기본값을 덮어쓴다.
  useEffect(() => {
    applyFontScale(scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회만: 이후 변경은 setLarge가 직접 적용
  }, []);

  const setLarge = useCallback((checked: boolean) => {
    const next = toggleFontScale(checked);
    setScale(next);
    applyFontScale(next);
    try { localStorage.setItem(FONT_SCALE_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  return { scale, isLarge: isLargeFontScale(scale), setLarge };
}
