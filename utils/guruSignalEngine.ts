// 구루 신호 엔진 (Guru Signal Engine) — 순수 함수
// ---------------------------------------------------------------------------
// 지식 규칙(KnowledgeRule)의 typed condition(ConditionNode)을 종목별 지표값에 대해 평가해
// "관찰/검토 후보"·"매도 경고" 매칭을 산출한다. 기존 알림(alertChecker/smartFilterLogic)과
// 별개로, 지식 DB의 규칙을 직접 신호로 연결하는 배선의 핵심(⑤ Guru Signal Engine).
//
// 설계:
//   · 게이트 우선: isActiveSignal(rule, claims, now)을 통과한 active·signal 규칙만 평가.
//   · condition이 없는 규칙(자동 마이그레이션된 mappedSignalKey 전용)은 엔진 비대상 → skip.
//   · 3치 논리: evaluateCondition은 true/false/null(지표 미산출=평가불가) 반환.
//     매칭은 오직 true일 때만 — null은 절대 신호로 발화하지 않는다(미검증/미구현 안전).
//   · 지표 어댑터(buildMetricValues)는 현재 "구현된 지표"만 매핑(rsi14/climaxFlags/
//     distributionCount/volumeRatio50). 신규 지표(rsRank/marketRegime/priceToMaXPct…)는
//     ④ 단계에서 필드 추가 시 어댑터 한 줄로 확장 → 해당 규칙 자동 발화.
//   · climaxFlags/distributionCount는 riskMatrix.computeRiskTier를 재사용해 알고리즘 drift 차단.
// side effect 금지(utils 규칙), any 금지. now는 호출부에서 주입.

import type {
  ConditionNode,
  ConditionLeaf,
  KnowledgeRule,
  KnowledgeClaim,
  RequiredMetric,
  RuleAction,
} from '../types/knowledge';
import type { Asset, ExchangeRates, WatchlistItem } from '../types';
import { Currency } from '../types';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import { computeRiskTier } from './riskMatrix';
import { isActiveSignal } from './knowledgeScoring';

export type MetricValue = number | string;
export type MetricValues = Partial<Record<RequiredMetric, MetricValue>>;

export interface GuruSignalTarget {
  assetId: string;
  ticker: string;
  name: string;
  currentPrice: number; // priceOriginal — 지표와 통화 일치
  enriched: EnrichedIndicatorData;
  source: 'portfolio' | 'watchlist';
}

export interface GuruSignalMatch {
  ruleId: string;
  ruleTitle: string;
  action: RuleAction;
  mappedSignalKey?: string;
  riskPolicy?: string; // 무효화/손절 조건 메모 (rule.riskPolicy)
  assetId: string;
  ticker: string;
  name: string;
  source: 'portfolio' | 'watchlist';
}

// 액션 표시 우선순위 (매도 경고 → 진입검토 → 관찰 → 리스크/국면/복기).
export const GURU_ACTION_ORDER: RuleAction[] = [
  'sell-warning', 'buy-setup', 'buy-watch', 'risk-sizing', 'regime-filter', 'review',
];

export interface GroupedAssetSignal {
  assetId: string;
  ticker: string;
  name: string;
  source: 'portfolio' | 'watchlist';
  rules: { ruleId: string; ruleTitle: string; riskPolicy?: string }[];
}

export interface GuruSignalActionGroup {
  action: RuleAction;
  signalCount: number;            // 이 액션의 총 매칭 수(종목 중복 포함)
  assets: GroupedAssetSignal[];   // 종목별 dedup (같은 종목의 여러 규칙은 rules[]로 묶음)
}

/**
 * 매칭을 액션별 → 종목별로 묶는다(순수). 같은 종목이 여러 규칙에 걸리면 한 줄로 합쳐
 * UI 중복 표시를 막는다. 액션 그룹은 GURU_ACTION_ORDER 순서, 종목은 매칭 등장 순서 유지.
 */
