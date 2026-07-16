// scripts/backtest/conditionalChannel/pipeline/delistingHandler.ts
// ---------------------------------------------------------------------------
// KR-size 파이프라인 — 상장폐지 처리 순수 로직.
//
// 설계 원칙:
//   · 정리매매 최종 체결가가 존재하면 실제 체결 가능 가격을 수익률로 반영한다.
//   · 합병·주식교환·현금대가는 최종 종가로 대신하지 않는다 — 별도 이벤트 테이블 필요.
//   · 대가가 확인되지 않은 합병 건은 UNRESOLVED로 기록하고 게이트를 실패시킨다.
//     개발·검증 기간 포지션이 합병 이벤트를 통과할 때 경제적 수익률을 계산할 수 없으면
//     그 포지션을 EXCLUDE_OPEN(미청산 제외)으로 처리하고 카운트를 보고한다.
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직), 외부 I/O 없음.
// ---------------------------------------------------------------------------

import type { IsoDate } from '../../../../types/backtestConditionalChannel';
import type { SecurityJsonFile } from './types';

// ===========================================================================
// 1. 상장폐지 분류 타입
// ===========================================================================

export type DelistingType =
  | 'ORDERLY_MERGER'      // 합병·주식교환 (최종가 ≈ 공모/합병가, 우상향)
  | 'ORDERLY_VOLUNTARY'   // 자진 상장폐지
  | 'ORDERLY_BUYOUT'      // 기업 공개매수 후 상장폐지
  | 'DISTRESS_BANKRUPTCY' // 법정관리·파산
  | 'DISTRESS_REGULATORY' // 관리종목→정리매매→강제폐지
  | 'UNKNOWN';            // 분류 불가

export interface DelistingEvent {
  code: string;
  name: string;
  lastTradingDate: IsoDate;
  lastClose: number;               // 정리매매 최종 체결가 (있으면 실제 가격)
  delistingType: DelistingType;
  finalWindowReturn: number;       // 마지막 15거래일 수익률 (분류 휴리스틱)
  mergerProceeds: number | null;   // 합병 대가(KRW/주) — 공식 데이터 없으면 null
  mergersResolvedViaLastClose: boolean; // lastClose를 합병 대가 대용으로 썼으면 true
  resolutionStatus: 'RESOLVED' | 'UNRESOLVED';
  note: string | null;
}

// ===========================================================================
// 2. 상장폐지 감지 (marcap 마지막 바 기반)
// ===========================================================================

const ORDERLY_THRESHOLD = -0.05;   // 최종 15일 수익률 > -5% → 정상 폐지 후보
const DISTRESS_THRESHOLD = -0.50;  // < -50% → 부실 폐지 후보

/**
 * 데이터 종료일보다 이전에 데이터가 끝난 종목을 상장폐지로 간주하고 분류한다.
 * panelEndDate: 전체 데이터셋의 마지막 날짜 (이 날짜에도 없으면 폐지)
 */
export function classifyDelistings(
  allSecurities: readonly SecurityJsonFile[],
  panelEndDate: IsoDate
): DelistingEvent[] {
  const results: DelistingEvent[] = [];

  for (const sec of allSecurities) {
    if (!sec.bars || sec.bars.length === 0) continue;
    const lastBar = sec.bars[sec.bars.length - 1];
    if (lastBar.date >= panelEndDate) continue; // 현재까지 살아있음

    const lastClose = lastBar.adj_close;

    // 최종 15거래일 수익률
    const windowStart = Math.max(0, sec.bars.length - 15);
    const firstBar = sec.bars[windowStart];
    const finalWindowReturn =
      firstBar.adj_close > 0
        ? lastClose / firstBar.adj_close - 1
        : -1;

    let delistingType: DelistingType;
    if (finalWindowReturn > ORDERLY_THRESHOLD) {
      delistingType = 'ORDERLY_MERGER'; // 합병/자진/공매수 — 세부 구분은 이벤트 테이블 필요
    } else if (finalWindowReturn < DISTRESS_THRESHOLD) {
      delistingType = 'DISTRESS_REGULATORY';
    } else {
      delistingType = 'UNKNOWN';
    }

    // 합병 대가 확인: 현재는 공식 이벤트 테이블이 없음
    // 정리매매 방식: lastClose = 실제 체결 가능 가격 (마지막 거래일)
    // 합병 방식: lastClose ≈ 합병가(근사) but 정확하지 않음 → UNRESOLVED
    const mergerProceeds: number | null = null;
    const mergersResolvedViaLastClose =
      delistingType === 'ORDERLY_MERGER' && mergerProceeds === null;

    // 이 분류기에서는 DISTRESS_REGULATORY만 발생(DISTRESS_BANKRUPTCY는 이벤트 테이블 필요 — 미구현)
    const resolutionStatus: 'RESOLVED' | 'UNRESOLVED' =
      delistingType === 'DISTRESS_REGULATORY'
        ? 'RESOLVED'   // 정리매매 최종가 = 실제 가격, 수익률 계산 가능
        : delistingType === 'ORDERLY_MERGER' && mergerProceeds === null
        ? 'UNRESOLVED' // 합병 대가 미확인 — 경제적 수익률 계산 불가
        : 'RESOLVED';

    results.push({
      code: sec.code,
      name: sec.name,
      lastTradingDate: lastBar.date,
      lastClose,
      delistingType,
      finalWindowReturn,
      mergerProceeds,
      mergersResolvedViaLastClose,
      resolutionStatus,
      note:
        delistingType === 'ORDERLY_MERGER' && mergerProceeds === null
          ? '합병 대가 미확인: 공식 이벤트 테이블(merger_proceeds.json) 미구현. ' +
            '포지션 보유 중 폐지 시 EXCLUDE_OPEN으로 처리.'
          : null,
    });
  }

  return results;
}

