// components/trade-plan/TradePlanBulkWizard.tsx
// 투더문 일괄 계획 만들기 마법사 — `derived.planlessSatellites`(투더문 보유 中 계획 없음)를
// 강의 기본값(오늘가·7%·3배·20일선·불타기 OFF)으로 미리보기 후 선택 저장한다.
// 렌더 전용: 계산은 `defaultEditorInput`+`buildTradePlan`(순수)만 사용, ONE commitPortfolio로 저장.

import React, { useState } from 'react';
import { formatQuantity } from '../portfolio-table/utils';
import { isBaseType } from '../../types/category';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { buildTradePlan, formatPlanPrice } from '../../utils/tradePlan';
import { defaultEditorInput } from '../../utils/tradePlanMarket';
import type { TradePlan } from '../../types/tradePlan';
import TradePlanIntro, { hasSeenTradePlanIntro } from './TradePlanIntro';
import Badge, { type BadgeTone } from '../common/Badge';
import Modal from '../common/Modal';
import Button from '../common/Button';

type RowStatus = 'ready' | 'below-exit' | 'no-price';

interface WizardRow {
  assetId: string;
  name: string;
  ticker: string;
  status: RowStatus;
  plan: TradePlan | null;
  currentPrice: number;
  currency: string;
  isCrypto: boolean;
}

const STATUS_LABEL: Record<RowStatus, { label: string; tone: BadgeTone }> = {
  ready: { label: '정상 대기', tone: 'ok' },
  'below-exit': { label: '이미 추세선 아래(재돌파 후 적용)', tone: 'warning' },
  'no-price': { label: '시세 없음(제외)', tone: 'neutral' },
};

const TradePlanBulkWizard: React.FC = () => {
  const { modal, derived, data, actions } = usePortfolio();
  const isOpen = modal.tradePlanBulkOpen;
  const onClose = actions.closeTradePlanBulk;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showIntro, setShowIntro] = useState<boolean>(() => !hasSeenTradePlanIntro());
  // 열릴 때마다 선택/안내 상태를 새로 시드 — effect 대신 "렌더 중 조정" 패턴
  // (React 문서 권장: prop 변화 시 state 조정은 effect보다 렌더 중 비교가 cascading render를 피한다).
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  const rows: WizardRow[] = isOpen
    ? derived.planlessSatellites.map(asset => {
        const enriched = derived.enrichedMap.get(asset.ticker);
        const now = new Date().toISOString();
        const input = defaultEditorInput(
          { kind: 'asset', asset },
          { totalEquityKRW: derived.totalValue, rates: data.exchangeRates, enriched, now, anchor: 'today' },
        );
        const result = buildTradePlan(input);
        const status: RowStatus = !result.ok
          ? 'no-price'
          : result.plan.exitLineArmMode === 'after-reclaim'
            ? 'below-exit'
            : 'ready';
        return {
          assetId: asset.id,
          name: asset.customName?.trim() || asset.name,
          ticker: asset.ticker,
          status,
          plan: result.ok ? result.plan : null,
          currentPrice: asset.priceOriginal,
          currency: asset.currency,
          isCrypto: isBaseType(asset.categoryId, 'CRYPTOCURRENCY'),
        };
      })
    : [];

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setSelectedIds(new Set(rows.filter(r => r.status !== 'no-price').map(r => r.assetId)));
      setShowIntro(!hasSeenTradePlanIntro());
    }
  }

  if (!isOpen) return null;

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const readyCount = rows.filter(r => r.status === 'ready').length;
  const belowExitCount = rows.filter(r => r.status === 'below-exit').length;
  const noPriceCount = rows.filter(r => r.status === 'no-price').length;
  const selectedCount = rows.filter(r => selectedIds.has(r.assetId) && r.plan).length;

  const handleSubmit = () => {
    const entries = rows
      .filter(r => selectedIds.has(r.assetId) && r.plan)
      .map(r => ({ assetId: r.assetId, plan: r.plan as TradePlan }));
    if (entries.length === 0) return;
    actions.saveTradePlansBulk(entries);
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="투더문 일괄 계획 만들기"
      description="강의 기본값(오늘가·7%·3배·20일선·불타기 안 함)으로 계획을 만듭니다. 유선 계정·현금·계획 있는 종목은 제외됩니다."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={selectedCount === 0}>
            {selectedCount}개 계획 만들기
          </Button>
        </>
      }
    >

        {showIntro && <TradePlanIntro onDismiss={() => setShowIntro(false)} className="mb-4" />}

        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">계획을 만들 투더문 보유 종목이 없습니다.</p>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-2 flex flex-wrap gap-x-3 gap-y-1">
              <span className="text-ok">정상 대기 {readyCount}</span>
              <span className="text-amber-400">이미 추세선 아래 {belowExitCount}(재돌파 후 적용)</span>
              <span className="text-gray-500">시세 없음 {noPriceCount}(만들지 않음)</span>
            </div>
            <div className="border border-gray-700 rounded-md overflow-hidden">
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-700">
                {rows.map(r => (
                  <label
                    key={r.assetId}
                    className={`flex items-center gap-3 px-3 py-2.5 text-xs ${r.status === 'no-price' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-700/40'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.assetId)}
                      disabled={r.status === 'no-price'}
                      onChange={() => toggle(r.assetId)}
                      className="flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-100 truncate">{r.name}</span>
                        <span className="text-gray-500">{r.ticker}</span>
                      </div>
                      {r.plan && (
                        <div className="text-gray-500 mt-0.5">
                          현재 {formatPlanPrice(r.currentPrice, r.currency)}
                          {' · '}손절 {formatPlanPrice(r.plan.stopPrice, r.currency)}
                          {r.plan.takeProfitPrice !== null && <> · 익절 {formatPlanPrice(r.plan.takeProfitPrice, r.currency)}</>}
                          {' · '}수량 {formatQuantity(r.plan.plannedQuantity, r.isCrypto)}
                        </div>
                      )}
                    </div>
                    <Badge tone={STATUS_LABEL[r.status].tone} className="flex-shrink-0">{STATUS_LABEL[r.status].label}</Badge>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

    </Modal>
  );
};

export default TradePlanBulkWizard;
