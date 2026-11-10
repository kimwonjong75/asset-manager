// utils/notifyChannel.ts
// 알림 발송 채널 순수 헬퍼 — 앱(설정·매니페스트)과 GAS 번들(scripts/notify/gas/entry.ts)이 공유한다.
// 브라우저/GAS 전역을 참조하지 않는다(번들 그렙 가드 대상).

import type {
  NotifyChannel,
  NotifyChannelTarget,
  TelegramSendBody,
  TelegramUpdate,
} from '../types/notifyChannel';

export const NOTIFY_CHANNEL_LABELS: Record<NotifyChannel, string> = {
  kakao: '카카오톡',
  telegram: '텔레그램',
  both: '카톡+텔레그램',
};

/** 잘못되었거나 없는 값은 'kakao'(기존 동작)로 되돌린다. */
export function normalizeNotifyChannel(raw: unknown): NotifyChannel {
  return raw === 'kakao' || raw === 'telegram' || raw === 'both' ? raw : 'kakao';
}

export function channelTargets(channel: NotifyChannel): NotifyChannelTarget[] {
  if (channel === 'both') return ['kakao', 'telegram'];
  return [channel];
}

export type TelegramChatPick =
  | { kind: 'ok'; chatId: string; name: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; names: string[] };

/**
 * getUpdates 결과에서 알림을 받을 채팅을 고른다. 개인(private) 대화만 보고, 서로 다른 채팅이 정확히 하나일 때만
 * 확정한다 — 둘 이상이면 모르는 사람이 봇에게 말을 걸었을 수 있어 자동 선택하지 않는다(ambiguous).
 */
export function pickTelegramChat(updates: TelegramUpdate[]): TelegramChatPick {
  const byId = new Map<number, string>();
  for (const u of updates) {
    for (const m of [u.message, u.edited_message]) {
      if (!m || !m.chat || m.chat.type !== 'private') continue;
      if (byId.has(m.chat.id)) continue;
      const full = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ');
      const handle = m.chat.username ? `@${m.chat.username}` : '';
      const name = [full, handle].filter(Boolean).join(' ') || String(m.chat.id);
      byId.set(m.chat.id, name);
    }
  }
  if (byId.size === 0) return { kind: 'none' };
  if (byId.size > 1) return { kind: 'ambiguous', names: Array.from(byId.values()) };
  const [id, name] = Array.from(byId.entries())[0];
  return { kind: 'ok', chatId: String(id), name };
}

function isButtonSafeLink(linkUrl: string): boolean {
  const m = /^https:\/\/([^/:?#]+)/i.exec(linkUrl);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1';
}

function textWithLink(text: string, linkUrl: string): string {
  return linkUrl ? `${text}\n${linkUrl}` : text;
}

/** sendMessage 본문 — https 공개 링크면 인라인 버튼 '앱에서 기록', 아니면 본문 끝에 링크를 덧붙인다. */
export function buildTelegramSendBody(chatId: string, text: string, linkUrl: string): TelegramSendBody {
  if (isButtonSafeLink(linkUrl)) {
    return {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: '앱에서 기록', url: linkUrl }]] },
    };
  }
  return {
    chat_id: chatId,
    text: textWithLink(text, linkUrl),
    link_preview_options: { is_disabled: true },
  };
}

/** 버튼 없는 본문(텔레그램이 버튼 URL을 거부해 400을 돌려줄 때의 폴백). */
export function buildTelegramPlainBody(chatId: string, text: string, linkUrl: string): TelegramSendBody {
  return {
    chat_id: chatId,
    text: textWithLink(text, linkUrl),
    link_preview_options: { is_disabled: true },
  };
}

/** 비밀값(봇 토큰은 API URL 안에 들어간다)이 로그·실패 메일·앱 응답으로 새지 않게 모든 출현을 가린다. */
export function redactSecret(message: string, secret: string | null): string {
  if (!secret) return message;
  return message.split(secret).join('***');
}
