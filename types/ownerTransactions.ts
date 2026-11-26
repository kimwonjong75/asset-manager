import type { Asset, Currency, SellRecord } from './index';
import type { OwnerId } from './owner';

export interface OwnerOpeningBalance {
  quantity: number;
  price: number;
  rate: number;
}

export interface OwnerSplitInput {
  assetId: string;
  expectedQuantity: number;
  balances: Record<OwnerId, OwnerOpeningBalance>;
}

export type OwnerSplitResult =
  | { ok: true; assets: Asset[]; sellHistory: SellRecord[] }
  | { ok: false; error: string };

export interface OwnerAssetProps { asset: Asset }

export interface OwnerSplitFields { quantity: string; price: string; rate: string }

export interface OwnerTradeEntry {
  key: string;
  owner?: OwnerId;
  name: string;
  ticker: string;
  date: string;
  side: '매수' | '매도';
  quantity: number;
  quantityUnit?: string;
  price: number;
  currency: Currency;
}
