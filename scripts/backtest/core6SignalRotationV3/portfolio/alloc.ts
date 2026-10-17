// scripts/backtest/core6SignalRotationV3/portfolio/alloc.ts
// 순수 배분 도우미 — 포트폴리오 시뮬레이터(simulate.ts)가 쓰는 water-filling 과 공통 λ.
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §11, V2 §10.1·§10.3, V1 §7.1.

export interface FillItem {
  /** 비례 배분 가중치(목표비중). 0 이하는 배분 대상이 아니다. */
  weight: number;
  /** 이 항목이 받을 수 있는 최대 금액. 0 이하는 배분 대상이 아니다. */
  cap: number;
}

/**
 * 목표비중 비례 water-filling.
 *
 * `total` 을 가중치 비례로 나누되, 각 항목은 `cap` 을 넘지 못한다. 어떤 항목이 몫을 상한 이상으로
 * 받게 되면 그 항목은 상한으로 고정하고 제외한 뒤 남은 금액을 나머지에 다시 비례 배분한다
 * (모든 항목이 상한에 닿거나 금액이 소진될 때까지 반복). 상한 합이 total 보다 작으면 남는 금액은
 * 배분되지 않는다(호출자가 현금으로 둔다).
 *
 * 반환 배열은 입력 `items` 와 같은 순서다(호출자가 종목코드 오름차순으로 넘긴다).
 * 한 라운드에서 상한을 넘는 항목은 **전부 동시에** 고정한다 — 한 항목을 고정하면 나머지 몫이 커지기만
 * 하므로, 현재 몫이 이미 상한을 넘는 항목은 어차피 상한에 닿기 때문이다(순서 무관 결정성).
 */
export function waterFill(total: number, items: readonly FillItem[]): number[] {
  const alloc: number[] = items.map(() => 0);
  let active: number[] = [];
  items.forEach((item, i) => {
    if (item.weight > 0 && item.cap > 0) active.push(i);
  });
  let remaining = total;
  while (active.length > 0 && remaining > 1e-9) {
    let sumWeight = 0;
    for (const i of active) sumWeight += items[i].weight;
    if (sumWeight <= 0) break;
    const over: number[] = [];
    for (const i of active) {
      const share = (remaining * items[i].weight) / sumWeight;
      if (share > items[i].cap - alloc[i] + 1e-12) over.push(i);
    }
    if (over.length === 0) {
      for (const i of active) alloc[i] += (remaining * items[i].weight) / sumWeight;
      break;
    }
    for (const i of over) {
      remaining -= items[i].cap - alloc[i];
      alloc[i] = items[i].cap;
    }
    active = active.filter(i => !over.includes(i));
  }
  return alloc;
}

/**
 * 공통 λ ∈ [0,1]: `λ × fullNeed ≤ available` 를 만족하는 최대값.
 * 모든 희망 매수액에 같은 λ 를 곱하는 것이므로 (비용 포함) 총 필요현금이 λ 에 선형이다 →
 * 이분법이 수렴하는 값(허용오차 1원)과 같은 정확한 해를 닫힌 형태로 구한다.
 */
export function solveLambda(fullNeed: number, available: number): number {
  if (!(fullNeed > 0)) return 1;
  if (!(available > 0)) return 0;
  return Math.min(1, available / fullNeed);
}
