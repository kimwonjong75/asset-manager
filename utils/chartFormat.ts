// utils/chartFormat.ts
// 차트 공용 포맷/색상 헬퍼 (순수). SignalReplayChart 가 사용 (AssetTrendChart 의 소형 헬퍼와 동형).
// AssetTrendChart 마이그레이션은 회귀 위험 회피로 후속(현재는 신규 코드만 사용).

import { Currency } from '../types';

// 한국식 캔들 — 양봉=상승=빨강, 음봉=하락=파랑.
// ⚠ 도형(캔들·거래량 막대·마커) 전용 — 글자 색으로 쓰지 말 것. 텍스트 방향 색은 Tailwind `up`/`down`
// 토큰(utils/directionTone)을 쓴다.
export const CANDLE_UP_COLOR = '#F23645';
export const CANDLE_DOWN_COLOR = '#2962FF';

// 리플레이 차트 기준일(asOf) 마커의 캔버스 텍스트 글리프. lightweight-charts 마커 text 는 캔버스에 그려지는
// 도형이라 lucide 아이콘을 쓸 수 없다 — components/ 의 이모지·글리프 금지 규칙(eslint no-restricted-syntax,
// tests/visualSystemIntegrity.ts) 범위 밖인 여기에 이름 붙인 상수로 둔다(RULES.md §8 색 규약).
export const REPLAY_ASOF_MARKER_GLYPH = '◆';

// ── 차트 식별 색 (Stage C, RULES.md §8 색 규약) ────────────────────────────────────────────
// 상태 색(up #F87171 · down #60A5FA · 캔들 #F23645/#2962FF · warning #F59E0B · danger #F472B6 ·
// ok #34D399 · info #38BDF8)은 **카테고리/시리즈 구분에 쓰지 않는다** — 빨강 조각이 "오름"으로 읽힌다.
// 아래 값은 모두 #1E1E1E 대비 3:1 이상(차트 마크 기준): 괄호 안이 대비.

/** 카테고리(자산 구분·섹터 등) 순환 팔레트 — index % length 로 사용 */
export const CATEGORY_PALETTE: readonly string[] = [
  '#818CF8', // indigo   (5.59)
  '#2DD4BF', // teal     (8.96)
  '#A78BFA', // violet   (6.13)
  '#A3E635', // lime     (11.06)
  '#94A3B8', // slate    (6.50)
  '#D6B98C', // sand     (8.87)
  '#67E8F9', // cyan-light (11.50)
  '#FDE68A', // pale yellow (13.39)
];

/** 의미가 고정된 시리즈의 중립 식별 색 */
export const SERIES_COLORS = {
  principal: '#94A3B8', // 원금 — slate
  valuation: '#818CF8', // 평가액 — indigo
  returnPct: '#2DD4BF', // 수익률 선 — teal
  premium: '#D6B98C', // 김치 프리미엄 — sand
  jpy: '#A78BFA', // 엔 — violet
  usd: '#67E8F9', // 달러 — cyan-light
  gold: '#FDE68A', // 금 — pale gold
} as const;

/** Recharts <Tooltip contentStyle labelStyle itemStyle> 공용 — surface 토큰과 같은 값 */
export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1E1E1E', // surface-elevated
    border: '1px solid #3A3A3A', // border-subtle
    borderRadius: 8,
    color: '#E5E7EB',
  },
  labelStyle: { color: '#FFFFFF', fontWeight: 600 },
  itemStyle: { color: '#D1D5DB' },
} as const;

/** YYYY-MM-DD → lightweight-charts time (문자열 그대로 허용) */
export function toChartTime(dateStr: string): string {
  return dateStr;
}

export function getCurrencySymbol(curr: Currency): string {
  switch (curr) {
    case Currency.USD: return '$';
    case Currency.JPY: return '¥';
    case Currency.KRW: return '₩';
    default: return '';
  }
}

export function formatPrice(value: number, curr: Currency): string {
  const symbol = getCurrencySymbol(curr);
  const formatted =
    curr === Currency.KRW
      ? Math.round(value).toLocaleString('ko-KR')
      : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}

/** 수익률/변동률 부호 라벨 */
export function formatPct(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}
