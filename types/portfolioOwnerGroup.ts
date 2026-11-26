import type { ReactNode } from 'react';
import type { Asset } from './index';
import type { OwnerId } from './owner';
import type { ColumnConfig, EnrichedAsset } from './ui';

/** 통합 화면에서만 쓰는 읽기 모델. 거래·편집·선택 시에는 holdings의 실제 ID를 쓴다. */
export interface PortfolioOwnerGroup {
  key: string;
  holdings: EnrichedAsset[];
  quantities: Partial<Record<OwnerId, number>>;
  quantity: number;
  currentValueKRW: number;
  purchaseValueKRW: number;
  profitLossKRW: number;
  returnPercentage: number | null;
  allocation: number;
}

export interface OwnerPositionBadgeProps {
  asset: Asset;
  quantity?: number;
}

export interface HoldingTradeButtonsProps {
  asset: EnrichedAsset;
  onBuy?: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
}

export interface PortfolioOwnerGroupRowProps {
  group: PortfolioOwnerGroup;
  mobile: boolean;
  visibleColumns: ColumnConfig[];
  onSell?: (asset: Asset, pickOwner?: boolean) => void;
  onBuy?: (asset: Asset, pickOwner?: boolean) => void;
  children: ReactNode;
}
