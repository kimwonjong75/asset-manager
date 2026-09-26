// utils/turtleHoldingsState.ts
// ---------------------------------------------------------------------------
// P1 — "보유종목 터틀" 순수 상태 전이 (계획서 PLAN_터틀중심_앱재정비_260925.md §6 P1, 2026-09-26 승인 범위).
//
// 이 파일은 계산만 한다 — 저장(commitPortfolio)·모달 연결·UI 배선은 P2. 호출부(P2)가 사용자의 명시적
// 버튼 행동(팔았음 기록/샀음 기록/보류) 뒤에서 이 함수들의 결과를 `commitPortfolio(patch)` 한 번으로
// 커밋한다(RULES §6-S 단일 저장 경로, CLAUDE.md "보이지 않는 쓰기 금지").
//
// 안전 원칙:
//   · 순수 함수만 — side effect·console·any 금지. 입력은 절대 변경하지 않고 항상 새 객체/배열을 반환한다.
//   · fail-closed — 잘못된 입력(수량≤0·가격≤0·N≤0·사유 없음·유닛 한도 초과)은 값을 지어내지 않고
//     `{ ok: false, reason }`을 반환한다(throw 없음 — 화면이 깨지면 안 된다).
//   · "실제 체결값 기준" — 매개변수 이름에 refPrice(이론적 기준가)를 쓰지 않는다. fillPrice/soldPriceOriginal만.
//   · 드로다운 감쇄(계좌 축소)는 **이 파일이 모른다** — `computeFirstUnitSize`/`computePyramidUnitSize`
//     (utils/turtleHoldings.ts)에 넘길 managedEquityKRW는 **호출부가 `applyDrawdownScaling` 적용 후** 값을
//     넘겨야 한다(P0 §6 체크 항목). 이 파일의 함수들은 이미 정해진 체결가·수량을 그대로 기록만 한다(재사이징 안 함).
//   · 손절가는 항상 **상향만**(래칫) — `recordTurtlePyramid`가 `Math.max(기존 손절가, 새로 계산된 손절가)`로
//     하향을 방지한다(입력 오류로 새 체결가가 이전보다 낮게 들어와도 손절선이 후퇴하지 않는다).

import { WatchlistItem, Asset, normalizeExchange } from '../types';
import { TurtlePosition, TurtleUnit, TurtleExitReason } from '../types/turtle';
import {
  TurtleHoldingsSettings,
  TurtleHoldingsWatchEntry,
  TurtleHoldDecision,
  TURTLE_HOLD_DECISIONS_CAP,
} from '../types/turtleHoldings';

function isPosNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 매도 기록 → "다시 살 때 감시" 명단 등록 + (재매수분이면) 포지션 종료
// ════════════════════════════════════════════════════════════════════════════

/** 감시 등록에 필요한 자산 메타(신규 관심종목 생성 시 채워짐). */
export interface TurtleExitAssetRef {
  ticker: string;
  exchange: string;
  name: string;
  categoryId: number;
  currency?: Asset['currency'];
}

export interface RecordTurtleExitInput {
  asset: TurtleExitAssetRef;
  /** 매도 체결일 — YYYY-MM-DD, 실제 체결값 */
  soldAt: string;
  /** 매도 체결가 — 원통화(priceOriginal), 실제 체결값(refPrice 금지) */
  soldPriceOriginal: number;
  /** 감시 등록 계기. 기본 'turtle-exit'(청산선 이탈로 자동 등록). */
  source?: 'turtle-exit' | 'manual';
  watchlist: readonly WatchlistItem[];
  /** 이 매도로 종료할 재매수 포지션 — 원래 보유분 매도(재매수 이력 없음)면 undefined. */
  position?: TurtlePosition | null;
  /** 종료 사유(position이 있을 때만 사용). */
  exitReason?: TurtleExitReason;
  /** 신규 관심종목 등록 시에만 호출되는 id 생성기(dedup 매칭되면 호출 안 함). */
  makeWatchId: () => string;
}

