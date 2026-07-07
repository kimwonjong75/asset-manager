// utils/bulkAssetOps.ts
// ---------------------------------------------------------------------------
// 포트폴리오 테이블 "일괄 변경" 순수 계산 — 선택 자산의 계정/버킷 일괄 패치 + 터틀 후보 일괄 등록.
// side effect·Date 없음(id는 makeId 주입). 저장은 호출부가 commitPortfolioPatch로 수행.
//
// 터틀 후보 등록 규칙 (대청소 buildCleanupCommit의 turtle 분기와 동일 규약):
//   · 유선(owner='YUSEON') 자산은 **기본 스킵** — 터틀 적용 여부가 사용자 본인 의사가 아닌 자산 보호.
//   · 자산 버킷을 SATELLITE로 전환 + 관심종목에 같은 ticker+거래소 있으면 isTurtleCandidate만 갱신,
//     없으면 자산 메타로 신규 등록(priceOriginal 없으면 실행 큐 진입은 시세 갱신 후).
//   · 기존 보유분을 터틀 포지션으로 만들지 않음(TurtlePosition 무접촉).

import { Asset, WatchlistItem, normalizeExchange } from '../types';
import { BucketId } from '../types/bucket';
import { OwnerId, isStrategyManaged } from '../types/owner';

export interface BulkAssetPatch {
  bucket?: BucketId;
  owner?: OwnerId;
}

export interface BulkPatchResult {
  assets: Asset[];
  /** 실제로 값이 바뀐 자산 수 (이미 같은 값이면 미포함) */
  changedCount: number;
}

/**
 * 선택 자산에만 patch를 적용해 다음 assets 배열을 만든다 (순수·불변).
 * 이미 같은 값인 자산은 참조 그대로 통과(불필요한 재렌더/저장 diff 최소화).
 */
export function applyBulkAssetPatch(
  assets: Asset[],
  selectedIds: Set<string>,
  patch: BulkAssetPatch,
): BulkPatchResult {
  let changedCount = 0;
  const next = assets.map(a => {
    if (!selectedIds.has(a.id)) return a;
    const bucketChanged = patch.bucket !== undefined && (a.bucket ?? 'CORE') !== patch.bucket;
    const ownerChanged = patch.owner !== undefined && (a.owner ?? 'WONJONG') !== patch.owner;
    if (!bucketChanged && !ownerChanged) return a;
    changedCount++;
    return {
      ...a,
      ...(patch.bucket !== undefined ? { bucket: patch.bucket } : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
    };
  });
  return { assets: next, changedCount };
}

export interface TurtleRegistrationResult {
  assets: Asset[];
  watchlist: WatchlistItem[];
  /** 버킷 SATELLITE 전환 + 후보 등록된 자산 수 */
  registeredCount: number;
  /** 유선(가족) 계정이라 스킵된 자산 표시명 */
  skippedFamily: string[];
}

/**
 * 선택 자산을 터틀 후보로 일괄 등록 — assets(버킷 SATELLITE) + watchlist(isTurtleCandidate) 동시 계산 (순수).
 * 유선 자산은 스킵하고 skippedFamily로 보고. 저장은 호출부가 commitPortfolioPatch({assets, watchlist})로.
 */
export function buildTurtleCandidateRegistration(
  assets: Asset[],
  selectedIds: Set<string>,
  opts: { makeId: (seq: number) => string },
  watchlist: WatchlistItem[],
): TurtleRegistrationResult {
  const targets: Asset[] = [];
  const skippedFamily: string[] = [];
  for (const a of assets) {
    if (!selectedIds.has(a.id)) continue;
    if (!isStrategyManaged(a)) {
      skippedFamily.push(a.customName?.trim() || a.name);
      continue;
    }
    targets.push(a);
  }

  const targetIds = new Set(targets.map(a => a.id));
  const nextAssets = assets.map(a =>
    targetIds.has(a.id) && (a.bucket ?? 'CORE') !== 'SATELLITE' ? { ...a, bucket: 'SATELLITE' as const } : a,
  );

  let nextWatchlist = watchlist;
  let seq = 0;
  for (const a of targets) {
    const idx = nextWatchlist.findIndex(
      w => w.ticker.toUpperCase() === a.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(a.exchange),
    );
    if (idx >= 0) {
      if (!nextWatchlist[idx].isTurtleCandidate) {
        nextWatchlist = nextWatchlist.map((w, i) => (i === idx ? { ...w, isTurtleCandidate: true } : w));
      }
      // 이미 후보면 no-op
    } else {
      const item: WatchlistItem = {
        id: opts.makeId(seq++),
        ticker: a.ticker,
        exchange: a.exchange,
        name: a.name,
        categoryId: a.categoryId,
        currency: a.currency,
        priceOriginal: a.priceOriginal > 0 ? a.priceOriginal : undefined,
        isTurtleCandidate: true,
      };
      nextWatchlist = [...nextWatchlist, item];
    }
  }

  return { assets: nextAssets, watchlist: nextWatchlist, registeredCount: targets.length, skippedFamily };
}
