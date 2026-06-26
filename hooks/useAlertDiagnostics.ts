// hooks/useAlertDiagnostics.ts
// ---------------------------------------------------------------------------
// 5B 알림 진단 패널 상태/계산 훅. "이 종목에 왜 이 알림이 떴나/안 떴나".
//   · 대상 = 포트폴리오(derived.enrichedAssets) + 관심종목(pseudo-EnrichedAsset). 신호 카드와 달리
//     enriched 없어도 포함(데이터 부족도 진단 대상). 관심종목은 buy-only 정책을 진단도 따른다.
//   · 선택 종목 1개만 온디맨드 진단(useMemo). 계산은 utils/alertDiagnostics(순수)에 위임, 컴포넌트는 렌더만.
//   · 팝업 전달 상태는 규칙 진단과 직교 — useAutoAlert가 공유 게이트로 산출한 `derived.autoPopupDiagnosis`를
//     **구독만** 한다(localStorage 직접 읽기 없음 → stale 없음, 부수효과 없음).

import { useMemo, useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { watchlistToPseudoAsset } from '../utils/alertChecker';
import { diagnoseAssetAlerts, describeAlertRuleStatus } from '../utils/alertDiagnostics';
import type {
  AlertDiagnosticsTarget, AlertDiagnosticRow, AlertDiagnosticsView, AlertRuleStatusKind,
} from '../types/alertDiagnostics';

// 발화 근접 순 정렬(거의 떴는데 → 꺼짐 순). 동순위는 안정 정렬로 규칙 원순서 유지.
const STATUS_ORDER: AlertRuleStatusKind[] = [
  'firing', 'firing-partial', 'not-met', 'not-met-partial', 'data-missing', 'disabled',
];
const orderOf = (k: AlertRuleStatusKind): number => {
  const i = STATUS_ORDER.indexOf(k);
  return i === -1 ? STATUS_ORDER.length : i;
};

export function useAlertDiagnostics(): AlertDiagnosticsView {
  const { data, ui, derived } = usePortfolio();
  const { enrichedAssets, enrichedMap, autoPopupDiagnosis } = derived;
  const { rules } = ui.alertSettings;
  const watchlist = data.watchlist;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const targets = useMemo<AlertDiagnosticsTarget[]>(() => {
    const out: AlertDiagnosticsTarget[] = [];
    for (const a of enrichedAssets) {
      out.push({ assetId: a.id, ticker: a.ticker, name: a.name, source: 'portfolio', asset: a, enriched: enrichedMap.get(a.ticker) });
    }
    const portfolioTickers = new Set(enrichedAssets.map(a => a.ticker));
    for (const w of watchlist) {
      if (portfolioTickers.has(w.ticker)) continue;
      const price = w.priceOriginal ?? w.currentPrice ?? 0;
      if (price <= 0) continue;
      out.push({ assetId: w.id, ticker: w.ticker, name: w.name, source: 'watchlist', asset: watchlistToPseudoAsset(w), enriched: enrichedMap.get(w.ticker) });
    }
    return out;
  }, [enrichedAssets, watchlist, enrichedMap]);

  const effectiveId =
    selectedId && targets.some(t => t.assetId === selectedId) ? selectedId : (targets[0]?.assetId ?? null);
  const selectedTarget = effectiveId ? targets.find(t => t.assetId === effectiveId) ?? null : null;

  const rows = useMemo<AlertDiagnosticRow[]>(() => {
    if (!selectedTarget) return [];
    const diags = diagnoseAssetAlerts({
      asset: selectedTarget.asset,
      enriched: selectedTarget.enriched,
      rules,
      source: selectedTarget.source,
    });
    const built: AlertDiagnosticRow[] = diags.map(d => ({ diagnostic: d, status: describeAlertRuleStatus(d) }));
    built.sort((a, b) => orderOf(a.status.kind) - orderOf(b.status.kind));
    return built;
  }, [selectedTarget, rules]);

  return {
    targets,
    selectedId: effectiveId,
    selectedTarget,
    selectTarget: setSelectedId,
    rows,
    // 팝업 전달 상태는 useAutoAlert가 공유 게이트로 산출해 반응형으로 노출(localStorage stale 제거).
    popupDelivery: autoPopupDiagnosis,
  };
}
