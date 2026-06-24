import { SymbolSearchResult } from '../types';

// 앱 전용 특수 종목 (백엔드 시세는 별도 코드로 처리). 검색 결과에 우선 노출된다.
// 키리스 검색(symbolListService)과 AI 검색(geminiService) 양쪽에서 공유한다.
export const SPECIAL_ASSETS: SymbolSearchResult[] = [
  {
    ticker: 'KRX-GOLD',
    name: 'KRX 금현물',
    exchange: 'KRX (코스피/코스닥)',
  },
];

// 특수 종목 검색 키워드 매핑
// 주의: '금'/'gold'를 부분일치(includes)로 잡으면 '금융','예금','지금','goldman' 등이
// 오탐된다. 짧고 모호한 키워드는 '정확히 일치'할 때만, 명확한 코드/티커는 부분일치 허용.
export function findSpecialAsset(query: string): SymbolSearchResult | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const exactKeywords = ['금', '골드', 'gold', '금현물', 'krx금', 'krx 금'];
  const codeKeywords = ['krx-gold', 'krx gold', 'm04020000'];

  if (exactKeywords.includes(q) || codeKeywords.some(kw => q.includes(kw))) {
    return SPECIAL_ASSETS.find(a => a.ticker === 'KRX-GOLD') || null;
  }

  return null;
}
