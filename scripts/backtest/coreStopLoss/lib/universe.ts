// scripts/backtest/coreStopLoss/lib/universe.ts
// 코어(정적배분) 손절 연구 유니버스 — 연구 전용(앱/백엔드 무접촉).
// 사용자의 목표 정적배분 14종(GRVT 채권펀드는 의도적 제외, 비중 재정규화 안 함 ≈96%)
// + 장기구간 확장을 위한 미국상장 대체 프록시 6종 = 총 20종.
//
// KRX 상장 종목은 Yahoo 조회 시 `.KS` 접미사가 필요하다.

export type Track = 'kr-equity' | 'us-equity' | 'em-equity' | 'bond' | 'commodity' | 'proxy-extension';

export interface UniverseEntry {
  symbol: string;
  label: string;
  track: Track;
  /** 최근 유동성(평균 일 거래대금)의 표기 통화 — 시장별로 다르다. */
  currency: 'USD' | 'KRW' | 'JPY';
  /** 프로브(가용 여부/정확 티커 미확정) 여부 — 감사에서 데이터 유무를 보고. */
  probe?: boolean;
  /** 상장 추정일·프록시 사유 등 참고 메모. */
  note?: string;
}

// 1. 한국주식
export const KR_EQUITY: UniverseEntry[] = [
  { symbol: '069500.KS', label: 'KODEX 200', track: 'kr-equity', currency: 'KRW', note: '한국주식' },
];

// 2~3. 미국주식(가치/성장)
export const US_EQUITY: UniverseEntry[] = [
  {
    symbol: '474800.KS',
    label: 'KIWOOM 미국원유에너지',
    track: 'us-equity',
    currency: 'KRW',
    note: '미국가치(에너지), 2024-01 상장 추정 — 감사로 확인',
  },
  {
    symbol: '379810.KS',
    label: 'KODEX 미국나스닥100',
    track: 'us-equity',
    currency: 'KRW',
    note: '미국성장, 2021-04 상장 추정 — 감사로 확인',
  },
];

// 4~9. 신흥/개별국가 (KRX 상품이 없거나 프록시 대체)
export const EM_EQUITY: UniverseEntry[] = [
  { symbol: 'EIS', label: '이스라엘 프록시', track: 'em-equity', currency: 'USD', note: '프록시(KRX 상품 없음)' },
  {
    symbol: '283580.KS',
    label: 'KODEX 차이나CSI300',
    track: 'em-equity',
    currency: 'KRW',
    probe: true,
    note: '정확 상장일 미확인 — 감사로 확인',
  },
  {
    symbol: '372330.KS',
    label: 'KODEX 차이나항셍테크',
    track: 'em-equity',
    currency: 'KRW',
    probe: true,
    note: '정확 상장일 미확인 — 감사로 확인',
  },
  { symbol: 'ECH', label: '칠레 프록시', track: 'em-equity', currency: 'USD', note: '프록시' },
  { symbol: 'EWZ', label: '브라질 프록시', track: 'em-equity', currency: 'USD', note: '프록시' },
  { symbol: 'EIDO', label: '인도네시아 프록시', track: 'em-equity', currency: 'USD', note: '프록시' },
];

// 10~11. 채권
export const BOND: UniverseEntry[] = [
  {
    symbol: '385560.KS',
    label: 'RISE KIS국고채30Enhanced',
    track: 'bond',
    currency: 'KRW',
    note: '한국채권30년, 2021-05 상장 추정 — 감사로 확인',
  },
  {
    symbol: '464470.KS',
    label: 'PLUS 미국채30액티브',
    track: 'bond',
    currency: 'KRW',
    note: '미국채권30년, 2023-08 상장 추정 — 감사로 확인',
  },
];

// 12~14. 원자재
export const COMMODITY: UniverseEntry[] = [
  {
    symbol: '411060.KS',
    label: 'ACE KRX금현물',
    track: 'commodity',
    currency: 'KRW',
    note: '금, 2021-12 상장 추정 — 감사로 확인',
  },
  {
    symbol: 'SLV',
    label: '은 프록시(SLV)',
    track: 'commodity',
    currency: 'USD',
    note: '한국 TIGER은액티브(상장 4개월) 대신 SLV 대체 결정',
  },
  {
    symbol: '160580.KS',
    label: 'TIGER 구리실물',
    track: 'commodity',
    currency: 'KRW',
    note: '구리, 2012-12 상장(14년 이력 확인됨) — 감사로 확인',
  },
];

// 15~20. 장기구간 확장용 미국상장 대체 프록시(백테스트 지평 확장 목적).
export const PROXY_EXTENSION: UniverseEntry[] = [
  { symbol: 'XLE', label: '에너지 프록시', track: 'proxy-extension', currency: 'USD', note: '#2(474800.KS) 장기 대체' },
  { symbol: 'QQQ', label: '나스닥 프록시', track: 'proxy-extension', currency: 'USD', note: '#3(379810.KS) 장기 대체' },
  { symbol: 'ASHR', label: 'CSI300 프록시', track: 'proxy-extension', currency: 'USD', note: '#5(283580.KS) 장기 대체' },
  { symbol: 'KWEB', label: '항셍테크 유사 프록시', track: 'proxy-extension', currency: 'USD', note: '#6(372330.KS) 장기 대체 근사' },
  { symbol: 'TLT', label: '미국장기채 프록시', track: 'proxy-extension', currency: 'USD', note: '#11(464470.KS) 장기 대체' },
  { symbol: 'GLD', label: '금 프록시', track: 'proxy-extension', currency: 'USD', note: '#12(411060.KS) 장기 대체' },
];

// 트랙 순서(리포트 그룹핑 순서).
export const TRACKS: { track: Track; label: string; entries: UniverseEntry[] }[] = [
  { track: 'kr-equity', label: '한국주식', entries: KR_EQUITY },
  { track: 'us-equity', label: '미국주식(가치/성장)', entries: US_EQUITY },
  { track: 'em-equity', label: '신흥/개별국가', entries: EM_EQUITY },
  { track: 'bond', label: '채권(장기)', entries: BOND },
  { track: 'commodity', label: '원자재(금/은/구리)', entries: COMMODITY },
  { track: 'proxy-extension', label: '장기 확장용 프록시(미국상장)', entries: PROXY_EXTENSION },
];

// 전체 종목 평탄화.
export const ALL_ENTRIES: UniverseEntry[] = TRACKS.flatMap(t => t.entries);
