// hooks/useGuruDiagnostics.ts
// ---------------------------------------------------------------------------
// 5A-⑤ 진단 패널 상태/계산 훅. "왜 신호가 안 뜨나"를 종목별로 분해한다.
//   · 평가/진단 대상은 Context가 노출하는 derived.guruSignalTargets(신호 카드와 동일 소스)를 그대로 쓴다
//     → 신호 집합과 진단 대상이 절대 어긋나지 않는다.
//   · 선택 종목 상태는 여기서 보유(useState). 진단은 "선택된 1종목"에 대해서만 온디맨드 계산(useMemo)
//     → 전 종목 사전계산 비용 회피. 컴포넌트는 이 결과를 렌더만 한다(프로젝트 규칙: 훅=로직, 컴포넌트=UI).
//   · 모든 계산식은 utils/guruDiagnostics(순수)에 위임 — 이 훅은 상태+조립(상태 정밀화·정렬)만.

import { useMemo, useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { diagnoseAssetRules, summarizeDiagnostics, describeRuleStatus } from '../utils/guruDiagnostics';
import type { RuleStatusKind } from '../types/knowledge';
import type { DiagnosticRow, GuruDiagnosticsView } from '../types/guruDiagnostics';

// 발화에 가까운 순서(사용자가 "거의 떴는데" 케이스를 먼저 보도록). 동순위는 안정 정렬로 규칙 원순서 유지.
const STATUS_ORDER: RuleStatusKind[] = [
  'firing', 'firing-partial', 'not-met', 'not-met-partial', 'data-missing', 'unsupported', 'inactive', 'no-condition',
];
const orderOf = (k: RuleStatusKind): number => {
  const i = STATUS_ORDER.indexOf(k);
  return i === -1 ? STATUS_ORDER.length : i;
};

export function useGuruDiagnostics(): GuruDiagnosticsView {
  const { data, derived } = usePortfolio();
  const targets = derived.guruSignalTargets;
  const { rules, claims } = data.knowledgeBase;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 선택이 없거나 더 이상 존재하지 않는 종목이면 첫 종목으로 폴백(렌더 중 파생, 상태 변경 아님).
  const effectiveId =
    selectedId && targets.some(t => t.assetId === selectedId)
      ? selectedId
      : (targets[0]?.assetId ?? null);
  const selectedTarget = effectiveId
    ? targets.find(t => t.assetId === effectiveId) ?? null
    : null;

  // 온디맨드: 선택 종목 1개에 대해서만 진단 계산. now는 claim 만료 판정에만 쓰임(useMemo 내부 1회).
  const { rows, summary } = useMemo(() => {
    if (!selectedTarget) return { rows: [] as DiagnosticRow[], summary: null };
    const diags = diagnoseAssetRules({ rules, claims, target: selectedTarget, now: new Date() });
    const built: DiagnosticRow[] = diags.map(d => ({ diagnostic: d, status: describeRuleStatus(d) }));
    built.sort((a, b) => orderOf(a.status.kind) - orderOf(b.status.kind));
    return { rows: built, summary: summarizeDiagnostics(diags) };
  }, [selectedTarget, rules, claims]);

  return {
    targets,
    selectedId: effectiveId,
    selectedTarget,
    selectTarget: setSelectedId,
    rows,
    summary,
  };
}
