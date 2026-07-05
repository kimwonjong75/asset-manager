// utils/actionQueueGenerator.ts
// ---------------------------------------------------------------------------
// 터틀 주문 생성기 (Phase 2a, 90/10, 순수 함수).
// 터틀 포지션·후보 종목 + "계산된 시장 입력"(N·돈치안·환율)을 받아 실행 큐에 넣을 ActionItem[]을 만든다.
//
// 설계 원칙:
//   · 순수: side effect·Date.now·랜덤 없음. 오늘 날짜와 id 생성기를 주입받는다(테스트 결정성).
//   · 데이터 소스 분리: OHLCV fetch·N/돈치안 계산은 호출부(Phase 2b 훅)가 하고, 여기는 규칙 판정만.
//   · 중복 방지: 같은 (kind,ticker)로 이미 대기 중(pending/snoozed)인 주문이 있으면 새로 만들지 않는다.
//   · 배치 예산 정합: 여러 진입 후보를 한 번에 평가할 때, 채택된 진입의 리스크·매수금액을 누적 반영해
//     12% 동시전멸 한도·예산 잔여를 초과하는 추가 진입을 차단한다(개별 통과했어도 합산 초과 방지).
//   · fail-closed: 시장 입력 없음(데이터 결손)·N 미산출·미돌파면 주문을 만들지 않는다.
//
// 통화 규약(D6): price/N/donchian은 종목 통화(원본), 금액 판정은 fxRate로 KRW 환산. 손절가는 원통화 저장.

import {
  TurtlePosition,
  TurtleSettings,
  TurtleUnit,
} from '../types/turtle';
import {
  ActionItem,
  ActionKind,
  isActiveAction,
  TurtleActionDiagnostics,
  TurtleEntryDiag,
  TurtlePositionDiag,
  TurtleEntryDiagReason,
} from '../types/actionQueue';
import {
  evaluateEntry,
  evaluatePyramid,
  evaluateStop,
  evaluateExit,
  computeTotalOpenRisk,
} from './turtleEngine';

/** 종목별 "계산된 시장 입력" — 호출부가 OHLCV로 미리 산출해 넘긴다. */
export interface TurtleMarketInput {
  ticker: string;
  name: string;
  price: number;                 // 현재가 (priceOriginal, 원통화)
  n: number | null;              // 20일 ATR (원통화). null이면 진입/피라미딩 fail-closed
  donchianHigh: number | null;   // entryLookback 최고가 (당일 제외, 원통화)
  donchianLow: number | null;    // exitLookback 최저가 (당일 제외, 원통화)
  fxRate: number;                // KRW/종목통화 (KRW=1)
  allowFractional?: boolean;     // 암호화폐 등 소수 수량
  dollarPerPoint?: number;       // 현물=1
}

/** 터틀 후보 (관심종목에서 터틀 후보로 표시된 것, 아직 포지션 아님). */
export interface TurtleCandidateRef {
  ticker: string;
  name: string;
}

export interface BuildTurtleActionsInput {
  positions: TurtlePosition[];             // 현재 터틀 포지션 (open/closed 혼재 허용)
  candidates: TurtleCandidateRef[];        // 진입 후보 (우선순위 순 — 예산 부족 시 앞선 것부터 채택)
  marketByTicker: Map<string, TurtleMarketInput>;
  settings: TurtleSettings;
  existingQueue: ActionItem[];             // 중복 방지 소스
  remainingBudgetKRW: number;              // 위성 예산 잔여 (배정 가능 현금)
  today: string;                           // YYYY-MM-DD (주입)
  makeId: (seq: number) => string;         // id 생성기 (주입)
}

/**
 * 터틀 규칙을 평가해 신규 ActionItem[]을 생성한다 (이미 대기 중인 것과 중복되지 않는 것만).
 * 우선순위: 오픈 포지션의 매도(손절>청산)·피라미딩을 먼저, 그다음 신규 진입 후보.
 */
