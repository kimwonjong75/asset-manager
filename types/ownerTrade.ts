import type { ReactNode } from 'react';
import type { Asset } from './index';
import type { OwnerId } from './owner';

export interface OwnerTradeTarget {
  source: Asset;
  owner: OwnerId;
  position: Asset | null;
  totalQuantity: number;
}

export interface OwnerTradeDialogProps {
  side: 'buy' | 'sell';
  source: Asset;
  children: (target: OwnerTradeTarget) => ReactNode;
}

export interface OwnerTradeBalanceProps {
  target: OwnerTradeTarget;
  change: number;
}
