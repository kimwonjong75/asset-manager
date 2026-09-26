// utils/notifyManifest.ts
// ---------------------------------------------------------------------------
// 카카오톡 알림(GAS)에 보낼 "활성 계획 매니페스트" 조립 — 순수 함수.
// 앱은 이 매니페스트를 hooks/useKakaoNotify → services/notifySyncService.syncManifest 로
// GAS 웹앱에 push한다(P5, 계획서 §6.1). GAS 쪽은 이 파일의 **함수를 실행하지 않는다**
// (앱 전용 조립 로직) — 필요하면 타입만 `import type`으로 참조한다(esbuild가 type-only
// import를 파싱 단계에서 완전히 제거하므로 GAS 번들에 영향이 없다 — scripts/notify/build-gas.mjs
// 검증 시 실측 확인).
//
// 대상 필터: tradePlan.status==='active' && CASH 아님 && owner!=='YUSEON'(옵션으로 포함 가능).
// 통화 규약(D6): 가격은 TradePlan 내부에 이미 원통화로 저장돼 있다 — 여기서 환산하지 않는다.

import { Currency, normalizeExchange } from '../types';
import type { Asset, WatchlistItem } from '../types';
import { isBaseType } from '../types/category';
import type { TradePlan } from '../types/tradePlan';
import type { TurtlePosition } from '../types/turtle';
import type { TurtleHoldingsSettings } from '../types/turtleHoldings';
import { isEligibleForBulkPlan } from './tradePlan';
import { resolveHoldingsSettings, isInHoldingsScope } from './turtleHoldings';
import { todayInstrumentKey } from './todayTurtle';
import { marketIdForExchange } from './holdingMarkets';

export const NOTIFY_MANIFEST_VERSION = 1 as const;

export interface NotifyManifestItem {
  assetId: string;
  ticker: string;
  exchange: string;
  name: string;
  currency: Currency;
  quantity: number;
  plan: TradePlan;
}

// ── P4(2026-09-26) — "보유종목 터틀" 섹션(계획서 §4.5·§6 P4) ────────────────────
// 개인 정보(금액·수량 등)는 발송 문구 계산에 필요한 최소만 싣는다. 청산/재진입선은 절대
// 싣지 않는다 — GAS가 확정 종가로 매일 재계산한다(`utils/turtleHoldings.ts`를 그대로 재사용).

export interface NotifyManifestTurtleHolding {
  assetId: string;
  ticker: string;
  exchange: string;
  name: string;
  currency: Currency;
  isCrypto: boolean;
  quantity: number;
}

export interface NotifyManifestTurtleReentryUnit {
  fillPrice: number;
  quantity: number;
  nAtFill: number;
}

export interface NotifyManifestTurtleReentryPosition {
  positionId: string;
  assetId: string;
  ticker: string;
  exchange: string;
  name: string;
  currency: Currency;
  isCrypto: boolean;
  units: NotifyManifestTurtleReentryUnit[];
  /** 전체 유닛 합산 보유 수량(문구 표시용 — Σunits.quantity, 앱이 미리 더해 보낸다). */
  quantity: number;
  /** 공통 손절가(원통화) — 앱이 최신 계산값을 싣는다(GAS는 이 값을 그대로 비교만 한다). */
  stopPrice: number;
  /** ATR 추적 청산 전용 래칫 상태. 미사용/미보유면 null. */
  trailHighClose: number | null;
  /** 포지션 시작일(YYYY-MM-DD) — atrTrail 청산의 진입 인덱스 산정용. */
  openedAt: string;
}

export interface NotifyManifestTurtleWatch {
  watchItemId: string;
  ticker: string;
  exchange: string;
  name: string;
  currency: Currency;
  isCrypto: boolean;
}

export interface NotifyManifestTurtleSection {
  /** 병합·범위 가드까지 끝난 완성 설정(`resolveHoldingsSettings` 결과) — GAS는 그대로 쓰면 된다. */
  settings: TurtleHoldingsSettings;
  legacyHoldings: NotifyManifestTurtleHolding[];
  reentryPositions: NotifyManifestTurtleReentryPosition[];
  watchItems: NotifyManifestTurtleWatch[];
}

