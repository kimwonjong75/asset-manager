// utils/stockReview.ts
// "종목 검토(Stock Review)" 패널 ViewModel 빌더 — 순수 함수 (side effect/any/API 없음).
// ---------------------------------------------------------------------------
// **지배 원리: 3축 완전 분리 + 단일 데이터 소스(enriched).** (공유 firing/알고리즘 로직 미수정)
//   · 축A 평가: evaluateSingleFilter 결과만(충족/미충족/판정불가=엔진 null/해당없음=보유 컨텍스트 없음).
//     **특정 필드 결측으로 사전 차단(pre-gate)해 판정불가로 만들지 않는다** — 엔진이 non-null이면 충족/미충족 보존.
//   · 축B 품질(qualityNote): '부분 데이터' 캐비엇 — 평가를 숨기지 않음, 헤더 '부분'·qualityCaveats에 기여.
//   · 축C 상태(stateNote): '장기추세 비상승' 등 중립 정보 — 품질 아님(헤더/카운트/‘데이터 부족’ 금지).
//   · 단일 소스: 평가 asset의 `indicators`를 strip → evaluateSingleFilter가 stale asset.indicators로 폴백 못 함
//     (metrics·priceOriginal은 유지 — 보유/가격 조건에 필요). 헤더(enriched)·타일(enriched)·조건(enriched) 동일 소스.
//   · 공유 evaluateSingleFilter/classifyFilterQuality/computeRiskTier/countDistributionDays/buildEnrichedIndicator 미수정.

import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { SmartFilterKey } from '../types/smartFilter';
import type {
  StockReviewCondition,
  StockReviewEvaluation,
  StockReviewDataStatus,
  StockReviewIndicator,
  StockReviewSideSummary,
  StockReviewSummary,
  StockReviewViewModel,
} from '../types/stockReview';
import { STOCK_REVIEW_DISCLAIMER } from '../types/stockReview';
import { evaluateSingleFilter } from './smartFilterLogic';
import { computeRiskTier } from './riskMatrix';
import { hasDistributionInputs } from './marketDistribution';
import { normalizeExchange } from '../types';

const MA_SHORT = 20;
const MA_LONG = 60;
const DROP_FROM_HIGH_THRESHOLD = 20;
const LOSS_THRESHOLD = 5;
const DISTRIBUTION_WINDOW = 13; // riskMatrix distributionWindow 기본값과 동기 (평가창)

const CAVEAT_PARTIAL = '부분 데이터';           // 축B
const STATE_TREND = '장기추세 비상승';           // 축C

interface ConditionSpec {
  key: SmartFilterKey;
  label: string;
  rationale: string;
  priceDependent?: boolean;
  holdingDependent?: boolean;
}

const BUY_SPECS: ConditionSpec[] = [
  { key: 'PRICE_ABOVE_LONG_MA', label: `현재가 > ${MA_LONG}일 이평선`, rationale: `현재가가 ${MA_LONG}일 이평선 위인지 — 중기 추세 지지 관찰`, priceDependent: true },
  { key: 'MA_BULLISH_ALIGN', label: `정배열(${MA_SHORT}일 > ${MA_LONG}일) 상태`, rationale: `단기선이 장기선 위에 있는 정배열 "상태" (신규 골든크로스 발생이 아님)` },
  { key: 'RSI_OVERSOLD', label: 'RSI 과매도(≤30)', rationale: 'RSI 과매도 구간 — 단기 반등 가능성 관찰(단독 매수 근거 아님)' },
];

const SELL_SPECS: ConditionSpec[] = [
  { key: 'PRICE_BELOW_LONG_MA', label: `현재가 < ${MA_LONG}일 이평선`, rationale: `현재가가 ${MA_LONG}일 이평선 아래인지 — 중기 추세 약화 관찰`, priceDependent: true },
  { key: 'RSI_OVERBOUGHT', label: 'RSI 과매수(≥70)', rationale: 'RSI 과매수 구간 — 단기 과열 관찰' },
  { key: 'CLIMAX_TOP', label: '클라이맥스(과열 정점 추정)', rationale: '급등·과열 정점 신호 개수 — OHLC 필요(예측 아닌 리스크 참고)' },
  { key: 'DISTRIBUTION_HIGH', label: '디스트리뷰션(개별 종목 매도 압력 추정치)', rationale: '매물 출회 추정 일수 — OHLC/거래량 필요(예측 아닌 리스크 참고)' },
  { key: 'DROP_FROM_HIGH', label: `고점 대비 -${DROP_FROM_HIGH_THRESHOLD}% 이상 하락`, rationale: '포지션 고점 대비 하락폭 — 보유 종목 기준', holdingDependent: true },
  { key: 'LOSS_THRESHOLD', label: `손절 임계(-${LOSS_THRESHOLD}%) 도달`, rationale: '보유 수익률이 손절 임계 이하인지 — 보유 종목 기준', holdingDependent: true },
];

