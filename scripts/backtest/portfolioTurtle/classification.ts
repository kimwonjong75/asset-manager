// scripts/backtest/portfolioTurtle/classification.ts
// 순수 함수 — S-CORE-EXCL 적용범위(금·은·채권·지수추종 ETF는 B&H 고정, 나머지만 터틀) 분류.
// CSV 자산구분(assetClass) + 종목명 키워드 휴리스틱으로만 판단(실제 상관계수 측정 아님 — 근사).
// 개인정보 없음(로직만). 실제 분류 결과 목록은 run.ts가 DB/portfolioTurtle/(로컬)에 기록한다.

/** 자산구분 자체로 코어제외(B&H 고정) 대상인 분류. */
const CORE_EXCL_ASSET_CLASSES = new Set(['실물자산', '한국채권', '미국채권']);

/**
 * 지수추종 ETF 키워드 — 브랜드/지수명 중 "광범위 시장 추종"을 강하게 시사하는 것만 보수적으로 포함.
 * 매칭 안 되면 개별종목으로 간주해 터틀 대상에 남긴다(보수적 — symbolResolve.isKrEtfName와 동일 원칙).
 */
const INDEX_ETF_NAME_KEYWORDS = [
  '200', 'KOSPI', '코스피', 'S&P', 'NASDAQ 100', 'NASDAQ100', '나스닥100', '나스닥 100',
  'MSCI', 'TOTAL MARKET', '전체', 'ACWI', '러셀', 'RUSSELL',
];

/** 지수추종을 시사하는 티커(시장 전체를 추종하는 대표 상장지수펀드). */
const INDEX_ETF_TICKERS = new Set(['SPY', 'IVV', 'VOO', 'VTI', 'QQQ', 'DIA', 'IWM', 'EFA', 'EEM', 'ACWI']);

export interface ClassificationInput {
  ticker: string;
  name: string;
  assetClass: string;
  isKrEtf: boolean;
}

export type ScopeClass = 'CORE_EXCL_BH' | 'SATELLITE_TURTLE';

/** 이름에 지수추종 키워드가 있으면 true(보수적 — 매칭 안 되면 false). */
export function isIndexTrackingName(name: string): boolean {
  const upper = name.toUpperCase();
  return INDEX_ETF_NAME_KEYWORDS.some(k => upper.includes(k.toUpperCase()));
}

/**
 * S-CORE-EXCL 적용범위 분류 — CORE_EXCL_BH면 그 티커는 이 적용범위 실행에서 항상 B&H(매매 대상 제외),
 * SATELLITE_TURTLE이면 완전한 터틀 사이클 대상.
 */
export function classifyScope(inp: ClassificationInput): ScopeClass {
  if (CORE_EXCL_ASSET_CLASSES.has(inp.assetClass)) return 'CORE_EXCL_BH';
  if (inp.isKrEtf && isIndexTrackingName(inp.name)) return 'CORE_EXCL_BH';
  if (INDEX_ETF_TICKERS.has(inp.ticker)) return 'CORE_EXCL_BH';
  return 'SATELLITE_TURTLE';
}
