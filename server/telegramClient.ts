import crypto from 'crypto';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_BOT_FILE_BYTES = 20 * 1024 * 1024; // Official Bot API 20 MB download cap

export interface BotEnvConfig {
  token: string | undefined;
  webhookSecret: string | undefined;
  ownerUserId: number | null;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramBotMe {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_connect_to_business?: boolean;
}

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

export interface TelegramBusinessConnectionPayload {
  id: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  user_chat_id: number;
  date: number;
  rights?: {
    can_reply?: boolean;
    can_read_messages?: boolean;
    can_delete_sent_messages?: boolean;
    can_delete_all_messages?: boolean;
  };
  can_reply?: boolean;
  is_enabled: boolean;
}

export interface TelegramLiveStatus {
  tokenConfigured: boolean;
  webhookSecretConfigured: boolean;
  ownerLockConfigured: boolean;
  botInfo: {
    id: number;
    username: string;
    firstName: string;
    canConnectToBusiness?: boolean;
  } | null;
  webhookInfo: {
    url: string;
    pendingUpdateCount: number;
    lastErrorDate?: number;
    lastErrorMessage?: string;
  } | null;
  error: string | null;
}

export function getBotEnv(): BotEnvConfig {
  const token =
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    process.env.TELEGRAM_BOT_TOKEN_A?.trim() ||
    undefined;
  const webhookSecret =
    process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ||
    process.env.TELEGRAM_WEBHOOK_SECRET_A?.trim() ||
    undefined;
  const rawOwner =
    process.env.TELEGRAM_OWNER_USER_ID?.trim() ||
    process.env.TELEGRAM_OWNER_USER_ID_A?.trim() ||
    '';

  return {
    token,
    webhookSecret,
    ownerUserId: rawOwner && /^\d+$/.test(rawOwner) ? Number(rawOwner) : null,
  };
}

export function verifyWebhookSecretHeader(receivedHeader: string | undefined): boolean {
  const { webhookSecret } = getBotEnv();
  if (!webhookSecret || !receivedHeader) return false;

  const expectedBuf = Buffer.from(webhookSecret, 'utf8');
  const receivedBuf = Buffer.from(receivedHeader.trim(), 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

async function callTelegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const { token } = getBotEnv();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN server maxfiy kalitlarda sozlanmagan.');
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
    error_code?: number;
  };
  if (!res.ok || !data.ok || data.result === undefined) {
    throw new Error(data.description || `Telegram API error (${res.status}) calling ${method}`);
  }
  return data.result;
}

export async function getLiveBotStatus(): Promise<TelegramLiveStatus> {
  const env = getBotEnv();
  const status: TelegramLiveStatus = {
    tokenConfigured: Boolean(env.token),
    webhookSecretConfigured: Boolean(env.webhookSecret),
    ownerLockConfigured: env.ownerUserId !== null,
    botInfo: null,
    webhookInfo: null,
    error: null,
  };

  if (!env.token) {
    return status;
  }

  try {
    const [me, wh] = await Promise.all([
      callTelegramApi<TelegramBotMe>('getMe'),
      callTelegramApi<TelegramWebhookInfo>('getWebhookInfo'),
    ]);

    status.botInfo = {
      id: me.id,
      username: me.username,
      firstName: me.first_name,
      canConnectToBusiness: me.can_connect_to_business,
    };

    status.webhookInfo = {
      url: wh.url || '',
      pendingUpdateCount: wh.pending_update_count || 0,
      lastErrorDate: wh.last_error_date,
      lastErrorMessage: wh.last_error_message,
    };
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
  }

  return status;
}

export async function setBotCommands(
  commands: Array<{ command: string; description: string }>
): Promise<void> {
  await callTelegramApi<boolean>('setMyCommands', { commands });
}

export async function registerTelegramWebhook(baseUrl: string): Promise<{
  webhookUrl: string;
  me: TelegramBotMe;
  webhookInfo: TelegramWebhookInfo;
}> {
  const { webhookSecret } = getBotEnv();
  if (!webhookSecret) {
    throw new Error(
      'TELEGRAM_WEBHOOK_SECRET sozlanmagan. Webhookni ro‘yxatdan o‘tkazishdan oldin uni server muhitiga qo‘shing.'
    );
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const webhookUrl = `${normalizedBase}/telegram/webhook`;
  const me = await callTelegramApi<TelegramBotMe>('getMe');

  await callTelegramApi<boolean>('setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: [
      'message',
      'callback_query',
      'business_connection',
      'business_message',
      'edited_business_message',
      'deleted_business_messages',
    ],
  });