const AXIS_LABEL: Partial<Record<SmartFilterKey, string>> = {
  PRICE_ABOVE_LONG_MA: '현재가', PRICE_BELOW_LONG_MA: '현재가', MA_BULLISH_ALIGN: '이평선',
  RSI_OVERSOLD: 'RSI', RSI_OVERBOUGHT: 'RSI', CLIMAX_TOP: '과열(클라이맥스)',
  DISTRIBUTION_HIGH: '매도 압력(디스트리뷰션)', DROP_FROM_HIGH: '보유 고점', LOSS_THRESHOLD: '보유 손익',
};

// 헤더 '부분' 트리거 코어 표시 지표 6종 + 축 라벨.
const CORE_INDICATOR_AXIS: Record<string, string> = {
  rsi14: 'RSI', ma60: '이평선', atr14: 'ATR', high52w: '52주 고점',
  volume52wMax: '최대 거래량', volumeRatio: '거래량 비율',
};

function isValidPrice(p: number): boolean {
  return Number.isFinite(p) && p > 0;
}
function isConfirmed(e: StockReviewEvaluation): boolean {
  return e === '충족' || e === '미충족';
}
function fmtValue(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  if (abs >= 1000) return Math.round(v).toLocaleString('ko-KR');
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 100) / 100);
}

/** 단일 소스 보장: 평가 asset의 indicators를 비운다(metrics·priceOriginal 유지). */
function stripIndicators(a: EnrichedAsset): EnrichedAsset {
  return { ...a, indicators: undefined };
}

interface EvalResultLike { result: boolean | null; actual?: number | string; threshold?: number | string; }

function mkCond(
  spec: ConditionSpec,
  evaluation: StockReviewEvaluation,
  qualityNote: string | null,
  stateNote: string | undefined,
  res?: EvalResultLike,
): StockReviewCondition {
  const show = evaluation === '충족' || evaluation === '미충족';
  const rawActual = show && res ? res.actual ?? null : null;
  const rawThreshold = show && res ? res.threshold ?? null : null;
  return {
    key: spec.key,
    label: spec.label,
    evaluation,
    qualityNote,
    stateNote,
    actualDisplay: fmtValue(rawActual),
    thresholdDisplay: fmtValue(rawThreshold),
    rawActual,
    rawThreshold,
    rationale: spec.rationale,
  };
}

/** 일반 조건(가격/MA/RSI + 보유). 축B/C 캐비엇 없음(있으면/없으면 이분법). */
function evalGeneric(spec: ConditionSpec, evalAsset: EnrichedAsset, enriched: EnrichedIndicatorData, priceValid: boolean): StockReviewCondition {
  if (spec.priceDependent && !priceValid) return mkCond(spec, '판정불가', null, undefined);
  const res = evaluateSingleFilter(evalAsset, spec.key, DROP_FROM_HIGH_THRESHOLD, MA_SHORT, MA_LONG, enriched, LOSS_THRESHOLD);
  if (res.result === null) return mkCond(spec, res.reason === 'not-applicable' ? '해당 없음' : '판정불가', null, undefined);
  return mkCond(spec, res.result ? '충족' : '미충족', null, undefined, res);
}

/**
 * CLIMAX_TOP: **사전 차단 없음** — evaluateSingleFilter 먼저 호출, non-null이면 충족/미충족 보존.
 *   축B(품질): MA60 결측 또는 OHLC 저하(ohlcvAvailable=false) → '부분 데이터'.
 *   축C(상태): slopeRatio=null & MA60 존재(데이터 충분한 하락·횡보) → '장기추세 비상승'(품질 아님).
 */