export function groupGuruSignals(matches: GuruSignalMatch[]): GuruSignalActionGroup[] {
  const byAction = new Map<RuleAction, Map<string, GroupedAssetSignal>>();
  const countByAction = new Map<RuleAction, number>();

  for (const m of matches) {
    countByAction.set(m.action, (countByAction.get(m.action) ?? 0) + 1);
    let assetMap = byAction.get(m.action);
    if (!assetMap) {
      assetMap = new Map<string, GroupedAssetSignal>();
      byAction.set(m.action, assetMap);
    }
    let entry = assetMap.get(m.assetId);
    if (!entry) {
      entry = { assetId: m.assetId, ticker: m.ticker, name: m.name, source: m.source, rules: [] };
      assetMap.set(m.assetId, entry);
    }
    if (!entry.rules.some(r => r.ruleId === m.ruleId)) {
      entry.rules.push({ ruleId: m.ruleId, ruleTitle: m.ruleTitle, riskPolicy: m.riskPolicy });
    }
  }

  const groups: GuruSignalActionGroup[] = [];
  for (const action of GURU_ACTION_ORDER) {
    const assetMap = byAction.get(action);
    if (!assetMap) continue;
    groups.push({
      action,
      signalCount: countByAction.get(action) ?? 0,
      assets: Array.from(assetMap.values()),
    });
  }
  return groups;
}

// 신호 종목을 AssetTrendChart에 넘길 props로 변환한 형태(assetId 키 맵의 값).
// source 분기(포트폴리오/관심종목) 룩업은 비즈니스 로직이므로 컴포넌트가 아닌 여기(순수)에서 처리.
export interface GuruSignalChartTarget {
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number;   // 원본 통화 단가 (currency와 일치) — PortfolioTableRow의 차트 호출과 동일 의미
  currency: Currency;
  exchangeRate: number;
  ticker: string;
  exchange: string;
  categoryId: number;
  purchasePrice?: number;
}

/** 통화→원화 환율. ExchangeRates는 USD/JPY만 보유(그 외/KRW는 1). */
function resolveExchangeRate(currency: Currency, rates: ExchangeRates): number {
  if (currency === Currency.USD) return rates.USD || 1;
  if (currency === Currency.JPY) return rates.JPY || 1;
  return 1;
}

/**
 * 신호 매칭 종목별 차트 props 맵을 만든다(순수, assetId 중복 제거).
 * 포트폴리오는 enrichedAssets(=Asset)에서, 관심종목은 watchlist에서 룩업.
 * 관심종목은 수량/매수평균이 없으므로 0/undefined로 채운다.
 */
export function buildGuruSignalChartTargets(params: {
  matches: GuruSignalMatch[];
  portfolioAssets: Asset[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
}): Record<string, GuruSignalChartTarget> {
  const { matches, portfolioAssets, watchlist, exchangeRates } = params;
  const byId: Record<string, GuruSignalChartTarget> = {};
  for (const m of matches) {
    if (byId[m.assetId]) continue;
    if (m.source === 'portfolio') {
      const a = portfolioAssets.find(x => x.id === m.assetId);
      if (!a) continue;
      byId[m.assetId] = {
        assetId: a.id,
        assetName: a.customName?.trim() || a.name,
        currentQuantity: a.quantity,
        currentPrice: a.currentPrice,
        currency: a.currency,
        exchangeRate: resolveExchangeRate(a.currency, exchangeRates),
        ticker: a.ticker,
        exchange: a.exchange,
        categoryId: a.categoryId,
        purchasePrice: a.purchasePrice,
      };
    } else {
      const w = watchlist.find(x => x.id === m.assetId);
      if (!w) continue;
      const currency = w.currency ?? Currency.KRW;
      byId[m.assetId] = {
        assetId: w.id,
        assetName: w.name,
        currentQuantity: 0,
        currentPrice: w.priceOriginal ?? w.currentPrice ?? 0,
        currency,
        exchangeRate: resolveExchangeRate(currency, exchangeRates),
        ticker: w.ticker,
        exchange: w.exchange,
        categoryId: w.categoryId,
        purchasePrice: undefined,
      };
    }
  }
  return byId;
}

function isLeaf(node: ConditionNode): node is ConditionLeaf {
  return 'metric' in node;
}

/** 단일 조건(leaf) 평가. 지표 미산출이면 null(평가 불가). */
export function evaluateLeaf(leaf: ConditionLeaf, metrics: MetricValues): boolean | null {
  const v = metrics[leaf.metric];
  if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) return null;
  const target = leaf.value;

  switch (leaf.operator) {
    case '>=': return typeof v === 'number' && typeof target === 'number' ? v >= target : null;
    case '<=': return typeof v === 'number' && typeof target === 'number' ? v <= target : null;
    case '>':  return typeof v === 'number' && typeof target === 'number' ? v > target : null;
    case '<':  return typeof v === 'number' && typeof target === 'number' ? v < target : null;
    case '=':  return v === target;
    case 'between':
      return typeof v === 'number' && Array.isArray(target) && target.length === 2 &&
        typeof target[0] === 'number' && typeof target[1] === 'number'
        ? v >= target[0] && v <= target[1]
        : null;
    case 'in':
      return Array.isArray(target) ? (target as Array<number | string>).some(t => t === v) : null;
    // 시계열 교차는 단일 스냅샷 metric으로 판정 불가 — 미지원(경과일 metric으로 대체 예정).
    case 'crossesAbove':
    case 'crossesBelow':
    default:
      return null;
  }
}