export interface NotifyManifest {
  version: 1;
  /** ISO — 매니페스트 조립 시각. */
  asOf: string;
  /** ISO — 마지막 변경 시각(현재 구현은 조립 시각과 동일; 향후 부분갱신을 대비해 필드 분리). */
  updatedAt: string;
  appUrl: string;
  /** 불타기 알림 발송 여부(GAS `pyramid-hit` 발송 게이트) — 기본 false. */
  pyramidAlerts: boolean;
  /**
   * 계획 없는 투더문(위성) 보유 종목 수(`isEligibleForBulkPlan` 기준) — GAS는 활성 계획이 있는
   * 자산만 담긴 `items`밖에 모르므로, 일일 요약(`formatKakaoDigest`의 `planless`)이 정확하려면
   * 앱이 이 카운트를 미리 계산해 실어 보내야 한다.
   */
  planlessCount: number;
  items: NotifyManifestItem[];
  /**
   * P4(2026-09-26) — "보유종목 터틀" 섹션. optional인 이유: 이 필드 도입 이전에 저장된 매니페스트
   * (GAS Drive 파일에 캐시된 옛 JSON)에는 실제로 값이 없을 수 있다 — GAS는 항상 `manifest.turtle?.`로
   * 접근해야 한다(사용자가 재동기화하면 항상 채워진다).
   */
  turtle?: NotifyManifestTurtleSection;
}

export interface BuildNotifyManifestInput {
  assets: Asset[];
  appUrl: string;
  /** ISO 시각 — 순수 함수라 주입한다(Date.now 금지). */
  now: string;
  /** 유선(가족) 자산도 포함할지. 기본 false — owner 축 규약(RULES: 유선=전략 상시 제외)과 동일. */
  includeYuseon?: boolean;
  pyramidAlerts: boolean;
  /** P4 — "보유종목 터틀" 감시 명단(isTurtleCandidate 항목만 추린다). 미지정=빈 배열(터틀 섹션 빈 목록). */
  watchlist?: WatchlistItem[];
  /** P4 — 오픈 포지션(origin==='holdings-reentry' && status==='open'만 추린다). 미지정=빈 배열. */
  turtlePositions?: TurtlePosition[];
  /** P4 — 저장된 원본 설정(부분/손상 허용, `resolveHoldingsSettings`가 병합·가드). 미지정=전부 기본값. */
  turtleHoldingsSettings?: Partial<TurtleHoldingsSettings> | null;
}

/**
 * "보유종목 터틀" 섹션 조립(P4) — 가족(유선) 제외는 `resolveHoldingsSettings().excludeFamilyOwner`
 * (터틀 설정 축)로 판정한다. TradePlan 섹션의 `includeYuseon`(레거시 옵션)과는 별개다.
 */
function buildTurtleSection(input: BuildNotifyManifestInput): NotifyManifestTurtleSection {
  const settings = resolveHoldingsSettings(input.turtleHoldingsSettings);
  const assetById = new Map(input.assets.map(a => [a.id, a] as const));
  const watchlist = input.watchlist ?? [];
  const turtlePositions = input.turtlePositions ?? [];

  const openReentryPositions = turtlePositions.filter(
    p => p.origin === 'holdings-reentry' && p.status === 'open',
  );
  const reentryAssetIds = new Set(
    openReentryPositions.map(p => p.assetId).filter((x): x is string => typeof x === 'string'),
  );

  const legacyHoldings: NotifyManifestTurtleHolding[] = input.assets
    .filter(a => !isBaseType(a.categoryId, 'CASH'))
    .filter(a => a.quantity > 0)
    .filter(a => !reentryAssetIds.has(a.id))
    .filter(a => isInHoldingsScope(a, settings))
    .map(a => ({
      assetId: a.id,
      ticker: a.ticker,
      exchange: a.exchange,
      name: a.customName ?? a.name,
      currency: a.currency,
      isCrypto: marketIdForExchange(a.exchange) === 'CRYPTO',
      quantity: a.quantity,
    }));

  const reentryPositions: NotifyManifestTurtleReentryPosition[] = [];
  for (const p of openReentryPositions) {
    const asset = p.assetId ? assetById.get(p.assetId) : undefined;
    if (!asset) continue; // 자산 연결이 끊긴 포지션 — 통화/거래소를 알 수 없어 판정 불가, 건너뜀
    if (!isInHoldingsScope(asset, settings)) continue;
    reentryPositions.push({
      positionId: p.id,
      assetId: asset.id,
      ticker: p.ticker,
      exchange: asset.exchange,
      name: asset.customName ?? asset.name,
      currency: asset.currency,
      isCrypto: marketIdForExchange(asset.exchange) === 'CRYPTO',
      units: p.units.map(u => ({ fillPrice: u.fillPrice, quantity: u.quantity, nAtFill: u.nAtFill })),
      quantity: p.units.reduce((sum, u) => sum + u.quantity, 0),
      stopPrice: p.stopPrice,
      trailHighClose: p.trailHighClose ?? null,
      openedAt: p.openedAt,
    });
  }

  // 이미 보유/재매수 중인 종목은 감시 후보에서 뺀다(중복 매수 방지 — turtleHoldingsView의
  // heldTickerKeys 관례와 동일).
  const heldKeys = new Set<string>([
    ...legacyHoldings.map(h => todayInstrumentKey(h.ticker, h.exchange, normalizeExchange)),
    ...reentryPositions.map(h => todayInstrumentKey(h.ticker, h.exchange, normalizeExchange)),
  ]);

  const watchItems: NotifyManifestTurtleWatch[] = watchlist
    .filter(w => w.isTurtleCandidate === true)
    .filter(w => isInHoldingsScope({ id: w.id, categoryId: w.categoryId }, settings))
    .filter(w => !heldKeys.has(todayInstrumentKey(w.ticker, w.exchange, normalizeExchange)))
    .map(w => ({
      watchItemId: w.id,
      ticker: w.ticker,
      exchange: w.exchange,
      name: w.name,
      currency: w.currency ?? Currency.KRW,
      isCrypto: marketIdForExchange(w.exchange) === 'CRYPTO',
    }));

  return { settings, legacyHoldings, reentryPositions, watchItems };
}

