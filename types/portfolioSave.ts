// types/portfolioSave.ts
// ---------------------------------------------------------------------------
// 포트폴리오 저장 경로의 **단일 계약**. 예전에는 `usePortfolioData.triggerAutoSave` 와
// `useGoogleDriveSync.autoSave` 가 각각 12개 위치 인자를 받았고, 호출부(47곳)가
// `undefined` 를 4개씩 늘어놓아 순서를 하나만 어긋나도 **엉뚱한 도메인에 저장**될 수 있었다.
//
// 두 축을 구분한다:
//   · Snapshot — Drive 에 실제로 쓰는 **완전한** 전 도메인 상태. 부분 저장은 없다.
//   · Patch    — 호출부가 "이번에 바뀐 것"만 밝히는 부분 집합.
//
// ⚠️ Patch 는 "생략하면 안 바뀐다"는 뜻이 **아니다**. Drive 저장은 항상 전체 스냅샷이므로
//    생략된 도메인은 저장 직전에 **그 시점 최신 스냅샷**으로 채워진다. 따라서 채우는 쪽이
//    렌더 클로저가 아니라 동기 갱신되는 최신 소스를 봐야 한다
//    (`usePortfolioData` 의 snapshotRef — 같은 틱 연속 저장 시 앞선 변경 유실 방지).
// ---------------------------------------------------------------------------

import type {
  Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets,
} from './index';
import type { CategoryStore } from './category';
import type { KnowledgeBase } from './knowledge';
import type { ActionItem } from './actionQueue';
import type { TurtlePosition, TurtleSettings } from './turtle';

/**
 * Drive 에 저장되는 전 도메인 상태. **모든 필드 필수** — 부분 저장이 존재하지 않음을
 * 타입으로 못박아, 빠뜨린 도메인이 조용히 undefined 로 나가는 일을 막는다.
 *
 * 여기 없는 저장 필드(`columnConfig`/`tableLayout`/`alertSettings`)는 UI 환경설정·알림 규칙으로
 * `useGoogleDriveSync.autoSave` 가 localStorage 에서 직접 읽어 payload 에 덧붙인다.
 * **인자 밖의 숨은 입력이므로 위치를 여기 명시해 둔다** — 소유권 이전은 별도 단계(5-B).
 */
export interface PortfolioSaveSnapshot {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  sellAlertDropRate: number;
  categoryStore: CategoryStore;
  knowledgeBase: KnowledgeBase;
  actionQueue: ActionItem[];
  turtlePositions: TurtlePosition[];
  turtleSettings: TurtleSettings;
}

/** 호출부가 넘기는 "이번에 바뀐 도메인"만. 생략분은 최신 스냅샷에서 채워진다. */
export type PortfolioSavePatch = Partial<PortfolioSaveSnapshot>;

/** 스냅샷의 도메인 키 — 병합 함수와 테스트가 공유하는 단일 목록 */
export const PORTFOLIO_SAVE_DOMAINS = [
  'assets', 'portfolioHistory', 'sellHistory', 'watchlist', 'exchangeRates',
  'allocationTargets', 'sellAlertDropRate', 'categoryStore', 'knowledgeBase',
  'actionQueue', 'turtlePositions', 'turtleSettings',
] as const satisfies readonly (keyof PortfolioSaveSnapshot)[];

/**
 * base 위에 patch 를 얹어 완전한 스냅샷을 만든다.
 *
 * **`undefined` 인 키만 base 값을 쓴다** — truthy 검사(`||`)를 쓰면 `0`(sellAlertDropRate)이나
 * 빈 배열이 "값 없음"으로 오인될 수 있다. 예전 `triggerAutoSave` 는 `||` 와 `??` 가 섞여 있었다.
 *
 * 순수 함수(입력 불변) — 회귀 테스트가 직접 호출한다.
 */
export function mergeSaveSnapshot(
  base: PortfolioSaveSnapshot,
  patch: PortfolioSavePatch,
): PortfolioSaveSnapshot {
  const next = { ...base };
  for (const key of PORTFOLIO_SAVE_DOMAINS) {
    const value = patch[key];
    if (value !== undefined) {
      // 키별 타입이 서로 달라 인덱스 대입은 제네릭으로 좁혀지지 않는다.
      // PORTFOLIO_SAVE_DOMAINS 가 keyof 로 고정돼 있어 키 자체는 안전하다.
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}