/** 조건 트리(all/any/not/leaf) 평가 — 3치 논리. null(미산출)은 발화하지 않는다. */
export function evaluateCondition(node: ConditionNode, metrics: MetricValues): boolean | null {
  if (isLeaf(node)) return evaluateLeaf(node, metrics);

  if (node.all && node.all.length > 0) {
    let result: boolean | null = true;
    for (const child of node.all) {
      const r = evaluateCondition(child, metrics);
      if (r === false) return false;   // AND: 하나라도 false면 false
      if (r === null) result = null;   // 미산출은 불확정으로 전파(단, false가 우선)
    }
    return result;
  }
  if (node.any && node.any.length > 0) {
    let result: boolean | null = false;
    for (const child of node.any) {
      const r = evaluateCondition(child, metrics);
      if (r === true) return true;     // OR: 하나라도 true면 true
      if (r === null) result = null;
    }
    return result;
  }
  if (node.not) {
    const r = evaluateCondition(node.not, metrics);
    return r === null ? null : !r;
  }
  return null; // 빈 그룹
}

/**
 * 종목 추세 국면 — 라이브 현재가와 MA60/MA150 정렬 + MA60 상승 확인으로 분류 (self-contained).
 * 'uptrend'는 단순 배열(price>ma60>ma150)만으로는 약함(이평선이 하락 전환 중일 수 있음) → `longTrendUp`
 * (enriched: MA60이 60거래일 전 대비 상승)을 함께 요구해 추세 품질을 보강한다. longTrendUp이 false/null이면
 * (하락 또는 데이터 부족) uptrend로 보지 않는다(매수 신호는 보수적으로).
 */
function computeAssetTrendRegime(
  price: number,
  ma60: number | null,
  ma150: number | null,
  longTrendUp: boolean | null,
): 'uptrend' | 'downtrend' | 'neutral' | null {
  if (typeof ma60 !== 'number' || typeof ma150 !== 'number' || ma60 <= 0 || ma150 <= 0) return null;
  if (price > ma60 && ma60 > ma150 && longTrendUp === true) return 'uptrend';
  if (price < ma60 && ma60 < ma150) return 'downtrend';
  return 'neutral';
}

/**
 * EnrichedIndicatorData(+라이브 currentPrice) → RequiredMetric 값 매핑 (현재 구현된 지표만).
 * - climaxFlags/distributionCount는 computeRiskTier 재사용(알고리즘 drift 차단).
 * - priceToMaXPct/pctBelow52wHigh/maCompression/assetTrendRegime은 라이브 priceOriginal 기준이므로
 *   과거 종가 시계열로 도는 buildEnrichedIndicator가 아니라 여기서 계산(라이브 정합 + 백테스트 무영향).
 * - 계산 불가(지표 부족)이면 해당 키를 비워 둠 → evaluateLeaf가 null → 발화 안 함(안전).
 */