function isEligibleForNotify(asset: Asset, includeYuseon: boolean): boolean {
  if (!asset.tradePlan || asset.tradePlan.status !== 'active') return false;
  if (isBaseType(asset.categoryId, 'CASH')) return false;
  if (!includeYuseon && (asset.owner ?? 'WONJONG') === 'YUSEON') return false;
  return true;
}

/** 활성 계획 → GAS 발신용 매니페스트. 계획 없는 자산·현금·유선(기본)은 제외한다. */
export function buildNotifyManifest(input: BuildNotifyManifestInput): NotifyManifest {
  const includeYuseon = input.includeYuseon ?? false;
  const items: NotifyManifestItem[] = input.assets
    .filter(a => isEligibleForNotify(a, includeYuseon))
    .map(a => ({
      assetId: a.id,
      ticker: a.ticker,
      exchange: a.exchange,
      name: a.customName ?? a.name,
      currency: a.currency,
      quantity: a.quantity,
      plan: a.tradePlan as TradePlan,
    }));
  const planlessCount = input.assets.filter(a => isEligibleForBulkPlan(a)).length;
  const turtle = buildTurtleSection(input);
  return {
    version: NOTIFY_MANIFEST_VERSION,
    asOf: input.now,
    updatedAt: input.now,
    appUrl: input.appUrl,
    pyramidAlerts: input.pyramidAlerts,
    planlessCount,
    items,
    turtle,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 안정 해시 (변경 감지 전용 — 암호학적 용도 아님)
// ═══════════════════════════════════════════════════════════════════════════

/** 객체 키를 재귀적으로 정렬한 JSON 문자열 — 필드 순서가 달라도 같은 내용이면 같은 문자열. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * manifest → 32비트 해시 문자열(FNV-1a). `hooks/useKakaoNotify`의 `needsSync` 배지가 쓴다.
 * **`asOf`/`updatedAt`은 해시에서 제외한다** — 매 렌더마다 다시 조립되며 시각이 바뀌므로,
 * 시각까지 해시에 넣으면 계획 내용이 그대로여도 매번 "동기화 필요"가 떠 배지가 무의미해진다.
 * (스펙 §6.1 "manifestHash(manifest)"의 구현상 필연적 선택 — 목적인 "동기화 필요 배지"를
 * 성립시키려면 시각 필드를 빼야 한다. 최종 보고서에 명시.)
 */
export function manifestHash(manifest: NotifyManifest): string {
  const stable = {
    appUrl: manifest.appUrl,
    pyramidAlerts: manifest.pyramidAlerts,
    planlessCount: manifest.planlessCount,
    items: manifest.items,
    // P4 — turtle 섹션에는 시각 필드가 없으므로 그대로 포함해도 무방(needsSync가 실제 내용 변화만 잡는다).
    turtle: manifest.turtle ?? null,
  };
  const s = stableStringify(stable);
  let h = 0x811c9dc5; // FNV-1a 32bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
