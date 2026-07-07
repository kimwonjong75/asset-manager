// scripts/backtest/lib/portfolioRun.ts
// 코어(정적배분+반기 리밸런싱) + 위성(터틀) 2버킷 포트폴리오를 하루 단위로 굴린다.
// 라우팅 실험(B)을 위해 "전 종목 터틀"·"전 종목 B&H" 단일 버킷 모드도 지원.

import { CoreAssetSeries, CoreBasketSim, CoreWeighting } from './coreBasket';
import { SatelliteAssetSeries, SatelliteRuleConfig, SatelliteTurtleSim } from './satelliteTurtle';
import { semiAnnualRebalanceIndices } from './rebalanceDates';
import { ClosedTrade, EquityPoint } from './metrics';

export type Routing = 'two-bucket' | 'all-turtle' | 'all-bh';

export interface PortfolioRunResult {
  combinedEquity: EquityPoint[]; // 실제 KRW 총자산 (전략 비교용 1차 지표)
  coreTwrIndex: EquityPoint[]; // 코어 단독 TWR 지수 (외부 자금유출입 제거)
  satelliteTwrIndex: EquityPoint[]; // 위성 단독 TWR 지수
  satelliteTrades: ClosedTrade[];
}

export interface PortfolioRunOptions {
  calendar: string[];
  coreAssets: CoreAssetSeries[];
  satelliteAssets: SatelliteAssetSeries[];
  coreWeighting: CoreWeighting;
  satelliteRatio: number; // 0~1
  initialCapitalKRW: number;
  costRate: number;
  satelliteRules: SatelliteRuleConfig;
  routing: Routing;
}

