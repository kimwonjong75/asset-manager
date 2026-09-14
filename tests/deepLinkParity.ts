// tests/deepLinkParity.ts
// utils/deepLink.ts 골든 테스트. 수동 실행: npm run test:deeplink (tsx). 통과 시 exit 0.

import { parseDeepLink, resolveTabAlias } from '../utils/deepLink';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

check('빈 문자열 → null', parseDeepLink(''), null);
check('물음표만 → null', parseDeepLink('?'), null);
check('tab도 asset도 없음(무관한 파라미터만) → null', parseDeepLink('?utm_source=kakao'), null);
check('tab 없음 + asset(id) 있음 → portfolio 기본값', parseDeepLink('?asset=abc'), { tab: 'portfolio', assetRef: { kind: 'id', id: 'abc' } });
check('tab 없음 + asset(ticker:exchange) 있음 → portfolio 기본값', parseDeepLink('?asset=005930:KRX'), { tab: 'portfolio', assetRef: { kind: 'ticker', ticker: '005930', exchange: 'KRX' } });
check("tab=today → 파서는 today 그대로 반환(구 카톡 링크 호환 — 홈 변환은 resolveTabAlias가 setActiveTab 시점에)", parseDeepLink('?tab=today'), { tab: 'today', assetRef: null });
check('tab=today + asset(id) 형태(파서는 today 유지, 별칭은 나중에)', parseDeepLink('?tab=today&asset=abc123'), { tab: 'today', assetRef: { kind: 'id', id: 'abc123' } });
check('tab=watchlist + asset(ticker:exchange) 형태', parseDeepLink('?tab=watchlist&asset=005930:KRX'), { tab: 'watchlist', assetRef: { kind: 'ticker', ticker: '005930', exchange: 'KRX' } });
check('tab=portfolio, asset 없음', parseDeepLink('?tab=portfolio'), { tab: 'portfolio', assetRef: null });
check('허용 목록 밖 탭(replay) → null', parseDeepLink('?tab=replay'), null);
check('허용 목록 밖 탭(execution) → null', parseDeepLink('?tab=execution'), null);
check('선행 ? 없어도 파싱', parseDeepLink('tab=guide'), { tab: 'guide', assetRef: null });
check('analytics + 미국 티커', parseDeepLink('?tab=analytics&asset=AAPL:NASDAQ'), { tab: 'analytics', assetRef: { kind: 'ticker', ticker: 'AAPL', exchange: 'NASDAQ' } });
check('콜론이 마지막 글자면 id로 취급', parseDeepLink('?tab=settings&asset=xyz:'), { tab: 'settings', assetRef: { kind: 'id', id: 'xyz:' } });
check('콜론이 첫 글자면 id로 취급', parseDeepLink('?tab=settings&asset=:xyz'), { tab: 'settings', assetRef: { kind: 'id', id: ':xyz' } });
check('무관한 파라미터는 무시(tab 있음)', parseDeepLink('?utm_source=kakao&tab=cleanup'), { tab: 'cleanup', assetRef: null });
check('대소문자 불일치 탭 → null', parseDeepLink('?tab=Dashboard'), null);
check('tab=dashboard(신규 카톡 링크) + asset', parseDeepLink('?tab=dashboard&asset=abc123'), { tab: 'dashboard', assetRef: { kind: 'id', id: 'abc123' } });

// ── resolveTabAlias: 폐지 탭 별칭(영구 유지 — 발송된 카톡 ?tab=today 링크 회수 불가) ──
check("resolveTabAlias('today') → dashboard", resolveTabAlias('today'), 'dashboard');
check("resolveTabAlias('execution') → dashboard", resolveTabAlias('execution'), 'dashboard');
check("resolveTabAlias('portfolio') → portfolio(불변)", resolveTabAlias('portfolio'), 'portfolio');
check("resolveTabAlias('dashboard') → dashboard(불변)", resolveTabAlias('dashboard'), 'dashboard');
// 파서 → 별칭 합성 경로(구 카톡 링크 전체 흐름)
check('구 카톡 링크 ?tab=today&asset= → 최종 dashboard', resolveTabAlias(parseDeepLink('?tab=today&asset=abc123')?.tab ?? 'portfolio'), 'dashboard');

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ deepLink parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ deepLink parity 전체 통과 (${pass} 단언)`);
