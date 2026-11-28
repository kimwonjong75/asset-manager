import { Currency, type Asset, type WatchlistItem } from '../types';
import { hasUnresolvedOwners } from '../types/owner';
import type { HoldingPolicyActivation, HoldingPolicyCloseInput, HoldingPolicyEvaluation, HoldingPolicyHistoryInput } from '../types/holdingPolicy';
import type { TurtleHoldingsSettings } from '../types/turtleHoldings';
import { addIsoDays, resolveMarketTz, SESSION_BAR_SETTLE_MIN } from './todayTurtle';
import { closeConfirmTime, lastSessionDate } from './marketHours';

const positive = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;

/** Use the registered acquisition basis. A confirmed brokerage basis takes precedence. */
export function getHoldingPrincipalKRW(asset: Asset): number | null {
  if (hasUnresolvedOwners(asset) || !positive(asset.quantity)) return null;
  const confirmed = asset.holdingPolicy?.confirmedUnitCostKRW;
  const rate = asset.currency === Currency.KRW ? 1 : asset.purchaseExchangeRate;
  const unit = confirmed ?? (positive(asset.purchasePrice) && positive(rate) ? asset.purchasePrice * rate : null);
  return positive(unit) && positive(unit * asset.quantity) ? unit * asset.quantity : null;
}

export function holdingPolicyTurtleSettings(settings: TurtleHoldingsSettings): TurtleHoldingsSettings {
  return { ...settings, exitMethod: 'donchian', exitLookback: 20, entryLookback: 55 };
}

export function isPolicyReentryWatch(item: WatchlistItem): boolean {
  const policy = item.holdingPolicy;
  const sale = item.turtleWatch;
  return policy?.mode === 'turtle-after-cost' && !!policy.armedOn && sale?.source === 'turtle-exit' &&
    sale.soldAt > policy.armedOn && positive(sale.soldPriceOriginal);
}

/** Late results from a closed position or a previous selection may never reactivate a holding. */
export function applyHoldingPolicyActivations(assets: Asset[], activations: readonly HoldingPolicyActivation[]): Asset[] {
  const byId = new Map(activations.map(item => [item.assetId, item]));
  let changed = false;
  const next = assets.map(asset => {
    const item = byId.get(asset.id);
    const policy = asset.holdingPolicy;
    if (!item || !item.cycleId || policy?.mode !== 'turtle-after-cost' || policy.cycleId !== item.cycleId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.armedOn) || (policy.armedOn && policy.armedOn <= item.armedOn) ||
        (!policy.armedOn && policy.startedOn && item.armedOn < policy.startedOn)) return asset;
    changed = true;
    return { ...asset, holdingPolicy: { ...policy, armedOn: item.armedOn } };
  });
  return changed ? next : assets;
}

/** Missing a scheduled market bar (including holidays) means wait for a confirmed quote. */
export function holdingPolicyExpectedSession(exchange: string, isCrypto: boolean, now: Date): string | null {
  const market = resolveMarketTz(exchange, isCrypto);
  if (market === 'UNKNOWN' || !Number.isFinite(now.getTime())) return null;
  const clockMarket = market === 'JP' ? 'KR' : market;
  const today = lastSessionDate(clockMarket, now);
  if (market === 'CRYPTO') {
    const previous = addIsoDays(today, -1);
    return now.getTime() >= Date.parse(closeConfirmTime('CRYPTO', previous)) + SESSION_BAR_SETTLE_MIN * 60_000
      ? previous : addIsoDays(previous, -1);
  }
  let candidate = now.getTime() >= Date.parse(closeConfirmTime(clockMarket, today)) + SESSION_BAR_SETTLE_MIN * 60_000
    ? today : addIsoDays(today, -1);
  while ([0, 6].includes(new Date(candidate + 'T12:00:00Z').getUTCDay())) candidate = addIsoDays(candidate, -1);
  return candidate;
}