  const webhookInfo = await callTelegramApi<TelegramWebhookInfo>('getWebhookInfo');
  return { webhookUrl, me, webhookInfo };
}

export async function removeTelegramWebhook(): Promise<void> {
  await callTelegramApi<boolean>('deleteWebhook', { drop_pending_updates: false });
}

export async function fetchBusinessConnection(
  businessConnectionId: string
): Promise<TelegramBusinessConnectionPayload> {
  return callTelegramApi<TelegramBusinessConnectionPayload>('getBusinessConnection', {
    business_connection_id: businessConnectionId,
  });
}

export async function sendBotTextMessage(params: {
  chatId: number | string;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
  replyToMessageId?: number;
  businessConnectionId?: string;
}): Promise<{ message_id: number }> {
  const body: Record<string, unknown> = {
    chat_id: Number(params.chatId),
    text: params.text.slice(0, 4096),
  };
  if (params.businessConnectionId) {
    body.business_connection_id = params.businessConnectionId;
  }
  if (params.replyMarkup) {
    body.reply_markup = params.replyMarkup;
  }
  if (params.replyToMessageId) {
    body.reply_parameters = { message_id: params.replyToMessageId };
  }
  return callTelegramApi<{ message_id: number }>('sendMessage', body);
}

export async function editBotTextMessage(params: {
  chatId: number | string;
  messageId: number;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
  businessConnectionId?: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: Number(params.chatId),
    message_id: params.messageId,
    text: params.text.slice(0, 4096),
  };
  if (params.businessConnectionId) {
    body.business_connection_id = params.businessConnectionId;
  }
  if (params.replyMarkup) {
    body.reply_markup = params.replyMarkup;
  }
  await callTelegramApi<unknown>('editMessageText', body);
}

export async function answerCallbackQuery(params: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}): Promise<void> {
  await callTelegramApi<boolean>('answerCallbackQuery', {
    callback_query_id: params.callbackQueryId,
    ...(params.text ? { text: params.text.slice(0, 200) } : {}),
    ...(params.showAlert ? { show_alert: true } : {}),
  });
}

export async function sendChatAction(params: {
  chatId: number | string;
  action: 'typing' | 'record_voice' | 'record_video_note';
  businessConnectionId?: string;
}): Promise<void> {
  await callTelegramApi<boolean>('sendChatAction', {
    chat_id: Number(params.chatId),
    action: params.action,
    ...(params.businessConnectionId ? { business_connection_id: params.businessConnectionId } : {}),
  }).catch(() => {});
}

