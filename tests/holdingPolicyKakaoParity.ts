// 실제 GAS 진입점과 카카오·텔레그램 전송 본문을 검사한다. 모든 I/O는 메모리 안에서 끝난다.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HoldingPolicyControl from '../components/portfolio-table/HoldingPolicyControl';
import { computeAssetMetrics } from '../utils/portfolioMetrics';
import { holdingPolicyFxRate } from '../utils/holdingPolicyFx';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../types/turtleHoldings';
import { buildTurtleHoldingsLegacyRow, buildTurtleHoldingsWatchRow, computeManagedEquity, describeHoldingsCoverage, summarizeTurtleHoldingsRows } from '../utils/turtleHoldingsView';
import { Currency, type Asset, type WatchlistItem } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import { buildNotifyManifest } from '../utils/notifyManifest';
import type { HoldingPolicy } from '../types/holdingPolicy';
import type { RawSeries } from '../utils/todayTurtle';

const stock = DEFAULT_CATEGORIES.find(c => c.baseType === 'KOREAN_STOCK')!.id;
const start = '2026-11-23';
let day = start;
const time = () => Date.parse(day + 'T08:15:00Z'); // 17:15 KST, 확정 후이며 정숙시간 밖
const props = new Map<string, string>([
  ['SHARED_SECRET', 'fixture'], ['KAKAO_ACCESS_TOKEN', 'fixture'], ['KAKAO_ACCESS_EXPIRES_AT', String(Date.parse('2030-01-01'))],
]);
const files = new Map<string, string>();
const messages: { text: string; link: { web_url: string; mobile_web_url: string } }[] = [];
const telegramChatId = 715001;
let telegramChatType = 'private';
const telegramCalls: string[] = [];
const telegramMessages: string[] = [];
const closes: Record<string, number> = {};
for (let n = 100; n > 0; n--) {
  const d = new Date(Date.parse(start) - n * 86_400_000);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) closes[d.toISOString().slice(0, 10)] = 90;
}
Object.assign(closes, { [start]: 102, '2026-11-24': 70, '2026-11-25': 69, '2026-11-26': 140, '2026-11-27': 150 });
const missing = new Set<string>();
const shift = (input: Record<string, number>, step: number) => Object.fromEntries(Object.entries(input).map(([d, v]) => [d, v + step]));
function history(ticker: string): RawSeries {
  const data = Object.fromEntries(Object.entries(closes).filter(([d]) => d <= day && !missing.has(ticker + d)));
  return ticker === 'USD/KRW' ? { data: Object.fromEntries(Object.keys(data).map(d => [d, 1400])) }
    : { data, open: data, high: shift(data, 1), low: shift(data, -1) };
}
const testClock = new Proxy(Date, {
  construct: (target, args) => Reflect.construct(target, args.length ? args : [time()]),
  get: (target, key) => key === 'now' ? time : Reflect.get(target, key),
});
function fileHandle(id: string) {
  return { getId: () => id, getBlob: () => ({ getDataAsString: () => files.get(id) }),
    setContent: (value: string) => { files.set(id, value); return fileHandle(id); } };
}
const globals = vm.createContext({
  Date: testClock, console,
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v),
    deleteProperty: (k: string) => props.delete(k), getProperties: () => Object.fromEntries(props),
  }) },
  DriveApp: { getFileById: fileHandle, createFile: (id: string, contents: string) => { files.set(id, contents); return fileHandle(id); } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }) },
  UrlFetchApp: { fetch: (url: string, opts: { payload: string }) => {
    let result: unknown;
    if (url.endsWith('/history')) {
      const { tickers } = JSON.parse(opts.payload) as { tickers: string[] };
      result = Object.fromEntries(tickers.map(t => [t, history(t)]));
    } else if (url === 'https://kapi.kakao.com/v2/api/talk/memo/default/send') {
      messages.push(JSON.parse(new URLSearchParams(opts.payload).get('template_object')!));
      result = { result_code: 0 };
    } else if (url === 'https://api.telegram.org/botfixture/getChat') {
      telegramCalls.push('getChat');
      assert.equal(JSON.parse(opts.payload).chat_id, String(telegramChatId));
      result = { ok: true, result: { id: telegramChatId, type: telegramChatType } };
    } else if (url === 'https://api.telegram.org/botfixture/sendMessage') {
      telegramCalls.push('sendMessage');
      const payload = JSON.parse(opts.payload) as { chat_id: string; text: string };
      assert.equal(payload.chat_id, String(telegramChatId));
      telegramMessages.push(payload.text);
      result = { ok: true, result: { message_id: 601, chat: { id: telegramChatId, type: telegramChatType }, text: payload.text } };
    } else throw new Error('모의 실행으로 허용되지 않은 호출 ' + url);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(result) };
  } },
});
vm.runInContext(buildSync({
  entryPoints: ['scripts/notify/gas/entry.ts'], bundle: true, write: false, format: 'iife',
  globalName: 'TradePlanNotify', platform: 'neutral', target: 'es2019', logLevel: 'silent',
}).outputFiles[0].text, globals);
const gas = globals.TradePlanNotify as {
  doPost: (event: { postData: { contents: string } }) => { ok: boolean; holdingPolicyVersion?: number; activations?: unknown[];
    duplicate?: boolean; messageId?: number; text?: string };
  closeCheck: () => void;
};
const policy = (mode: HoldingPolicy['mode'], cycleId: string): HoldingPolicy => ({ mode, sellCostPct: 1, startedOn: start, cycleId });
const asset = (id: string, holdingPolicy: HoldingPolicy, extra: Partial<Asset> = {}): Asset => ({
  id, categoryId: stock, ticker: 'SAME', exchange: 'KRX', name: '합성', quantity: 10, purchasePrice: 100,
  currency: Currency.KRW, currentPrice: 999, priceOriginal: 999, highestPrice: 999, purchaseDate: '2025-01-01', holdingPolicy, ...extra,
});
const exit = asset('one', policy('exit-at-cost', 'cycle-exit'));
const turtle = asset('two', policy('turtle-after-cost', 'cycle-turtle'), { owner: 'YUSEON' });
const hold = asset('held', policy('hold', 'cycle-hold'), { ticker: 'HOLD', name: '장기' });
const foreign = asset('foreign', { ...policy('exit-at-cost', 'cycle-fx'), confirmedUnitCostKRW: 140000 },
  { ticker: 'FX-CHECK', name: '환율확인', currency: Currency.USD });