export function buildMetricValues(
  enriched: EnrichedIndicatorData,
  currentPrice: number,
): MetricValues {
  const m: MetricValues = {};
  if (typeof enriched.rsi === 'number') m.rsi14 = enriched.rsi;

  const risk = computeRiskTier(enriched, currentPrice);
  m.climaxFlags = risk.climaxFlagCount;
  m.distributionCount = risk.distributionCount;

  const lastMeta = enriched.distributionDayMeta?.[enriched.distributionDayMeta.length - 1];
  if (lastMeta && typeof lastMeta.volRatio === 'number') m.volumeRatio50 = lastMeta.volRatio;

  // ── self-contained 지표 (라이브 현재가 기준) ──
  if (currentPrice > 0) {
    const ma20 = enriched.ma[20];
    const ma60 = enriched.ma[60];
    const ma150 = enriched.ma[150];

    if (typeof ma20 === 'number' && ma20 > 0) m.priceToMa20Pct = ((currentPrice - ma20) / ma20) * 100;
    if (typeof ma60 === 'number' && ma60 > 0) m.priceToMa60Pct = ((currentPrice - ma60) / ma60) * 100;
    if (typeof ma150 === 'number' && ma150 > 0) m.priceToMa150Pct = ((currentPrice - ma150) / ma150) * 100;

    if (typeof enriched.high52w === 'number' && enriched.high52w > 0) {
      m.pctBelow52wHigh = ((enriched.high52w - currentPrice) / enriched.high52w) * 100;
    }

    const masForCompression = [ma20, ma60, ma150].filter(
      (x): x is number => typeof x === 'number' && x > 0,
    );
    if (masForCompression.length === 3) {
      m.maCompression = ((Math.max(...masForCompression) - Math.min(...masForCompression)) / currentPrice) * 100;
    }

    const regime = computeAssetTrendRegime(currentPrice, ma60, ma150, enriched.longTrendUp);
    if (regime) m.assetTrendRegime = regime;
  }

  // MA20 재돌파 경과 거래일 (재돌파 당일=0, 현재 MA20 아래면 null) — MA reclaim 규칙용.
  const crossMa20 = enriched.priceCrossMaDays?.[20];
  if (typeof crossMa20 === 'number') m.priceCrossAboveMa20Days = crossMa20;

  // rsRank(시장 유니버스 백분위)/marketRegime(지수기반)/gapPct(당일 시가 필요)/priceVsMa/swingLow는 미매핑.
  return m;
}

/** 게이트 통과 + condition 보유한 평가 대상 규칙만 추출. */
export function getActiveSignalRules(
  rules: KnowledgeRule[],
  claims: KnowledgeClaim[],
  now: Date,
): KnowledgeRule[] {
  return rules.filter(r => r.condition !== undefined && isActiveSignal(r, claims, now));
}

/**
 * 활성 신호 규칙들을 종목별로 평가해 매칭 결과를 산출한다.
 * condition === true인 (규칙 × 종목) 조합만 매칭으로 반환(null/false 미발화).
 */
export function evaluateGuruSignals(params: {
  rules: KnowledgeRule[];
  claims: KnowledgeClaim[];
  targets: GuruSignalTarget[];
  now: Date;
}): GuruSignalMatch[] {
  const { rules, claims, targets, now } = params;
  const activeRules = getActiveSignalRules(rules, claims, now);
  if (activeRules.length === 0) return [];

  const matches: GuruSignalMatch[] = [];
  for (const target of targets) {
    const metrics = buildMetricValues(target.enriched, target.currentPrice);
    for (const rule of activeRules) {
      if (evaluateCondition(rule.condition as ConditionNode, metrics) === true) {
        matches.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          action: rule.action,
          mappedSignalKey: rule.mappedSignalKey,
          riskPolicy: rule.riskPolicy,
          assetId: target.assetId,
          ticker: target.ticker,
          name: target.name,
          source: target.source,
        });
      }
    }
  }
  return matches;
}
