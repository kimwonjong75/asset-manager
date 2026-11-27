import type { Asset } from './index';
import type { OwnerId } from './owner';
import type { HoldingPolicy } from './holdingPolicy';
import type { TurtleHoldingsRow } from '../utils/turtleHoldingsView';

/** Only the editable values cross from the form to the store. Activation belongs to the signal engine. */
export interface HoldingPolicyEdit {
  assetId: string;
  owner: OwnerId;
  expectedQuantity: number;
  expectedCycleId?: string;
  mode: HoldingPolicy['mode'] | null;
  sellCostPct?: number;
  pyramidingEnabled?: boolean;
  confirmedPrincipalKRW?: number;
}

export interface HoldingPolicyEditorProps {
  asset: Asset;
  row?: TurtleHoldingsRow;
  onSave: (edit: HoldingPolicyEdit) => string | null;
  onClose: () => void;
}

export interface HoldingPolicyControlProps {
  asset: Asset;
  row?: TurtleHoldingsRow;
  onOpen: () => void;
}

export type HoldingPolicyChange =
  | { ok: true; policy: HoldingPolicy | undefined }
  | { ok: false; error: string };

export const HOLDING_POLICY_LABELS: Record<HoldingPolicy['mode'], string> = {
  hold: '계속 보유',
  'exit-at-cost': '본전에서 정리',
  'turtle-after-cost': '본전부터 터틀',
};
