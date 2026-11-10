// types/notifyChannel.ts
// 알림 발송 채널(카카오톡 / 텔레그램 / 둘 다) + 텔레그램 Bot API 최소 응답 형태.
// 앱(설정·매니페스트)과 GAS 번들이 공유한다 — 브라우저/GAS 전역을 쓰지 않는 순수 타입만 둔다.

export type NotifyChannel = 'kakao' | 'telegram' | 'both';
export type NotifyChannelTarget = 'kakao' | 'telegram';

export interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  title?: string;
}

export interface TelegramMessage {
  chat: TelegramChat;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

/** getUpdates 응답. */
export interface TelegramGetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
  error_code?: number;
}

export interface TelegramInlineButton {
  text: string;
  url: string;
}

/** sendMessage 요청 본문(parse_mode 미사용 — 평문). */
export interface TelegramSendBody {
  chat_id: string;
  text: string;
  link_preview_options: { is_disabled: boolean };
  reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
}