export async function sendBotVoiceMessage(params: {
  chatId: number | string;
  oggBuffer: Buffer;
  caption?: string;
  replyToMessageId?: number;
  businessConnectionId?: string;
}): Promise<{ message_id: number }> {
  const { token } = getBotEnv();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN serverda sozlanmagan.');
  }

  const form = new FormData();
  if (params.businessConnectionId) {
    form.append('business_connection_id', params.businessConnectionId);
  }
  form.append('chat_id', String(params.chatId));
  const voiceBytes = Uint8Array.from(params.oggBuffer);
  form.append('voice', new Blob([voiceBytes], { type: 'audio/ogg' }), 'reply.ogg');
  if (params.caption) {
    form.append('caption', params.caption.slice(0, 1024));
  }
  if (params.replyToMessageId) {
    form.append('reply_parameters', JSON.stringify({ message_id: params.replyToMessageId }));
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendVoice`, {
    method: 'POST',
    body: form,
  });

  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!res.ok || !data.ok || !data.result) {
    throw new Error(data.description || `Telegram sendVoice failed (${res.status})`);
  }
  return data.result;
}

export async function sendBotVideoNote(params: {
  chatId: number | string;
  mp4Buffer: Buffer;
  durationSec: number;
  lengthPx?: number;
  replyToMessageId?: number;
  businessConnectionId?: string;
}): Promise<{ message_id: number }> {
  const { token } = getBotEnv();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN serverda sozlanmagan.');
  }

  const form = new FormData();
  if (params.businessConnectionId) {
    form.append('business_connection_id', params.businessConnectionId);
  }
  form.append('chat_id', String(params.chatId));
  const videoBytes = Uint8Array.from(params.mp4Buffer);
  form.append('video_note', new Blob([videoBytes], { type: 'video/mp4' }), 'omnia_note.mp4');
  form.append('duration', String(Math.max(1, Math.min(60, Math.round(params.durationSec)))));
  form.append('length', String(params.lengthPx ?? 384));
  if (params.replyToMessageId) {
    form.append('reply_parameters', JSON.stringify({ message_id: params.replyToMessageId }));
  }

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendVideoNote`, {
    method: 'POST',
    body: form,
  });

  const data = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!res.ok || !data.ok || !data.result) {
    throw new Error(data.description || `Telegram sendVideoNote failed (${res.status})`);
  }
  return data.result;
}

export async function sendBusinessTextMessage(params: {
  businessConnectionId: string;
  chatId: string;
  text: string;
  replyToMessageId?: number;
  replyMarkup?: InlineKeyboardMarkup;
}): Promise<{ message_id: number }> {
  const body: Record<string, unknown> = {
    business_connection_id: params.businessConnectionId,
    chat_id: Number(params.chatId),
    text: params.text.slice(0, 4096),
  };
  if (params.replyMarkup) {
    body.reply_markup = params.replyMarkup;
  }
  if (params.replyToMessageId) {
    body.reply_parameters = { message_id: params.replyToMessageId };
  }
  return callTelegramApi<{ message_id: number }>('sendMessage', body);
}

export async function markBusinessMessageRead(params: {
  businessConnectionId: string;
  chatId: string;
  messageId: number;
}): Promise<void> {
  await callTelegramApi<boolean>('readBusinessMessage', {
    business_connection_id: params.businessConnectionId,
    chat_id: Number(params.chatId),
    message_id: params.messageId,
  });
}

export async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const { token } = getBotEnv();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN serverda sozlanmagan.');
  }

  const fileInfo = await callTelegramApi<{ file_id: string; file_size?: number; file_path?: string }>(
    'getFile',
    { file_id: fileId }
  );

  if (fileInfo.file_size && fileInfo.file_size > MAX_BOT_FILE_BYTES) {
    throw new Error(
      `Fayl hajmi rasmiy Telegram Bot API 20 MB limitidan katta (${Math.round(
        fileInfo.file_size / (1024 * 1024)
      )} MB).`
    );
  }
  if (!fileInfo.file_path) {
    throw new Error('Telegram getFile javobida file_path qaytmadi.');
  }

  const downloadRes = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${fileInfo.file_path}`);
  if (!downloadRes.ok) {
    throw new Error(`Telegram media yuklab olinmadi (${downloadRes.status}).`);
  }

  const arrBuf = await downloadRes.arrayBuffer();
  const buffer = Buffer.from(arrBuf);
  if (buffer.length > MAX_BOT_FILE_BYTES) {
    throw new Error('Yuklab olingan media 20 MB Bot API limitidan katta.');
  }

  return { buffer, filePath: fileInfo.file_path };
}
