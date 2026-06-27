// utils/replayEval.ts
// 신호 리플레이 핵심 오케스트레이터 — `evaluateReplayDay` (순수 함수, 1일 단위).
//
// 처리(조건 #5): asOf 인덱스까지만 OHLCV 슬라이스(이후 데이터 미유입 = 룩어헤드 0)
//   → buildEnrichedIndicator → 구루 진단(diagnoseAssetRules) → 알림 진단(diagnoseAssetAlerts)
//   → 신호 후 성과(미래 종가 기반; 신호 계산엔 미사용).
// 진단은 전부 기존 5A/5B 인프라 재사용(새 엔진 금지). now(자격)는 호출부에서 주입(오늘 동결).

import { buildEnrichedIndicator } from './buildEnrichedIndicator';
import { diagnoseAssetRules } from './guruDiagnostics';
import { diagnoseAssetAlerts } from './alertDiagnostics';
import { buildMetricValues, type GuruSignalTarget } from './guruSignalEngine';
import { flattenLeaves } from './conditionLeafId';
import { boundaryDistance } from './boundaryDistance';
import { Currency } from '../types';
import type { KnowledgeRule, KnowledgeClaim } from '../types/knowledge';
import type { AlertRule } from '../types/alertRules';
import type { SmartFilterKey } from '../types/smartFilter';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { ReplayDay, SignalOutcome } from '../types/signalReplay';
import type { HistoricalPriceResult, HistoricalPriceData } from '../services/historicalPriceService';

/** 날짜 오름차순으로 정렬·정렬된 OHLCV 배열(종가는 항상 number). buildEnrichedIndicator 입력과 동일 규약. */
export interface PreparedSeries {
  sortedDates: string[];
  closes: number[];
  opens: (number | null)[];
  highs: (number | null)[];
  lows: (number | null)[];
  volumes: (number | null)[];
}

function alignSeries(sortedDates: string[], series?: HistoricalPriceData): (number | null)[] {
  if (!series) return sortedDates.map(() => null);
  return sortedDates.map(d => {
    const v = series[d];
    return typeof v === 'number' && isFinite(v) ? v : null;
  });
}

/** HistoricalPriceResult → PreparedSeries (유효 종가 날짜만, 오름차순). 1회만 수행해 재사용. */
export function prepareSeries(history: HistoricalPriceResult): PreparedSeries {
  const data = history.data ?? {};
  const sortedDates = Object.keys(data)
    .filter(d => typeof data[d] === 'number' && isFinite(data[d]))
    .sort();
  const closes = sortedDates.map(d => data[d]);
  return {
    sortedDates,
    closes,
    opens: alignSeries(sortedDates, history.open),
    highs: alignSeries(sortedDates, history.high),
    lows: alignSeries(sortedDates, history.low),
    volumes: alignSeries(sortedDates, history.volume),
  };
}

// ── 리플레이 알림 검증범위 분류 ──────────────────────────────────────────────
// buildPseudoAsset이 보유 단가를 현재가로 모의(수익률 0%)하고 서버지표(매매신호/거래량)는 미수신 처리하므로,
// 아래 필터들을 쓰는 규칙의 "발화/미충족" 판정은 실전과 다르다. UI에서 '리플레이 검증 불가'로 분리해
// 사용자가 "놓친 매수/매도"로 잘못 태깅(데이터 오염)하지 않게 한다.

/** 보유 단가 의존(수익률 0% 모의 → 손절/익절류는 항상 미충족으로 보임). */
const HOLDING_DEPENDENT_FILTERS: ReadonlySet<SmartFilterKey> = new Set<SmartFilterKey>([
  'PROFIT_POSITIVE', 'PROFIT_NEGATIVE', 'PROFIT_TARGET', 'LOSS_THRESHOLD',
]);
/** 서버 지표 의존(indicators 미수신 → data-missing). */
const SERVER_DEPENDENT_FILTERS: ReadonlySet<SmartFilterKey> = new Set<SmartFilterKey>([
  'SIGNAL_STRONG_BUY', 'SIGNAL_BUY', 'SIGNAL_SELL', 'SIGNAL_STRONG_SELL',
  'VOLUME_SURGE', 'VOLUME_HIGH', 'VOLUME_LOW',
]);

export type ReplayAlertScope = 'verifiable' | 'holding-dependent' | 'server-dependent';

/**
 * 규칙 필터 구성 → 리플레이 검증 가능 범위. 서버 의존이 보유가 의존보다 우선(데이터 자체가 없어 더 근본적).
 * verifiable = MA/RSI/돌파/클라이맥스/디스트리뷰션/고점대비하락/당일변동 등 가격·OHLCV로 재현 가능한 알림.
 */
export function classifyReplayAlertScope(filters: SmartFilterKey[]): ReplayAlertScope {
  if (filters.some(f => SERVER_DEPENDENT_FILTERS.has(f))) return 'server-dependent';
  if (filters.some(f => HOLDING_DEPENDENT_FILTERS.has(f))) return 'holding-dependent';
  return 'verifiable';
}