export function buildTurtleActions(input: BuildTurtleActionsInput): ActionItem[] {
  const { positions, candidates, marketByTicker, settings, existingQueue, today, makeId } = input;

  const openPositions = positions.filter(p => p.status === 'open');
  const openTickers = new Set(openPositions.map(p => p.ticker));

  // 중복 방지: 이미 대기 중(pending/snoozed)인 주문.
  // 포지션 주문(stop/exit/pyramid)은 positionId까지 포함해 같은 티커의 다른 포지션을 구분한다.
  // 진입 후보는 positionId가 없으므로 (kind|ticker)로 판정.
  const activeKeys = new Set<string>();
  for (const item of existingQueue) {
    if (isActiveAction(item.status)) activeKeys.add(dedupKey(item.kind, item.ticker, item.positionId));
  }

  const resolveFx = (position: TurtlePosition): number => {
    const m = marketByTicker.get(position.ticker);
    if (m && m.fxRate > 0) return m.fxRate;
    const lastUnit: TurtleUnit | undefined = position.units[position.units.length - 1];
    return lastUnit?.fxRateAtFill && lastUnit.fxRateAtFill > 0 ? lastUnit.fxRateAtFill : 1;
  };

  const results: ActionItem[] = [];
  let seq = 0;
  const generatedKeys = new Set<string>();

  const canEmit = (kind: ActionKind, ticker: string, positionId?: string): boolean => {
    const key = dedupKey(kind, ticker, positionId);
    return !activeKeys.has(key) && !generatedKeys.has(key);
  };
  const push = (item: ActionItem): void => {
    generatedKeys.add(dedupKey(item.kind, item.ticker, item.positionId));
    results.push(item);
  };

  // ── 1. 오픈 포지션: 손절 > 청산 > 피라미딩 ──
  for (const pos of openPositions) {
    const m = marketByTicker.get(pos.ticker);
    if (!m) continue; // 데이터 결손 → 판정 불가, fail-closed

    const stop = evaluateStop(pos, m.price);
    const exit = stop ? null : evaluateExit(pos, m.donchianLow, m.price);

    if (stop && canEmit('TURTLE_STOP', pos.ticker, pos.id)) {
      push({
        id: makeId(seq++), createdDate: today, kind: 'TURTLE_STOP',
        ticker: pos.ticker, name: pos.name, positionId: pos.id,
        quantity: stop.quantity, refPrice: m.price,
        reasonText: `손절가 ${fmt(pos.stopPrice)} 도달 — 전량 매도 (예외 없음)`,
        ruleSnapshot: { stopPrice: pos.stopPrice, triggerPrice: stop.triggerPrice, price: m.price },
        status: 'pending',
      });
      continue; // 손절되면 이 포지션은 청산·피라미딩 평가 안 함
    }

    if (exit && canEmit('TURTLE_EXIT', pos.ticker, pos.id)) {
      push({
        id: makeId(seq++), createdDate: today, kind: 'TURTLE_EXIT',
        ticker: pos.ticker, name: pos.name, positionId: pos.id,
        quantity: exit.quantity, refPrice: m.price,
        reasonText: `${settings.exitLookback}일 최저가 ${fmt(exit.triggerPrice)} 이탈 — 전량 청산`,
        ruleSnapshot: { donchianLow: exit.triggerPrice, price: m.price },
        status: 'pending',
      });
      continue; // 청산되면 피라미딩 평가 안 함
    }

    // 피라미딩 (불타기) — 매도가 없을 때만
    const pyr = evaluatePyramid(pos, m.price, m.n, settings, {
      allowFractional: m.allowFractional, dollarPerPoint: m.dollarPerPoint, fxRate: m.fxRate,
    });
    if (pyr && pyr.quantity > 0 && canEmit('TURTLE_PYRAMID', pos.ticker, pos.id)) {
      push({
        id: makeId(seq++), createdDate: today, kind: 'TURTLE_PYRAMID',
        ticker: pos.ticker, name: pos.name, positionId: pos.id,
        quantity: pyr.quantity, refPrice: m.price,
        reasonText: `직전 체결가 +${settings.pyramidStepN}N 상승 — ${pyr.unitIndex + 1}유닛째 추가, 손절 ${fmt(pyr.newStopPrice)}로 상향`,
        ruleSnapshot: { newStopPrice: pyr.newStopPrice, n: pyr.nAtFill, price: m.price, unitIndex: pyr.unitIndex },
        status: 'pending',
      });
    }
  }

  // ── 2. 신규 진입 후보 (배치 예산·리스크 누적 반영) ──
  let runningOpenRiskKRW = computeTotalOpenRisk(openPositions, settings, resolveFx).riskKRW;
  let runningBudgetKRW = input.remainingBudgetKRW;

  for (const cand of candidates) {
    if (openTickers.has(cand.ticker)) continue; // 이미 보유 → 진입 아님(피라미딩 대상)
    const m = marketByTicker.get(cand.ticker);
    if (!m) continue;
    if (!canEmit('TURTLE_ENTRY', cand.ticker)) continue;

    const decision = evaluateEntry({
      ticker: cand.ticker, name: cand.name, price: m.price, n: m.n,
      donchianHigh: m.donchianHigh, settings,
      openRiskKRW: runningOpenRiskKRW, remainingBudgetKRW: runningBudgetKRW,
      fxRate: m.fxRate, allowFractional: m.allowFractional, dollarPerPoint: m.dollarPerPoint,
    });
    if (!decision.ok || !decision.proposal) continue;

    const p = decision.proposal;
    push({
      id: makeId(seq++), createdDate: today, kind: 'TURTLE_ENTRY',
      ticker: p.ticker, name: p.name,
      quantity: p.quantity, refPrice: p.refPrice,
      reasonText: `${settings.entryLookback}일 신고가 ${fmt(p.donchianHigh)} 돌파 · 손절 ${fmt(p.stopPrice)} · N ${fmt(p.nAtEntry)}`,
      ruleSnapshot: {
        donchianHigh: p.donchianHigh, stopPrice: p.stopPrice, n: p.nAtEntry,
        riskKRW: p.riskKRW, positionValueKRW: p.positionValueKRW, fxRate: p.fxRateUsed,
      },
      status: 'pending',
    });

    // 채택분 누적 → 이후 후보의 한도·예산 판정에 반영
    runningOpenRiskKRW += p.riskKRW;
    runningBudgetKRW -= p.positionValueKRW;
  }

  return results;
}

