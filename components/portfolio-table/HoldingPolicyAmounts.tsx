import type { TurtleHoldingsRow } from '../../utils/turtleHoldingsView';
import { formatNumber } from './utils';

export default function HoldingPolicyAmounts({ holdingPolicyEvaluation }: Pick<TurtleHoldingsRow, 'holdingPolicyEvaluation'>) {
  if (holdingPolicyEvaluation?.netProceedsKRW == null || holdingPolicyEvaluation.remainingPrincipalKRW == null) return null;
  return (
    <p className="mt-1 text-xs text-gray-400">
      예상 순매도대금 {formatNumber(holdingPolicyEvaluation.netProceedsKRW)}원 · 잔여 원금 {formatNumber(holdingPolicyEvaluation.remainingPrincipalKRW)}원
    </p>
  );
}
