// types/turtleHoldingsActions.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" 저장 액션 I/O 계약 (계획서 PLAN_터틀중심_앱재정비_260925 §6 P2 2-2).
//
// 실제 체결과 터틀 상태는 검증을 마친 뒤 같은 커밋으로 저장한다.
//   recordTurtleSell → 전량 매도할 때만 개인 운용 방침에 따라 감시·포지션을 함께 변경
//   recordTurtleBuy  → addAsset/confirmBuyMore가 매수와 포지션 변경을 함께 반영
//   recordTurtleHold → 사유 필수, 순수 기록(돈 이동 없음)
// 구현은 contexts/PortfolioContext.tsx.

import type { Currency, Asset } from './index';
import type { WatchlistItem } from './index';
import type { TurtlePosition } from './turtle';
import type { PortfolioSaveSnapshot } from './portfolioSave';

/** 시세 조회 뒤 최신 잔고에서 검증한다. 실패하면 매수 원장도 쓰지 않는다. */
export type LinkTurtleBuy = (snapshot: PortfolioSaveSnapshot, asset: Asset) =>
  { ok: true; positions: TurtlePosition[] } | { ok: false; reason: string };

export interface HoldingSaleOutcome {
  watchItemId: string | null;
  isNewWatchItem: boolean;
  closedPositionId: string | null;
}

export interface HoldingSaleTransition extends HoldingSaleOutcome {
  watchlist: WatchlistItem[];
  turtlePositions: TurtlePosition[];
}

export interface RecordTurtleSellInput {
  assetId: string;
  sellQuantity: number;
  /** 결제 통화 기준 단가(confirmSell과 동일 인자) */
  sellPrice: number;
  sellDate: string;
  settlementCurrency?: Currency;
  /** 방침 미지정 자산의 전량 매도 체크박스. 명시 방침은 이 입력에 우선한다. */
  addToWatchlist: boolean;
}

export type RecordTurtleSellOutcome =
  | {
      ok: true;
      sellRecordId: string;
      /** 매도 결과 그대로 노출(SellAssetModal의 매매 계획 연동 등 기존 호출부가 그대로 재사용) */
      assetClosed: boolean;
      updatedAsset?: Asset;
      watchItemId: string | null;
      isNewWatchItem: boolean;
      closedPositionId: string | null;
    }
  | { ok: false; reason?: string };

export type RecordTurtleBuyInput =
  | {
      mode: 'reentry';
      watchItemId: string;
      ticker: string;
      exchange: string;
      name: string;
      categoryId: number;
      currency: Currency;
      fillDate: string;
      fillPrice: number;
      quantity: number;
      nAtFill: number;
      fxRate?: number;
      /** 재진입 근거 스냅샷(돌파한 entryLookback일 최고가, 원통화) */
      donchianHigh: number;
    }
  | {
      mode: 'pyramid';
      assetId: string;
      positionId: string;
      fillDate: string;
      fillPrice: number;
      quantity: number;
      nAtFill: number;
      fxRate?: number;
    };

export type RecordTurtleBuyOutcome =
  | { ok: true; assetId: string; positionId: string }
  | { ok: false; reason?: string };

export type RecordTurtleHoldOutcome =
  | { ok: true }
  | { ok: false; reason: 'reason-required' | 'asset-not-found' };