/**
 * "왜 주문이 안 생겼나" 진단 (Phase 2b-6, 순수·표시 전용).
 * **buildTurtleActions의 판정 순서·누적을 1:1로 미러링**하되 ActionItem을 만들지 않고 사유만 수집한다.
 * 생성 경로(buildTurtleActions)는 절대 건드리지 않는다 — 진단이 생성 동작에 영향 주지 않도록 완전 분리.
 * `generatedCount`는 buildTurtleActions(...).length와 동치여야 한다(테스트가 강제).
 */
export function diagnoseTurtleActions(input: Omit<BuildTurtleActionsInput, 'makeId'>): TurtleActionDiagnostics {
  const { positions, candidates, marketByTicker, settings, existingQueue } = input;

  const openPositions = positions.filter(p => p.status === 'open');
  const openTickers = new Set(openPositions.map(p => p.ticker));

  const activeKeys = new Set<string>();
  for (const item of existingQueue) {
    if (isActiveAction(item.status)) activeKeys.add(dedupKey(item.kind, item.ticker, item.positionId));
  }
  const generatedKeys = new Set<string>();
  const canEmit = (kind: ActionKind, ticker: string, positionId?: string): boolean => {
    const key = dedupKey(kind, ticker, positionId);
    return !activeKeys.has(key) && !generatedKeys.has(key);
  };
  const markGen = (kind: ActionKind, ticker: string, positionId?: string): void => {
    generatedKeys.add(dedupKey(kind, ticker, positionId));
  };

  const resolveFx = (position: TurtlePosition): number => {
    const m = marketByTicker.get(position.ticker);
    if (m && m.fxRate > 0) return m.fxRate;
    const lastUnit: TurtleUnit | undefined = position.units[position.units.length - 1];
    return lastUnit?.fxRateAtFill && lastUnit.fxRateAtFill > 0 ? lastUnit.fxRateAtFill : 1;
  };

  const positionDiags: TurtlePositionDiag[] = [];
  const candidateDiags: TurtleEntryDiag[] = [];
  let generatedCount = 0;

  // ── 1. 오픈 포지션: 손절 > 청산 > 피라미딩 (buildTurtleActions와 동일 순서) ──
  for (const pos of openPositions) {
    const base = { ticker: pos.ticker, name: pos.name, positionId: pos.id };
    const m = marketByTicker.get(pos.ticker);
    if (!m) { positionDiags.push({ ...base, reason: 'no-market' }); continue; }

    const stop = evaluateStop(pos, m.price);
    const exit = stop ? null : evaluateExit(pos, m.donchianLow, m.price);

    if (stop) {
      if (canEmit('TURTLE_STOP', pos.ticker, pos.id)) { markGen('TURTLE_STOP', pos.ticker, pos.id); generatedCount++; positionDiags.push({ ...base, reason: 'stop-generated' }); }
      else positionDiags.push({ ...base, reason: 'duplicate-pending' });
      continue;
    }
    if (exit) {
      if (canEmit('TURTLE_EXIT', pos.ticker, pos.id)) { markGen('TURTLE_EXIT', pos.ticker, pos.id); generatedCount++; positionDiags.push({ ...base, reason: 'exit-generated' }); }
      else positionDiags.push({ ...base, reason: 'duplicate-pending' });
      continue;
    }

    const pyr = evaluatePyramid(pos, m.price, m.n, settings, {
      allowFractional: m.allowFractional, dollarPerPoint: m.dollarPerPoint, fxRate: m.fxRate,
    });
    if (pyr && pyr.quantity > 0) {
      if (canEmit('TURTLE_PYRAMID', pos.ticker, pos.id)) { markGen('TURTLE_PYRAMID', pos.ticker, pos.id); generatedCount++; positionDiags.push({ ...base, reason: 'pyramid-generated' }); }
      else positionDiags.push({ ...base, reason: 'duplicate-pending' });
    } else {
      positionDiags.push({ ...base, reason: 'no-trigger' });
    }
  }

  // ── 2. 신규 진입 후보 (배치 예산·리스크 누적 동일) ──
  let runningOpenRiskKRW = computeTotalOpenRisk(openPositions, settings, resolveFx).riskKRW;
  let runningBudgetKRW = input.remainingBudgetKRW;

  for (const cand of candidates) {
    const base = { ticker: cand.ticker, name: cand.name };
    if (openTickers.has(cand.ticker)) { candidateDiags.push({ ...base, reason: 'already-open' }); continue; }
    const m = marketByTicker.get(cand.ticker);
    if (!m) { candidateDiags.push({ ...base, reason: 'no-market' }); continue; }
    if (!canEmit('TURTLE_ENTRY', cand.ticker)) { candidateDiags.push({ ...base, reason: 'duplicate-pending' }); continue; }

    const decision = evaluateEntry({
      ticker: cand.ticker, name: cand.name, price: m.price, n: m.n,
      donchianHigh: m.donchianHigh, settings,
      openRiskKRW: runningOpenRiskKRW, remainingBudgetKRW: runningBudgetKRW,
      fxRate: m.fxRate, allowFractional: m.allowFractional, dollarPerPoint: m.dollarPerPoint,
    });

    if (decision.ok && decision.proposal) {
      markGen('TURTLE_ENTRY', cand.ticker);
      generatedCount++;
      candidateDiags.push({ ...base, reason: 'generated' });
      runningOpenRiskKRW += decision.proposal.riskKRW;
      runningBudgetKRW -= decision.proposal.positionValueKRW;
    } else {
      candidateDiags.push({ ...base, reason: (decision.reason ?? 'no-breakout') as TurtleEntryDiagReason });
    }
  }

  return { positions: positionDiags, candidates: candidateDiags, generatedCount };
}

