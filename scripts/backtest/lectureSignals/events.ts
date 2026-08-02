// scripts/backtest/lectureSignals/events.ts
// ---------------------------------------------------------------------------
// D2 급성 매도 신호(S1~S6, S5 두 변형) 판정 + 이벤트 중복 제거(§5.3, §7.1).
//
// 모든 이동 기준선은 당일 이전만 사용(§7.1 "현재일 이전 값만 기준선에 사용").
// S3 상한가는 2015-06-15 전후 임계값 분기 + 기업행위일 제외(§7.1, §15-4·5).
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import type { AcuteSignalCode, SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import {
  dailyRatio,
  isRollingMaxInclusive,
  priorMean,
  ratioK,
} from './features';

/** 기업행위일 집합 키. */
export function corpActionKey(code: string, date: string): string {
  return `${code}|${date}`;
}

/**
 * price[k]×qty[k] 곱이 최근 window일(당일 포함) 최대인지. 전체 배열을 만들지 않고
 * 창 안에서만 계산한다(O(window)). 창 부족이면 false(판정불가 → 이벤트 미발생).
 * S5_APP_PROXY(adj×adj)·S5_APP_RUNTIME_RAW(원시×원시)이 공유한다.
 */
export function isProductRollingMax(
  price: readonly number[],
  qty: readonly number[],
  i: number,
  window: number
): boolean {
  const start = i - window + 1;
  if (start < 0) return false;
  if (i >= price.length || i >= qty.length) return false;
  const today = price[i] * qty[i];
  let mx = -Infinity;
  for (let k = start; k <= i; k++) {
    const p = price[k] * qty[k];
    if (p > mx) mx = p;
  }
  return today >= mx;
}

/**
 * 단일 신호 판정. i는 bar index. corpActionDates는 `code|date` 집합(S3 제외용).
 * 판정 불가(창 부족 등)면 false. 미래참조 없음.
 */
export function testSignalAt(
  signal: AcuteSignalCode,
  bars: SecurityBars,
  i: number,
  corpActionDates: ReadonlySet<string>
): boolean {
  const { adjOpen, adjHigh, adjClose, adjVolume, amount, dates } = bars;
  switch (signal) {
    case 'S1_RUNUP_21D_100': {
      // ratio >= 1 + threshold (부동소수 경계 절벽 회피)
      const ratio = ratioK(adjClose, i, CONST.s1Lookback);
      return ratio !== null && ratio >= 1 + CONST.s1Threshold;
    }
    case 'S2_RUNUP_5D_40': {
      const ratio = ratioK(adjClose, i, CONST.s2Lookback);
      return ratio !== null && ratio >= 1 + CONST.s2Threshold;
    }
    case 'S3_LIMIT_UP': {
      if (i < 1) return false;
      // 기업행위일 제외(§7.1)
      if (corpActionDates.has(corpActionKey(bars.code, dates[i]))) return false;
      const ratio = dailyRatio(adjClose, i);
      if (ratio === null) return false;
      const threshold =
        dates[i] < CONST.limitUpRegimeChangeDate ? CONST.limitUpBefore : CONST.limitUpAfter;
      // 종가==고가(조정계수 동일하므로 adj 값 동등성 유지). 부동소수 허용오차.
      const closeEqHigh = Math.abs(adjClose[i] - adjHigh[i]) <= 1e-9 * Math.max(1, adjHigh[i]);
      return ratio >= 1 + threshold && closeEqHigh;
    }
    case 'S4_GAP_BEAR_VOLUME': {
      if (i < 1) return false;
      const prevClose = adjClose[i - 1];
      if (!(prevClose > 0)) return false;
      const gapRatio = adjOpen[i] / prevClose;
      if (gapRatio < 1 + CONST.s4GapThreshold) return false;
      if (!(adjClose[i] < adjOpen[i])) return false;
      const base = priorMean(adjVolume, i, CONST.volBaselineWindow);
      if (base === null || base <= 0) return false;
      return adjVolume[i] >= CONST.s4VolMultiple * base;
    }
    case 'S5_AMOUNT': {
      const ratio = dailyRatio(adjClose, i);
      if (ratio === null || ratio > 1 + CONST.s5CrashThreshold) return false;
      const isMax = isRollingMaxInclusive(amount, i, CONST.s5MaxWindow);
      return isMax === true;
    }
    case 'S5_APP_PROXY': {
      const ratio = dailyRatio(adjClose, i);
      if (ratio === null || ratio > 1 + CONST.s5CrashThreshold) return false;
      // 프록시 거래대금 = adj_close × adj_volume (원천 amount 미사용).
      return isProductRollingMax(adjClose, adjVolume, i, CONST.s5MaxWindow);
    }
    case 'S5_APP_RUNTIME_RAW': {
      // 앱 `/history` 입력 규약 재현: 거래대금 최대 판정을 **무조정 원시 종가 × 원시 거래량**으로 한다.
      // 수익률(−10%) 판정은 세 변형 모두 adj_close로 동일하게 유지한다(분할일 가짜 −50% 방지).
      const ratio = dailyRatio(adjClose, i);
      if (ratio === null || ratio > 1 + CONST.s5CrashThreshold) return false;
      const rawClose = bars.close;
      const rawVolume = bars.volume;
      if (!rawClose || !rawVolume) return false; // 원시 배열 없음 → 판정불가
      return isProductRollingMax(rawClose, rawVolume, i, CONST.s5MaxWindow);
    }
    case 'S6_CRASH_5_VOLUME_2X': {
      const ratio = dailyRatio(adjClose, i);
      if (ratio === null || ratio > 1 + CONST.s6CrashThreshold) return false;
      const base = priorMean(adjVolume, i, CONST.volBaselineWindow);
      if (base === null || base <= 0) return false;
      return adjVolume[i] >= CONST.s6VolMultiple * base;
    }
    default:
      return false;
  }
}

export interface RawEvent {
  code: string;
  signal: AcuteSignalCode;
  date: string;
  barIndex: number;
}

/**
 * 한 종목·한 신호의 이벤트를 스캔하며 중복 제거(§5.3): 첫 이벤트만 유지하고,
 * 해당 가설의 주호라이즌(dedupHorizon 거래일)이 끝날 때까지 같은 신호 재등록 금지.
 * eligible(i): 그 bar가 이벤트 자격(유니버스·유동성)을 갖는지 판정하는 콜백.
 * fromIdx/toIdx: 신호일이 이 [from,to] bar-index 범위(표본기간)에 있어야 등록.
 */
export function scanSignalEvents(
  signal: AcuteSignalCode,
  bars: SecurityBars,
  corpActionDates: ReadonlySet<string>,
  dedupHorizon: number,
  fromIdx: number,
  toIdx: number,
  eligible: (i: number) => boolean
): RawEvent[] {
  const out: RawEvent[] = [];
  let blockUntil = -1; // 이 인덱스 이하로는 재등록 금지
  const n = bars.dates.length;
  const lo = Math.max(0, fromIdx);
  const hi = Math.min(n - 1, toIdx);
  for (let i = lo; i <= hi; i++) {
    if (i <= blockUntil) continue;
    if (!eligible(i)) continue;
    if (!testSignalAt(signal, bars, i, corpActionDates)) continue;
    out.push({ code: bars.code, signal, date: bars.dates[i], barIndex: i });
    blockUntil = i + dedupHorizon; // 주호라이즌 종료까지 재등록 금지
  }
  return out;
}
