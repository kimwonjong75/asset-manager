import type { Asset } from '../types';
import { isCashCategory } from '../types/category';
import { getAssetOwner, hasUnresolvedOwners } from '../types/owner';
import type { HoldingPolicyChange, HoldingPolicyEdit } from '../types/holdingPolicyUi';
import type { PortfolioSaveSnapshot } from '../types/portfolioSave';
import { marketLocalDate, resolveMarketTz } from './todayTurtle';
import { isCryptoExchange } from './marketCurrency';

export function holdingPolicySuggestion(principalKRW: number | null): string {
  if (principalKRW === null) return '원금 확인 후 분류';
  return principalKRW >= 10_000_000 ? '1천만원 이상 · 본전부터 터틀 제안' : '1천만원 미만 · 본전 정리 제안';
}

/** Validate the live balance, then persist a per-unit basis so partial sales reduce principal pro rata. */
export function buildHoldingPolicyChange(asset: Asset | undefined, edit: HoldingPolicyEdit, now: Date, newCycleId: string): HoldingPolicyChange {
  if (!asset || asset.id !== edit.assetId || hasUnresolvedOwners(asset) || getAssetOwner(asset) !== edit.owner ||
      asset.quantity !== edit.expectedQuantity || asset.holdingPolicy?.cycleId !== edit.expectedCycleId) {
    return { ok: false, error: '보유 수량·보유자 또는 방침이 바뀌었습니다. 창을 다시 열어 확인해 주세요.' };
  }
  if (!edit.mode) return { ok: true, policy: undefined };
  if (!(asset.quantity > 0 && Number.isFinite(asset.quantity))) return { ok: false, error: '보유 수량을 확인해 주세요.' };
  const sellCostPct = edit.mode === 'hold' ? undefined : edit.sellCostPct;
  if (sellCostPct !== undefined && (!Number.isFinite(sellCostPct) || sellCostPct < 0 || sellCostPct >= 100)) {
    return { ok: false, error: '매도 비용률은 0% 이상, 100% 미만으로 입력해 주세요.' };
  }
  const previous = asset.holdingPolicy;
  const previousUnitCost = previous?.confirmedUnitCostKRW;
  const confirmedUnitCostKRW = previousUnitCost !== undefined && previousUnitCost * asset.quantity === edit.confirmedPrincipalKRW
    ? previousUnitCost : edit.confirmedPrincipalKRW === undefined ? undefined : edit.confirmedPrincipalKRW / asset.quantity;
  if (confirmedUnitCostKRW !== undefined && (!Number.isFinite(confirmedUnitCostKRW) || confirmedUnitCostKRW <= 0)) {
    return { ok: false, error: '증권사 잔여 원금은 0원보다 큰 금액을 입력해 주세요.' };
  }
  const pyramidingEnabled = edit.mode === 'turtle-after-cost' && edit.pyramidingEnabled === true;
  if (previous && previous.mode === edit.mode && previous.sellCostPct === sellCostPct &&
      previous.confirmedUnitCostKRW === confirmedUnitCostKRW) {
    return { ok: true, policy: !!previous.pyramidingEnabled === pyramidingEnabled ? previous : { ...previous, pyramidingEnabled } };
  }
  const startedOn = holdingPolicyStartDate(asset.exchange, now);
  return { ok: true, policy: {
    mode: edit.mode, sellCostPct, confirmedUnitCostKRW, pyramidingEnabled, cycleId: newCycleId, startedOn,
    requiresCostConfirmation: !confirmedUnitCostKRW && previous?.requiresCostConfirmation,
    armedOn: previous?.mode === 'turtle-after-cost' && edit.mode === previous.mode ? previous.armedOn : undefined,
  } };
}

export function holdingPolicyStartDate(exchange: string, now: Date): string {
  const tz = resolveMarketTz(exchange, isCryptoExchange(exchange));
  return marketLocalDate(tz === 'UNKNOWN' ? 'KR' : tz, now);
}

/** Commit only the matching holding, preserving every other balance from the current snapshot. */
export function editedHoldingPolicyAssets(snap: PortfolioSaveSnapshot, edit: HoldingPolicyEdit, now: Date, cycleId: string): Asset[] | string {
  const asset = snap.assets.find(a => a.id === edit.assetId);
  if (asset && edit.mode && isCashCategory(asset.categoryId, snap.categoryStore.categories)) {
    return '이 보유분은 운용 대상에서 제외되어 있습니다.';
  }
  const result = buildHoldingPolicyChange(asset, edit, now, cycleId);
  if (!result.ok) return result.error;
  if (!asset || result.policy === asset.holdingPolicy) return snap.assets;
  return snap.assets.map(a => a.id === asset.id ? { ...a, holdingPolicy: result.policy } : a);
}
