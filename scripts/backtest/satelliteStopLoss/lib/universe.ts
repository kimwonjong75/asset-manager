// scripts/backtest/satelliteStopLoss/lib/universe.ts
// 투더문(위성) 손절 연구 유니버스 — 연구 전용(앱/백엔드 무접촉).
//
// 사용자가 지정한 보유 31종목. **종목명만 근거**로 삼는다:
// 실제 보유수량/매수가/수익률 등은 일체 사용하지 않고 전 종목 균등비중으로 취급한다.
// (과거 세션의 CORE/SATELLITE_TURTLE/EXIT_LEGACY 분류·universe.json 은 참조하지 않는다.)
//
// KRX 종목은 Yahoo 조회 시 시장 접미사가 필요하다: 코스피 `.KS`, 코스닥 `.KQ`.
// 시장이 불확실한 종목은 altSymbols 에 대체 접미사를 넣어 두고 lib/resolve.ts 가 순차 프로브한다.

export type Track = 'kr-equity' | 'kr-reit' | 'kr-etf' | 'us-equity' | 'us-etf';

export interface UniverseEntry {
  /** 사용자가 준 한글 종목명(유일 식별자 역할). */
  name: string;
  /** 1순위 티커 후보. */
  symbol: string;
  /** 1순위 실패 시 순차로 시도할 대체 티커. */
  altSymbols?: string[];
  track: Track;
  /** 호가 통화 — KRW 종목은 환산 없음, USD 종목은 일별 USD/KRW 환산. */
  currency: 'USD' | 'KRW';
  /** 티커 확실성. 'confirmed' = 널리 알려진 티커, 'probe' = 감사에서 확인 필요. */
  confidence: 'confirmed' | 'probe';
  note?: string;
}

export const TRACK_LABELS: Record<Track, string> = {
  'kr-equity': '국내 주식',
  'kr-reit': '국내 리츠',
  'kr-etf': '국내 ETF',
  'us-equity': '미국 주식',
  'us-etf': '미국 ETF',
};

export const ALL_ENTRIES: UniverseEntry[] = [
  // ── 미국 상장 ──────────────────────────────────────────────
  { name: '월트 디즈니 회사', symbol: 'DIS', track: 'us-equity', currency: 'USD', confidence: 'confirmed' },
  { name: 'AT&T 주식회사', symbol: 'T', track: 'us-equity', currency: 'USD', confidence: 'confirmed' },
  { name: '아마존닷컴', symbol: 'AMZN', track: 'us-equity', currency: 'USD', confidence: 'confirmed' },
  { name: '알파벳', symbol: 'GOOGL', track: 'us-equity', currency: 'USD', confidence: 'confirmed' },
  { name: 'Microsoft Corporation', symbol: 'MSFT', track: 'us-equity', currency: 'USD', confidence: 'confirmed' },
  {
    name: '에너지 셀렉트 섹터 SPDR ETF',
    symbol: 'XLE',
    track: 'us-etf',
    currency: 'USD',
    confidence: 'confirmed',
  },

  // ── 국내 주식(코스피 추정) ─────────────────────────────────
  { name: '유한양행보통주', symbol: '000100.KS', altSymbols: ['000100.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '풍산', symbol: '103140.KS', altSymbols: ['103140.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: 'NAVER', symbol: '035420.KS', altSymbols: ['035420.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '풀무원', symbol: '017810.KS', altSymbols: ['017810.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '오뚜기', symbol: '007310.KS', altSymbols: ['007310.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '한샘', symbol: '009240.KS', altSymbols: ['009240.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '셀트리온', symbol: '068270.KS', altSymbols: ['068270.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '보령', symbol: '003850.KS', altSymbols: ['003850.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '녹십자', symbol: '006280.KS', altSymbols: ['006280.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '롯데케미칼', symbol: '011170.KS', altSymbols: ['011170.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '티와이홀딩스', symbol: '363280.KS', altSymbols: ['363280.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  { name: '카카오', symbol: '035720.KS', altSymbols: ['035720.KQ'], track: 'kr-equity', currency: 'KRW', confidence: 'confirmed' },
  {
    name: '대한조선',
    symbol: '439260.KS',
    altSymbols: ['439260.KQ'],
    track: 'kr-equity',
    currency: 'KRW',
    confidence: 'probe',
    note: '최근 상장 추정 — 이력이 짧을 수 있음',
  },

  // ── 국내 리츠 ──────────────────────────────────────────────
  { name: '신한알파리츠', symbol: '293940.KS', altSymbols: ['293940.KQ'], track: 'kr-reit', currency: 'KRW', confidence: 'confirmed' },
  { name: '케이탑리츠', symbol: '145270.KS', altSymbols: ['145270.KQ'], track: 'kr-reit', currency: 'KRW', confidence: 'confirmed' },

  // ── 국내 주식(코스닥 추정 — .KQ 우선) ───────────────────────
  { name: '고려신용정보', symbol: '049720.KQ', altSymbols: ['049720.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },
  { name: '테고사이언스', symbol: '191420.KQ', altSymbols: ['191420.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },
  { name: 'KG모빌리언스(주)', symbol: '046440.KQ', altSymbols: ['046440.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },
  { name: 'SBI인베스트먼트', symbol: '019550.KQ', altSymbols: ['019550.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },
  { name: '인선이엔티', symbol: '060150.KQ', altSymbols: ['060150.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },
  { name: '일진다이아몬드', symbol: '081000.KQ', altSymbols: ['081000.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },
  { name: '효성ITX', symbol: '094280.KQ', altSymbols: ['094280.KS'], track: 'kr-equity', currency: 'KRW', confidence: 'probe' },

  // ── 국내 ETF ───────────────────────────────────────────────
  {
    name: 'TIGER 글로벌AI사이버보안',
    symbol: '418670.KS',
    altSymbols: ['418670.KQ'],
    track: 'kr-etf',
    currency: 'KRW',
    confidence: 'probe',
    note: '2022년 상장 추정',
  },
  {
    name: '한화 ARIRANG PLUS K방산 ETF',
    symbol: '449450.KS',
    altSymbols: ['449450.KQ'],
    track: 'kr-etf',
    currency: 'KRW',
    confidence: 'probe',
    note: '2023년 상장 추정',
  },
  {
    name: 'SOL 조선기자재',
    symbol: '0141S0.KS',
    altSymbols: ['0141S0.KQ', '141S0.KS'],
    track: 'kr-etf',
    currency: 'KRW',
    confidence: 'probe',
    note: 'KRX 신규 6자리 영숫자 코드체계 — Yahoo 미수록 가능성 있음',
  },
];

/** 트랙 그룹핑 순서(리포트 표시용). */
export const TRACK_ORDER: Track[] = ['kr-equity', 'kr-reit', 'kr-etf', 'us-equity', 'us-etf'];
