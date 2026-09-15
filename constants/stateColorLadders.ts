// constants/stateColorLadders.ts
// Stage D2 — 사다리(단계)·식별 색 클래스 문자열의 유일한 보관처 (RULES.md §8 색 규약)
//
// 규칙
//   · 상태 의미(위험·확인 / 정보 / 오름 / 내림 / 성공 / 삭제·오류)는 tailwind 토큰만 쓴다:
//       warning · info · up · down · ok · danger (+ -soft 틴트, 흰 글자 채움은 -strong).
//   · 토큰 하나로 표현할 수 없는 "단계가 있는 사다리"(디스트리뷰션 3/4/5, 리스크 매트릭스, 터틀 게이지)와
//     상태가 아닌 "식별 색"(핀 별, 거래량 강도, 인라인 코드, 유선 계정 배지)만 이 파일에 둔다.
//   · 컴포넌트에서 raw amber/orange/yellow/sky 클래스를 직접 쓰지 않는다 — 여기서 import 한다
//     (ESLint 차단 대상, 이 파일은 예외). 새 사다리가 필요하면 이 파일에 이름·용도·대비를 적어 추가.
//   · Tailwind JIT 는 문자열 리터럴만 찾는다(constants/** 는 content 에 포함). 템플릿 문자열로 색 이름 조합 금지.
//
// 대비 표기: 글자 = WCAG 대비(AA 4.5), 도형(점·막대·별) = 비텍스트 대비(3.0).
// 배경 기준: 페이지 #121212 · 카드 #1E1E1E · 카드 안 강조 #2C2C2C. 반투명은 해당 배경 위 합성값으로 계산.

import type { DistributionTier } from '../utils/distributionTierState';
import type { RiskTier } from '../utils/riskMatrix';

// ── 시장 디스트리뷰션 데이 사다리 (노랑 → 주황 → 진한 주황) ─────────────────────────

/**
 * AlertPopup 'distribution-high' 신규(new) 단계 배지 — 불투명 채움이라 배경과 무관하게 대비가 고정된다.
 * (이전 4단계 `bg-orange-500/80 text-white` 는 3.92로 AA 미달 → 밝은 채움 + 어두운 글자로 교체)
 * 'ongoing' 배지는 사다리가 아니라 회색(bg-gray-700/60 text-gray-400)이므로 여기 두지 않는다.
 */
export const DISTRIBUTION_TIER_BADGE: Readonly<Record<DistributionTier, string>> = {
  3: 'bg-yellow-400 text-gray-900', // 글자 12.23 · 채움 vs #1E1E1E 10.89
  4: 'bg-orange-400 text-gray-900', // 글자 8.28 · 채움 vs #1E1E1E 7.37
  5: 'bg-orange-700 text-white', //    글자 5.18 · 채움 vs #1E1E1E 3.22
};

/** MarketDistributionBanner severity 키 — hooks/useMarketDistributionDays 의 MarketDistributionSeverity 에서 'safe' 제외와 동일 */
export type DistributionBannerSeverity = 'attention' | 'warning' | 'exit';

export interface DistributionBannerStyle {
  /** 테두리 + 틴트 배경 + 본문 글자 */
  container: string;
  /** 단계 점(도형) — icon 이 있는 단계는 점 대신 아이콘 */
  dot: string;
  /** 최고 단계 아이콘 색(OctagonAlert) */
  icon?: string;
}