function dedupKey(kind: ActionKind, ticker: string, positionId?: string): string {
  return positionId ? `${kind}|${ticker}|${positionId}` : `${kind}|${ticker}`;
}

/** reasonText용 숫자 포맷 — 천단위 구분, 소수 2자리까지 (결정적, 로케일 고정). */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ── 큐 파생/에스컬레이션 헬퍼 (순수) ──

/** 생성일로부터 오늘까지 무시된 일수 (pending/snoozed만 의미). 음수면 0. */
export function actionDaysIgnored(item: ActionItem, today: string): number {
  return Math.max(0, daysBetween(item.createdDate, today));
}

/**
 * 에스컬레이션 레벨 — 3일+ 무시 또는 연속 스누즈 2회+면 강조.
 * 0=보통, 1=주의(3~6일 or 스누즈 2회), 2=경고(7일+ or 스누즈 3회+).
 */
export function actionEscalationLevel(item: ActionItem, today: string): 0 | 1 | 2 {
  if (!isActiveAction(item.status)) return 0;
  const days = actionDaysIgnored(item, today);
  const snoozes = item.snoozeCount ?? 0;
  if (days >= 7 || snoozes >= 3) return 2;
  if (days >= 3 || snoozes >= 2) return 1;
  return 0;
}

/** 스누즈 만료 여부 — snoozedUntil 이하가 today면 pending으로 되살릴 대상. */
export function isSnoozeExpired(item: ActionItem, today: string): boolean {
  if (item.status !== 'snoozed' || !item.snoozedUntil) return false;
  return item.snoozedUntil <= today;
}

/**
 * 기존 큐 + 신규 생성분 병합 (순수). 만료된 스누즈는 pending으로 되살리고, 신규 주문을 뒤에 추가한다.
 * done/skipped 이력은 그대로 보존(감사·기록). buildTurtleActions가 이미 활성 항목과 중복을 배제하므로
 * revived된 항목과 generated 사이에 중복은 생기지 않는다.
 */
export function reconcileActionQueue(existing: ActionItem[], generated: ActionItem[], today: string): ActionItem[] {
  const revived = existing.map(it =>
    isSnoozeExpired(it, today) ? { ...it, status: 'pending' as const, snoozedUntil: undefined } : it
  );
  return [...revived, ...generated];
}

/** YYYY-MM-DD 두 날짜 사이 일수 (b - a). UTC 기준 파싱으로 타임존 영향 제거. */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}
