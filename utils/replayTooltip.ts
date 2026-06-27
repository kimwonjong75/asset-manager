// utils/replayTooltip.ts
// 리플레이 차트 hover 툴팁 데이터(순수 계산) — "그 날짜 당시 차트/지표 상태를 빠르게 읽는 요약".
// 차트가 이미 들고 있는 ReplayChartPoint(date·OHLC·ma·rsi) + 그 날 markers(구루 게이팅)만으로 산출.
// **미래 정보(신호 후 수익률 등)는 절대 포함하지 않는다** — 룩어헤드 0 유지(상세는 클릭 후 패널 담당).

import type { ReplayChartPoint, ReplayMarker, SignalVerdictKind } from '../types/signalReplay';

export type RsiZone = 'oversold' | 'neutral' | 'near-overbought' | 'overbought';

export const RSI_ZONE_LABEL: Record<RsiZone, string> = {
  oversold: '과매도',
  neutral: '중립',
  'near-overbought': '과열 근접',
  overbought: '과열',
};

/** RSI 구간 — 과매도 ≤30 / 중립 / 과열 근접 60~69 / 과열 ≥70. null이면 null. */
export function rsiZone(rsi: number | null): RsiZone | null {
  if (rsi == null) return null;
  if (rsi >= 70) return 'overbought';
  if (rsi >= 60) return 'near-overbought';
  if (rsi <= 30) return 'oversold';
  return 'neutral';
}

/** 종가 대비 MA 이격률(%) — MA가 null/0이면 null. */
export function maDistancePct(close: number, ma: number | null): number | null {
  return ma != null && ma !== 0 ? ((close - ma) / ma) * 100 : null;
}

export interface ReplayTooltipMa {
  period: number;
  value: number | null;
  distPct: number | null; // 종가 대비 이격률(%)
}

export interface ReplayTooltipData {
  date: string;
  close: number;
  changePct: number | null;       // 전일 대비 등락률(%)
  open: number | null;
  high: number | null;
  low: number | null;
  hasOHLC: boolean;
  mas: ReplayTooltipMa[];         // 요청 기간 순서대로
  ma5vs20: 'above' | 'below' | 'equal' | null; // 골든/데드크로스 상태(5 vs 20)
  rsi: number | null;
  rsiZone: RsiZone | null;
  guru: { kind: 'buy' | 'sell'; count: number }[]; // 그 날 구루 신호 요약(마커 기반)
  volume: number | null;                            // 거래량(없으면 null → UI에서 숨김)
  alerts: { buy: string[]; sell: string[] } | null; // 검증 가능 가격기반 알림 요약(규칙명) — 컴포넌트가 최대 3개 표시
  verdicts: SignalVerdictKind[];                    // 그 날짜 내 판정(별도 prop 유래, 타임라인 무관)
}

/**
 * hover 툴팁 데이터 빌드. prevClose는 직전 거래일 종가(등락률용), markers는 그 날짜의 마커(구루 게이팅).
 * maPeriods는 표시할 MA 기간(차트 오버레이와 동일 순서). ma5/ma20으로 골든/데드크로스 상태도 산출.
 */
export function buildReplayTooltip(params: {
  point: ReplayChartPoint;
  prevClose: number | null;
  markers: ReplayMarker[];
  maPeriods: number[];
  verdictKinds?: SignalVerdictKind[]; // 그 날짜 내 판정(별도 prop) — 없으면 빈 배열
}): ReplayTooltipData {
  const { point, prevClose, markers, maPeriods, verdictKinds } = params;
  const close = point.close;

  const changePct = prevClose != null && prevClose !== 0 ? ((close - prevClose) / prevClose) * 100 : null;
  const hasOHLC = point.open != null && point.high != null && point.low != null;

  const mas: ReplayTooltipMa[] = maPeriods.map(period => {
    const value = point.ma?.[period] ?? null;
    return { period, value, distPct: maDistancePct(close, value) };
  });

  const ma5 = point.ma?.[5] ?? null;
  const ma20 = point.ma?.[20] ?? null;
  const ma5vs20: ReplayTooltipData['ma5vs20'] =
    ma5 != null && ma20 != null ? (ma5 > ma20 ? 'above' : ma5 < ma20 ? 'below' : 'equal') : null;

  const guru = markers
    .filter(m => m.guruCount > 0)
    .map(m => ({ kind: m.kind, count: m.guruCount }));

  return {
    date: point.date,
    close,
    changePct,
    open: point.open,
    high: point.high,
    low: point.low,
    hasOHLC,
    mas,
    ma5vs20,
    rsi: point.rsi,
    rsiZone: rsiZone(point.rsi),
    guru,
    volume: point.volume ?? null,
    alerts: point.alerts ?? null,
    verdicts: verdictKinds ?? [],
  };
}
