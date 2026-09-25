// scripts/backtest/holdingsTurtleCycle/symbolResolve.ts
// 순수 함수 — CSV 행(거래소·티커·종목명)에서 통화·조회심볼·코인여부·KRX ETF여부를 결정한다.
// 개인정보 없음(로직만). 실제 보유 티커·금액은 이 파일에 하드코딩하지 않는다.

export type Currency = 'KRW' | 'USD' | 'JPY';

/** 한국 ETF 브랜드/법정용어 키워드 — 매도세 면제 판정용 휴리스틱(보수적: 매칭 안 되면 개별주로 간주해 세금 부과). */
const ETF_NAME_KEYWORDS = [
  'ETF', 'ETN', '상장지수', 'KODEX', 'TIGER', 'ACE', 'SOL ', 'KBSTAR', 'RISE', 'ARIRANG',
  'KOSEF', 'PLUS ', 'HANARO', 'KINDEX', 'FOCUS', 'SMART',
];

/** 이름에 ETF 브랜드/법정용어가 있으면 true. 대소문자 무시. */
export function isKrEtfName(name: string): boolean {
  const upper = name.toUpperCase();
  return ETF_NAME_KEYWORDS.some(k => upper.includes(k.toUpperCase()));
}

const CRYPTO_SPOT_TICKERS = new Set(['BTC', 'ETH', 'SOL']);

export interface ExchangeClass {
  currency: Currency;
  /** "주요 거래소 (종합)" 등 현물 코인 거래소 표기 — 심볼에 -USD 접미가 필요하다는 신호. */
  isCryptoExchange: boolean;
}

/** 거래소 표기 문자열 → 통화 + 코인거래소 여부. 순수. */
export function classifyExchange(exchange: string): ExchangeClass {
  const s = exchange ?? '';
  if (s.includes('KRX')) return { currency: 'KRW', isCryptoExchange: false };
  if (s.includes('도쿄') || s.includes('TYO') || s.includes('Tokyo') || s.includes('TSE')) {
    return { currency: 'JPY', isCryptoExchange: false };
  }
  if (s.includes('종합')) return { currency: 'USD', isCryptoExchange: true };
  return { currency: 'USD', isCryptoExchange: false };
}

export interface ResolvedSymbol {
  ticker: string;
  fetchSymbol: string;
  currency: Currency;
  isCryptoTicker: boolean;
  isKrEtf: boolean;
}

/**
 * CSV 한 행(또는 중복합산 후 대표행)에서 조회 심볼과 통화 규약을 결정한다.
 * · KRX(코스피/코스닥): 6자리(또는 신형 영숫자) 코드 그대로 — .KS 접미는 백엔드가 거부한다(실측, reprUniverse.ts 참고).
 * · 도쿄: CSV 표기 자체가 이미 야후 형식(`8002.T`)이라 그대로 사용.
 * · "주요 거래소 (종합)"(코인 현물): 티커 + "-USD" (BTC→BTC-USD 등).
 * · 그 외(NYSE/NASDAQ/NYSE Arca/NYSE AMERICA 등): 티커 그대로.
 */
export function resolveSymbol(row: { ticker: string; exchange: string; name: string }): ResolvedSymbol {
  const { currency, isCryptoExchange } = classifyExchange(row.exchange);
  const isCryptoTicker = isCryptoExchange && CRYPTO_SPOT_TICKERS.has(row.ticker);
  const fetchSymbol = isCryptoTicker ? `${row.ticker}-USD` : row.ticker;
  const isKrEtf = currency === 'KRW' && isKrEtfName(row.name);
  return { ticker: row.ticker, fetchSymbol, currency, isCryptoTicker, isKrEtf };
}
