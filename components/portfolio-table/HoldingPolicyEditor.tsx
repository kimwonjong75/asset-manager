import { useState } from 'react';
import type { HoldingPolicy } from '../../types/holdingPolicy';
import { HOLDING_POLICY_LABELS, type HoldingPolicyEditorProps } from '../../types/holdingPolicyUi';
import { getAssetOwner, getOwnerLabel } from '../../types/owner';
import { getHoldingPrincipalKRW } from '../../utils/holdingPolicy';
import { holdingPolicySuggestion } from '../../utils/holdingPolicyEdit';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { formatKRW } from './utils';

const MODES = ['hold', 'exit-at-cost', 'turtle-after-cost'] as const;
const descriptions: Record<HoldingPolicy['mode'], string> = {
  hold: '장기로 보유하고 매매 알림을 끕니다.',
  'exit-at-cost': '매도 비용을 뺀 종가 평가액이 원금에 닿으면 정리를 알립니다.',
  'turtle-after-cost': '본전을 확인한 날부터 감시합니다. 이후 종가가 직전 20거래일 최저가 이하가 되면 매도를 알립니다.',
};

export default function HoldingPolicyEditor({ asset, row, defaultSellCostPct, monitoringExclusion, onSave, onClose }: HoldingPolicyEditorProps) {
  const [initial] = useState(asset);
  const previous = initial.holdingPolicy;
  const [mode, setMode] = useState<HoldingPolicy['mode'] | null>(previous?.mode ?? null);
  const [feeText, setFeeText] = useState(String(previous?.sellCostPct ?? defaultSellCostPct));
  const [pyramidingEnabled, setPyramidingEnabled] = useState(previous?.pyramidingEnabled === true);
  const [principalText, setPrincipalText] = useState(previous?.confirmedUnitCostKRW === undefined
    ? '' : String(previous.confirmedUnitCostKRW * initial.quantity));
  const [error, setError] = useState('');
  const principal = getHoldingPrincipalKRW(initial);
  const needsCost = mode === 'exit-at-cost' || mode === 'turtle-after-cost';
  const save = () => {
    const problem = onSave({
      assetId: initial.id, owner: getAssetOwner(initial), expectedQuantity: initial.quantity,
      expectedCycleId: previous?.cycleId, mode, pyramidingEnabled,
      sellCostPct: feeText.trim() ? Number(feeText) : defaultSellCostPct,
      confirmedPrincipalKRW: principalText.trim() ? Number(principalText) : undefined,
    });
    if (problem) setError(problem);
    else onClose();
  };
  return <Modal open onClose={onClose} title="보유분 운용 방침"
    description={`${getOwnerLabel(initial.owner)} · ${initial.customName?.trim() || initial.name} (${initial.ticker})`}
    footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save}>방침 저장</Button></>}>
    <div className="space-y-4">
      {monitoringExclusion && <p className="text-sm text-warning">터틀 감시 제외 · {monitoringExclusion} 방침은 저장할 수 있으며 현재 설정에서는 이 보유분의 터틀 알림이 꺼져 있습니다.</p>}
      <div className="text-sm text-gray-300">
        <div>잔여 투자원금 <strong>{principal === null ? '원가 정보 부족' : formatKRW(principal)}</strong></div>
        {principal !== null && <p className="text-xs text-gray-400">{previous?.confirmedUnitCostKRW != null ? '기존 확인 원금 기준' : '등록 매입단가·매입환율과 현재 수량 기준'}</p>}
        <p className="mt-1 text-xs text-gray-400">{holdingPolicySuggestion(principal)}</p>
      </div>
      <fieldset className="space-y-1">
        <legend className="mb-1 font-semibold">운용 방침</legend>
        {MODES.map(value => <label key={value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-700/60">
          <input type="radio" name="holding-policy" aria-label={HOLDING_POLICY_LABELS[value]} className="mt-1"
            checked={mode === value} onChange={() => setMode(value)} />
          <span><span className="block text-sm">{HOLDING_POLICY_LABELS[value]}</span>
            <span className="text-xs text-gray-400">{descriptions[value]}</span></span>
        </label>)}
        <label className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-400">
          <input type="radio" name="holding-policy" aria-label="미지정" checked={mode === null} onChange={() => setMode(null)} />
          미지정 · 기존 규칙 사용
        </label>
      </fieldset>
      {needsCost && <div className="space-y-3">
        <details>
          <summary className="cursor-pointer text-sm">예상 매도 비용률 {feeText || defaultSellCostPct}% · 변경</summary>
        <label className="block text-sm">
          예상 매도 비용률 (%)
          <input className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-3 py-2" type="number"
            aria-label="예상 매도 비용률 (%)" min="0" step="any" inputMode="decimal" value={feeText} onChange={e => setFeeText(e.target.value)} />
          <span className="mt-1 block text-xs text-gray-400">이 종목에 적용할 수수료·세금 등을 반영하세요. 빈칸은 설정값 {defaultSellCostPct}%, 비용 없음은 0%입니다.</span>
        </label>
        </details>
        {principal === null && <label className="block text-sm">
          증권사에서 확인한 잔여 투자원금 (원)
          <input className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-3 py-2"
            aria-label="증권사에서 확인한 잔여 투자원금 (원)" type="number" min="0" step="any" inputMode="decimal"
            value={principalText} onChange={e => setPrincipalText(e.target.value)} />
          <span className="mt-1 block text-xs text-gray-400">등록된 매입 정보로 계산할 수 없습니다. 잔여 원금을 입력하거나 종목의 매입 정보를 보완하세요.</span>
        </label>}
      </div>}
      {mode === 'turtle-after-cost' && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pyramidingEnabled} onChange={e => setPyramidingEnabled(e.target.checked)} />
        재매수 후 불타기 알림
      </label>}
      {asset.holdingPolicy && row?.holdingPolicyEvaluation && <div className="rounded bg-surface-muted p-3 text-sm">
        <p className="font-semibold">현재 저장된 방침</p>
        <p className="mt-1">{row.reasonText}</p>
        {row.holdingPolicyEvaluation.phase !== 'hold' && <p className="mt-1 text-xs text-gray-300">
          {row.asOfDate && <span>{row.asOfDate} 종가 · </span>}
          비용 차감 후 예상 매도금액 {row.holdingPolicyEvaluation.netProceedsKRW === null
            ? '확인 필요' : formatKRW(row.holdingPolicyEvaluation.netProceedsKRW)}
        </p>}
      </div>}
      {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    </div>
  </Modal>;
}
