// scripts/backtest/lib/coreBasket.ts
// 코어 바스켓 시뮬레이터 — 정적 배분 + 반기 리밸런싱. 순수 계산(터틀 없음, buy&hold).
// 앱의 순수 함수 재사용 대상 없음(코어는 리밸런싱 로직으로, 터틀 엔진과 무관) — 시뮬레이터 내부 구현.

export interface CoreAssetSeries {
  ticker: string;
  weightPct: number; // universe.json 원본 비중 (동일가중 모드에서는 무시)
  close: (number | null)[]; // 캘린더 정렬 + carry-forward 완료
  fxRate: (number | null)[]; // 캘린더 정렬 (KRW 자산은 전부 1)
}

export type CoreWeighting = 'proportional' | 'equal';

export class CoreBasketSim {
  private units = new Map<string, number>(); // ticker -> 보유수량(원통화 기준)
  private initialized = false;
  private readonly costRate: number;
  // 리밸런싱 시점에 유효 가격 종목이 하나도 없을 때(예: 캘린더 첫날이 휴장일) 목표금액을 잃지 않고
  // 대기시키는 현금 버퍼. 다음 리밸런싱 때 정상 배분된다.
  private cashKRW = 0;

  constructor(private assets: CoreAssetSeries[], private weighting: CoreWeighting, costRate: number) {
    this.costRate = costRate;
  }

  /** 현재 시점(t) 평가액(KRW). 미상장(가격 null) 종목은 0 취급. */
  currentValueKRW(t: number): number {
    let sum = this.cashKRW;
    for (const a of this.assets) {
      const u = this.units.get(a.ticker) ?? 0;
      if (u === 0) continue;
      const price = a.close[t];
      const fx = a.fxRate[t] ?? 1;
      if (typeof price === 'number') sum += u * price * fx;
    }
    return sum;
  }

  private targetWeights(t: number): Map<string, number> {
    const available = this.assets.filter(a => typeof a.close[t] === 'number');
    const weights = new Map<string, number>();
    if (available.length === 0) return weights;
    if (this.weighting === 'equal') {
      const w = 1 / available.length;
      available.forEach(a => weights.set(a.ticker, w));
    } else {
      const totalW = available.reduce((s, a) => s + a.weightPct, 0);
      if (totalW <= 0) {
        const w = 1 / available.length;
        available.forEach(a => weights.set(a.ticker, w));
      } else {
        available.forEach(a => weights.set(a.ticker, a.weightPct / totalW));
      }
    }
    return weights;
  }

  /** targetTotalKRW로 리밸런싱(내부 비중 재분배 + 외부 자금 유출입 반영). 비용은 turnover 기준 차감. */
  rebalanceTo(t: number, targetTotalKRW: number): { costKRW: number } {
    const weights = this.targetWeights(t);
    const targetTotal = Math.max(0, targetTotalKRW);

    if (weights.size === 0) {
      // 오늘 유효 가격이 있는 종목이 하나도 없음 — 배분하지 않고 현금으로 대기(자금 유실 방지)
      this.units.forEach((_, ticker) => this.units.set(ticker, 0));
      this.cashKRW = targetTotal;
      this.initialized = true;
      return { costKRW: 0 };
    }
    this.cashKRW = 0;

    let turnover = 0;
    for (const a of this.assets) {
      const price = a.close[t];
      const fx = a.fxRate[t] ?? 1;
      const curUnits = this.units.get(a.ticker) ?? 0;
      const curVal = typeof price === 'number' ? curUnits * price * fx : 0;
      const w = weights.get(a.ticker) ?? 0;
      const targetVal = targetTotal * w;
      turnover += Math.abs(targetVal - curVal);
    }
    const costKRW = turnover * this.costRate;
    const netTotal = Math.max(0, targetTotal - costKRW);
    const scale = targetTotal > 0 ? netTotal / targetTotal : 0;

    for (const a of this.assets) {
      const price = a.close[t];
      const fx = a.fxRate[t] ?? 1;
      const w = weights.get(a.ticker) ?? 0;
      if (typeof price === 'number' && price > 0 && w > 0) {
        const targetVal = targetTotal * w * scale; // KRW
        this.units.set(a.ticker, targetVal / (price * fx)); // 종목 통화 수량 (KRW → 원통화 환산 필수)
      } else {
        this.units.set(a.ticker, 0);
      }
    }
    this.initialized = true;
    return { costKRW };
  }
}
