// tests/notifyChannelParity.ts
// ---------------------------------------------------------------------------
// utils/notifyChannel.ts 골든 테스트 — 명시적 절대값만 고정한다.
//   · normalizeNotifyChannel / channelTargets / NOTIFY_CHANNEL_LABELS
//   · pickTelegramChat: 개인 대화만 · 단일=ok · 0=none · 2+=ambiguous(안전장치)
//   · buildTelegramSendBody / buildTelegramPlainBody: 버튼 부착 조건·링크 덧붙이기
//   · redactSecret: 봇 토큰이 로그/메일/앱 응답으로 새지 않게 모든 출현을 가림
//
// 수동 실행: npm run test:notifychannel (tsx). 통과 시 exit 0.

import {
  NOTIFY_CHANNEL_LABELS,
  normalizeNotifyChannel,
  channelTargets,
  pickTelegramChat,
  buildTelegramSendBody,
  buildTelegramPlainBody,
  redactSecret,
} from '../utils/notifyChannel';
import type { TelegramMessage, TelegramUpdate } from '../types/notifyChannel';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// ── 1. normalize / targets / labels ─────────────────────────────────────────
check('normalize kakao', normalizeNotifyChannel('kakao'), 'kakao');
check('normalize telegram', normalizeNotifyChannel('telegram'), 'telegram');
check('normalize both', normalizeNotifyChannel('both'), 'both');
check('normalize undefined → kakao', normalizeNotifyChannel(undefined), 'kakao');
check('normalize null → kakao', normalizeNotifyChannel(null), 'kakao');
check('normalize 잘못된 문자열 → kakao', normalizeNotifyChannel('slack'), 'kakao');
check('normalize 숫자 → kakao', normalizeNotifyChannel(1), 'kakao');
check('normalize 대문자 → kakao(엄격)', normalizeNotifyChannel('TELEGRAM'), 'kakao');

check('targets kakao', channelTargets('kakao'), ['kakao']);
check('targets telegram', channelTargets('telegram'), ['telegram']);
check('targets both', channelTargets('both'), ['kakao', 'telegram']);

check('labels', NOTIFY_CHANNEL_LABELS, { kakao: '카카오톡', telegram: '텔레그램', both: '카톡+텔레그램' });

// ── 2. pickTelegramChat ─────────────────────────────────────────────────────
check('빈 업데이트 → none', pickTelegramChat([]), { kind: 'none' });

const priv = (id: number, first?: string, last?: string, username?: string): TelegramMessage =>
  ({ chat: { id, type: 'private', first_name: first, last_name: last, username } });

check('개인 대화 1개 → ok(이름+@username)',
  pickTelegramChat([{ update_id: 1, message: priv(123456789, 'Won', 'Jong', 'wonjong') }]),
  { kind: 'ok', chatId: '123456789', name: 'Won Jong @wonjong' });
check('이름만(username 없음)',
  pickTelegramChat([{ update_id: 1, message: priv(42, 'Kim') }]),
  { kind: 'ok', chatId: '42', name: 'Kim' });
check('username만',
  pickTelegramChat([{ update_id: 1, message: priv(42, undefined, undefined, 'abc') }]),
  { kind: 'ok', chatId: '42', name: '@abc' });
check('이름·username 모두 없음 → id 문자열',
  pickTelegramChat([{ update_id: 1, message: priv(42) }]),
  { kind: 'ok', chatId: '42', name: '42' });
check('같은 채팅의 message+edited_message+여러 업데이트는 1개로 합침',
  pickTelegramChat([
    { update_id: 1, message: priv(7, 'A') },
    { update_id: 2, edited_message: priv(7, 'A') },
    { update_id: 3, message: priv(7, 'A') },
  ]),
  { kind: 'ok', chatId: '7', name: 'A' });