export function runPortfolio(opts: PortfolioRunOptions): PortfolioRunResult {
  const { calendar } = opts;

  if (opts.routing === 'all-bh') {
    // 코어+위성 전 종목을 하나의 정적 바스켓으로 (터틀 없음)
    const combinedAssets: CoreAssetSeries[] = [
      ...opts.coreAssets,
      ...opts.satelliteAssets.map(s => ({
        ticker: s.ticker,
        weightPct: 1, // 동일가중으로 취급 (원 비중 정보 없음 — all-bh는 구조 비교용)
        close: s.close,
        fxRate: s.fxRate,
      })),
    ];
    // all-bh는 위성 자산에 별도 비중 정보가 없어 항상 동일가중으로 비교 (구조 비교 실험 — 절대수익 최적화 목적 아님)
    const sim = new CoreBasketSim(combinedAssets, 'equal', opts.costRate);
    const combinedEquity: EquityPoint[] = [];
    const rebalanceIdx = new Set(semiAnnualRebalanceIndices(calendar));
    for (let t = 0; t < calendar.length; t++) {
      if (t === 0 || rebalanceIdx.has(t)) {
        sim.rebalanceTo(t, t === 0 ? opts.initialCapitalKRW : sim.currentValueKRW(t));
      }
      combinedEquity.push({ date: calendar[t], value: sim.currentValueKRW(t) });
    }
    return { combinedEquity, coreTwrIndex: combinedEquity, satelliteTwrIndex: [], satelliteTrades: [] };
  }

  if (opts.routing === 'all-turtle') {
    // 코어+위성 전 종목에 터틀 규칙 적용, 단일 예산 풀
    const allAssets: SatelliteAssetSeries[] = [
      ...opts.satelliteAssets,
      ...opts.coreAssets.map(c => ({
        ticker: c.ticker,
        name: c.ticker,
        currency: 'KRW',
        open: c.close, // 코어 자산엔 별도 O/H/L을 안 모았으므로 종가로 근사 (all-turtle은 구조 비교용 실험)
        high: c.close,
        low: c.close,
        close: c.close,
        fxRate: c.fxRate,
        allowFractional: false,
      })),
    ];
    const sat = new SatelliteTurtleSim(allAssets, opts.satelliteRules);
    sat.applyExternalFlow(opts.initialCapitalKRW);
    sat.setReferenceBudget(opts.initialCapitalKRW);
    const rebalanceIdxAllTurtle = new Set(semiAnnualRebalanceIndices(calendar));
    const combinedEquity: EquityPoint[] = [];
    for (let t = 0; t < calendar.length; t++) {
      if (t > 0 && rebalanceIdxAllTurtle.has(t)) {
        // 사이징 기준 예산도 반기마다만 갱신 (반사적 자기증폭 방지 — two-bucket과 동일 이유)
        sat.setReferenceBudget(sat.currentValueKRW(t));
      }
      sat.advanceDay(t, calendar[t]);
      combinedEquity.push({ date: calendar[t], value: sat.currentValueKRW(t) });
    }
    return { combinedEquity, coreTwrIndex: [], satelliteTwrIndex: combinedEquity, satelliteTrades: sat.trades };
  }

  // two-bucket (기본): 코어 정적배분(반기 리밸런싱) + 위성 터틀, 반기마다 비율 재조정
  const core = new CoreBasketSim(opts.coreAssets, opts.coreWeighting, opts.costRate);
  const sat = new SatelliteTurtleSim(opts.satelliteAssets, opts.satelliteRules);
  const rebalanceIdx = new Set(semiAnnualRebalanceIndices(calendar));

  const combinedEquity: EquityPoint[] = [];
  const coreValueAfterFlow: number[] = [];
  const coreValueBeforeFlow: number[] = [];
  const satValueAfterFlow: number[] = [];
  const satValueBeforeFlow: number[] = [];

  for (let t = 0; t < calendar.length; t++) {
    const date = calendar[t];
    const isRebalance = t === 0 || rebalanceIdx.has(t);

    if (isRebalance) {
      const coreCur = t === 0 ? 0 : core.currentValueKRW(t);
      const satCur = t === 0 ? 0 : sat.currentValueKRW(t);
      coreValueBeforeFlow.push(coreCur);
      satValueBeforeFlow.push(satCur);

      const combined = t === 0 ? opts.initialCapitalKRW : coreCur + satCur;
      const targetSat = combined * opts.satelliteRatio;
      const targetCore = combined - targetSat;
      const flowToSat = targetSat - satCur;
      sat.applyExternalFlow(flowToSat);
      core.rebalanceTo(t, targetCore);
      // 사이징 기준 예산은 반기 리밸런싱 시점에만 갱신 (반사적 자기증폭 방지 — satelliteTurtle.ts 주석 참조)
      sat.setReferenceBudget(sat.currentValueKRW(t));
    } else {
      coreValueBeforeFlow.push(core.currentValueKRW(t));
      satValueBeforeFlow.push(sat.currentValueKRW(t));
    }

    sat.advanceDay(t, date);

    const coreAfter = core.currentValueKRW(t);
    const satAfter = sat.currentValueKRW(t);
    coreValueAfterFlow.push(coreAfter);
    satValueAfterFlow.push(satAfter);
    combinedEquity.push({ date, value: coreAfter + satAfter });
  }

  const coreTwrIndex = buildTwrIndex(calendar, coreValueBeforeFlow, coreValueAfterFlow);
  const satelliteTwrIndex = buildTwrIndex(calendar, satValueBeforeFlow, satValueAfterFlow);

  return { combinedEquity, coreTwrIndex, satelliteTwrIndex, satelliteTrades: sat.trades };
}

/** 외부 자금유출입을 제거한 시간가중수익률(TWR) 지수 (기준 100). */
function buildTwrIndex(calendar: string[], beforeFlow: number[], afterFlow: number[]): EquityPoint[] {
  const out: EquityPoint[] = [];
  let index = 100;
  for (let t = 0; t < calendar.length; t++) {
    if (t === 0) {
      out.push({ date: calendar[t], value: index });
      continue;
    }
    const prevBase = afterFlow[t - 1];
    const ret = prevBase > 0 ? beforeFlow[t] / prevBase - 1 : 0;
    index = index * (1 + ret);
    out.push({ date: calendar[t], value: index });
  }
  return out;
}