function evalClimax(spec: ConditionSpec, evalAsset: EnrichedAsset, enriched: EnrichedIndicatorData): StockReviewCondition {
  const res = evaluateSingleFilter(evalAsset, 'CLIMAX_TOP', DROP_FROM_HIGH_THRESHOLD, MA_SHORT, MA_LONG, enriched, LOSS_THRESHOLD);
  if (res.result === null) return mkCond(spec, '판정불가', null, undefined); // 엔진 null(=!enriched)일 때만
  const ma60Present = typeof enriched.ma[MA_LONG] === 'number';
  // 축B 품질: countClimaxFlags가 **실제 사용하는 입력**이 모두 확정일 때만 complete(카운트가 정확한 값).
  //   · longTrendUp === null → 게이트(수개월 상승 전제) 불확정 → 부분. (ma60은 climax 입력이 아님 — 헤더 타일이 별도 반영.)
  //   · ohlcvAvailable === false → 전체이력 OHLC 결손 → 부분.
  //   · slope 불확정(number도 아니고 하락추세 확정[=null+ma60]도 아님) → (a) 불확정 → 부분.
  //   · **당일 (b) 입력**: dayRangeOverAtr(당일 고-저/ATR) null 또는 isBullishCandle(당일 시가 필요) null →
  //     전체이력 ohlcvAvailable=true여도 **당일** 시가/고저가가 빠지면 (b)가 미확인 양봉에 카운트될 수 있음 → 부분.
  const slopeDeterminate = typeof enriched.slopeRatio === 'number' || ma60Present;
  const todayCandleDeterminate =
    typeof enriched.dayRangeOverAtr === 'number' && enriched.isBullishCandle !== null;
  const climaxComplete =
    enriched.longTrendUp !== null && enriched.ohlcvAvailable !== false && slopeDeterminate && todayCandleDeterminate;
  const qualityNote = climaxComplete ? null : CAVEAT_PARTIAL;
  // 축C 상태: slopeRatio=null & MA60 존재 = 데이터 충분한 하락·횡보(품질 아님).
  const stateNote = (typeof enriched.slopeRatio !== 'number' && ma60Present) ? STATE_TREND : undefined;
  return mkCond(spec, res.result ? '충족' : '미충족', qualityNote, stateNote, res);
}

/**
 * DISTRIBUTION_HIGH: 최근 13일 창 기준. 품질 complete는 **행별 OHLC 가용성**(volRatio + isBearish/isLowerHalfClose)으로 —
 * 전역 ohlcvAvailable로 '완전·0일'을 확정하지 않는다. 창 유효 volRatio 전무일 때만 판정불가.
 */
function evalDistribution(spec: ConditionSpec, evalAsset: EnrichedAsset, enriched: EnrichedIndicatorData): StockReviewCondition {
  const meta = enriched.distributionDayMeta;
  // 공용 헬퍼 재사용(windowDays=13) — 창 유효 volRatio 전무일 때만 판정불가.
  if (!hasDistributionInputs(meta, DISTRIBUTION_WINDOW)) return mkCond(spec, '판정불가', null, undefined);
  const res = evaluateSingleFilter(evalAsset, 'DISTRIBUTION_HIGH', DROP_FROM_HIGH_THRESHOLD, MA_SHORT, MA_LONG, enriched, LOSS_THRESHOLD);
  if (res.result === null) return mkCond(spec, '판정불가', null, undefined);
  // 품질 complete = 창(13일) 행별 OHLC 가용성(volRatio + isBearish + isLowerHalfClose 전부 non-null).
  const window = (meta ?? []).slice(-DISTRIBUTION_WINDOW);
  const rowComplete = window.every(m => typeof m.volRatio === 'number' && m.isBearish !== null && m.isLowerHalfClose !== null);
  return mkCond(spec, res.result ? '충족' : '미충족', rowComplete ? null : CAVEAT_PARTIAL, undefined, res);
}

function evalSpec(spec: ConditionSpec, displayAsset: EnrichedAsset, holdingAsset: EnrichedAsset | undefined, enriched: EnrichedIndicatorData, priceValid: boolean): StockReviewCondition {
  if (spec.holdingDependent) {
    if (!holdingAsset) return mkCond(spec, '해당 없음', null, undefined);
    return evalGeneric(spec, holdingAsset, enriched, priceValid);
  }
  if (spec.key === 'CLIMAX_TOP') return evalClimax(spec, displayAsset, enriched);
  if (spec.key === 'DISTRIBUTION_HIGH') return evalDistribution(spec, displayAsset, enriched);
  return evalGeneric(spec, displayAsset, enriched, priceValid);
}

