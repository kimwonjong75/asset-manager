// utils/turtleHoldingsNotify.ts
// ---------------------------------------------------------------------------
// P4 — "보유종목 터틀" 카카오톡 알림 순수 판정 + 문구 조립
// (계획서 `docs/PLAN_터틀중심_앱재정비_260925.md` §4.5·§6 P4).
//
// 앱(`hooks/useKakaoNotify` 경유 매니페스트 조립)과 카카오톡 GAS 번들
// (`scripts/notify/gas/entry.ts`)이 이 파일을 그대로 공유한다 — side effect·Date.now·any 금지,
// `utils/tradePlan.ts`(evaluateTradePlan → formatKakaoText 분리)와 동일한 설계다.
//
// 재사용(재구현 금지): 판정 자체는 전부 `utils/turtleHoldings.ts`(P0 순수 계산)를 그대로 쓴다.
// 이 파일은 "판정 결과 → 발송 후보(신호·문구)" 조립만 담당하고, 완료봉 추출(raw→bars)과
// HTTP 조회는 호출부(entry.ts/useKakaoNotify)의 책임이다.
//
// GAS 번들 안전성: 이 파일이 값으로 import하는 `./tradePlan`(KAKAO_EMOJI·clip)·`./turtleHoldings`는
// 전부 순수 TS이고 브라우저 전역을 참조하지 않는다(scripts/notify/build-gas.mjs 그렙 가드로 매 빌드 확인).
// `./todayTurtle`은 타입(DailyBar)만 참조한다(값 import 없음 — bars는 호출부가 이미 추출해 넘긴다).

import { KAKAO_EMOJI, clip } from './tradePlan';
import type { DailyBar } from './todayTurtle';
import type { TurtleHoldingsSettings } from '../types/turtleHoldings';
import {
  computeExitLine,
  computeReentryLine,
  computeN,
  computePyramidTriggerPrice,
  evaluateLegacyHoldingsStatus,
  describeExitLineExplanation,
  describeReentryLineExplanation,
  describeStopHitExplanation,
  describePyramidHitExplanation,
} from './turtleHoldings';

export type TurtleNotifySignal =
  | 'legacy-sell'     // 원래 보유분 — 청산선 이탈
  | 'reentry-stop'    // 재매수분 — 손절 이탈
  | 'reentry-exit'    // 재매수분 — 청산선 이탈
  | 'reentry-pyramid' // 재매수분 — 불타기(추가 매수) 트리거 도달
  | 'watch-reentry';  // 감시 관심종목 — 재진입(다시 살 때) 돌파

export interface TurtleNotifyCandidate {
  signal: TurtleNotifySignal;
  /** 카카오톡 본문(≤200자, 이미 clip 적용됨). */
  text: string;
  /** 요약 묶음(상한 초과·정숙시간 보류)용 짧은 문구 — 예: "오뚜기 팔 때". */
  summary: string;
}

// 입력 최소 인터페이스 — `utils/notifyManifest.ts`의 매니페스트 항목 타입과 구조적으로 호환된다
// (필드를 더 가진 실제 매니페스트 타입을 그대로 넘겨도 무방 — 여기서는 구조적 타이핑만 요구).
export interface TurtleLegacyHoldingLike {
  ticker: string;
  name: string;
  currency: string;
  quantity: number;
}
export interface TurtleReentryUnitLike {
  fillPrice: number;
  quantity: number;
  nAtFill: number;
}
export interface TurtleReentryPositionLike {
  ticker: string;
  name: string;
  currency: string;
  quantity: number;
  units: readonly TurtleReentryUnitLike[];
  stopPrice: number;
  /** 포지션 시작일(YYYY-MM-DD) — atrTrail 청산의 진입 인덱스 산정용. */
  openedAt: string;
}
export interface TurtleWatchItemLike {
  ticker: string;
  name: string;
  currency: string;
}

function shortName(name: string): string {
  return name.length > 14 ? name.slice(0, 13) + '…' : name;
}
function formatQty(q: number): string {
  return Number.isInteger(q) ? `${q}주` : `${q}`;
}
function entryIdxFor(bars: readonly DailyBar[], openedAt: string): number {
  const idx = bars.findIndex(b => b.date >= openedAt);
  return idx >= 0 ? idx : 0;
}

/**
 * 원래 보유분(legacy) — 청산선 이탈만 판정한다(진입 N 기록이 없어 2N 손절 불가,
 * `utils/turtleHoldings.evaluateLegacyHoldingsStatus`와 동일 제약).
 */
export function evaluateLegacyHoldingForNotify(
  item: TurtleLegacyHoldingLike,
  bars: readonly DailyBar[],
  settings: TurtleHoldingsSettings,
): TurtleNotifyCandidate | null {
  if (bars.length === 0) return null;
  const lastClose = bars[bars.length - 1].close;
  const exitLine = computeExitLine({ bars, settings });
  const status = evaluateLegacyHoldingsStatus(lastClose, exitLine);
  if (status !== 'sell-check' || exitLine === null) return null;
  const reason = describeExitLineExplanation({ exitLookback: settings.exitLookback, exitMethod: settings.exitMethod, maPeriod: settings.maPeriod, atrTrailMultiple: settings.atrTrailMultiple, exitLine, lastClose, currency: item.currency });
  const name = shortName(item.name);
  const text = clip(
    `${KAKAO_EMOJI.exitLineHit} [팔 때] ${name} — ${reason}\n` +
    `보유 ${formatQty(item.quantity)} 매도 검토 후 앱에서 [팔았음 기록]하세요.`,
  );
  return { signal: 'legacy-sell', text, summary: `${name} 팔 때` };
}