export function evaluateHoldingPolicy(input: HoldingPolicyCloseInput): HoldingPolicyEvaluation {
  const { policy, remainingPrincipalKRW, quantity, fxRate, close, sessionDate, expectedSession } = input;
  const pct = policy.sellCostPct;
  const validCost = pct != null && Number.isFinite(pct) && pct >= 0 && pct < 100;
  const fresh = !!sessionDate && sessionDate === expectedSession;
  const net = fresh && validCost && positive(close) && positive(fxRate) && positive(quantity)
    ? close * fxRate * quantity * (1 - pct / 100) : null;
  const netProceedsKRW = positive(net) ? net : null;
  const result = (phase: HoldingPolicyEvaluation['phase'], reason: string, armedOn?: string): HoldingPolicyEvaluation =>
    ({ phase, reason, remainingPrincipalKRW, netProceedsKRW, armedOn });
  if (policy.mode === 'hold') return result('hold', '계속 보유 · 매매 알림을 쉬고 장기 보유합니다.');
  if (policy.mode !== 'exit-at-cost' && policy.mode !== 'turtle-after-cost') return result('unavailable', '확인 필요 · 운용 방침을 다시 선택하세요.');
  if (!fresh || !positive(close)) return result('unavailable', '확인 필요 · 해당 거래일의 확정 종가를 기다립니다.', policy.armedOn);
  if (policy.mode === 'turtle-after-cost' && policy.armedOn && policy.armedOn <= sessionDate) {
    return policy.armedOn === sessionDate
      ? result('armed-today', '본전 도달 · 오늘은 터틀 감시만 시작합니다.', policy.armedOn)
      : result('active', '터틀 감시 중 · 직전 20거래일 저가를 확인합니다.', policy.armedOn);
  }
  if (policy.startedOn && sessionDate < policy.startedOn) return result('waiting', '방침 설정 이후 첫 확정 종가를 기다립니다.');
  if (!positive(remainingPrincipalKRW)) return result('unavailable', '원가 확인 필요 · 이 보유자의 잔여 원화 매입원금을 확인하세요.');
  if (!validCost) return result('unavailable', '비용 확인 필요 · 예상 매도 비용률을 입력하세요.');
  if (netProceedsKRW == null) return result('unavailable', '확인 필요 · 종가와 같은 거래일의 원화 환율 또는 수량을 확인하세요.');
  const arithmeticTolerance = 4 * Number.EPSILON * Math.max(remainingPrincipalKRW, netProceedsKRW);
  if (remainingPrincipalKRW - netProceedsKRW > arithmeticTolerance) return result('waiting', '본전 대기 · 예상 순매도대금이 잔여 원금보다 적습니다.');
  return policy.mode === 'exit-at-cost'
    ? result('exit-ready', '본전 도달 · 주문 전 예상 순매도대금을 확인하고 매도를 검토하세요.')
    : result('armed-today', '본전 도달 · 오늘은 터틀 감시만 시작합니다.', sessionDate);
}

/** Replay only closes after the policy was selected, using each close's own FX. No historical FX substitution. */
export function evaluateHoldingPolicyHistory(input: HoldingPolicyHistoryInput): HoldingPolicyEvaluation {
  const { policy, bars, expectedSession, fxForDate } = input;
  let armedOn = policy.armedOn;
  if (policy.mode === 'turtle-after-cost' && !armedOn && policy.startedOn && expectedSession) {
    for (const bar of bars) {
      if (bar.date < policy.startedOn || bar.date > expectedSession) continue;
      const day = evaluateHoldingPolicy({ ...input, close: bar.close, fxRate: fxForDate(bar.date),
        sessionDate: bar.date, expectedSession: bar.date });
      if (day.armedOn) { armedOn = day.armedOn; break; }
    }
  }
  const last = bars.at(-1);
  return evaluateHoldingPolicy({ ...input, policy: { ...policy, armedOn }, close: last?.close ?? null,
    sessionDate: last?.date ?? null, fxRate: last ? fxForDate(last.date) : null });
}