function post(body: object, secret = 'fixture') {
  return gas.doPost({ postData: { contents: JSON.stringify({ ...body, secret }) } });
}
function sync(assets: Asset[], watchlist: WatchlistItem[] = []) {
  const manifest = buildNotifyManifest({ assets, watchlist, appUrl: 'https://example.test/', now: new Date(time()).toISOString(),
    turtleHoldingsSettings: { excludeFamilyOwner: false }, pyramidAlerts: false });
  assert.equal(manifest.items.length + manifest.turtle!.legacyHoldings.length + manifest.turtle!.watchItems.length, 0);
  const ack = post({ action: 'sync', manifest });
  assert.ok(ack.ok);
  assert.equal(ack.holdingPolicyVersion, 1);
  return ack;
}
function checkOn(date: string) {
  day = date;
  props.set('LAST_DIGEST_DATE', date); // 일반 시장 요약은 이 검사의 대상이 아니다.
  const offset = messages.length;
  gas.closeCheck();
  assert.ok(props.get('LAST_RUN_JSON')?.includes('"status":"ok"'));
  return messages.slice(offset);
}
// Home uses these same rows and headline; the mobile card renders HoldingPolicyControl.
// The oracle is fixed separately from GAS. No actual brokerage data, orders or messages are used.
const settings = { ...DEFAULT_TURTLE_HOLDINGS_SETTINGS, excludeFamilyOwner: false };
function screenRow(asset: Asset, now = new Date(time())) {
  const enriched = computeAssetMetrics(asset, { USD: 1500, JPY: 10 }, 100_000, { plBasis: 'native' });
  const row = buildTurtleHoldingsLegacyRow({ asset: enriched, raw: history(asset.ticker), isCrypto: false,
    fetchFailed: false, now, settings, policyFx: history('USD/KRW') });
  const html = renderToStaticMarkup(createElement(HoldingPolicyControl, { asset: enriched, row, onOpen: () => {} }));
  assert.ok(html.includes(row.reasonText), '모바일 카드에 홈과 같은 종목 사유 표시');
  if (row.holdingPolicyEvaluation?.phase === 'exit-ready' && asset.id === 'one') {
    assert.ok(html.includes('예상 순매도대금 1,010원 · 잔여 원금 1,000원'), '모바일 카드에 발송 본문과 같은 순매도대금·원금 표시');
  }
  return row;
}
function screenHeadline(assets: Asset[]) {
  const rows = assets.map(a => screenRow(a));
  return describeHoldingsCoverage(rows, summarizeTurtleHoldingsRows(rows)).headline;
}
missing.add('USD/KRW' + start);
assert.equal(holdingPolicyFxRate('USD', start, { data: { [start]: 999999 } }), null);
sync([exit, turtle, hold, foreign]);
const first = checkOn(start);
assert.equal(screenHeadline([exit, turtle, hold, foreign]), '본전 매도 검토 1개 · 터틀 감시 시작 1개');
assert.equal(screenRow(exit).holdingPolicyEvaluation?.netProceedsKRW, 1009.8);
assert.equal(screenRow(turtle).holdingPolicyEvaluation?.armedOn, start);
assert.equal(screenRow(hold).status, 'hold');
assert.equal(screenRow(foreign).status, 'unavailable');
// 15:01 KST: intraday close above cost must not arm either policy.
assert.equal(screenRow(turtle, new Date(start + 'T06:01:00Z')).holdingPolicyEvaluation?.phase, 'waiting');
assert.deepEqual(first.map(m => m.text.split('\n')[0]), ['[본전에서 정리] 합성 (원종)', '[터틀 감시 시작] 합성 (유선)']);
assert.match(first[0].text, /1,010원 · 잔여 원금 1,000원/);
assert.match(first[0].link.web_url, /asset=one$/);
assert.equal(first[0].link.web_url, first[0].link.mobile_web_url);
assert.deepEqual(checkOn(start), []); // 환율이 없어 다시 확인해도 이미 발송한 종목은 중복되지 않는다.
missing.delete('USD/KRW' + start);
assert.equal(screenRow(foreign).status, 'sell');
assert.deepEqual(checkOn(start).map(m => m.text.split('\n')[0]), ['[본전에서 정리] 환율확인 (원종)']);
assert.deepEqual(sync([exit, turtle, hold, foreign]).activations, [{ assetId: 'two', cycleId: 'cycle-turtle', armedOn: start }]);
const fall = checkOn('2026-11-24');
assert.equal(screenRow(exit).holdingPolicyEvaluation?.phase, 'waiting');
assert.equal(screenRow(turtle).holdingPolicyEvaluation?.phase, 'active');
assert.equal(screenRow(turtle).status, 'sell');
assert.equal(fall.length, 1);
assert.match(fall[0].text, /\[팔 때\].*합성 \(유선\)/);
assert.deepEqual(checkOn('2026-11-25'), []); // 같은 이탈이 이어지는 동안 개별 반복 없음.
day = '2026-11-26';
const watch: WatchlistItem = {
  id: 'watch', name: '합성', ticker: 'SAME', exchange: 'KRX', categoryId: stock, owner: 'YUSEON', isTurtleCandidate: true,
  holdingPolicy: { ...turtle.holdingPolicy!, armedOn: start }, turtleWatch: { soldAt: day, soldPriceOriginal: 139, source: 'turtle-exit' },
};
sync([hold, { ...exit, holdingPolicy: policy('hold', 'new') }], [watch]);
const watchRow = (enabled: boolean) => buildTurtleHoldingsWatchRow({
  watchItem: { ...watch, holdingPolicy: { ...watch.holdingPolicy!, pyramidingEnabled: enabled } },
  raw: history(watch.ticker), isCrypto: false, fetchFailed: false, now: new Date(time()), settings,
  effectiveManagedEquityKRW: 100_000_000, fxRate: 1, heldTickerKeys: new Set(),
});
assert.equal(watchRow(false).status, 'watching');
assert.deepEqual(checkOn(day), []); // 다른 소유자 보유는 허용하지만 실제 매도일 당일 재진입 금지.
assert.match(checkOn('2026-11-27')[0]?.text ?? '', /\[다시 살 때\].*합성 \(유선\)/);
const firstUnit = watchRow(false);
assert.equal(firstUnit.status, 'reentry');
assert.equal(firstUnit.rebuy?.nextPyramidPriceOriginal, null);
assert.ok((firstUnit.rebuy?.qty ?? 0) > 0);
assert.equal(firstUnit.rebuy?.qty, watchRow(true).rebuy?.qty);
const equity = (a: Asset) => computeManagedEquity([computeAssetMetrics(a, { USD: 1500, JPY: 10 }, 100_000, { plBasis: 'native' })], settings);
assert.deepEqual(equity(exit), equity({ ...exit, holdingPolicy: undefined }));
// 같은 자산에서 방침을 다시 선택해도 옛 주기의 활성일을 상속하지 않는다.
const restarted = asset('two', { ...policy('turtle-after-cost', 'restart'), startedOn: day, confirmedUnitCostKRW: 999 });
assert.deepEqual(sync([restarted]).activations, []);
assert.deepEqual(checkOn(day), []);
process.stdout.write('동일 합성 종목의 홈·모바일 표시와 GAS sync → closeCheck → 카카오 메시지 모의 통합 검사 통과\n');