/** 대시보드 최상단 시장 디스트리뷰션 배너 (3=주의 / 4=약세 / 5+=시장 탈출) */
export const DISTRIBUTION_BANNER_STYLES: Readonly<Record<DistributionBannerSeverity, DistributionBannerStyle>> = {
  // 글자 13.60(#121212) / 11.81(#1E1E1E) · 점 10.33 / 8.98
  attention: { container: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200', dot: 'bg-yellow-400' },
  // 글자 12.22 / 10.67 · 점 7.31 / 6.38
  warning: { container: 'border-orange-500/40 bg-orange-500/10 text-orange-200', dot: 'bg-orange-400' },
  // 글자 12.28 / 10.69 · 아이콘 8.35 / 7.26 · 점 6.22 / 5.41 — 굵은 메시지 + OctagonAlert 와 함께
  exit: { container: 'border-orange-400 bg-orange-500/20 text-orange-100', dot: 'bg-orange-400', icon: 'text-orange-300' },
};

// ── 리스크 매트릭스 티어 ────────────────────────────────────────────────────────

export interface RiskTierStyle {
  /** 티어 라벨 배지(채움 + 글자) */
  badge: string;
  /** 행 틴트 배경 */
  bg: string;
  border: string;
}

/**
 * RiskMatrixPanel 티어 표시. 키(red/amber/blue)는 utils/riskMatrix.RiskTier 식별자일 뿐 표시 색이 아니다 —
 * 빨강(오름)·파랑(내림)은 쓰지 않는다. 아이콘(OctagonAlert / TriangleAlert / Eye)과 라벨 문구는 컴포넌트가 붙인다.
 * 행 본문 text-gray-200 대비: red 13.26 · amber 13.13 · blue 14.20 (#1E1E1E 위 합성).
 */
export const RISK_TIER_STYLES: Readonly<Record<Exclude<RiskTier, null>, RiskTierStyle>> = {
  red: { badge: 'bg-orange-700 text-white', bg: 'bg-orange-950/50', border: 'border-orange-500/60' }, // 배지 5.18
  amber: { badge: 'bg-amber-400 text-gray-900', bg: 'bg-amber-950/40', border: 'border-amber-700/50' }, // 배지 11.22
  blue: { badge: 'bg-gray-600 text-gray-100', bg: 'bg-gray-900/40', border: 'border-gray-600' }, // 배지 10.34
};

// ── 터틀 오픈 리스크 게이지 ──────────────────────────────────────────────────────

export type TurtleRiskGaugeStep = 'over' | 'near' | 'normal';

export interface TurtleRiskGaugeStyle {
  /** 한도 대비 막대(도형, 트랙 bg-gray-700 #2C2C2C 위) */
  bar: string;
  /** 비율 텍스트 */
  text: string;
}

/**
 * TurtleRiskGauge — over(한도 이상) / near(한도 75% 이상) / normal.
 * over 막대는 orange-500 → orange-600: near(warning #F59E0B)와 1.31 → 1.66 로 구분을 조금 더 벌린다.
 * over 는 색만으로 구분하지 말 것 — 아이콘 + '초과' 문구와 함께.
 */
export const TURTLE_RISK_GAUGE_STEPS: Readonly<Record<TurtleRiskGaugeStep, TurtleRiskGaugeStyle>> = {
  over: { bar: 'bg-orange-600', text: 'text-orange-300 font-bold' }, // 막대 3.92 · 글자 10.43(게이지 박스) / 9.89(#1E1E1E)
  near: { bar: 'bg-warning', text: 'text-warning' }, //                  막대 6.50 · 글자 8.19 / 7.76
  normal: { bar: 'bg-ok', text: 'text-gray-400' }, //                    막대 7.26
};

// ── 식별 색 (상태 의미 없음) ────────────────────────────────────────────────────

/** 고정(핀) 별 — 보유자산 표·모바일 카드·관심종목. 도형: 켜짐 10.89(#1E1E1E)/9.12(#2C2C2C), hover 4.73/4.28 */
export const PIN_STAR = {
  pinned: 'text-yellow-400',
  unpinned: 'text-gray-500 hover:text-yellow-400/60',
} as const;

export type VolumeIntensity = 'surge' | 'high' | 'low' | 'normal';

/**
 * 표 거래량 비율 표시(columnDefinitions VolumeIndicator) — 강도 식별이지 매수/매도·위험 판정이 아니다.
 * surge(≥2.0 '!!') / high(≥1.5 '!') / low(<0.5 '~') / normal. 글자 대비 #1E1E1E / #2C2C2C 기준.
 */
export const VOLUME_INTENSITY_TEXT: Readonly<Record<VolumeIntensity, string>> = {
  surge: 'text-orange-400', // 7.37 / 6.17
  high: 'text-yellow-400', //  10.89 / 9.12
  low: 'text-gray-500', //     5.54 / 4.64
  normal: 'text-gray-400', //  6.57 / 5.50
};

/** PortfolioAssistant 마크다운 인라인 코드 — 글자 14.21 (#121212 위) */
export const ASSISTANT_INLINE_CODE = 'bg-gray-900 text-yellow-300';

/**
 * 유선(가족) 계정 식별 배지 — sand 토큰(tailwind.config.ts, CATEGORY_PALETTE sand 와 동일 #D6B98C).
 * 이전 amber 배지는 "위험·확인"으로 읽혀 교체. 글자 7.49(#121212) / 6.46(#1E1E1E) / 5.38(#2C2C2C).
 */
export const YUSEON_ACCOUNT_BADGE = 'bg-sand/15 text-sand';
