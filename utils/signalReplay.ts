// utils/signalReplay.ts
// 윈도 전체 타임라인 빌더 — `buildReplayTimeline` (동기, 테스트/소윈도용).
// 훅(useSignalReplay)은 성능을 위해 evaluateReplayDay 를 청크로 직접 돌리지만,
// 알고리즘은 동일하다(이 함수가 단일 소스 — 테스트가 이걸 검증).

import { prepareSeries, evaluateReplayDay, type PreparedSeries } from './replayEval';
import type { KnowledgeRule, KnowledgeClaim, RuleAction } from '../types/knowledge';
import type { AlertRule } from '../types/alertRules';
import type { HistoricalPriceResult } from '../services/historicalPriceService';
import type {
  ReplayDay, ReplayMarker, ReplayChartPoint, ReplayTimeline,
} from '../types/signalReplay';

const DEFAULT_WINDOW = 252;       // 약 1년
const MIN_WARMUP_INDEX = 60;      // 백테스트와 동일 — 워밍업 부족일 스킵(이전 indices만큼 history 필요)

/** asOf 이하(포함)에서 가장 큰 인덱스. 없으면 -1. */
function lastIndexAtOrBefore(sortedDates: string[], date: string): number {
  let idx = -1;
  for (let i = 0; i < sortedDates.length; i++) {
    if (sortedDates[i] <= date) idx = i; else break;
  }
  return idx;
}

function guruKind(action: RuleAction): 'buy' | 'sell' | null {
  if (action === 'sell-warning') return 'sell';
  if (action === 'buy-watch' || action === 'buy-setup') return 'buy';
  return null; // risk-sizing/regime-filter/review 는 마커 비대상
}

/**
 * 한 거래일의 차트 마커 집계. **마커 생성은 구루 신호(eligible&&matched)가 기준** — 이 화면의 목표는
 * 구루 신호 검증이라, 가격기반 알림은 "참고용"이며 마커/이전·다음 신호/신호 발생일 카운트에 섞지 않는다.
 * (alertCount는 같은 날·같은 방향에 동반 발화한 참고 알림 수를 정보로만 기록 — 마커 존재 여부엔 영향 없음.
 *  알림 전용 표시는 뷰의 별도 "참고용" 박스가 담당.)
 */
function markersForDay(day: ReplayDay): ReplayMarker[] {
  const agg: Record<'buy' | 'sell', { guru: number; alert: number }> = {
    buy: { guru: 0, alert: 0 },
    sell: { guru: 0, alert: 0 },
  };
  for (const d of day.guruDiagnostics) {
    if (d.eligibility.eligible && d.evaluation === 'matched') {
      const k = guruKind(d.action);
      if (k) agg[k].guru++;
    }
  }
  for (const d of day.alertDiagnostics) {
    if (d.enabled && d.evaluation === 'matched') {
      agg[d.action === 'sell' ? 'sell' : 'buy'].alert++;
    }
  }
  const out: ReplayMarker[] = [];
  (['buy', 'sell'] as const).forEach(kind => {
    const a = agg[kind];
    if (a.guru > 0) out.push({ date: day.date, kind, guruCount: a.guru, alertCount: a.alert }); // 구루 게이팅
  });
  return out;
}

export interface BuildReplayTimelineParams {
  ticker: string;
  name: string;
  history: HistoricalPriceResult;
  guruRules: KnowledgeRule[];   // effective(오버라이드 적용본)
  claims: KnowledgeClaim[];
  alertRules: AlertRule[];
  now: Date;
  anchorDate?: string;          // 윈도 종료일(기본 최신 거래일)
  windowTradingDays?: number;   // 기본 252
  /** 이미 prepare된 시리즈 재사용(반복 호출 시 정렬 비용 절약) */
  prepared?: PreparedSeries;
}

export function buildReplayTimeline(params: BuildReplayTimelineParams): ReplayTimeline {
  const series = params.prepared ?? prepareSeries(params.history);
  const n = series.sortedDates.length;
  const win = params.windowTradingDays ?? DEFAULT_WINDOW;

  const anchorIdx = params.anchorDate ? lastIndexAtOrBefore(series.sortedDates, params.anchorDate) : n - 1;

  const days: ReplayDay[] = [];
  const markers: ReplayMarker[] = [];
  const signalDates = new Set<string>();

  if (anchorIdx >= MIN_WARMUP_INDEX) {
    const startIdx = Math.max(MIN_WARMUP_INDEX, anchorIdx - win + 1);
    for (let i = startIdx; i <= anchorIdx; i++) {
      const day = evaluateReplayDay({
        ticker: params.ticker,
        name: params.name,
        series,
        asOfIndex: i,
        guruRules: params.guruRules,
        claims: params.claims,
        alertRules: params.alertRules,
        now: params.now,
      });
      days.push(day);
      const dm = markersForDay(day);
      for (const m of dm) { markers.push(m); signalDates.add(m.date); }
    }
  }

  // 차트는 윈도 시작 ~ 최신(미래 포함) — replay 모드에서 asOf 이후를 가린다.
  const chartStart = days.length > 0 ? series.sortedDates.indexOf(days[0].date) : 0;
  const chartPoints: ReplayChartPoint[] = [];
  for (let i = Math.max(0, chartStart); i < n; i++) {
    chartPoints.push({
      date: series.sortedDates[i],
      open: series.opens[i],
      high: series.highs[i],
      low: series.lows[i],
      close: series.closes[i],
    });
  }

  return {
    ticker: params.ticker,
    name: params.name,
    days,
    chartPoints,
    markers,
    signalDates: [...signalDates].sort(),
  };
}
