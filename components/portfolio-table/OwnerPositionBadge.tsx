import type { OwnerPositionBadgeProps } from '../../types/portfolioOwnerGroup';
import { YUSEON_ACCOUNT_BADGE } from '../../constants/stateColorLadders';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getAssetOwner, OWNER_LABELS } from '../../types/owner';
import { hasUnresolvedOwners } from '../../utils/ownerHoldings';
import { formatOwnerQuantity } from '../../utils/ownerQuantity';
import OwnerSplitButton from './OwnerSplitButton';

export default function OwnerPositionBadge({ asset, quantity = asset.quantity }: OwnerPositionBadgeProps) {
  const { data } = usePortfolio();
  if (hasUnresolvedOwners(asset)) {
    return <span className="inline-flex flex-wrap items-center gap-1 text-xs text-warning" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <span>분할 확인 필요 · 운용 방침은 분할 후 선택</span><OwnerSplitButton asset={asset} />
    </span>;
  }
  const owner = getAssetOwner(asset);
  const tone = owner === 'YUSEON' ? YUSEON_ACCOUNT_BADGE : 'bg-primary/15 text-primary-light';
  return (
    <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${tone}`}>
      {OWNER_LABELS[owner]} {formatOwnerQuantity(asset, quantity, data.categoryStore.categories)}
    </span>
  );
}
