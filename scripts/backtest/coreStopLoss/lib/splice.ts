// scripts/backtest/coreStopLoss/lib/splice.ts
// 프록시→실제상품 접합(splice) — 연구 전용(앱/백엔드 무접촉).
//
// 문제: 목표 배분 14종 중 7종은 상장이 늦어 5년/10년 지평을 커버하지 못한다.
// 해결: 실제 상품의 최초거래일 이전 구간은 미국상장 프록시의 **일간 수익률**을
//       실제 상품의 값 스케일에 역방향으로 이어 붙여 하나의 연속 시계열을 만든다.
//
// 왜 수익률 공간에서 잇는가:
//   실제 레그는 KRW(원화 호가), 프록시는 USD다. 가격 레벨을 그대로 이으면
//   통화 단위가 섞여 무의미한 점프가 생긴다. 반면 일간 % 변화율은 통화 무차원이므로
//   프록시의 USD 수익률을 실제 레그의 KRW 값 스케일 위로 전파하면 이음매가 매끄럽다.
//   (주의: 이 방식은 과거 구간에 대해 "환율 변동 효과 없는 USD 자산 수익률"을
//    가정한다 — 프록시 구간의 알려진 한계로 리포트에 명시한다.)
//
// 역방향 체인:
//   splicedValue[i] = splicedValue[i+1] / (1 + proxyReturn[i+1])
//   (anchor = 실제 상품 최초값, 최초거래일 이후는 실제값 그대로)

import type { AdjSeries } from './yahooData';

/** 결측 없는 단순 일별 시계열. */
export interface PriceSeries {
  symbol: string;
  dates: string[];
  values: number[];
}

/** 접합 결과. realFirstDate 이후는 실제 상품, 그 이전은 프록시 수익률 기반 합성. */
export interface SplicedSeries extends PriceSeries {
  /** 실제 상품 데이터가 시작되는 날짜(이 날짜 포함 이후는 100% 실제). */
  realFirstDate: string;
  /** 접합에 쓴 프록시 심볼 (접합 없으면 null). */
  proxySymbol: string | null;
  /** 합성(프록시) 구간의 행 수. */
  proxyRowCount: number;
  /** 실제 구간의 행 수. */
  realRowCount: number;
}

/** AdjSeries(수정종가)에서 null을 제거한 단순 시계열로 변환. */
export function toPriceSeries(s: AdjSeries): PriceSeries {
  const dates: string[] = [];
  const values: number[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const v = s.adjClose[i];
    if (typeof v === 'number' && isFinite(v) && v > 0) {
      dates.push(s.dates[i]);
      values.push(v);
    }
  }
  return { symbol: s.symbol, dates, values };
}

/** 접합 없이 실제 시계열 그대로 사용하는 레그. */
export function noSplice(real: PriceSeries): SplicedSeries {
  return {
    symbol: real.symbol,
    dates: real.dates,
    values: real.values,
    realFirstDate: real.dates[0] ?? '',
    proxySymbol: null,
    proxyRowCount: 0,
    realRowCount: real.dates.length,
  };
}

/**
 * 실제 상품 시계열 앞쪽에 프록시 수익률 구간을 이어 붙인다.
 *
 * @param real  실제 상품(KRW 호가) 시계열
 * @param proxy 프록시(USD 호가) 시계열 — 수익률만 사용한다
 */
export function spliceWithProxy(real: PriceSeries, proxy: PriceSeries): SplicedSeries {
  if (real.dates.length === 0) {
    throw new Error(`splice: 실제 시계열 비어 있음 (${real.symbol})`);
  }
  if (proxy.dates.length === 0) {
    throw new Error(`splice: 프록시 시계열 비어 있음 (${proxy.symbol})`);
  }

  const realFirstDate = real.dates[0];
  const anchorValue = real.values[0];

  // 프록시에서 realFirstDate 이하인 마지막 인덱스 = 앵커 위치.
  let anchorIdx = -1;
  for (let i = 0; i < proxy.dates.length; i++) {
    if (proxy.dates[i] <= realFirstDate) anchorIdx = i;
    else break;
  }

  const preDates: string[] = [];
  const preValues: number[] = [];

  if (anchorIdx > 0) {
    // 앵커 인덱스 자체는 실제 상품 최초일과 같은 값으로 취급하므로 결과에 넣지 않는다
    // (중복/이중계상 방지). anchorIdx-1 부터 역방향으로 체인.
    const chained: number[] = new Array<number>(anchorIdx).fill(0);
    let next = anchorValue; // proxy[anchorIdx] 위치의 합성값
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const p0 = proxy.values[i];
      const p1 = proxy.values[i + 1];
      const ret = p1 / p0 - 1; // i → i+1 수익률
      const cur = next / (1 + ret); // = next * p0 / p1
      chained[i] = cur;
      next = cur;
    }
    for (let i = 0; i < anchorIdx; i++) {
      preDates.push(proxy.dates[i]);
      preValues.push(chained[i]);
    }
  }

  return {
    symbol: real.symbol,
    dates: [...preDates, ...real.dates],
    values: [...preValues, ...real.values],
    realFirstDate,
    proxySymbol: proxy.symbol,
    proxyRowCount: preDates.length,
    realRowCount: real.dates.length,
  };
}

/** USD 시계열을 일별 USD/KRW로 환산해 KRW 시계열로 만든다(프록시 전용 레그용). */
export function toKrwSeries(usd: PriceSeries, usdKrwByDate: Map<string, number>): PriceSeries {
  const dates: string[] = [];
  const values: number[] = [];
  let lastRate: number | null = null;
  for (let i = 0; i < usd.dates.length; i++) {
    const d = usd.dates[i];
    const r = usdKrwByDate.get(d);
    if (typeof r === 'number' && isFinite(r) && r > 0) lastRate = r;
    if (lastRate === null) continue; // 환율 데이터 시작 전 구간은 버린다
    dates.push(d);
    values.push(usd.values[i] * lastRate);
  }
  return { symbol: usd.symbol, dates, values };
}
