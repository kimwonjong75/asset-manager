import { useState } from 'react';
import { Currency } from '../../types';
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

export default function HoldingPolicyEditor({ asset, row, onSave, onClose }: HoldingPolicyEditorProps) {
  const [initial] = useState(asset);
  const previous = initial.holdingPolicy;
  const [mode, setMode] = useState<HoldingPolicy['mode'] | null>(previous?.mode ?? null);
  const [feeText, setFeeText] = useState(String(previous?.sellCostPct ?? ''));
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
      sellCostPct: feeText.trim() ? Number(feeText) : undefined,
      confirmedPrincipalKRW: principalText.trim() ? Number(principalText) : undefined,
    });
    if (problem) setError(problem);
    else onClose();
  };
  return <Modal open onClose={onClose} title="보유분 운용 방침"
    description={`${getOwnerLabel(initial.owner)} · ${initial.customName?.trim() || initial.name} (${initial.ticker})`}
    footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save}>방침 저장</Button></>}>
    <div className="space-y-4">
      <div className="text-sm text-gray-300">
        <div>잔여 투자원금 <strong>{principal === null ? '확인 필요' : formatKRW(principal)}</strong></div>
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
        <label className="block text-sm">
          예상 매도 비용률 (%)
          <input className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-3 py-2" type="number"
            aria-label="예상 매도 비용률 (%)" min="0" step="any" inputMode="decimal" value={feeText} onChange={e => setFeeText(e.target.value)} />
          <span className="mt-1 block text-xs text-gray-400">수수료·거래세·환전 비용 등을 합산하세요. 비용이 없으면 0을 입력하세요. 비워 두면 본전 알림을 보류합니다.</span>
        </label>
        <label className="block text-sm">
          증권사에서 확인한 잔여 투자원금 (원)
          <input className="mt-1 block w-full rounded border border-gray-600 bg-gray-900 px-3 py-2"
            aria-label="증권사에서 확인한 잔여 투자원금 (원)" type="number" min="0" step="any" inputMode="decimal"
            value={principalText} onChange={e => setPrincipalText(e.target.value)} />
          <span className="mt-1 block text-xs text-gray-400">{asset.currency === Currency.KRW
            ? '원금 확인이 필요하거나 표시 금액이 다르면, 이 보유자에게 남은 수량의 매입원금을 입력하세요.'
            : '증권사의 원화 매입원가를 확인해 이 보유자에게 남은 수량의 원금을 입력하세요. 외화 체결금액으로 계산할 때는 각 매수 당시 실제 환율을 적용하세요.'}</span>
        </label>
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
