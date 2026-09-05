// types/valuation.ts
// 수익률 기준(PLBasis) 설정 타입 — "앱이 −1.45%, 키움이 +7.5%" 문제의 근원인 **환산 규약**을 명시화한다.
//
// 규약 차이(버그 아님):
//   · 'native' (달러 기준, 증권사 방식) — 매입가·평가액을 **둘 다 오늘 환율**로 환산.
//     환율 약분 → 수익률은 사실상 **원통화 수익률**. 국내 증권사(키움 등) 표기와 일치.
//   · 'krw'    (원화 기준, 앱의 기존 방식) — 매입원가는 **매수 당시 환율**, 평가액은 **오늘 환율**.
//     환차손익이 수익률 안에 들어온다. 실제 원화 자산 증감을 보려면 이쪽.
//
// 계산 구현은 `utils/portfolioMetrics.ts` 한 곳(순수). 이 파일은 타입·기본값·라벨만 담는다.
// 저장 데이터(purchaseExchangeRate 등)는 **어느 모드에서도 손대지 않는다** — 표시 규약 전환일 뿐이다.
// 형태는 `types/alertSensitivity.ts`(ORDER/LABELS/SUBLABELS)와 `types/turtle.ts`(DEFAULT_*) 패턴을 따른다.

/** 수익률·손익 환산 기준. */
export type PLBasis = 'native' | 'krw';

/** 저장·동기화 대상 설정(현재 필드 1개 — 추후 확장 여지를 위해 객체로 유지). */
export interface ValuationSettings {
  plBasis: PLBasis;
}

/** 기본값 = 증권사(달러) 방식. 사용자 확정 결정(2026-09-01). */
export const DEFAULT_VALUATION_SETTINGS: ValuationSettings = { plBasis: 'native' };

/** UI 세그먼트 표시 순서(왼→오). */
export const PL_BASIS_ORDER: readonly PLBasis[] = ['native', 'krw'];

export const PL_BASIS_LABELS: Record<PLBasis, string> = {
  native: '달러 기준 (증권사 방식)',
  krw: '원화 기준 (환율 포함)',
};

/** 세그먼트 보조 설명(한 줄). */
export const PL_BASIS_SUBLABELS: Record<PLBasis, string> = {
  native: '환율 변동 제외, 키움 등 증권사와 동일',
  krw: '환율 손익 포함, 실제 원화 자산 증감',
};

const isPLBasis = (v: unknown): v is PLBasis => v === 'native' || v === 'krw';

/**
 * Drive/저장본에서 읽은 임의 값 → 안전한 `ValuationSettings`.
 * 순수·방어적: 객체가 아니거나(null·문자열·배열), 필드가 없거나, 두 리터럴이 아니면 **기본값 사본**을 반환한다.
 * 입력은 절대 변형하지 않으며 반환값은 항상 새 객체(호출부가 그대로 setState 해도 공유 참조가 생기지 않음).
 */
export const normalizeValuationSettings = (raw: unknown): ValuationSettings => {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_VALUATION_SETTINGS };
  const candidate = (raw as { plBasis?: unknown }).plBasis;
  if (!isPLBasis(candidate)) return { ...DEFAULT_VALUATION_SETTINGS };
  return { plBasis: candidate };
};
