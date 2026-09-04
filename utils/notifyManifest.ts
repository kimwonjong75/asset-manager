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

import type { Asset, Currency } from '../types';
import { isBaseType } from '../types/category';
import type { TradePlan } from '../types/tradePlan';
import { isEligibleForBulkPlan } from './tradePlan';

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
}

export interface BuildNotifyManifestInput {
  assets: Asset[];
  appUrl: string;
  /** ISO 시각 — 순수 함수라 주입한다(Date.now 금지). */
  now: string;
  /** 유선(가족) 자산도 포함할지. 기본 false — owner 축 규약(RULES: 유선=전략 상시 제외)과 동일. */
  includeYuseon?: boolean;
  pyramidAlerts: boolean;
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
  return {
    version: NOTIFY_MANIFEST_VERSION,
    asOf: input.now,
    updatedAt: input.now,
    appUrl: input.appUrl,
    pyramidAlerts: input.pyramidAlerts,
    planlessCount,
    items,
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
  };
  const s = stableStringify(stable);
  let h = 0x811c9dc5; // FNV-1a 32bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
