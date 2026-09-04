// utils/displayPrefs.ts
// P6 — "글자 크게" 표시 설정의 순수 파싱/변환 로직만 담는다(RULES.md §2 utils 규약: 상태·부수효과 금지).
// 실제 localStorage 읽기/쓰기와 document.documentElement 적용은 hooks/useFontScale이 담당한다.
//
// 저장 형식은 문자열 하나('normal'|'large')뿐이라 JSON.parse가 필요 없다 — 다른 UI 플래그
// (TradePlanIntro의 TRADE_PLAN_INTRO_SEEN_KEY 등)와 동일하게 원시 문자열을 그대로 저장한다.

export type FontScale = 'normal' | 'large';

export const FONT_SCALE_STORAGE_KEY = 'asset-manager-font-scale-v1';

/** 기본 15px(index.css `html` 기본값과 동일) / 크게 17px(계획서 §4.6 "표시 설정" 행). */
export const FONT_SCALE_PX: Record<FontScale, number> = {
  normal: 15,
  large: 17,
};

/**
 * localStorage에서 읽은 원시값을 FontScale로 파싱한다. fail-closed — 'large'가 아니면
 * 전부(null/빈 문자열/손상된 값) 'normal'로 취급한다(알 수 없는 값 때문에 글자가 커지는
 * 쪽보다, 커지지 않는 쪽이 안전한 기본값).
 */
export function parseFontScale(raw: string | null | undefined): FontScale {
  return raw === 'large' ? 'large' : 'normal';
}

/** FontScale → 루트 폰트 크기(px). */
export function fontScalePx(scale: FontScale): number {
  return FONT_SCALE_PX[scale];
}

/** document.documentElement.style.fontSize에 그대로 대입할 CSS 문자열. */
export function fontScaleToCssValue(scale: FontScale): string {
  return `${fontScalePx(scale)}px`;
}

/** Toggle 컴포넌트의 checked(= '크게' 여부)를 다음 FontScale로 뒤집는다. */
export function toggleFontScale(checked: boolean): FontScale {
  return checked ? 'large' : 'normal';
}

/** 현재 scale이 '크게'인지 — Toggle의 checked prop에 그대로 연결. */
export function isLargeFontScale(scale: FontScale): boolean {
  return scale === 'large';
}