// 배포 확인용 고정 종목으로 저장된 개인 대화만 검사하고, 실제 감시 명단과 카카오에는 영향이 없어야 한다.
const smoke = { action: 'test-holding-policy' };
props.set('TELEGRAM_BOT_TOKEN', 'fixture');
props.set('TELEGRAM_CHAT_ID', String(telegramChatId));
const filesBefore = new Map(files);
const kakaoBefore = messages.length;
props.set('NOTIFY_CHANNEL', 'telegram');
assert.equal(post(smoke, 'wrong-secret').ok, false);
assert.deepEqual(telegramCalls, []);
for (const channel of ['kakao', 'both']) {
  props.set('NOTIFY_CHANNEL', channel);
  assert.equal(post(smoke).ok, false);
}
assert.deepEqual(telegramCalls, []);
props.set('NOTIFY_CHANNEL', 'telegram');
const propertiesBefore = new Map(props);
telegramChatType = 'group';
assert.equal(post(smoke).ok, false);
assert.deepEqual(telegramCalls, ['getChat']);
assert.deepEqual(telegramMessages, []);
assert.deepEqual(props, propertiesBefore);
telegramChatType = 'private';
const firstReceipt = post(smoke);
const expectedTelegramText = [
  '[배포 테스트 · 999991]',
  '[본전에서 정리] 배포점검 (원종)',
  '예상 순매도대금 108,900원 · 잔여 원금 100,000원',
  '주문 전 가격을 다시 확인하고 실제 체결분만 기록하세요.',
].join('\n');
assert.equal(firstReceipt.ok, true);
assert.equal(firstReceipt.messageId, 601);
assert.equal(firstReceipt.text, expectedTelegramText);
assert.deepEqual(telegramCalls, ['getChat', 'getChat', 'sendMessage']);
assert.deepEqual(telegramMessages, [expectedTelegramText]);
const repeatReceipt = post(smoke);
assert.deepEqual(repeatReceipt, { ok: true, duplicate: true, messageId: 601, text: expectedTelegramText });
assert.deepEqual(telegramCalls, ['getChat', 'getChat', 'sendMessage']);
assert.equal(messages.length, kakaoBefore);
assert.deepEqual(files, filesBefore, '실제 운용 매니페스트를 변경하지 않는다');
const otherProperties = new Map(props);
assert.ok(otherProperties.delete('TELEGRAM_POLICY_SMOKE_RECEIPT'));
assert.deepEqual(otherProperties, propertiesBefore, '당일 발송 영수증만 저장한다');
process.stdout.write('텔레그램 개인 대화 사전 확인·고정 본문·재시도 멱등·운영 파일 보존 통과\n');