function buildIndicators(
  enriched: EnrichedIndicatorData,
  currentPrice: number,
  priceValid: boolean,
  climaxEval: StockReviewEvaluation,
  distEval: StockReviewEvaluation,
  climaxPartial: boolean,
  distPartial: boolean,
): StockReviewIndicator[] {
  const out: StockReviewIndicator[] = [];
  const push = (key: string, label: string, raw: number | null, display?: string): void => {
    out.push({ key, label, raw, display: display ?? fmtValue(raw) ?? '데이터 부족' });
  };

  push('currentPrice', '현재가(원본 통화)', priceValid ? currentPrice : null);
  push('rsi14', 'RSI(14)', typeof enriched.rsi === 'number' ? enriched.rsi : null);
  push('atr14', 'ATR(14)', typeof enriched.atr14 === 'number' ? enriched.atr14 : null);
  push('ma60', `${MA_LONG}일 이평선`, typeof enriched.ma[MA_LONG] === 'number' ? (enriched.ma[MA_LONG] as number) : null);
  push('high52w', '최근 252개 일봉 최고 종가', typeof enriched.high52w === 'number' ? enriched.high52w : null);

  // 고점 대비 하락폭 — 부호 직접 제어("--%" 방지, 신고가 상회 라벨).
  const high = enriched.high52w;
  const canPct = priceValid && typeof high === 'number' && high > 0;
  const pctBelowHigh = canPct ? ((high! - currentPrice) / high!) * 100 : null;
  let pctDisplay: string;
  if (pctBelowHigh === null) pctDisplay = '데이터 부족';
  else if (pctBelowHigh <= 0) pctDisplay = '고점 상회(신고가 부근)';
  else pctDisplay = `-${fmtValue(pctBelowHigh)}%`;
  push('pctBelow52wHigh', '최근 252봉 고점 대비 하락폭', pctBelowHigh, pctDisplay);

  const atrPct = typeof enriched.atr14 === 'number' && priceValid ? (enriched.atr14 / currentPrice) * 100 : null;
  push('atrRatio', 'ATR/현재가 비율(%)', atrPct, atrPct === null ? '데이터 부족' : `${fmtValue(atrPct)}%`);

  // 거래량 비율 — **마지막 원소만**(뒤로탐색 금지). 마지막 volRatio=null → '데이터 부족'.
  const meta = enriched.distributionDayMeta;
  const lastMeta = meta && meta.length > 0 ? meta[meta.length - 1] : undefined;
  const lastVolRatio = lastMeta && typeof lastMeta.volRatio === 'number' ? lastMeta.volRatio : null;
  push('volumeRatio', '거래량 비율(당일/50일 평균)', lastVolRatio, lastVolRatio === null ? '데이터 부족' : `${fmtValue(lastVolRatio)}배`);

  const volMax = typeof enriched.volume52wMax === 'number' ? enriched.volume52wMax : null;
  push('volume52wMax', '최근 252봉 최대 거래량', volMax,
    volMax === null ? '데이터 부족' : `${fmtValue(volMax)}${enriched.volumeIsAt52wMax ? ' (당일 최대)' : ''}`);

  // 기울기 비율 — slopeRatio null은 장기기울기≤0(정의상). MA60 있으면 **상태**(데이터 부족 아님), 없으면 데이터 부족.
  const slope = typeof enriched.slopeRatio === 'number' ? enriched.slopeRatio : null;
  const ma60Present = typeof enriched.ma[MA_LONG] === 'number';
  const slopeDisplay = slope !== null
    ? fmtValue(slope) ?? '데이터 부족'
    : (ma60Present ? '장기 추세 비상승 · 비율 해당 없음' : '데이터 부족');
  push('slopeRatio', '단기(10)/장기(60) 기울기 비율', slope, slopeDisplay);

  // 클라이맥스/디스트리뷰션 — 조건 evaluation 확정 시에만 카운트 노출.
  // 품질 '부분 데이터'면 카운트가 정확값이 아니므로 불확실성을 밝힌다:
  //   · distribution: OHLC 결손 시 changeRatio만 세어 **하한값** → '최소 N일'.
  //   · climax: 결측 방향이 양방향(longTrendUp 미상은 과대·OHLC 결손은 과소)이라 '(불완전)' 중립 표기.
  const risk = computeRiskTier(enriched, priceValid ? currentPrice : 0);
  push('climaxFlags', '클라이맥스 플래그(과열 신호 수)',
    isConfirmed(climaxEval) ? risk.climaxFlagCount : null,
    isConfirmed(climaxEval) ? `${risk.climaxFlagCount}/3${climaxPartial ? ' (불완전)' : ''}` : '데이터 부족');
  push('distributionCount', '디스트리뷰션(매도 압력 추정 일수)',
    isConfirmed(distEval) ? risk.distributionCount : null,
    isConfirmed(distEval) ? `${distPartial ? '최소 ' : ''}${risk.distributionCount}일` : '데이터 부족');

  return out;
}