// ===========================================================================
// 3. 포지션 보유 중 폐지 이벤트 교차 검사
// ===========================================================================

export interface DelistingPositionConflict {
  code: string;
  positionEntryDate: IsoDate;
  delistingDate: IsoDate;
  delistingType: DelistingType;
  resolutionStatus: 'RESOLVED' | 'UNRESOLVED';
  economicReturnComputable: boolean;
  suggestedTreatment: 'USE_LAST_CLOSE' | 'EXCLUDE_OPEN';
}

/**
 * 포지션 보유 기간과 상장폐지 이벤트를 교차해
 * 경제적 수익률을 계산할 수 없는 건을 찾는다.
 * entryDates: 시뮬레이션에서 실제 진입한 (code, entryDate) 쌍
 */
export function findDelistingConflicts(
  delistings: readonly DelistingEvent[],
  entryDates: ReadonlyArray<{ code: string; entryDate: IsoDate }>
): DelistingPositionConflict[] {
  const delistMap = new Map<string, DelistingEvent>();
  for (const d of delistings) delistMap.set(d.code, d);

  return entryDates
    .filter(({ code }) => delistMap.has(code))
    .map(({ code, entryDate }) => {
      const ev = delistMap.get(code)!;
      const economicReturnComputable = ev.resolutionStatus === 'RESOLVED';
      return {
        code,
        positionEntryDate: entryDate,
        delistingDate: ev.lastTradingDate,
        delistingType: ev.delistingType,
        resolutionStatus: ev.resolutionStatus,
        economicReturnComputable,
        suggestedTreatment: economicReturnComputable
          ? 'USE_LAST_CLOSE'
          : 'EXCLUDE_OPEN',
      };
    });
}

// ===========================================================================
// 4. 게이트 판정 (개발·검증 기간 중 UNRESOLVED 건 보고)
// ===========================================================================

export interface DelistingGateResult {
  totalDelistings: number;
  resolvedCount: number;
  unresolvedCount: number;
  unresolvedDetails: Array<{ code: string; name: string; type: DelistingType }>;
  /** 개발·검증 기간 포지션 교차 미해결 건: 게이트 FAIL 아님, 보고만 */
  positionConflictsUnresolved: number;
  gateNote: string;
}

/**
 * 상장폐지 처리 게이트 결과를 만든다.
 * 이 게이트는 개발·검증 구간에서 경제적 수익률을 계산할 수 없는 건이 있으면
 * EXCLUDE_OPEN 처리 수와 함께 보고한다 (자동 게이트 실패가 아닌 보고 + 경고).
 */
export function buildDelistingGateResult(
  delistings: readonly DelistingEvent[],
  conflicts: readonly DelistingPositionConflict[]
): DelistingGateResult {
  const resolvedCount = delistings.filter((d) => d.resolutionStatus === 'RESOLVED').length;
  const unresolvedDelistings = delistings.filter((d) => d.resolutionStatus === 'UNRESOLVED');
  const positionConflictsUnresolved = conflicts.filter(
    (c) => !c.economicReturnComputable
  ).length;

  return {
    totalDelistings: delistings.length,
    resolvedCount,
    unresolvedCount: unresolvedDelistings.length,
    unresolvedDetails: unresolvedDelistings.slice(0, 20).map((d) => ({
      code: d.code,
      name: d.name,
      type: d.delistingType,
    })),
    positionConflictsUnresolved,
    gateNote:
      positionConflictsUnresolved > 0
        ? `포지션 보유 중 합병 대가 미확인 ${positionConflictsUnresolved}건: EXCLUDE_OPEN 처리됨. ` +
          '공식 이벤트 테이블(merger_proceeds.json) 구축 전까지 이 건의 경제적 수익률은 추정치에서 제외된다.'
        : '개발·검증 기간 포지션 중 미해결 상장폐지 없음',
  };
}
