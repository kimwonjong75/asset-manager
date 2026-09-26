// types/turtleHoldingsActions.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" 저장 액션 I/O 계약 (계획서 PLAN_터틀중심_앱재정비_260925 §6 P2 2-2).
//
// 이 세 액션은 전부 "돈 기록이 먼저 성공한 뒤에만" 터틀 상태를 커밋한다(§5 안전 원칙 2·3):
//   recordTurtleSell → confirmSell 성공 후에만 recordTurtleExit(watchlist+turtlePositions 단일 커밋)
//   recordTurtleBuy  → addAsset/confirmBuyMore 성공 후에만 recordTurtleReentry/recordTurtlePyramid
//   recordTurtleHold → 사유 필수, 순수 기록(돈 이동 없음)
// 구현은 contexts/PortfolioContext.tsx.

import type { Currency, Asset } from './index';

export interface RecordTurtleSellInput {
  assetId: string;
  sellQuantity: number;
  /** 결제 통화 기준 단가(confirmSell과 동일 인자) */
  sellPrice: number;
  sellDate: string;
  settlementCurrency?: Currency;
  /** "다시 살 때 감시 명단"에 추가할지 — 매도 모달 체크박스(기본 켬) */
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
