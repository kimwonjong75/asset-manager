// utils/soldPLBreakdown.ts
// 매도 실현손익의 **이익/손실 분해** — "매도 수익" 카드 하단 보조 표기의 공용 순수 함수.
//
// 두 화면(수익통계 탭 `SellAnalyticsPage`, 대시보드 `SoldAssetsStats`)이 각자 다른 경로로
// 건별 실현손익을 구하지만, **부호별 분해와 문구는 여기 한 곳에서만** 만든다 (drift 차단).
//
// 규약:
//   · 이익 = realized > 0, 손실 = realized < 0 — **정확히 0은 어느 쪽도 아님**(건수에서 제외).
//     0은 "본전"이 아니라 대부분 데이터 부재 폴백이다(매수정보 없음 → 매수금액=매도금액으로
//     처리해 수익 0 고정). 이걸 이익으로 세면 "이익 N건"이 부풀려진다.
//   · 금액은 0을 더해도 불변이므로 **`grossProfit + grossLoss === 총 실현손익`은 항상 성립**.
//     (건수만 총 매도횟수보다 적을 수 있다.)
//   · `grossLoss`는 **부호를 유지한 음수**. 표기용 부호는 buildSoldPLBreakdownRows가 붙인다.
//   · NaN/Infinity는 합계를 오염시키므로 양쪽 모두에서 제외한다.
//
// 회귀 가드: tests/soldPLBreakdownParity.ts (npm run test:soldpl). side effect/any 없음.

export interface RealizedPLBreakdown {
  /** 이익 건(realized > 0) 합계 — 항상 >= 0 */
  grossProfit: number;
  /** 손실 건(realized < 0) 합계 — 항상 <= 0 (부호 유지) */
  grossLoss: number;
  profitCount: number;
  lossCount: number;
}

export const EMPTY_REALIZED_PL_BREAKDOWN: RealizedPLBreakdown = {
  grossProfit: 0,
  grossLoss: 0,
  profitCount: 0,
  lossCount: 0,
};

/** 건별 실현손익 배열 → 이익/손실 분해. 입력 배열은 변경하지 않는다. */
export function splitRealizedPL(realizedValues: readonly number[]): RealizedPLBreakdown {
  let grossProfit = 0;
  let grossLoss = 0;
  let profitCount = 0;
  let lossCount = 0;

  for (const value of realizedValues) {
    if (!Number.isFinite(value)) continue;
    if (value > 0) {
      grossProfit += value;
      profitCount += 1;
    } else if (value < 0) {
      grossLoss += value;
      lossCount += 1;
    }
  }

  return { grossProfit, grossLoss, profitCount, lossCount };
}

export type SoldPLBreakdownTone = 'profit' | 'loss';

export interface SoldPLBreakdownRow {
  label: string;
  value: string;
  tone: SoldPLBreakdownTone;
}

/**
 * 카드 하단 표기용 행 2개(이익/손실) 생성.
 * `formatKRW`는 호출부의 통화 포맷터를 주입받는다(화면마다 Intl 옵션이 다를 수 있어 고정하지 않음).
 * 부호(+/−)는 여기서 붙이고 금액은 절댓값으로 넘겨, 두 줄의 표기가 항상 대칭이 되게 한다.
 * 이익·손실이 모두 0건이면 빈 배열 → 카드는 기존 모습 그대로 유지된다.
 */
export function buildSoldPLBreakdownRows(
  breakdown: RealizedPLBreakdown,
  formatKRW: (value: number) => string
): SoldPLBreakdownRow[] {
  if (breakdown.profitCount === 0 && breakdown.lossCount === 0) return [];

  return [
    {
      label: `이익 ${breakdown.profitCount}건`,
      value: `+${formatKRW(Math.abs(breakdown.grossProfit))}`,
      tone: 'profit',
    },
    {
      label: `손실 ${breakdown.lossCount}건`,
      value: `−${formatKRW(Math.abs(breakdown.grossLoss))}`,
      tone: 'loss',
    },
  ];
}