check('그룹·채널 대화는 무시 → none',
  pickTelegramChat([
    { update_id: 1, message: { chat: { id: -100, type: 'group', title: 'G' } } },
    { update_id: 2, message: { chat: { id: -200, type: 'supergroup', title: 'S' } } },
  ]),
  { kind: 'none' });
check('그룹 + 개인 1개 → 개인만 ok',
  pickTelegramChat([
    { update_id: 1, message: { chat: { id: -100, type: 'group', title: 'G' } } },
    { update_id: 2, message: priv(5, 'Me') },
  ]),
  { kind: 'ok', chatId: '5', name: 'Me' });
check('message 없는 업데이트 무시 → none', pickTelegramChat([{ update_id: 9 } as TelegramUpdate]), { kind: 'none' });
check('서로 다른 개인 2명 → ambiguous(등장 순서)',
  pickTelegramChat([
    { update_id: 1, message: priv(1, 'A', undefined, 'a1') },
    { update_id: 2, message: priv(2, 'B') },
  ]),
  { kind: 'ambiguous', names: ['A @a1', 'B'] });

// ── 3. buildTelegramSendBody / PlainBody ────────────────────────────────────
const URL_OK = 'https://app.example.com/?tab=dashboard&asset=a1';
check('https 링크 → 버튼',
  buildTelegramSendBody('99', '본문', URL_OK),
  {
    chat_id: '99', text: '본문', link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: '앱에서 기록', url: URL_OK }]] },
  });
check('localhost https → 버튼 없이 링크를 본문에 덧붙임',
  buildTelegramSendBody('99', '본문', 'https://localhost:5173/?tab=dashboard'),
  { chat_id: '99', text: '본문\nhttps://localhost:5173/?tab=dashboard', link_preview_options: { is_disabled: true } });
check('127.0.0.1 → 버튼 없음',
  buildTelegramSendBody('99', '본문', 'https://127.0.0.1/x'),
  { chat_id: '99', text: '본문\nhttps://127.0.0.1/x', link_preview_options: { is_disabled: true } });
check('http 링크 → 버튼 없음',
  buildTelegramSendBody('99', '본문', 'http://example.com/a'),
  { chat_id: '99', text: '본문\nhttp://example.com/a', link_preview_options: { is_disabled: true } });
check('빈 링크 → 본문 그대로·버튼 없음',
  buildTelegramSendBody('99', '본문', ''),
  { chat_id: '99', text: '본문', link_preview_options: { is_disabled: true } });
check('parse_mode 없음', 'parse_mode' in buildTelegramSendBody('1', 'a_b*c', URL_OK), false);

check('plain: 링크는 본문에 덧붙임·버튼 없음',
  buildTelegramPlainBody('99', '본문', URL_OK),
  { chat_id: '99', text: `본문\n${URL_OK}`, link_preview_options: { is_disabled: true } });
check('plain: 빈 링크',
  buildTelegramPlainBody('99', '본문', ''),
  { chat_id: '99', text: '본문', link_preview_options: { is_disabled: true } });

// ── 4. redactSecret ─────────────────────────────────────────────────────────
check('토큰 1회 출현',
  redactSecret('POST https://api.telegram.org/bot123:ABC/sendMessage 실패', '123:ABC'),
  'POST https://api.telegram.org/bot***/sendMessage 실패');
check('토큰 여러 번 출현',
  redactSecret('123:ABC / 123:ABC / x123:ABCy', '123:ABC'),
  '*** / *** / x***y');
check('secret null → 원문', redactSecret('abc', null), 'abc');
check('secret 빈 문자열 → 원문', redactSecret('abc', ''), 'abc');
check('정규식 특수문자 토큰도 안전', redactSecret('a.b+c(d) a.b+c(d)', 'a.b+c(d)'), '*** ***');
check('토큰 없는 문자열은 그대로', redactSecret('오류 401', '123:ABC'), '오류 401');

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ notifyChannel parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ notifyChannel parity 전체 통과 (${pass} 단언)`);
