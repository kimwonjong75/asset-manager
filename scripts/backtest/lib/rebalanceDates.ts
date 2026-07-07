// scripts/backtest/lib/rebalanceDates.ts
// 반기(1월/7월) 첫 거래일 인덱스를 캘린더에서 찾는다.

export function semiAnnualRebalanceIndices(calendar: string[]): number[] {
  const out: number[] = [];
  let lastKey = '';
  calendar.forEach((d, i) => {
    const month = d.slice(5, 7);
    if (month !== '01' && month !== '07') return;
    const key = d.slice(0, 7); // YYYY-MM
    if (key === lastKey) return; // 이미 이 달의 첫 거래일을 기록함
    lastKey = key;
    out.push(i);
  });
  return out;
}
