// 구루 신호 설명 레이어 — typed condition → 한국어 번역 + 종목별 충족 이유 (순수 함수)
// ---------------------------------------------------------------------------
// 1) describeCondition: 규칙의 조건을 사람이 읽는 문장으로 ("언제 뜨나")
// 2) explainConditionLeaves: 그 종목의 실제 지표값 vs 기준값 ("이 종목이 왜 떴나")
// 3) buildSignalExplanation: 근거(claim) + 조건 + 종목별 충족 + 무효조건 묶음
// 엔진 변경 없이 buildMetricValues/evaluateLeaf를 재사용. side effect/any 없음.

import type {
  ConditionNode, ConditionLeaf, RequiredMetric,
  KnowledgeRule, KnowledgeClaim,
} from '../types/knowledge';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import { buildMetricValues, evaluateLeaf, type MetricValues, type MetricValue } from './guruSignalEngine';

interface MetricMeta {
  label: string;
  unit?: string;
  valueLabels?: Record<string, string>;
}

// 지표별 표시 이름·단위 (초보 친화). RequiredMetric 중 신호에 쓰이는 것 위주.
const METRIC_META: Partial<Record<RequiredMetric, MetricMeta>> = {
  priceToMa20Pct: { label: '현재가의 20일선 대비 위치', unit: '%' },
  priceToMa60Pct: { label: '현재가의 60일선 대비 위치', unit: '%' },
  priceToMa150Pct: { label: '현재가의 150일선 대비 위치', unit: '%' },
  pctBelow52wHigh: { label: '52주 고점 대비 하락폭', unit: '%' },
  volumeRatio50: { label: '거래량(50일 평균 대비)', unit: '배' },
  climaxFlags: { label: '과열(클라이맥스) 신호 개수', unit: '개' },
  distributionCount: { label: '매물 출회(분산) 일수', unit: '일' },
  rsi14: { label: 'RSI(14일)', unit: '' },
  maCompression: { label: '이평선 압축률', unit: '%' },
  assetTrendRegime: {
    label: '추세 상태',
    valueLabels: { uptrend: '상승', downtrend: '하락', neutral: '중립' },
  },
  priceCrossAboveMa20Days: { label: '20일선 위로 복귀한 지', unit: '거래일' },
};

function metaOf(metric: RequiredMetric): MetricMeta {
  return METRIC_META[metric] ?? { label: metric };
}

function isLeaf(node: ConditionNode): node is ConditionLeaf {
  return 'metric' in node;
}

function fmtNum(v: number, unit?: string): string {
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  const sign = unit === '%' && rounded > 0 ? '+' : '';
  return `${sign}${rounded}${unit ?? ''}`;
}

function fmtValue(meta: MetricMeta, raw: number | string | number[]): string {
  if (typeof raw === 'string') return meta.valueLabels?.[raw] ?? raw;
  if (Array.isArray(raw)) return raw.map(n => fmtNum(n, meta.unit)).join('~');
  return fmtNum(raw, meta.unit);
}

/** 단일 조건(leaf)을 한국어 구절로. 예: "현재가의 20일선 대비 위치 −3%~+3% 사이" */
export function describeLeaf(leaf: ConditionLeaf): string {
  const meta = metaOf(leaf.metric);
  const val = leaf.value;
  switch (leaf.operator) {
    case '>=': return `${meta.label} ${fmtValue(meta, val as number)} 이상`;
    case '>':  return `${meta.label} ${fmtValue(meta, val as number)} 초과`;
    case '<=': return `${meta.label} ${fmtValue(meta, val as number)} 이하`;
    case '<':  return `${meta.label} ${fmtValue(meta, val as number)} 미만`;
    case 'between': return `${meta.label} ${fmtValue(meta, val as number[])} 사이`;
    case '=': return `${meta.label}: ${fmtValue(meta, val as string | number)}`;
    case 'in': {
      const arr = Array.isArray(val) ? val : [val];
      return `${meta.label}: ${arr.map(v => fmtValue(meta, v as string | number)).join(' 또는 ')}`;
    }
    default: return meta.label;
  }
}