function summarizeSide(conds: StockReviewCondition[]): StockReviewSideSummary {
  let met = 0, evaluated = 0, qualityCaveats = 0, dataMissing = 0, notApplicable = 0;
  for (const c of conds) {
    if (c.evaluation === '충족') { met++; evaluated++; }
    else if (c.evaluation === '미충족') { evaluated++; }
    else if (c.evaluation === '판정불가') { dataMissing++; }
    else notApplicable++;
    if (c.qualityNote) qualityCaveats++; // 축B만 (축C stateNote 제외)
  }
  return { met, evaluated, qualityCaveats, dataMissing, notApplicable };
}

/**
 * 데이터 상태 — 코어 표시 지표(6종) 결측 또는 조건 축B 캐비엇/판정불가만 '부분' 트리거. **축C(stateNote)는 무관.**
 */
function classifyDataStatus(
  enriched: EnrichedIndicatorData,
  indicators: StockReviewIndicator[],
  conditions: StockReviewCondition[],
): { status: StockReviewDataStatus; note: string | null } {
  const hasCore = typeof enriched.rsi === 'number' || Object.values(enriched.ma).some(v => typeof v === 'number');
  if (!hasCore) return { status: '없음', note: '가격 이력이 부족해 기술 지표를 계산할 수 없습니다.' };

  const axes: string[] = [];
  const addAxis = (a: string | undefined): void => { if (a && !axes.includes(a)) axes.push(a); };

  for (const ind of indicators) {
    if (ind.key in CORE_INDICATOR_AXIS && ind.raw === null) addAxis(CORE_INDICATOR_AXIS[ind.key]);
  }
  for (const c of conditions) {
    if (c.evaluation === '판정불가') addAxis(AXIS_LABEL[c.key]);
    else if (c.qualityNote) addAxis(AXIS_LABEL[c.key]); // 축B만 (stateNote 무시)
  }

  if (axes.length === 0) return { status: '정상', note: null };
  return { status: '부분', note: `${axes.join(' · ')} 데이터 부분/부족 → 일부 지표·조건에 캐비엇이 표시됩니다` };
}

/**
 * 정규화 instrument key (정규화 ticker + 공용 normalizeExchange). 거래소 별칭(AMEX↔NYSE American 등) 매칭 실패 방지.
 * normalizeExchange는 비-AMEX 거래소의 대소문자를 보존하므로, 대소문자 무시를 위해 결과를 다시 uppercase.
 */
function normKey(ticker: string, exchange: string): string {
  return `${ticker.trim().toUpperCase()}|${normalizeExchange(exchange).toUpperCase()}`;
}

/**
 * 복수 계정(원종/유선) 동일 티커 보유 통합 — **결정론적**(임의 첫 선택 금지).
 * 0건 → null. 1건 → 그대로. ≥2건 → 수량가치 합산으로 returnPercentage 재산출 +
 * dropFromHigh는 최댓값 낙폭(가장 음수 = 보수적) → holdingNote 부여.
 * LOSS_THRESHOLD=m.returnPercentage, DROP_FROM_HIGH=m.dropFromHigh만 재정의(그 외 필드는 첫 자산 유지).
 */