/** smartFilterLogic/diagnoseAlertRule이 참조하는 필드만 의미있게 채운 pseudo EnrichedAsset(과거 시점). */
function buildPseudoAsset(
  ticker: string,
  close: number,
  changePct: number,
  enriched: EnrichedIndicatorData,
): EnrichedAsset {
  // 고점 대비 하락(DROP_FROM_HIGH)은 52주 신고가로 복원. 매수가 의존(PROFIT_*/LOSS_*)은 0 → 미발화.
  const dropFromHigh =
    typeof enriched.high52w === 'number' && enriched.high52w > 0
      ? ((close - enriched.high52w) / enriched.high52w) * 100
      : 0;

  const base = {
    id: `replay:${ticker}`,
    ticker,
    name: ticker,
    categoryId: 1,
    exchange: '',
    quantity: 1,
    purchasePrice: close,
    purchaseDate: '',
    currency: Currency.USD,
    currentPrice: close,
    priceOriginal: close,
    highestPrice: typeof enriched.high52w === 'number' && enriched.high52w > 0 ? enriched.high52w : close,
    changeRate: changePct,
    indicators: undefined, // VOLUME_*/SIGNAL_*는 서버지표 미수신 → data-missing(정직), MA/RSI는 enriched가 이김
  };

  const metrics = {
    purchasePrice: close,
    currentPrice: close,
    currentPriceKRW: close,
    purchasePriceKRW: close,
    purchaseValue: close,
    currentValue: close,
    purchaseValueKRW: close,
    currentValueKRW: close,
    returnPercentage: 0,
    allocation: 0,
    dropFromHigh,
    profitLoss: 0,
    profitLossKRW: 0,
    diffFromHigh: 0,
    yesterdayChange: changePct,
    diffFromYesterday: 0,
  };

  return { ...base, metrics } as unknown as EnrichedAsset;
}

/** 신호 후 성과 — 미래 종가 기반(신호 계산엔 절대 미사용). 매수/매도 방향은 뷰에서 라벨 구분. */
function computeOutcome(closes: number[], i: number): SignalOutcome {
  const base = closes[i];
  if (!(base > 0)) return { ret5: null, ret20: null, ret60: null, maxRise: null, maxDrop: null };
  const fwdRet = (k: number): number | null => {
    const j = i + k;
    return j < closes.length ? ((closes[j] - base) / base) * 100 : null;
  };
  const end = Math.min(i + 60, closes.length - 1);
  let maxC = base;
  let minC = base;
  for (let j = i; j <= end; j++) {
    if (closes[j] > maxC) maxC = closes[j];
    if (closes[j] < minC) minC = closes[j];
  }
  const hasFuture = end > i;
  return {
    ret5: fwdRet(5),
    ret20: fwdRet(20),
    ret60: fwdRet(60),
    maxRise: hasFuture ? ((maxC - base) / base) * 100 : null,
    maxDrop: hasFuture ? ((minC - base) / base) * 100 : null,
  };
}

export interface EvaluateReplayDayInput {
  ticker: string;
  name: string;
  series: PreparedSeries;
  asOfIndex: number;
  guruRules: KnowledgeRule[];   // effective(오버라이드 적용본) — 호출부 책임
  claims: KnowledgeClaim[];
  alertRules: AlertRule[];      // enabled 필터는 진단 내부에서 표기(전 규칙 진단 가능)
  now: Date;                    // 자격/만료 게이트 = 오늘 동결(과거 날짜 주입 금지)
}

export function evaluateReplayDay(input: EvaluateReplayDayInput): ReplayDay {
  const { ticker, name, series, asOfIndex, guruRules, claims, alertRules, now } = input;
  const end = asOfIndex + 1; // [0, asOfIndex] 포함 — 이후 데이터 절대 미포함

  const enriched = buildEnrichedIndicator({
    sortedDates: series.sortedDates.slice(0, end),
    closes: series.closes.slice(0, end),
    opens: series.opens.slice(0, end),
    highs: series.highs.slice(0, end),
    lows: series.lows.slice(0, end),
    volumes: series.volumes.slice(0, end),
  });

  const close = series.closes[asOfIndex];
  const previousClose = asOfIndex >= 1 ? series.closes[asOfIndex - 1] : null;
  const changePct =
    previousClose != null && previousClose > 0 ? ((close - previousClose) / previousClose) * 100 : null;

  // ── 구루 진단 (자격=now 동결, 평가=과거 지표) ──
  const target: GuruSignalTarget = {
    assetId: `replay:${ticker}`,
    ticker,
    name,
    currentPrice: close,
    enriched,
    source: 'portfolio',
  };
  const guruDiagnostics = diagnoseAssetRules({ rules: guruRules, claims, target, now });

  // leaf 근접도 — RuleDiagnostic.leaves(explainConditionLeaves DFS 순서)와 동일 순서로 1:1 정렬.
  const metrics = buildMetricValues(enriched, close);
  const guruLeafDistances: Record<string, (number | null)[]> = {};
  for (const diag of guruDiagnostics) {
    const rule = guruRules.find(r => r.id === diag.ruleId);
    if (!rule || rule.condition === undefined) {
      guruLeafDistances[diag.ruleId] = [];
      continue;
    }
    guruLeafDistances[diag.ruleId] = flattenLeaves(rule.condition).map(({ leaf }) => {
      const v = metrics[leaf.metric];
      return boundaryDistance(typeof v === 'number' || typeof v === 'string' ? v : null, leaf.operator, leaf.value);
    });
  }

  // ── 알림 진단 (가격기반만 의미; 서버지표 의존은 data-missing) ──
  const pseudo = buildPseudoAsset(ticker, close, changePct ?? 0, enriched);
  const alertDiagnostics = diagnoseAssetAlerts({
    asset: pseudo,
    enriched,
    rules: alertRules,
    source: 'portfolio',
  });

  return {
    date: series.sortedDates[asOfIndex],
    close,
    previousClose,
    changePct,
    enriched,
    guruDiagnostics,
    alertDiagnostics,
    guruLeafDistances,
    outcome: computeOutcome(series.closes, asOfIndex),
  };
}