export interface RecordTurtleExitResult {
  ok: true;
  watchlist: WatchlistItem[];
  watchItemId: string;
  isNewWatchItem: boolean;
  /** 종료된 포지션. 입력에 position이 없었으면 null(종료할 것이 없음 — 정상). */
  closedPosition: TurtlePosition | null;
}
export interface RecordTurtleExitRejected {
  ok: false;
  reason: 'invalid-sold-price';
}

/**
 * 매도 체결 성공 → ① watchlist에 "다시 살 때 감시" 등록(기존 항목 있으면 필드만 갱신 — dedup은
 * ticker 대소문자 무시 + `normalizeExchange` 비교, `utils/cleanupPlan.buildCleanupCommit`과 동일 관례),
 * ② position이 주어졌으면(재매수분 매도) 그 포지션을 closed로 종료.
 */
export function recordTurtleExit(
  input: RecordTurtleExitInput,
): RecordTurtleExitResult | RecordTurtleExitRejected {
  if (!isPosNum(input.soldPriceOriginal)) return { ok: false, reason: 'invalid-sold-price' };

  const { asset } = input;
  const source = input.source ?? 'turtle-exit';
  const watchEntry: TurtleHoldingsWatchEntry = {
    soldAt: input.soldAt,
    soldPriceOriginal: input.soldPriceOriginal,
    source,
  };

  const idx = input.watchlist.findIndex(
    w => w.ticker.toUpperCase() === asset.ticker.toUpperCase()
      && normalizeExchange(w.exchange) === normalizeExchange(asset.exchange),
  );

  let watchlist: WatchlistItem[];
  let watchItemId: string;
  let isNewWatchItem: boolean;
  if (idx >= 0) {
    watchItemId = input.watchlist[idx].id;
    isNewWatchItem = false;
    watchlist = input.watchlist.map((w, i) => (
      i === idx ? { ...w, isTurtleCandidate: true, turtleWatch: watchEntry } : w
    ));
  } else {
    watchItemId = input.makeWatchId();
    isNewWatchItem = true;
    const item: WatchlistItem = {
      id: watchItemId,
      ticker: asset.ticker,
      exchange: asset.exchange,
      name: asset.name,
      categoryId: asset.categoryId,
      currency: asset.currency,
      isTurtleCandidate: true,
      turtleWatch: watchEntry,
    };
    watchlist = [...input.watchlist, item];
  }

  const closedPosition: TurtlePosition | null = input.position
    ? { ...input.position, status: 'closed', closedAt: input.soldAt, exitReason: input.exitReason ?? 'channel-exit' }
    : null;

  return { ok: true, watchlist, watchItemId, isNewWatchItem, closedPosition };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 재매수 체결 → 신규 포지션 생성 (손절 = 체결가 − stopMultipleN×N)
// ════════════════════════════════════════════════════════════════════════════

export interface RecordTurtleReentryInput {
  /** 신규 포지션 id — 호출부 생성(makeId). */
  id: string;
  ticker: string;
  name: string;
  /** 실행으로 생성/연결된 Asset id. */
  assetId?: string;
  /** 실제 체결일 — YYYY-MM-DD */
  fillDate: string;
  /** 실제 체결가 — 원통화(priceOriginal), refPrice 금지 */
  fillPrice: number;
  /** 실제 체결 수량 */
  quantity: number;
  /** 체결 시점 N(20일 ATR, 원통화) */
  nAtFill: number;
  /** 체결 시 환율(KRW/종목통화, 감사용) */
  fxRate?: number;
  /** 재진입 근거 스냅샷 — 돌파한 entryLookback일 최고가(원통화) */
  donchianHigh: number;
  settings: TurtleHoldingsSettings;
}

export type RecordTurtleReentryRejectReason = 'invalid-fill' | 'invalid-n';

/** 재매수 체결 성공 → 신규 오픈 포지션(units[0], origin='holdings-reentry'). 입력 검증 실패는 사유 반환. */
export function recordTurtleReentry(
  input: RecordTurtleReentryInput,
): { ok: true; position: TurtlePosition } | { ok: false; reason: RecordTurtleReentryRejectReason } {
  if (!isPosNum(input.fillPrice) || !isPosNum(input.quantity)) return { ok: false, reason: 'invalid-fill' };
  if (!isPosNum(input.nAtFill)) return { ok: false, reason: 'invalid-n' };

  const unit: TurtleUnit = {
    fillDate: input.fillDate,
    fillPrice: input.fillPrice,
    quantity: input.quantity,
    nAtFill: input.nAtFill,
    fxRateAtFill: input.fxRate,
  };
  const stopPrice = input.fillPrice - input.settings.stopMultipleN * input.nAtFill;
  const position: TurtlePosition = {
    id: input.id,
    ticker: input.ticker,
    name: input.name,
    assetId: input.assetId,
    units: [unit],
    stopPrice,
    entryDonchianHigh: input.donchianHigh,
    status: 'open',
    openedAt: input.fillDate,
    origin: 'holdings-reentry',
    trailHighClose: input.fillPrice,
  };
  return { ok: true, position };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 불타기 체결 → 유닛 추가 + 공통 손절 상향 (maxUnitsPerPosition 가드)
// ════════════════════════════════════════════════════════════════════════════

export interface RecordTurtlePyramidFill {
  fillDate: string;
  fillPrice: number;
  quantity: number;
  nAtFill: number;
  fxRate?: number;
}

export type RecordTurtlePyramidRejectReason = 'invalid-fill' | 'invalid-n' | 'max-units-reached';

/**
 * 불타기 체결 성공 → 유닛 추가 + 손절가 재계산(마지막 체결가 − stopMultipleN×N, **상향만** — 하향 방지)
 * + `trailHighClose` 래칫 갱신. `position.units.length >= settings.maxUnitsPerPosition`이면 거부.
 */
export function recordTurtlePyramid(
  position: TurtlePosition,
  fill: RecordTurtlePyramidFill,
  settings: TurtleHoldingsSettings,
): { ok: true; position: TurtlePosition } | { ok: false; reason: RecordTurtlePyramidRejectReason } {
  if (position.units.length >= settings.maxUnitsPerPosition) return { ok: false, reason: 'max-units-reached' };
  if (!isPosNum(fill.fillPrice) || !isPosNum(fill.quantity)) return { ok: false, reason: 'invalid-fill' };
  if (!isPosNum(fill.nAtFill)) return { ok: false, reason: 'invalid-n' };

  const unit: TurtleUnit = {
    fillDate: fill.fillDate,
    fillPrice: fill.fillPrice,
    quantity: fill.quantity,
    nAtFill: fill.nAtFill,
    fxRateAtFill: fill.fxRate,
  };
  const computedStop = fill.fillPrice - settings.stopMultipleN * fill.nAtFill;
  const stopPrice = Math.max(position.stopPrice, computedStop);
  const trailHighClose = position.trailHighClose !== undefined
    ? Math.max(position.trailHighClose, fill.fillPrice)
    : fill.fillPrice;

  const next: TurtlePosition = {
    ...position,
    units: [...position.units, unit],
    stopPrice,
    trailHighClose,
  };
  return { ok: true, position: next };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 보류 결정 기록 + 연속 보류 횟수 파생
// ════════════════════════════════════════════════════════════════════════════

export interface RecordTurtleHoldInput {
  /** 자산의 기존 이력(`Asset.turtleDecisions`) — 없으면(구 저장본) undefined. */
  decisions: readonly TurtleHoldDecision[] | undefined;
  /** 결정일 — YYYY-MM-DD */
  date: string;
  /** 보류 사유 — 필수. 공백만 있는 문자열도 거부(trim 후 빈 문자열 검사). */
  reason: string;
}

export type RecordTurtleHoldRejectReason = 'reason-required';

/** 보류 기록 — 사유 없으면 거부. 최근 `TURTLE_HOLD_DECISIONS_CAP`개만 유지(오래된 것부터 버림). */
export function recordTurtleHold(
  input: RecordTurtleHoldInput,
): { ok: true; decisions: TurtleHoldDecision[] } | { ok: false; reason: RecordTurtleHoldRejectReason } {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'reason-required' };

  const entry: TurtleHoldDecision = { date: input.date, action: 'hold', reason };
  const prior = input.decisions ? [...input.decisions] : [];
  const next = [...prior, entry];
  const capped = next.length > TURTLE_HOLD_DECISIONS_CAP
    ? next.slice(next.length - TURTLE_HOLD_DECISIONS_CAP)
    : next;
  return { ok: true, decisions: capped };
}

/**
 * 연속 보류 횟수 — 이력 배열 끝에서부터 `action==='hold'`인 동안 센다(현재 action은 'hold'뿐이라
 * 사실상 전체 길이와 같지만, 향후 다른 action이 섞여도 안전하도록 "연속"을 실제로 계산한다).
 */
export function consecutiveHoldCount(decisions: readonly TurtleHoldDecision[] | undefined): number {
  if (!decisions || decisions.length === 0) return 0;
  let count = 0;
  for (let i = decisions.length - 1; i >= 0; i--) {
    if (decisions[i].action !== 'hold') break;
    count++;
  }
  return count;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 로드 방어 — 저장본이 손상돼도 값을 지어내지 않고 버린다(§6-S 정규화 함수 관례,
//    `resolveHoldingsSettings`와 동일한 "안전한 읽기 접근자" 패턴). 저장 파이프라인 자체(로더 3곳)는
//    수정하지 않는다 — 배열 캐스팅은 그대로 두고, 소비하는 쪽(P2)이 이 함수들을 거쳐 읽는다.
// ════════════════════════════════════════════════════════════════════════════

function isValidExitSource(v: unknown): v is 'turtle-exit' | 'manual' {
  return v === 'turtle-exit' || v === 'manual';
}

/** 저장본의 `WatchlistItem.turtleWatch`가 올바른 형태인지 검사 — 아니면 undefined(값을 지어내지 않음). */
export function sanitizeTurtleWatchEntry(raw: unknown): TurtleHoldingsWatchEntry | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<TurtleHoldingsWatchEntry>;
  if (typeof r.soldAt !== 'string' || !r.soldAt) return undefined;
  if (typeof r.soldPriceOriginal !== 'number' || !Number.isFinite(r.soldPriceOriginal) || r.soldPriceOriginal <= 0) return undefined;
  if (!isValidExitSource(r.source)) return undefined;
  return { soldAt: r.soldAt, soldPriceOriginal: r.soldPriceOriginal, source: r.source };
}

/**
 * 저장본의 `Asset.turtleDecisions`에서 유효한 항목만 남기고 최근 CAP개로 자른다(구조 손상 항목은
 * 조용히 제외). 필드 자체가 없으면(구 저장본) undefined를 그대로 돌려준다(기본값 강제 주입 금지).
 */
export function sanitizeTurtleHoldDecisions(raw: unknown): TurtleHoldDecision[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const valid: TurtleHoldDecision[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Partial<TurtleHoldDecision>;
    if (typeof d.date !== 'string' || !d.date) continue;
    if (d.action !== 'hold') continue;
    if (typeof d.reason !== 'string' || !d.reason.trim()) continue;
    valid.push({ date: d.date, action: 'hold', reason: d.reason });
  }
  return valid.length > TURTLE_HOLD_DECISIONS_CAP ? valid.slice(valid.length - TURTLE_HOLD_DECISIONS_CAP) : valid;
}

/**
 * P2(2026-09-26) — P1의 로드 방어를 실제 watchlist 로드 경로에 연결(`hooks/usePortfolioData.ts` 2곳)할 때
 * 쓰는 배열 단위 헬퍼. 각 항목의 `turtleWatch`만 `sanitizeTurtleWatchEntry`로 재검증한다.
 * `turtleWatch`가 애초에 없는 항목(대다수)은 **원본 참조를 그대로 유지**한다 — 매 로드마다 전체
 * watchlist를 새 객체로 복제하지 않는다. 손상값은 필드째 제거, 정상값은 검증된 사본으로 교체한다.
 */
export function sanitizeWatchlistTurtleFields<T extends { turtleWatch?: TurtleHoldingsWatchEntry }>(
  list: readonly T[],
): T[] {
  return list.map(w => {
    const sanitized = sanitizeTurtleWatchEntry(w.turtleWatch);
    if (sanitized === w.turtleWatch) return w;
    if (sanitized === undefined) {
      const clone = { ...w };
      delete clone.turtleWatch;
      return clone;
    }
    return { ...w, turtleWatch: sanitized };
  });
}
