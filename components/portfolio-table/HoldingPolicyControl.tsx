import type { HoldingPolicyControlProps } from '../../types/holdingPolicyUi';
import { HOLDING_POLICY_LABELS } from '../../types/holdingPolicyUi';
import { getOwnerLabel } from '../../types/owner';
import { getHoldingPrincipalKRW } from '../../utils/holdingPolicy';
import { holdingPolicySuggestion } from '../../utils/holdingPolicyEdit';

export default function HoldingPolicyControl({ asset, row, onOpen }: HoldingPolicyControlProps) {
  const label = asset.holdingPolicy ? HOLDING_POLICY_LABELS[asset.holdingPolicy.mode] : '운용 방침 선택';
  return (
    <div className="mt-1 text-xs" data-no-chart-toggle>
      <button type="button" aria-label={`${getOwnerLabel(asset.owner)} ${asset.name} 운용 방침 · ${label}`}
        className="focus-ring min-h-7 rounded text-left text-primary-light underline decoration-dotted underline-offset-4"
        onClick={event => { event.stopPropagation(); onOpen(); }}>{label}</button>
      {asset.holdingPolicy ? <p className={row?.status === 'unavailable' ? 'text-warning' : 'text-gray-300'}>
        {row?.reasonText ?? '종가 확인 대기'}
      </p> : <p className="text-gray-400">{holdingPolicySuggestion(getHoldingPrincipalKRW(asset))}</p>}
    </div>
  );
}
