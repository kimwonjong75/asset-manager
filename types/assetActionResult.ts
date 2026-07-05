// types/assetActionResult.ts
// ---------------------------------------------------------------------------
// 자산 액션(매수/추가매수/매도)의 구조화 결과 (Phase 2b-4b-2b).
// 기존 핸들러는 Promise<void>였고 에러를 내부 catch·id를 내부 생성해 반환하지 않아,
// 호출부가 성공/실패도 생성 id도 알 수 없었다. 90/10 실행 큐가 "저장 성공 이후에만"
// 포지션 lifecycle을 돌리려면 성공 신호 + 생성 id가 필요하다.
//
// 후방호환: 반환 타입만 void → 결과 객체로 확장. 기존 호출부는 반환을 무시하므로 동작 불변.
// ok:false에는 디버깅용 reason(내부 사유 코드)을 실을 수 있다. UI 에러 표시는 핸들러가 기존대로 수행.

import type { Asset, SellRecord } from './index';

export type AddAssetResult =
  | { ok: true; assetId: string; asset: Asset }
  | { ok: false; reason?: string };

export type SellResult =
  | { ok: true; sellRecordId: string; sellRecord: SellRecord; assetClosed: boolean; updatedAsset?: Asset }
  | { ok: false; reason?: string };

export type BuyMoreResult =
  | { ok: true; assetId: string; updatedAsset: Asset }
  | { ok: false; reason?: string };