export function consolidateHoldingAsset(matches: EnrichedAsset[]): { asset: EnrichedAsset; note: string | null } | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return { asset: matches[0], note: null };
  let pv = 0, cv = 0, minDrop = Infinity;
  for (const a of matches) {
    pv += a.metrics.purchaseValueKRW;
    cv += a.metrics.currentValueKRW;
    if (a.metrics.dropFromHigh < minDrop) minDrop = a.metrics.dropFromHigh;
  }
  const returnPercentage = pv > 0 ? ((cv - pv) / pv) * 100 : 0;
  const dropFromHigh = Number.isFinite(minDrop) ? minDrop : 0;
  const base = matches[0];
  return {
    asset: { ...base, metrics: { ...base.metrics, returnPercentage, dropFromHigh } },
    note: '복수 계정 통합 기준',
  };
}

/** 관심종목 티커에 매칭되는 보유 자산 전체 수집(정규화 키). 훅이 consolidateHoldingAsset과 함께 사용. */
export function matchHoldings(ticker: string, exchange: string, portfolio: EnrichedAsset[]): EnrichedAsset[] {
  const key = normKey(ticker, exchange);
  return portfolio.filter(a => normKey(a.ticker, a.exchange) === key);
}

/**
 * 종목 검토 패널 ViewModel 생성 (순수).
 * @param asset 표시·일반조건 평가용(평가 시 indicators strip). 포트폴리오=실제 / 관심종목=pseudo.
 * @param holdingAsset 보유 조건(DROP/LOSS) 평가용 자산(포트폴리오=asset 폴백 / 관심 보유=매칭·통합 자산 / 미보유=undefined).
 * @param holdingNote 보유 집계 방식('복수 계정 통합 기준' 등).
 */
export function buildStockReviewViewModel(params: {
  asset: EnrichedAsset;
  enriched: EnrichedIndicatorData;
  source: 'portfolio' | 'watchlist';
  name: string;
  asOfLabel: string;
  holdingAsset?: EnrichedAsset;
  holdingNote?: string | null;
}): StockReviewViewModel {
  const { asset, enriched, source, name, asOfLabel, holdingAsset, holdingNote } = params;
  const currentPrice = asset.priceOriginal;
  const priceValid = isValidPrice(currentPrice);

  // 단일 소스: 평가 asset의 indicators strip (stale 폴백 차단). 포트폴리오는 자산 자체가 보유 컨텍스트.
  const displayEval = stripIndicators(asset);
  const effectiveHolding = holdingAsset ?? (source === 'portfolio' ? asset : undefined);
  const holdingEval = effectiveHolding ? stripIndicators(effectiveHolding) : undefined;

  const buyConditions = BUY_SPECS.map(s => evalSpec(s, displayEval, holdingEval, enriched, priceValid));
  const sellConditions = SELL_SPECS.map(s => evalSpec(s, displayEval, holdingEval, enriched, priceValid));
  const allConditions = [...buyConditions, ...sellConditions];

  const climaxCond = sellConditions.find(c => c.key === 'CLIMAX_TOP');
  const distCond = sellConditions.find(c => c.key === 'DISTRIBUTION_HIGH');
  const climaxEval: StockReviewEvaluation = climaxCond?.evaluation ?? '판정불가';
  const distEval: StockReviewEvaluation = distCond?.evaluation ?? '판정불가';

  const indicators = buildIndicators(
    enriched, currentPrice, priceValid, climaxEval, distEval,
    !!climaxCond?.qualityNote, !!distCond?.qualityNote,
  );
  const { status: dataStatus, note: dataStatusNote } = classifyDataStatus(enriched, indicators, allConditions);

  const summary: StockReviewSummary = { buy: summarizeSide(buyConditions), sell: summarizeSide(sellConditions) };

  return {
    ticker: asset.ticker,
    name,
    source,
    holdingEvaluated: !!effectiveHolding,
    holdingNote: holdingNote ?? null,
    asOfLabel,
    dataStatus,
    dataStatusNote,
    summary,
    indicators,
    buyConditions,
    sellConditions,
    disclaimer: STOCK_REVIEW_DISCLAIMER,
  };
}

/** 오늘 날짜를 'YYYY-MM-DD'(로컬)로 — 호출부가 asOfLabel로 주입. clock 접근이라 순수영역 밖. */
export function formatLocalAsOfLabel(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
