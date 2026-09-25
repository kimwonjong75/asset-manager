// scripts/backtest/holdingsTurtleCycle/costs.ts
// 순수 비용 모델. 기존 conditionalChannel 매도세 스케줄(getKrSellTaxBps)을 재사용한다(재발명 금지).
//
// 기본 편도율(연구용 가정): 코인 0.05%, 그 외 0.1%.
// 한국 개별주(KRW·비-ETF) 매도에만 증권거래세(getKrSellTaxBps, 시행일 기준) 추가.
// 비용 3단계(0/기본/2배)는 **편도율+세금 합산액**에 그대로 곱한다 — 세금도 2배 티어에서는 함께 스케일된다
// (법정세율을 별도로 취급하지 않는 단순화 — 보고서에 명시).

import { getKrSellTaxBps } from '../conditionalChannel/pipeline/corporateActions';
import type { Currency } from './symbolResolve';

export interface CostInputs {
  currency: Currency;
  isCryptoTicker: boolean;
  isKrEtf: boolean;
}

/** 기본 편도 슬리피지+수수료율 (배수 적용 전). */
export function baseOneWayRate(inp: CostInputs): number {
  return inp.isCryptoTicker ? 0.0005 : 0.001;
}

/** 매도 시 한국 개별주(비-ETF, KRW) 증권거래세 bps → 비율. 스케줄 밖 날짜는 0(임의값 대체 금지). */
export function krSellTaxRate(inp: CostInputs, tradeDateISO: string): number {
  if (inp.currency !== 'KRW' || inp.isCryptoTicker || inp.isKrEtf) return 0;
  const bps = getKrSellTaxBps(tradeDateISO);
  return bps === null ? 0 : bps / 10000;
}

export interface CostRates {
  buyRate: number;
  sellRate: number;
}

/** costMultiplier ∈ {0, 1, 2} — 비용 3단계. 0=완전 무비용 기준선, 1=기본, 2=2배(세금 포함 스케일). */
export function computeCostRates(inp: CostInputs, tradeDateISO: string, costMultiplier: number): CostRates {
  const oneWay = baseOneWayRate(inp);
  const tax = krSellTaxRate(inp, tradeDateISO);
  return {
    buyRate: oneWay * costMultiplier,
    sellRate: (oneWay + tax) * costMultiplier,
  };
}