/**
 * 재매수분(reentry) — 손절 이탈 > 청산선 이탈 > 불타기(추가 매수) 순서로 판정한다
 * (한 번에 하나만 발생 — `utils/turtleHoldingsView.buildTurtleHoldingsReentryRow`와 동일 우선순위).
 */
export function evaluateReentryPositionForNotify(
  item: TurtleReentryPositionLike,
  bars: readonly DailyBar[],
  settings: TurtleHoldingsSettings,
): TurtleNotifyCandidate | null {
  if (bars.length === 0 || item.units.length === 0) return null;
  const lastClose = bars[bars.length - 1].close;
  const name = shortName(item.name);
  const lastUnit = item.units[item.units.length - 1];

  if (lastClose <= item.stopPrice) {
    const reason = describeStopHitExplanation({ stopPrice: item.stopPrice, lastClose, currency: item.currency });
    const text = clip(`${KAKAO_EMOJI.stopHit} [손절 이탈] ${name} — ${reason}\n손절 매도 후 앱에서 [팔았음 기록]하세요.`);
    return { signal: 'reentry-stop', text, summary: `${name} 손절 이탈` };
  }

  const entryIdx = entryIdxFor(bars, item.openedAt);
  const exitLine = computeExitLine({ bars, settings, entryIdx });
  if (exitLine !== null && lastClose <= exitLine) {
    const reason = describeExitLineExplanation({ exitLookback: settings.exitLookback, exitMethod: settings.exitMethod, maPeriod: settings.maPeriod, atrTrailMultiple: settings.atrTrailMultiple, exitLine, lastClose, currency: item.currency });
    const text = clip(
      `${KAKAO_EMOJI.exitLineHit} [팔 때] ${name} — ${reason}\n` +
      `보유 ${formatQty(item.quantity)} 매도 검토 후 앱에서 [팔았음 기록]하세요.`,
    );
    return { signal: 'reentry-exit', text, summary: `${name} 팔 때` };
  }

  const n = computeN(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close));
  if (n !== null && item.units.length < settings.maxUnitsPerPosition) {
    const triggerPrice = computePyramidTriggerPrice(lastUnit.fillPrice, n, settings);
    if (lastClose >= triggerPrice) {
      const reason = describePyramidHitExplanation({ lastFillPrice: lastUnit.fillPrice, triggerPrice, currency: item.currency });
      const text = clip(
        `${KAKAO_EMOJI.pyramidHit} [추가 매수] ${name} — ${reason}\n` +
        `계획대로 추가 매수 후 앱에서 [샀음 기록]하세요(손절선이 상향됩니다).`,
      );
      return { signal: 'reentry-pyramid', text, summary: `${name} 추가 매수` };
    }
  }
  return null;
}

/** 감시 관심종목 — entryLookback(기본 55)일 최고가 돌파 시 "다시 살 때". */
export function evaluateWatchItemForNotify(
  item: TurtleWatchItemLike,
  bars: readonly DailyBar[],
  settings: TurtleHoldingsSettings,
): TurtleNotifyCandidate | null {
  if (bars.length === 0) return null;
  const lastClose = bars[bars.length - 1].close;
  const reentryLine = computeReentryLine(bars, settings);
  if (reentryLine === null || lastClose < reentryLine) return null;
  const reason = describeReentryLineExplanation({ entryLookback: settings.entryLookback, reentryLine, lastClose, currency: item.currency });
  const name = shortName(item.name);
  const text = clip(
    `${KAKAO_EMOJI.pyramidHit} [다시 살 때] ${name} — ${reason}\n` +
    `앱에서 재매수 계산기를 확인하고 [샀음 기록]하세요.`,
  );
  return { signal: 'watch-reentry', text, summary: `${name} 다시 살 때` };
}

// ═══════════════════════════════════════════════════════════════════════════
// 아침 요약(morningDigest) — 오늘 할 일 종목명 + 건수 한 줄 (계획서 §4.5 "아침 요약 1번")
// ═══════════════════════════════════════════════════════════════════════════

export interface TurtleMorningDigestInput {
  /** "팔 때"로 묶는다 — legacy-sell·reentry-exit·reentry-stop 전부 포함(사용자 관점에서는 전부 매도 행동). */
  sellNames: string[];
  /** watch-reentry(다시 살 때). */
  reentryNames: string[];
  /** reentry-pyramid(추가 매수). */
  pyramidNames: string[];
}

function summarizeNames(names: string[]): string {
  const top = names.slice(0, 3).join(', ');
  const rest = names.length - Math.min(3, names.length);
  return `${names.length}(${top}${rest > 0 ? ` 외 ${rest}` : ''})`;
}

/** 전부 0건이면 null(스팸 방지 — 이미 있는 마감 후 개별 발송으로 충분). */
export function formatTurtleMorningDigest(input: TurtleMorningDigestInput): string | null {
  const { sellNames, reentryNames, pyramidNames } = input;
  const total = sellNames.length + reentryNames.length + pyramidNames.length;
  if (total === 0) return null;
  const parts: string[] = [];
  if (sellNames.length > 0) parts.push(`팔 때 ${summarizeNames(sellNames)}`);
  if (reentryNames.length > 0) parts.push(`다시 살 때 ${summarizeNames(reentryNames)}`);
  if (pyramidNames.length > 0) parts.push(`추가 매수 ${summarizeNames(pyramidNames)}`);
  return clip(`${KAKAO_EMOJI.digest} [터틀 오늘 할 일] ${parts.join(' · ')}`);
}
