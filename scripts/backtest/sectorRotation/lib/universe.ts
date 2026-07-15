// scripts/backtest/sectorRotation/lib/universe.ts
// 섹터/테마 로테이션 백테스트 유니버스(트랙별) — 연구 전용.
// 시장(통화)별 유동성 라벨/체결 현실성 판단을 위해 각 종목에 track 을 붙인다.

export type Track =
  | 'Global'
  | 'US-Sector'
  | 'KR-Sector'
  | 'KR-Broad'
  | 'JP-Sector'
  | 'CN-Sector';

export interface UniverseEntry {
  symbol: string;
  label: string;
  track: Track;
  /** 최근 유동성(평균 일 거래대금)의 표기 통화 — 시장별로 다르다. */
  currency: 'USD' | 'KRW' | 'JPY';
  /** 프로브(가용 여부 미확정) 여부 — 감사에서 데이터 유무를 보고. */
  probe?: boolean;
  /** ADR/USD 상장 등 참고 메모. */
  note?: string;
}

// 글로벌: 미국/한국/일본/중국/금/원자재 (전부 美상장 USD)
export const GLOBAL: UniverseEntry[] = [
  { symbol: 'SPY', label: '미국', track: 'Global', currency: 'USD' },
  { symbol: 'EWY', label: '한국', track: 'Global', currency: 'USD' },
  { symbol: 'EWJ', label: '일본', track: 'Global', currency: 'USD' },
  { symbol: 'MCHI', label: '중국', track: 'Global', currency: 'USD' },
  { symbol: 'GLD', label: '금', track: 'Global', currency: 'USD' },
  { symbol: 'DBC', label: '원자재', track: 'Global', currency: 'USD' },
];

// 미국 섹터 고정 9종
export const US_SECTOR_FIXED: UniverseEntry[] = [
  { symbol: 'XLK', label: '기술', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLV', label: '헬스케어', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLF', label: '금융', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLE', label: '에너지', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLI', label: '산업재', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLY', label: '경기소비재', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLP', label: '필수소비재', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLU', label: '유틸리티', track: 'US-Sector', currency: 'USD' },
  { symbol: 'XLB', label: '소재', track: 'US-Sector', currency: 'USD' },
];

// 미국 섹터 동적 추가(나중 상장): 부동산/커뮤니케이션
export const US_SECTOR_DYNAMIC: UniverseEntry[] = [
  { symbol: 'XLRE', label: '부동산', track: 'US-Sector', currency: 'USD', note: '2015 상장' },
  { symbol: 'XLC', label: '커뮤니케이션', track: 'US-Sector', currency: 'USD', note: '2018 상장' },
];

// 한국 섹터 ETF (Yahoo .KS, KRW)
export const KR_SECTOR: UniverseEntry[] = [
  { symbol: '091160.KS', label: '반도체', track: 'KR-Sector', currency: 'KRW' },
  { symbol: '091170.KS', label: '은행', track: 'KR-Sector', currency: 'KRW' },
  { symbol: '091180.KS', label: '자동차', track: 'KR-Sector', currency: 'KRW' },
  { symbol: '143860.KS', label: '헬스케어', track: 'KR-Sector', currency: 'KRW' },
  { symbol: '266360.KS', label: 'IT', track: 'KR-Sector', currency: 'KRW' },
  { symbol: '305720.KS', label: '2차전지', track: 'KR-Sector', currency: 'KRW' },
];

// 한국 광의 지수
export const KR_BROAD: UniverseEntry[] = [
  { symbol: '^KS11', label: 'KOSPI', track: 'KR-Broad', currency: 'KRW' },
  { symbol: '^KQ11', label: 'KOSDAQ', track: 'KR-Broad', currency: 'KRW' },
];

// 일본 섹터 (프로브 세트, .T, JPY) — TOPIX-17 계열 섹터 ETF.
// 어느 것이 실제로 데이터를 주는지는 감사에서 보고.
export const JP_SECTOR: UniverseEntry[] = [
  { symbol: '1615.T', label: '은행', track: 'JP-Sector', currency: 'JPY', probe: true },
  { symbol: '1617.T', label: 'TOPIX-17 섹터(프로브)', track: 'JP-Sector', currency: 'JPY', probe: true },
  { symbol: '1621.T', label: 'TOPIX-17 섹터(프로브)', track: 'JP-Sector', currency: 'JPY', probe: true },
  { symbol: '1622.T', label: 'TOPIX-17 섹터(프로브)', track: 'JP-Sector', currency: 'JPY', probe: true },
  { symbol: '1625.T', label: 'TOPIX-17 섹터(프로브)', track: 'JP-Sector', currency: 'JPY', probe: true },
];

// 중국 섹터 (美상장 ADR, USD) — ADR/USD 특성 주의.
export const CN_SECTOR: UniverseEntry[] = [
  { symbol: 'KWEB', label: '중국인터넷', track: 'CN-Sector', currency: 'USD', note: 'ADR/USD' },
  { symbol: 'CQQQ', label: '중국기술', track: 'CN-Sector', currency: 'USD', note: 'ADR/USD' },
];

// 트랙 순서(리포트 그룹핑 순서).
export const TRACKS: { track: Track; label: string; entries: UniverseEntry[] }[] = [
  { track: 'Global', label: '글로벌(국가/금/원자재)', entries: GLOBAL },
  { track: 'US-Sector', label: '미국 섹터', entries: [...US_SECTOR_FIXED, ...US_SECTOR_DYNAMIC] },
  { track: 'KR-Sector', label: '한국 섹터 ETF', entries: KR_SECTOR },
  { track: 'KR-Broad', label: '한국 광의 지수', entries: KR_BROAD },
  { track: 'JP-Sector', label: '일본 섹터 ETF(프로브)', entries: JP_SECTOR },
  { track: 'CN-Sector', label: '중국 섹터(美상장 ADR)', entries: CN_SECTOR },
];

// 전체 종목 평탄화.
export const ALL_ENTRIES: UniverseEntry[] = TRACKS.flatMap(t => t.entries);