/** 조건 트리를 구절 배열로 ("언제 뜨나" 표시용). */
export function describeCondition(node: ConditionNode): string[] {
  if (isLeaf(node)) return [describeLeaf(node)];
  if (node.all && node.all.length) return node.all.flatMap(describeCondition);
  if (node.any && node.any.length) {
    return [`다음 중 하나 — ${node.any.flatMap(describeCondition).join(' / ')}`];
  }
  if (node.not) return describeCondition(node.not).map(s => `(아님) ${s}`);
  return [];
}

export interface LeafExplain {
  label: string;       // "현재가의 20일선 대비 위치"
  condition: string;   // "−3%~+3% 사이"
  actual: string;      // "+1.2%"
  passed: boolean | null;
}

function conditionRangeText(leaf: ConditionLeaf): string {
  const meta = metaOf(leaf.metric);
  const val = leaf.value;
  switch (leaf.operator) {
    case '>=': return `${fmtValue(meta, val as number)} 이상`;
    case '>':  return `${fmtValue(meta, val as number)} 초과`;
    case '<=': return `${fmtValue(meta, val as number)} 이하`;
    case '<':  return `${fmtValue(meta, val as number)} 미만`;
    case 'between': return `${fmtValue(meta, val as number[])} 사이`;
    case '=':
    case 'in': {
      const arr = Array.isArray(val) ? val : [val];
      return arr.map(v => fmtValue(meta, v as string | number)).join(' 또는 ');
    }
    default: return '';
  }
}

function actualText(meta: MetricMeta, v: MetricValue | undefined): string {
  if (v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (typeof v === 'string') return meta.valueLabels?.[v] ?? v;
  return fmtNum(v, meta.unit);
}

/** 조건의 각 leaf에 대해 실제 지표값/통과여부를 매핑 ("이 종목이 왜 떴나"). */
export function explainConditionLeaves(node: ConditionNode, metrics: MetricValues): LeafExplain[] {
  const leaves: ConditionLeaf[] = [];
  const collect = (n: ConditionNode): void => {
    if (isLeaf(n)) { leaves.push(n); return; }
    n.all?.forEach(collect);
    n.any?.forEach(collect);
    if (n.not) collect(n.not);
  };
  collect(node);

  return leaves.map(leaf => {
    const meta = metaOf(leaf.metric);
    return {
      label: meta.label,
      condition: conditionRangeText(leaf),
      actual: actualText(meta, metrics[leaf.metric]),
      passed: evaluateLeaf(leaf, metrics),
    };
  });
}

export interface SignalExplanation {
  basis: string[];        // 근거 claim들의 자연어 statement
  conditions: string[];   // 자동 번역된 조건 ("언제 뜨나")
  leaves: LeafExplain[];  // 종목별 실제값 충족 상세
  riskPolicy?: string;    // 무효/주의
}

/** 규칙 + 근거 + (선택)종목 지표 → 설명 묶음. enriched 없으면 leaves 비움. */
export function buildSignalExplanation(params: {
  rule: KnowledgeRule | undefined;
  claims: KnowledgeClaim[];
  enriched: EnrichedIndicatorData | undefined;
  currentPrice: number;
}): SignalExplanation {
  const { rule, claims, enriched, currentPrice } = params;
  if (!rule) return { basis: [], conditions: [], leaves: [] };

  const basis = rule.claimIds
    .map(id => claims.find(c => c.id === id)?.statement)
    .filter((s): s is string => !!s);
  const conditions = rule.condition ? describeCondition(rule.condition) : [];

  let leaves: LeafExplain[] = [];
  if (rule.condition && enriched && currentPrice > 0) {
    const metrics = buildMetricValues(enriched, currentPrice);
    leaves = explainConditionLeaves(rule.condition, metrics);
  }

  return { basis, conditions, leaves, riskPolicy: rule.riskPolicy };
}
