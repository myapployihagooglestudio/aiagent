import {
  clearMemoryRecords,
  formatMemoriesForTelegram,
  saveMemorySafely,
  searchMemoryRecords,
} from './ai/memoryManager.ts';
import { QuotaUnavailableError } from './ai/geminiQuotaManager.ts';
import { sanitizeForLog } from './ai/securityFilter.ts';
import { approveAndSendPendingReply } from './approvals.ts';
import { buildCallsStatusReport } from './callsAudit.ts';
import {
  addConversationMessage,
  clearConversationHistory,
  countPendingApprovals,
  getBotSettings,
  getConversationHistory,
  getDbInfo,
  getPendingApprovalById,
  getQueueMetrics,
  getRecentAuditLogs,
  getUserLanguagePreference,
  listChatRules,
  setUserLanguagePreference,
  updateBotSettings,
  updatePendingApproval,
  upsertChatRule,
  upsertUserProfile,
  writeAuditLog,
} from './db.ts';
import { deliverAssistantResponse } from './deliveryHelper.ts';
import {
  analyzeVideoWithFfmpeg,
  generateAssistantReply,
  isGeminiConfigured,
  transcribeAudioBuffer,
} from './geminiEngine.ts';
import {
  buildLanguageSelectionView,
  buildMainMenuKeyboard,
  formatLanguageChangedConfirmation,
  formatStatusMessage,
  LANGUAGE_DISPLAY_NAMES,
  parseLanguageShortcut,
  t,
} from './i18nBot.ts';
import { MAX_MEDIA_BYTES } from './mediaPipeline.ts';
import {
  answerCallbackQuery,
  downloadTelegramFile,
  editBotTextMessage,
  fetchBusinessConnection,
  getBotEnv,
  getLiveBotStatus,
  sendBotTextMessage,
  sendChatAction,
  type InlineKeyboardMarkup,
} from './telegramClient.ts';
import type {
  BotSettings,
  EmojiLevel,
  LanguagePreference,
  ResponseStyle,
  SpeakingSpeed,
  TtsVoice,
  UILanguage,
  VerbosityMode,
  VoiceOutputMode,
  VoiceStyle,
} from './types.ts';

export interface IncomingTelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface IncomingTelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  last_name?: string;
  username?: string;
  title?: string;
}

export interface IncomingTelegramMessage {
  message_id: number;
  business_connection_id?: string;
  from?: IncomingTelegramUser;
  sender_business_bot?: IncomingTelegramUser;
  date: number;
  chat: IncomingTelegramChat;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration: number; mime_type?: string; file_name?: string; file_size?: number };
  video_note?: { file_id: string; duration: number; length: number; file_size?: number };
  video?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
}

export interface IncomingCallbackQuery {
  id: string;
  business_connection_id?: string;
  from: IncomingTelegramUser;
  message?: {
    message_id: number;
    chat: IncomingTelegramChat;
    text?: string;
  };
  data?: string;
}

export function evaluateOwnerAccess(params: {
  userId?: number;
  isBot?: boolean;
  envOwnerId: number | null;
  storedOwnerId: number;
}): { allowed: boolean; needsOwnerSync: boolean; ownerMissing: boolean } {
  if (!params.userId || params.isBot) {
    return { allowed: false, needsOwnerSync: false, ownerMissing: false };
  }
  if (params.envOwnerId !== null) {
    return {
      allowed: params.userId === params.envOwnerId,
      needsOwnerSync: params.userId === params.envOwnerId && params.storedOwnerId !== params.envOwnerId,
      ownerMissing: false,
    };
  }
  if (params.storedOwnerId > 0) {
    return {
      allowed: params.userId === params.storedOwnerId,
      needsOwnerSync: false,
      ownerMissing: false,
    };
  }
  // Safe locked mode: NEVER allow strangers to claim owner access on /start
  return { allowed: false, needsOwnerSync: false, ownerMissing: true };
}

async function resolveOwnerAccess(
  user: IncomingTelegramUser | undefined
): Promise<{ allowed: boolean; settings: BotSettings; ownerMissing: boolean }> {
  let settings = await getBotSettings();
  const envOwner = getBotEnv().ownerUserId;
  const check = evaluateOwnerAccess({
    userId: user?.id,
    isBot: user?.is_bot,
    envOwnerId: envOwner,
    storedOwnerId: settings.ownerTelegramId,
  });

  if (check.allowed && check.needsOwnerSync && envOwner !== null && user) {
    settings = await updateBotSettings({
      ownerTelegramId: envOwner,
      ownerUsername: user.username || '',
    });
  }

  return {
    allowed: check.allowed,
    settings,
    ownerMissing: check.ownerMissing,
  };
}

function buildSettingsView(settings: BotSettings): { text: string; markup: InlineKeyboardMarkup } {
  const s = t(settings.uiLanguage);
  const text = [
    s.settingsHeader,
    '',
    `• Avtonom rejim: ${settings.autonomousEnabled && settings.autoReplyMode === 'autonomous' ? '🟢 Yoniq' : `📝 ${settings.autoReplyMode}`}`,
    `• AI ma’lumot roziligi: ${settings.aiConsentConfirmed ? '✅ Tasdiqlangan' : '❌ O‘chiq'}`,
    `• AI oshkoralik belgisi: ${settings.disclosureEnabled ? `✅ Yoniq (${settings.disclosureText})` : 'O‘chiq'}`,
    `• Ishonchlilik chegarasi: ${settings.confidenceThreshold}%`,
    `• Chiqish rejimi: ${settings.voiceOutputMode} | Dumaloq video: ${settings.videoReplyEnabled ? 'YONIQ' : 'O‘CHIQ'}`,
    `• Ovoz transkripsiyasi: ${settings.autoTranscribeVoice ? 'Yoniq' : 'O‘chiq'} | Video tahlili: ${settings.autoAnalyzeVideo ? 'Yoniq' : 'O‘chiq'}`,
    `• Pauza: umumiy=${settings.paused ? 'HA' : 'YO‘Q'}, bot=${settings.botPaused ? 'HA' : 'YO‘Q'}, shaxsiy=${settings.businessPaused ? 'HA' : 'YO‘Q'}`,
    `• Favqulodda to‘xtatish (Emergency Stop): ${settings.emergencyStop ? '🛑 FAOL' : 'O‘chiq'}`,
  ].join('\n');

  const markup: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: settings.aiConsentConfirmed ? s.btnRevokeConsent : s.btnConfirmConsent,
          callback_data: 'cfg:toggle_consent',
        },
      ],
      [
        {
          text: `${s.btnAutonomous}: ${settings.autonomousEnabled ? 'YONIQ' : 'O‘CHIQ'}`,
          callback_data: 'cfg:toggle_autonomous',
        },
        {
          text: s.btnToggleDisclosure,
          callback_data: 'cfg:toggle_disclosure',
        },
      ],
      [
        {
          text: `${s.btnToggleTranscribe}: ${settings.autoTranscribeVoice ? 'YONIQ' : 'O‘CHIQ'}`,
          callback_data: 'cfg:toggle_transcribe',
        },
        {
          text: `${s.btnToggleVideo}: ${settings.autoAnalyzeVideo ? 'YONIQ' : 'O‘CHIQ'}`,
          callback_data: 'cfg:toggle_video',
        },
      ],
      [
        { text: '🎯 60%', callback_data: 'cfg:conf:60' },
        { text: '🎯 70%', callback_data: 'cfg:conf:70' },
        { text: '🎯 85%', callback_data: 'cfg:conf:85' },
      ],
      [
        { text: s.btnStyle, callback_data: 'cmd:style' },
        { text: s.btnCalls, callback_data: 'cmd:calls' },
      ],
      [
        { text: s.btnLanguage, callback_data: 'cmd:language' },
        { text: s.btnVoice, callback_data: 'cmd:voice' },
      ],
      [{ text: s.btnBack, callback_data: 'cmd:home' }],
    ],
  };

  return { text, markup };
}

function buildLanguageView(
  lang: UILanguage,
  activePref: LanguagePreference = lang
): { text: string; markup: InlineKeyboardMarkup } {
  return buildLanguageSelectionView(lang, activePref, true);
}

function buildStyleView(settings: BotSettings): { text: string; markup: InlineKeyboardMarkup } {
  const s = t(settings.uiLanguage);
  const text = [
    s.styleHeader,
    '',
    `• Ohang (Tone): ${settings.responseStyle}`,
    `• Uzunlik: ${settings.verbosityMode}`,
    `• Emoji darajasi: ${settings.emojiLevel}`,
    `• Shaxsiy uslub namunalari: ${settings.customStyleExamples ? 'Kiritilgan' : 'Standart'}`,
    '',
    'Namuna qo‘shish uchun: /style example <matn>',
  ].join('\n');

  return {
    text,
    markup: {
      inline_keyboard: [
        [
          { text: `${settings.responseStyle === 'concise' ? '✅ ' : ''}Qisqa`, callback_data: 'style:tone:concise' },
          { text: `${settings.responseStyle === 'warm' ? '✅ ' : ''}Samimiy`, callback_data: 'style:tone:warm' },
          { text: `${settings.responseStyle === 'executive' ? '✅ ' : ''}Bosiq`, callback_data: 'style:tone:executive' },
          { text: `${settings.responseStyle === 'formal' ? '✅ ' : ''}Rasmiy`, callback_data: 'style:tone:formal' },
        ],
        [
          { text: `${settings.verbosityMode === 'short' ? '✅ ' : ''}1-2 gap`, callback_data: 'style:len:short' },
          { text: `${settings.verbosityMode === 'balanced' ? '✅ ' : ''}Muvozanatli`, callback_data: 'style:len:balanced' },
          { text: `${settings.verbosityMode === 'detailed' ? '✅ ' : ''}Batafsil`, callback_data: 'style:len:detailed' },
        ],
        [
          { text: `${settings.emojiLevel === 'none' ? '✅ ' : ''}Emojisiz`, callback_data: 'style:emoji:none' },
          { text: `${settings.emojiLevel === 'subtle' ? '✅ ' : ''}Yengil`, callback_data: 'style:emoji:subtle' },
          { text: `${settings.emojiLevel === 'expressive' ? '✅ ' : ''}Faol`, callback_data: 'style:emoji:expressive' },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    },
  };
}

function buildVoiceView(settings: BotSettings): { text: string; markup: InlineKeyboardMarkup } {
  const s = t(settings.uiLanguage);
  const voices: TtsVoice[] = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
  const text = [
    s.voiceHeader,
    '',
    `• Chiqish rejimi: ${settings.voiceOutputMode} (text | voice | both)`,
    `• Gemini TTS ovozi: ${settings.ttsVoice}`,
    `• Ovoz uslubi: ${settings.voiceStyle} | Tezlik: ${settings.speakingSpeed}`,
    `• Kiruvchi ovozni matnga o‘girish: ${settings.autoTranscribeVoice ? 'YONIQ' : 'O‘CHIQ'}`,
  ].join('\n');

  const voiceButtons = voices.map((v) => ({
    text: `${settings.ttsVoice === v ? '✅ ' : ''}${v}`,
    callback_data: `voice:set:${v}`,
  }));

  return {
    text,
    markup: {
      inline_keyboard: [
        [
          { text: `${settings.voiceOutputMode === 'text' ? '✅ ' : ''}Faqat matn`, callback_data: 'voice:mode:text' },
          { text: `${settings.voiceOutputMode === 'voice' ? '✅ ' : ''}Faqat ovoz`, callback_data: 'voice:mode:voice' },
          { text: `${settings.voiceOutputMode === 'both' ? '✅ ' : ''}Matn + Ovoz`, callback_data: 'voice:mode:both' },
        ],
        voiceButtons.slice(0, 3),
        voiceButtons.slice(3),
        [
          { text: `${settings.voiceStyle === 'calm' ? '✅ ' : ''}Bosiq`, callback_data: 'voice:style:calm' },
          { text: `${settings.voiceStyle === 'warm' ? '✅ ' : ''}Iliq`, callback_data: 'voice:style:warm' },
          { text: `${settings.voiceStyle === 'energetic' ? '✅ ' : ''}Tetik`, callback_data: 'voice:style:energetic' },
          { text: `${settings.voiceStyle === 'formal' ? '✅ ' : ''}Rasmiy`, callback_data: 'voice:style:formal' },
        ],
        [
          { text: `${settings.speakingSpeed === 'slow' ? '✅ ' : ''}Sekin`, callback_data: 'voice:speed:slow' },
          { text: `${settings.speakingSpeed === 'normal' ? '✅ ' : ''}Me’yoriy`, callback_data: 'voice:speed:normal' },
          { text: `${settings.speakingSpeed === 'fast' ? '✅ ' : ''}Tez`, callback_data: 'voice:speed:fast' },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    },
  };
}

function buildVideoView(settings: BotSettings): { text: string; markup: InlineKeyboardMarkup } {
  const s = t(settings.uiLanguage);
  const text = [
    s.videoHeader,
    '',
    `• Kiruvchi video & dumaloq video tahlili (ffmpeg kadr + nutq): ${settings.autoAnalyzeVideo ? '🟢 YONIQ' : '⚪️ O‘CHIQ'}`,
    `• Chiquvchi dumaloq video javob (384x384 MP4 sendVideoNote): ${settings.videoReplyEnabled ? '🟢 YONIQ' : '⚪️ O‘CHIQ'}`,
    `• Telegram Bot API kiruvchi media limiti: 20 MB | Dumaloq video limiti: 60 soniya.`,
  ].join('\n');

  return {
    text,
    markup: {
      inline_keyboard: [
        [
          {
            text: `${s.btnToggleVideoReply}: ${settings.videoReplyEnabled ? 'YONIQ' : 'O‘CHIQ'}`,
            callback_data: 'video:toggle_reply',
          },
        ],
        [
          {
            text: `${s.btnToggleVideo}: ${settings.autoAnalyzeVideo ? 'YONIQ' : 'O‘CHIQ'}`,
            callback_data: 'cfg:toggle_video',
          },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    },
  };
}

async function buildAccountsView(settings: BotSettings): Promise<{ text: string; markup: InlineKeyboardMarkup }> {
  const s = t(settings.uiLanguage);
  const live = await getLiveBotStatus();
  const businessActive =
    Boolean(settings.businessConnectionId) && settings.connectionEnabled && settings.rightsCanReply;

  const text = [
    '👥 OMNIA AI — A va B Akkauntlar Holati',
    '',
    '🔹 A KOMPONENT (Shaxsiy Telegram Business Akkaunt):',
    `• Holat: ${businessActive ? '🟢 Ulangan va faol' : settings.businessConnectionId ? '🟡 Ulangan, lekin o‘chiq/ruxsatsiz' : '⚪️ Hali ulanmagan'}`,
    `• Egasi: ${settings.businessOwnerName || 'Noma‘lum'} (${settings.businessOwnerId || '—'})`,
    `• Pauza: ${settings.businessPaused || settings.paused ? '⏸ Pauzada' : '▶️ Faol'}`,
    `• Ruxsatlar: o‘qish=${settings.rightsCanReadMessages ? 'ha' : 'yo‘q'}, javob=${settings.rightsCanReply ? 'ha' : 'yo‘q'}`,
    '',
    '🔹 B KOMPONENT (OMNIA AI Rasmiy Boti):',
    `• Bot: ${live.botInfo ? `@${live.botInfo.username} (ID: ${live.botInfo.id})` : 'Token ulanmagan'}`,
    `• Business Mode: ${live.botInfo?.canConnectToBusiness ? '✅ Yoqilgan' : '⚠️ Tekshiring'}`,
    `• Pauza: ${settings.botPaused ? '⏸ Pauzada' : '▶️ Faol'}`,
    `• Webhook: ${live.webhookInfo?.url || 'O‘rnatilmagan'}`,
  ].join('\n');

  return {
    text,
    markup: {
      inline_keyboard: [
        [{ text: s.btnCheckBusiness, callback_data: 'act:check_business' }],
        [
          { text: settings.businessPaused ? '▶️ A komponentni yoqish' : '⏸ A komponent pauza', callback_data: 'acc:toggle_business_pause' },
          { text: settings.botPaused ? '▶️ B komponentni yoqish' : '⏸ B komponent pauza', callback_data: 'acc:toggle_bot_pause' },
        ],
        [
          { text: s.btnConnect, callback_data: 'cmd:connect' },
          { text: s.btnBack, callback_data: 'cmd:home' },
        ],
      ],
    },
  };
}

async function buildPermissionsView(settings: BotSettings): Promise<{ text: string; markup: InlineKeyboardMarkup }> {
  const s = t(settings.uiLanguage);
  const rules = await listChatRules(15);
  const ruleLines = rules.map(
    (r) => `• ${r.contactName || r.chatId} (${r.chatId}): ${r.permission}`
  );

  const text = [
    s.permissionsHeader,
    '',
    'Chat boshqaruv buyruqlari:',
    '• /exclude <chat_id> — Chatni AI dan butunlay cheklash',
    '• /approve <chat_id> — Chatni qo‘lda tasdiqlashga o‘tkazish',
    '• /allow <chat_id> — Avtonom javobga ruxsat berish',
    '',
    ruleLines.length > 0 ? `Qayd etilgan chatlar:\n${ruleLines.join('\n')}` : 'Hali alohida chat qoidalari yo‘q.',
  ].join('\n');

  return {
    text,
    markup: {
      inline_keyboard: [[{ text: s.btnBack, callback_data: 'cmd:home' }]],
    },
  };
}

async function buildMemoryView(settings: BotSettings): Promise<{ text: string; markup: InlineKeyboardMarkup }> {
  const s = t(settings.uiLanguage);
  const structuredText = await formatMemoriesForTelegram(15).catch(() => '');
  const text = [
    s.memoryHeader,
    '',
    settings.memorySummary ? `📌 Global eslatma:\n${settings.memorySummary}\n` : '',
    structuredText ? `🗂 Tuzilgan yozuvlar:\n${structuredText}` : 'Tuzilgan xotira hozircha bo‘sh.',
    '',
    s.memoryUsage,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    text: text.slice(0, 4000),
    markup: {
      inline_keyboard: [
        [{ text: s.btnClearMemory, callback_data: 'act:clear_memory' }],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    },
  };
}

async function buildStatusView(settings: BotSettings): Promise<{ text: string; markup: InlineKeyboardMarkup }> {
  const [live, queue, pendingApprovals] = await Promise.all([
    getLiveBotStatus(),
    getQueueMetrics(),
    countPendingApprovals(),
  ]);
  const dbInfo = getDbInfo();
  const s = t(settings.uiLanguage);
  const dbLabel = dbInfo.ready
    ? `Firestore (${dbInfo.projectId})`
    : `Firestore XATOSI (${dbInfo.error || 'ulanmagan'})`;
  return {
    text: formatStatusMessage({
      settings,
      live,
      geminiReady: isGeminiConfigured(),
      dbLabel,
      queue,
      pendingApprovals,
    }),
    markup: {
      inline_keyboard: [
        [
          { text: s.btnCheckBusiness, callback_data: 'act:check_business' },
          { text: s.btnSettings, callback_data: 'cmd:settings' },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    },
  };
}

async function buildActivityView(settings: BotSettings): Promise<{ text: string; markup: InlineKeyboardMarkup }> {
  const s = t(settings.uiLanguage);
  const logs = await getRecentAuditLogs(12);
  const pendingCount = await countPendingApprovals();

  const lines = logs.map((l) => {
    const time = l.createdAt.slice(11, 19);
    const icon =
      l.severity === 'critical' ? '🛑' : l.severity === 'error' ? '❌' : l.severity === 'warn' ? '⚠️' : '•';
    return `${icon} [${time}] ${l.summary}`;
  });

  const text = [
    s.activityHeader,
    `Kutilayotgan tasdiqlar: ${pendingCount}`,
    '',
    lines.length > 0 ? lines.join('\n') : s.noActivity,
  ].join('\n');

  return {
    text,
    markup: {
      inline_keyboard: [
        [{ text: s.btnStatus, callback_data: 'cmd:status' }, { text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    },
  };
}

export async function handleBotDirectMessage(msg: IncomingTelegramMessage): Promise<void> {
  if (msg.chat.type !== 'private') return;
  if (msg.from?.is_bot) return;

  const rawText = (msg.text || msg.caption || '').trim();

  let settings: BotSettings;
  let allowed = false;
  let ownerMissing = false;

  try {
    const access = await resolveOwnerAccess(msg.from);
    allowed = access.allowed;
    settings = access.settings;
    ownerMissing = access.ownerMissing;
  } catch (err) {
    const errMsg = sanitizeForLog(err instanceof Error ? err.message : String(err));
    await sendBotTextMessage({
      chatId: msg.chat.id,
      text: `⚠️ Ma’lumotlar bazasi (Firestore) hozircha javob bermayapti:\n${errMsg.slice(0, 350)}`,
    }).catch(() => {});
    return;
  }

  if (!allowed) {
    await writeAuditLog({
      channel: 'bot_direct',
      eventType: ownerMissing ? 'owner_not_configured' : 'unauthorized_bot_access',
      severity: ownerMissing ? 'critical' : 'warn',
      chatId: String(msg.chat.id),
      summary: ownerMissing
        ? `TELEGRAM_OWNER_USER_ID sozlanmagan; ${msg.from?.id ?? 'unknown'} so‘rovi bloklandi`
        : `Ruxsatsiz foydalanuvchi ${msg.from?.id ?? 'unknown'} shaxsiy botga kirishga urindi`,
    }).catch(() => {});
    await sendBotTextMessage({
      chatId: msg.chat.id,
      text: ownerMissing
        ? '🔒 Bot xavfsizlik rejimida: serverda TELEGRAM_OWNER_USER_ID hali sozlanmagan. Avval server muhitiga egasi Telegram ID sini kiriting.'
        : t(settings.uiLanguage).unauthorized,
    }).catch(() => {});
    return;
  }

  if (msg.from?.id) {
    void upsertUserProfile({
      userId: String(msg.from.id),
      channel: 'bot_direct',
      username: msg.from.username || '',
      displayName: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim(),
    }).catch(() => {});
  }

  const s = t(settings.uiLanguage);

  if (rawText.startsWith('/')) {
    const [rawCmd, ...args] = rawText.split(/\s+/);
    const cmd = rawCmd.toLowerCase().split('@')[0];
    const argText = args.join(' ').trim();
    const argLower = argText.toLowerCase();

    if (cmd === '/start') {
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: `${s.welcomeTitle}\n\n${s.welcomeBody}`,
        replyMarkup: buildMainMenuKeyboard(settings.uiLanguage, settings),
      });
      return;
    }

    if (cmd === '/help') {
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: s.helpText,
        replyMarkup: buildMainMenuKeyboard(settings.uiLanguage, settings),
      });
      return;
    }

    if (cmd === '/status') {
      const view = await buildStatusView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/accounts' || cmd === '/account_status') {
      const view = await buildAccountsView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/personal_status') {
      const active = Boolean(settings.businessConnectionId) && settings.connectionEnabled && settings.rightsCanReply;
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: [
          '👤 A komponent — Shaxsiy Telegram Akkaunt Holati',
          `• Ulanish: ${active ? '🟢 Faol va tayyor' : settings.businessConnectionId ? '🟡 Ulangan, lekin o‘chiq/ruxsatsiz' : '⚪️ Ulanmagan'}`,
          `• Egasi: ${settings.businessOwnerName || '—'} (${settings.businessOwnerId || '—'})`,
          `• Avtonom rejim: ${settings.autonomousEnabled ? 'YONIQ' : 'O‘CHIQ'} | Pauza: ${settings.businessPaused || settings.paused ? 'HA' : 'YO‘Q'}`,
        ].join('\n'),
        replyMarkup: { inline_keyboard: [[{ text: s.btnCheckBusiness, callback_data: 'act:check_business' }]] },
      });
      return;
    }

    if (cmd === '/bot_status') {
      const live = await getLiveBotStatus();
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: [
          '🤖 B komponent — OMNIA AI Bot Holati',
          `• Bot: ${live.botInfo ? `@${live.botInfo.username} (ID: ${live.botInfo.id})` : 'Token xatosi'}`,
          `• Business Mode: ${live.botInfo?.canConnectToBusiness ? 'Yoqilgan' : 'Tekshiring'}`,
          `• Pauza: ${settings.botPaused ? 'HA' : 'YO‘Q'}`,
          `• Webhook: ${live.webhookInfo?.url || 'O‘rnatilmagan'}`,
          live.webhookInfo?.lastErrorMessage ? `• Oxirgi xato: ${live.webhookInfo.lastErrorMessage}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return;
    }

    if (cmd === '/connect') {
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: s.connectText,
        replyMarkup: {
          inline_keyboard: [
            [{ text: s.btnCheckBusiness, callback_data: 'act:check_business' }],
            [
              {
                text: settings.aiConsentConfirmed ? s.btnRevokeConsent : s.btnConfirmConsent,
                callback_data: 'cfg:toggle_consent',
              },
            ],
            [{ text: s.btnBack, callback_data: 'cmd:home' }],
          ],
        },
      });
      return;
    }

    if (cmd === '/disconnect') {
      settings = await updateBotSettings({
        connectionEnabled: false,
        rightsCanReply: false,
        rightsCanReadMessages: false,
      });
      await writeAuditLog({
        channel: 'business_chat',
        eventType: 'business_disconnected_by_owner',
        severity: 'warn',
        chatId: String(msg.chat.id),
        summary: 'Egasi /disconnect orqali shaxsiy Business ulanishni o‘chirdi',
      });
      await sendBotTextMessage({ chatId: msg.chat.id, text: s.disconnectedText });
      return;
    }

    if (cmd === '/settings') {
      const view = buildSettingsView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (['/language', '/lang', '/til', '/uz', '/uzcyr', '/uznew', '/ru', '/en'].includes(cmd)) {
      const requestedPref = parseLanguageShortcut(cmd, argLower);
      const userId = String(msg.from?.id || msg.chat.id);
      const displayName = `${msg.from?.first_name || ''} ${msg.from?.last_name || ''}`.trim();

      if (requestedPref) {
        const nextUiLang: UILanguage =
          requestedPref === 'auto' ? settings.uiLanguage : requestedPref;

        await setUserLanguagePreference({
          userId,
          preferredLanguage: requestedPref,
          uiLanguage: nextUiLang,
          username: msg.from?.username || '',
          displayName,
        });

        settings = await updateBotSettings({
          defaultReplyLanguage: requestedPref,
          ...(requestedPref !== 'auto' ? { uiLanguage: requestedPref } : {}),
        });

        await writeAuditLog({
          channel: 'bot_direct',
          eventType: 'language_changed',
          severity: 'info',
          chatId: String(msg.chat.id),
          summary: `Til rejimi "${requestedPref}" ga o‘zgartirildi (buyruq: ${cmd})`,
        }).catch(() => {});

        const view = buildLanguageView(settings.uiLanguage, requestedPref);
        await sendBotTextMessage({
          chatId: msg.chat.id,
          text: formatLanguageChangedConfirmation(requestedPref, settings.uiLanguage),
          replyMarkup: view.markup,
        });
        return;
      }

      const existingPref = await getUserLanguagePreference(userId).catch(() => null);
      const activePref = existingPref?.preferredLanguage ?? settings.defaultReplyLanguage;
      const view = buildLanguageView(settings.uiLanguage, activePref);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/style') {
      if (argLower.startsWith('example ')) {
        const sample = argText.slice(8).trim();
        await updateBotSettings({ customStyleExamples: sample.slice(0, 2000) });
        await sendBotTextMessage({ chatId: msg.chat.id, text: '✅ Shaxsiy muloqot uslubi namunasi saqlandi.' });
        return;
      }
      const view = buildStyleView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/voice') {
      const view = buildVoiceView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/voice_on') {
      settings = await updateBotSettings({ voiceReplyEnabled: true, voiceOutputMode: 'voice' });
      await sendBotTextMessage({ chatId: msg.chat.id, text: '🎙 Ovozli javoblar (OGG/OPUS sendVoice) yoqildi.' });
      return;
    }

    if (cmd === '/voice_off') {
      settings = await updateBotSettings({ voiceReplyEnabled: false, voiceOutputMode: 'text' });
      await sendBotTextMessage({ chatId: msg.chat.id, text: '💬 Ovozli javoblar o‘chirildi; endi faqat matn yuboriladi.' });
      return;
    }

    if (cmd === '/voice_style') {
      const [vStyle, vSpeed] = argLower.split(/\s+/);
      if (vStyle && ['calm', 'warm', 'energetic', 'formal'].includes(vStyle)) {
        await updateBotSettings({
          voiceStyle: vStyle as VoiceStyle,
          ...(vSpeed && ['slow', 'normal', 'fast'].includes(vSpeed) ? { speakingSpeed: vSpeed as SpeakingSpeed } : {}),
        });
        await sendBotTextMessage({ chatId: msg.chat.id, text: `✅ Ovoz uslubi yangilandi (${vStyle}).` });
        return;
      }
      const view = buildVoiceView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/video') {
      const view = buildVideoView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/video_on') {
      settings = await updateBotSettings({ videoReplyEnabled: true });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: '⭕️ Chiquvchi dumaloq video javoblar (384x384 MP4 sendVideoNote) yoqildi.',
      });
      return;
    }

    if (cmd === '/video_off') {
      settings = await updateBotSettings({ videoReplyEnabled: false });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: '🎬 Dumaloq video javoblar o‘chirildi (kiruvchi video tahlili faol qoladi).',
      });
      return;
    }

    if (cmd === '/calls') {
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: buildCallsStatusReport(settings),
        replyMarkup: {
          inline_keyboard: [
            [
              {
                text: settings.callsEnabled ? '⚪️ Qo‘ng‘iroq ruxsatini o‘chirish' : '🟢 Qo‘ng‘iroq ruxsatini yoqish',
                callback_data: 'calls:toggle',
              },
            ],
            [{ text: s.btnBack, callback_data: 'cmd:home' }],
          ],
        },
      });
      return;
    }

    if (cmd === '/calls_on') {
      settings = await updateBotSettings({ callsEnabled: true });
      await sendBotTextMessage({ chatId: msg.chat.id, text: buildCallsStatusReport(settings) });
      return;
    }

    if (cmd === '/calls_off') {
      settings = await updateBotSettings({ callsEnabled: false });
      await sendBotTextMessage({ chatId: msg.chat.id, text: '📞 Qo‘ng‘iroqlar tayyorlik ruxsati o‘chirildi.' });
      return;
    }

    if (cmd === '/permissions') {
      const view = await buildPermissionsView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/privacy') {
      await sendBotTextMessage({ chatId: msg.chat.id, text: s.privacyText });
      return;
    }

    if (cmd === '/activity' || cmd === '/logs') {
      const view = await buildActivityView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/autonomous' || cmd === '/auto') {
      if (!settings.aiConsentConfirmed) {
        await sendBotTextMessage({
          chatId: msg.chat.id,
          text: s.autonomousNeedsConsentText,
          replyMarkup: {
            inline_keyboard: [
              [{ text: s.btnConfirmConsent, callback_data: 'cfg:confirm_and_auto' }],
              [{ text: s.btnSettings, callback_data: 'cmd:settings' }],
            ],
          },
        });
        return;
      }
      settings = await updateBotSettings({
        autonomousEnabled: true,
        autoReplyMode: 'autonomous',
        paused: false,
        businessPaused: false,
        botPaused: false,
        emergencyStop: false,
      });
      await writeAuditLog({
        channel: 'system',
        eventType: 'autonomous_enabled',
        severity: 'info',
        chatId: String(msg.chat.id),
        summary: 'Egasi avtonom rejimni yoqdi',
      });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: s.autonomousEnabledText,
        replyMarkup: buildMainMenuKeyboard(settings.uiLanguage, settings),
      });
      return;
    }

    if (cmd === '/pause') {
      if (argLower === 'bot') {
        settings = await updateBotSettings({ botPaused: true });
        await sendBotTextMessage({ chatId: msg.chat.id, text: '⏸ B komponent (bot suhbati) pauza qilindi.' });
        return;
      }
      if (argLower === 'personal' || argLower === 'business') {
        settings = await updateBotSettings({ businessPaused: true });
        await sendBotTextMessage({ chatId: msg.chat.id, text: '⏸ A komponent (shaxsiy Business javoblar) pauza qilindi.' });
        return;
      }
      settings = await updateBotSettings({ paused: true, businessPaused: true });
      await writeAuditLog({
        channel: 'system',
        eventType: 'assistant_paused',
        severity: 'warn',
        chatId: String(msg.chat.id),
        summary: 'Egasi /pause orqali avtomatik javoblarni to‘xtatdi',
      });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: s.pausedToast,
        replyMarkup: buildMainMenuKeyboard(settings.uiLanguage, settings),
      });
      return;
    }

    if (cmd === '/resume') {
      if (argLower === 'bot') {
        settings = await updateBotSettings({ botPaused: false, emergencyStop: false });
        await sendBotTextMessage({ chatId: msg.chat.id, text: '▶️ B komponent qayta faollashtirildi.' });
        return;
      }
      if (argLower === 'personal' || argLower === 'business') {
        settings = await updateBotSettings({ businessPaused: false, paused: false, emergencyStop: false });
        await sendBotTextMessage({ chatId: msg.chat.id, text: '▶️ A komponent (shaxsiy Business) qayta faollashtirildi.' });
        return;
      }
      settings = await updateBotSettings({
        paused: false,
        botPaused: false,
        businessPaused: false,
        emergencyStop: false,
      });
      await writeAuditLog({
        channel: 'system',
        eventType: 'assistant_resumed',
        severity: 'info',
        chatId: String(msg.chat.id),
        summary: 'Egasi /resume orqali barcha javoblarni qayta yoqdi',
      });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: s.resumedToast,
        replyMarkup: buildMainMenuKeyboard(settings.uiLanguage, settings),
      });
      return;
    }

    if (cmd === '/stop') {
      settings = await updateBotSettings({
        emergencyStop: true,
        paused: true,
        botPaused: true,
        businessPaused: true,
        autonomousEnabled: false,
      });
      await writeAuditLog({
        channel: 'system',
        eventType: 'emergency_stop_activated',
        severity: 'critical',
        chatId: String(msg.chat.id),
        summary: 'FAVQULODDA TO‘XTATISH (Emergency Stop) faollashtirildi',
      });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: s.stoppedToast,
        replyMarkup: buildMainMenuKeyboard(settings.uiLanguage, settings),
      });
      return;
    }

    if (cmd === '/memory_show') {
      const view = await buildMemoryView(settings);
      await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
      return;
    }

    if (cmd === '/memory_clear') {
      const deletedCount = await clearMemoryRecords();
      settings = await updateBotSettings({ memorySummary: '' });
      await writeAuditLog({
        channel: 'system',
        eventType: 'memory_cleared',
        severity: 'info',
        summary: `Egasi /memory_clear orqali ${deletedCount} ta xotira yozuvini tozaladi`,
      });
      await sendBotTextMessage({ chatId: msg.chat.id, text: `${s.memoryCleared} (${deletedCount} ta yozuv)` });
      return;
    }

    if (cmd === '/memory_search') {
      if (!argText) {
        await sendBotTextMessage({ chatId: msg.chat.id, text: 'Foydalanish: /memory_search <kalit_so‘z>' });
        return;
      }
      const hits = await searchMemoryRecords(argText, 15);
      const formatted =
        hits.length > 0
          ? hits.map((m, i) => `${i + 1}. [${m.type} | ${m.scope}] ${m.content}`).join('\n')
          : 'Mos xotira yozuvi topilmadi.';
      await sendBotTextMessage({ chatId: msg.chat.id, text: `🔍 Qidiruv: "${argText}"\n\n${formatted}` });
      return;
    }

    if (cmd === '/memory') {
      if (!argText) {
        const view = await buildMemoryView(settings);
        await sendBotTextMessage({ chatId: msg.chat.id, text: view.text, replyMarkup: view.markup });
        return;
      }

      if (argLower === 'clear') {
        const deletedCount = await clearMemoryRecords();
        settings = await updateBotSettings({ memorySummary: '' });
        await sendBotTextMessage({ chatId: msg.chat.id, text: `${s.memoryCleared} (${deletedCount})` });
        return;
      }

      const content = argLower.startsWith('add ')
        ? argText.slice(4).trim()
        : argLower.startsWith('set ')
          ? argText.slice(4).trim()
          : argText;

      const saved = await saveMemorySafely({
        type: 'owner_fact',
        scope: 'owner',
        channel: 'global',
        content,
        provenance: 'owner_command',
        tags: 'manual owner',
      });
      if (!saved) {
        await sendBotTextMessage({
          chatId: msg.chat.id,
          text: '🚫 Xavfsizlik qoidasi: parol, OTP, karta raqami yoki maxfiy kalit xotiraga saqlanmaydi.',
        });
        return;
      }
      await writeAuditLog({
        channel: 'system',
        eventType: 'memory_updated',
        severity: 'info',
        summary: 'Egasi /memory orqali yangi xotira saqladi',
      });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: `${s.memorySaved}\n\n• [${saved.type}] ${saved.content}`,
      });
      return;
    }

    if (cmd === '/clear') {
      await clearConversationHistory('bot_direct', String(msg.chat.id));
      await sendBotTextMessage({ chatId: msg.chat.id, text: '🧹 Ushbu bot suhbat tarixi tozalandi.' });
      return;
    }

    if (cmd === '/exclude' || cmd === '/approve' || cmd === '/allow') {
      if (!argText || !/^-?\d+$/.test(argText)) {
        await sendBotTextMessage({
          chatId: msg.chat.id,
          text: `Foydalanish: ${cmd} <chat_id>`,
        });
        return;
      }
      const perm = cmd === '/exclude' ? 'exclude' : cmd === '/approve' ? 'manual_approve' : 'allow';
      await upsertChatRule({ channel: 'business_chat', chatId: argText, permission: perm });
      await writeAuditLog({
        channel: 'business_chat',
        eventType: 'chat_rule_updated',
        severity: 'info',
        chatId: argText,
        summary: `Chat ${argText} ruxsati "${perm}" ga o‘zgartirildi`,
      });
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: `✅ Chat ${argText} qoidasi "${perm}" ga o‘zgartirildi.`,
      });
      return;
    }
  }

  // Non-command direct message to Component B bot -> real Gemini AI conversation
  if (settings.emergencyStop || settings.botPaused) {
    await sendBotTextMessage({
      chatId: msg.chat.id,
      text: settings.emergencyStop ? s.emergencyBlockedReply : '⏸ Bot suhbati pauzada (/resume bot).',
    });
    return;
  }
  if (!isGeminiConfigured()) {
    await sendBotTextMessage({ chatId: msg.chat.id, text: s.geminiMissingReply });
    return;
  }

  const chatIdStr = String(msg.chat.id);
  const ownerName = `${msg.from?.first_name || 'Egasi'} ${msg.from?.last_name || ''}`.trim();

  await sendChatAction({
    chatId: msg.chat.id,
    action: settings.videoReplyEnabled
      ? 'record_video_note'
      : settings.voiceOutputMode !== 'text' || settings.voiceReplyEnabled
        ? 'record_voice'
        : 'typing',
  });

  let inboundText = rawText;
  let transcript = '';
  let mediaType: 'text' | 'voice' | 'photo' | 'video' | 'video_note' | 'document' = 'text';
  const attachments: Array<{ mimeType: string; buffer: Buffer; label: string }> = [];

  try {
    if (msg.voice) {
      mediaType = 'voice';
      const { buffer } = await downloadTelegramFile(msg.voice.file_id);
      transcript = await transcribeAudioBuffer(buffer, msg.voice.mime_type || 'audio/ogg');
      inboundText = transcript || '[Ovozli xabar aniq eshitilmadi]';
    } else if (msg.audio) {
      mediaType = 'voice';
      const { buffer } = await downloadTelegramFile(msg.audio.file_id);
      transcript = await transcribeAudioBuffer(buffer, msg.audio.mime_type || 'audio/mpeg');
      inboundText = transcript || `[Audio: ${msg.audio.file_name || 'fayl'}]`;
    } else if (msg.video_note && settings.autoAnalyzeVideo) {
      mediaType = 'video_note';
      const { buffer } = await downloadTelegramFile(msg.video_note.file_id);
      const analyzed = await analyzeVideoWithFfmpeg({
        videoBuffer: buffer,
        isVideoNote: true,
        caption: rawText,
      });
      transcript = analyzed.transcript;
      inboundText = analyzed.summaryContext;
      for (const fr of analyzed.frames) attachments.push(fr);
    } else if (msg.video && settings.autoAnalyzeVideo) {
      mediaType = 'video';
      const { buffer } = await downloadTelegramFile(msg.video.file_id);
      const analyzed = await analyzeVideoWithFfmpeg({
        videoBuffer: buffer,
        isVideoNote: false,
        caption: rawText,
      });
      transcript = analyzed.transcript;
      inboundText = analyzed.summaryContext;
      for (const fr of analyzed.frames) attachments.push(fr);
    } else if (msg.photo && msg.photo.length > 0) {
      mediaType = 'photo';
      const largest = msg.photo[msg.photo.length - 1];
      const { buffer } = await downloadTelegramFile(largest.file_id);
      attachments.push({ mimeType: 'image/jpeg', buffer, label: 'photo' });
    } else if (msg.document) {
      mediaType = 'document';
      const supported = ['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/webp'];
      if (msg.document.file_size && msg.document.file_size > MAX_MEDIA_BYTES) {
        await sendBotTextMessage({
          chatId: msg.chat.id,
          text: `⚠️ Fayl hajmi 20 MB limitidan katta (${Math.round(msg.document.file_size / (1024 * 1024))} MB); Telegram Bot API uni yuklab ololmaydi.`,
        });
        return;
      }
      if (msg.document.mime_type && supported.includes(msg.document.mime_type)) {
        const { buffer } = await downloadTelegramFile(msg.document.file_id);
        attachments.push({
          mimeType: msg.document.mime_type,
          buffer,
          label: `document (${msg.document.file_name || 'file'})`,
        });
      } else {
        inboundText = `${inboundText} [Qo‘llab-quvvatlanmaydigan fayl turi: ${msg.document.file_name || 'hujjat'} (${msg.document.mime_type || 'noma‘lum'})]`.trim();
      }
    }

    await addConversationMessage({
      channel: 'bot_direct',
      chatId: chatIdStr,
      telegramMessageId: msg.message_id,
      role: 'user',
      mediaType,
      text: inboundText || `[${mediaType}]`,
      transcript,
      status: 'received',
    });

    const userPref = msg.from?.id
      ? await getUserLanguagePreference(String(msg.from.id)).catch(() => null)
      : null;
    const history = await getConversationHistory('bot_direct', chatIdStr, 16);
    const reply = await generateAssistantReply({
      mode: 'bot_direct',
      chatId: chatIdStr,
      personaPrompt: settings.personaPrompt,
      memorySummary: settings.memorySummary,
      defaultLanguage: userPref?.preferredLanguage ?? settings.defaultReplyLanguage,
      uiLanguage: userPref?.uiLanguage ?? settings.uiLanguage,
      responseStyle: settings.responseStyle,
      verbosityMode: settings.verbosityMode,
      emojiLevel: settings.emojiLevel,
      customStyleExamples: settings.customStyleExamples,
      disclosureEnabled: false,
      confidenceThreshold: settings.confidenceThreshold,
      escalationKeywords: settings.escalationKeywords,
      contactName: ownerName,
      conversationHistory: history,
      inboundText: inboundText || `[${mediaType}]`,
      attachments: attachments.length > 0 ? attachments : undefined,
      dedupKey: `bot_${chatIdStr}_${msg.message_id}`,
    });

    const replyText = reply.replyText || 'Javob shakllantirilmadi.';
    const delivered = await deliverAssistantResponse({
      channel: 'bot_direct',
      chatId: chatIdStr,
      replyText,
      settings,
      replyToMessageId: msg.message_id,
    });

    await addConversationMessage({
      channel: 'bot_direct',
      chatId: chatIdStr,
      telegramMessageId: delivered.sentMessageId,
      role: 'assistant',
      mediaType: delivered.mediaType,
      text: replyText,
      status: 'sent',
    });

    await writeAuditLog({
      channel: 'bot_direct',
      eventType: 'bot_direct_reply',
      severity: 'info',
      chatId: chatIdStr,
      summary: `B komponent javob berdi (${mediaType} -> ${delivered.mediaType}, QC=${reply.confidenceScore}%)`,
      details: delivered.fallbackNote || '',
    });
  } catch (err) {
    const rawErr = err instanceof Error ? err.message : String(err);
    const safeErr = sanitizeForLog(rawErr);

    await writeAuditLog({
      channel: 'bot_direct',
      eventType: err instanceof QuotaUnavailableError ? 'gemini_quota_unavailable' : 'bot_direct_error',
      severity: err instanceof QuotaUnavailableError ? 'warn' : 'error',
      chatId: chatIdStr,
      summary: err instanceof QuotaUnavailableError ? 'Gemini API kvotasi vaqtincha band' : 'B komponent javob yaratishda xatolik',
      details: safeErr,
    }).catch(() => {});

    if (err instanceof QuotaUnavailableError) {
      const waitSec = Math.max(5, Math.ceil(err.retryAfterMs / 1000));
      await sendBotTextMessage({
        chatId: msg.chat.id,
        text: `⏳ Gemini AI xizmati hozir vaqtincha cheklangan (${waitSec} soniyadan so‘ng qayta urinib ko‘ring). Xabaringiz xavfsizlik tekshiruviga tushmadi — bu vaqtinchalik API limiti.`,
      }).catch(() => {});
      return;
    }

    await sendBotTextMessage({
      chatId: msg.chat.id,
      text: `⚠️ Xatolik yuz berdi: ${safeErr.slice(0, 350)}`,
    }).catch(() => {});
  }
}

export async function handleBotCallbackQuery(cb: IncomingCallbackQuery): Promise<void> {
  const data = cb.data || '';
  const chatId = cb.message?.chat.id ?? cb.from.id;
  const messageId = cb.message?.message_id;

  const { allowed, settings: currentSettings } = await resolveOwnerAccess(cb.from);
  let settings = currentSettings;
  const s = t(settings.uiLanguage);

  // Allow Business-chat users to update ONLY their own persistent language preference via inline buttons
  if (!allowed && cb.business_connection_id && data.startsWith('lang:')) {
    const nextPref = data.slice(5) as LanguagePreference;
    if (['uz_lat', 'uz_cyr', 'uz_new', 'ru', 'en', 'auto'].includes(nextPref)) {
      const nextUiLang: UILanguage = nextPref === 'auto' ? settings.uiLanguage : nextPref;
      await setUserLanguagePreference({
        userId: String(cb.from.id),
        preferredLanguage: nextPref,
        uiLanguage: nextUiLang,
        username: cb.from.username || '',
        displayName: `${cb.from.first_name || ''} ${cb.from.last_name || ''}`.trim(),
      });
      await writeAuditLog({
        channel: 'business_chat',
        eventType: 'user_language_changed',
        severity: 'info',
        chatId: String(chatId),
        summary: `Foydalanuvchi (${cb.from.id}) til rejimini "${nextPref}" ga o‘zgartirdi`,
      }).catch(() => {});
      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: `✅ ${LANGUAGE_DISPLAY_NAMES[nextPref]}`,
      });
      const view = buildLanguageSelectionView(nextUiLang, nextPref, false);
      const confirmText = `${formatLanguageChangedConfirmation(nextPref, nextUiLang)}\n\n${view.text}`;
      if (messageId) {
        await editBotTextMessage({
          chatId,
          messageId,
          text: confirmText,
          replyMarkup: view.markup,
          businessConnectionId: cb.business_connection_id,
        }).catch(async () => {
          await sendBotTextMessage({
            chatId,
            text: confirmText,
            replyMarkup: view.markup,
            businessConnectionId: cb.business_connection_id,
          });
        });
      }
    }
    return;
  }

  if (!allowed) {
    await answerCallbackQuery({ callbackQueryId: cb.id, text: s.unauthorized, showAlert: true }).catch(
      () => {}
    );
    return;
  }

  const updateMenu = async (text: string, markup?: InlineKeyboardMarkup) => {
    if (messageId) {
      await editBotTextMessage({ chatId, messageId, text, replyMarkup: markup }).catch(async () => {
        await sendBotTextMessage({ chatId, text, replyMarkup: markup });
      });
    } else {
      await sendBotTextMessage({ chatId, text, replyMarkup: markup });
    }
  };

  if (data === 'cmd:home') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    await updateMenu(`${s.welcomeTitle}\n\n${s.welcomeBody}`, buildMainMenuKeyboard(settings.uiLanguage, settings));
    return;
  }

  if (data === 'cmd:status') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildStatusView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:accounts') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildAccountsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:connect') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    await updateMenu(s.connectText, {
      inline_keyboard: [
        [{ text: s.btnCheckBusiness, callback_data: 'act:check_business' }],
        [
          {
            text: settings.aiConsentConfirmed ? s.btnRevokeConsent : s.btnConfirmConsent,
            callback_data: 'cfg:toggle_consent',
          },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    });
    return;
  }

  if (data === 'cmd:settings') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildSettingsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:language') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const existingPref = await getUserLanguagePreference(String(cb.from.id)).catch(() => null);
    const activePref = existingPref?.preferredLanguage ?? settings.defaultReplyLanguage;
    const view = buildLanguageView(settings.uiLanguage, activePref);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:style') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildStyleView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:voice') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildVoiceView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:video') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildVideoView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:calls') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    await updateMenu(buildCallsStatusReport(settings), {
      inline_keyboard: [
        [
          {
            text: settings.callsEnabled ? '⚪️ Qo‘ng‘iroq ruxsatini o‘chirish' : '🟢 Qo‘ng‘iroq ruxsatini yoqish',
            callback_data: 'calls:toggle',
          },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    });
    return;
  }

  if (data === 'cmd:memory') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildMemoryView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:permissions') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildPermissionsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cmd:activity') {
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildActivityView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('lang:')) {
    const nextPref = data.slice(5) as LanguagePreference;
    if (['uz_lat', 'uz_cyr', 'uz_new', 'ru', 'en', 'auto'].includes(nextPref)) {
      const nextUiLang: UILanguage = nextPref === 'auto' ? settings.uiLanguage : nextPref;

      await setUserLanguagePreference({
        userId: String(cb.from.id),
        preferredLanguage: nextPref,
        uiLanguage: nextUiLang,
        username: cb.from.username || '',
        displayName: `${cb.from.first_name || ''} ${cb.from.last_name || ''}`.trim(),
      });

      settings = await updateBotSettings({
        defaultReplyLanguage: nextPref,
        ...(nextPref !== 'auto' ? { uiLanguage: nextPref } : {}),
      });

      await writeAuditLog({
        channel: 'system',
        eventType: 'language_changed',
        severity: 'info',
        summary: `Egasi til rejimini "${nextPref}" ga o‘zgartirdi`,
      }).catch(() => {});

      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: `✅ ${LANGUAGE_DISPLAY_NAMES[nextPref]}`,
      });
      const view = buildLanguageView(settings.uiLanguage, nextPref);
      await updateMenu(
        `${formatLanguageChangedConfirmation(nextPref, settings.uiLanguage)}\n\n${view.text}`,
        view.markup
      );
    }
    return;
  }

  if (data.startsWith('style:tone:')) {
    const tone = data.slice('style:tone:'.length) as ResponseStyle;
    settings = await updateBotSettings({ responseStyle: tone });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `✅ Ohang: ${tone}` });
    const view = buildStyleView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('style:len:')) {
    const len = data.slice('style:len:'.length) as VerbosityMode;
    settings = await updateBotSettings({ verbosityMode: len });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `✅ Uzunlik: ${len}` });
    const view = buildStyleView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('style:emoji:')) {
    const em = data.slice('style:emoji:'.length) as EmojiLevel;
    settings = await updateBotSettings({ emojiLevel: em });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `✅ Emoji: ${em}` });
    const view = buildStyleView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'acc:toggle_business_pause') {
    settings = await updateBotSettings({ businessPaused: !settings.businessPaused });
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildAccountsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'acc:toggle_bot_pause') {
    settings = await updateBotSettings({ botPaused: !settings.botPaused });
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = await buildAccountsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'calls:toggle') {
    settings = await updateBotSettings({ callsEnabled: !settings.callsEnabled });
    await answerCallbackQuery({ callbackQueryId: cb.id });
    await updateMenu(buildCallsStatusReport(settings), {
      inline_keyboard: [
        [
          {
            text: settings.callsEnabled ? '⚪️ Qo‘ng‘iroq ruxsatini o‘chirish' : '🟢 Qo‘ng‘iroq ruxsatini yoqish',
            callback_data: 'calls:toggle',
          },
        ],
        [{ text: s.btnBack, callback_data: 'cmd:home' }],
      ],
    });
    return;
  }

  if (data === 'act:pause') {
    settings = await updateBotSettings({ paused: true, businessPaused: true });
    await writeAuditLog({
      channel: 'system',
      eventType: 'assistant_paused',
      severity: 'warn',
      summary: 'Egasi tugma orqali pauza qildi',
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: s.pausedToast });
    await updateMenu(`${s.welcomeTitle}\n\n${s.pausedToast}`, buildMainMenuKeyboard(settings.uiLanguage, settings));
    return;
  }

  if (data === 'act:resume') {
    settings = await updateBotSettings({
      paused: false,
      botPaused: false,
      businessPaused: false,
      emergencyStop: false,
    });
    await writeAuditLog({
      channel: 'system',
      eventType: 'assistant_resumed',
      severity: 'info',
      summary: 'Egasi tugma orqali davom ettirdi',
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: s.resumedToast });
    await updateMenu(`${s.welcomeTitle}\n\n${s.resumedToast}`, buildMainMenuKeyboard(settings.uiLanguage, settings));
    return;
  }

  if (data === 'act:stop') {
    settings = await updateBotSettings({
      emergencyStop: true,
      paused: true,
      botPaused: true,
      businessPaused: true,
      autonomousEnabled: false,
    });
    await writeAuditLog({
      channel: 'system',
      eventType: 'emergency_stop_activated',
      severity: 'critical',
      summary: 'FAVQULODDA TO‘XTATISH tugma orqali yoqildi',
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: s.stoppedToast, showAlert: true });
    await updateMenu(s.stoppedToast, buildMainMenuKeyboard(settings.uiLanguage, settings));
    return;
  }

  if (data === 'act:clear_memory') {
    const count = await clearMemoryRecords();
    settings = await updateBotSettings({ memorySummary: '' });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `${s.memoryCleared} (${count})` });
    await updateMenu(`${s.memoryCleared} (${count})`, buildMainMenuKeyboard(settings.uiLanguage, settings));
    return;
  }

  if (data === 'act:check_business') {
    if (!settings.businessConnectionId) {
      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: 'Hali Telegram Business ulanishi kelmadi. Settings → Telegram Business → Chatbots dan ulang.',
        showAlert: true,
      });
      return;
    }
    try {
      const bc = await fetchBusinessConnection(settings.businessConnectionId);
      const canReply = bc.rights?.can_reply ?? bc.can_reply ?? false;
      const canRead = bc.rights?.can_read_messages ?? false;
      const canDeleteSent = bc.rights?.can_delete_sent_messages ?? false;
      const ownerName = `${bc.user.first_name} ${bc.user.last_name || ''}`.trim();

      settings = await updateBotSettings({
        connectionEnabled: bc.is_enabled,
        businessOwnerId: bc.user.id,
        businessOwnerName: ownerName,
        rightsCanReply: canReply,
        rightsCanReadMessages: canRead,
        rightsCanDeleteSent: canDeleteSent,
      });
      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: bc.is_enabled ? '✅ Business ulanishi faol!' : '⚠️ Business ulanishi o‘chirilgan.',
      });
      const view = await buildStatusView(settings);
      await updateMenu(view.text, view.markup);
    } catch (err) {
      await answerCallbackQuery({
        callbackQueryId: cb.id,
        text: err instanceof Error ? err.message : 'Ulanishni tekshirishda xatolik',
        showAlert: true,
      });
    }
    return;
  }

  if (data === 'cfg:toggle_consent') {
    const next = !settings.aiConsentConfirmed;
    settings = await updateBotSettings({
      aiConsentConfirmed: next,
      ...(!next ? { autonomousEnabled: false } : {}),
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: next ? s.consentConfirmedToast : '🚫 AI roziligi o‘chirildi' });
    const view = buildSettingsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cfg:confirm_and_auto') {
    settings = await updateBotSettings({
      aiConsentConfirmed: true,
      autonomousEnabled: true,
      autoReplyMode: 'autonomous',
      paused: false,
      businessPaused: false,
      emergencyStop: false,
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: s.autonomousEnabledText });
    await updateMenu(s.autonomousEnabledText, buildMainMenuKeyboard(settings.uiLanguage, settings));
    return;
  }

  if (data === 'cfg:toggle_autonomous') {
    if (!settings.autonomousEnabled && !settings.aiConsentConfirmed) {
      await answerCallbackQuery({ callbackQueryId: cb.id, text: s.autonomousNeedsConsentText, showAlert: true });
      return;
    }
    const next = !settings.autonomousEnabled;
    settings = await updateBotSettings({
      autonomousEnabled: next,
      autoReplyMode: next ? 'autonomous' : 'manual_approval',
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: next ? '🤖 Avtonom rejim ON' : '📝 Qo‘lda tasdiqlash' });
    const view = buildSettingsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cfg:toggle_disclosure') {
    settings = await updateBotSettings({ disclosureEnabled: !settings.disclosureEnabled });
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildSettingsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cfg:toggle_transcribe') {
    settings = await updateBotSettings({ autoTranscribeVoice: !settings.autoTranscribeVoice });
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildSettingsView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'cfg:toggle_video') {
    settings = await updateBotSettings({ autoAnalyzeVideo: !settings.autoAnalyzeVideo });
    await answerCallbackQuery({ callbackQueryId: cb.id });
    const view = buildVideoView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data === 'video:toggle_reply') {
    settings = await updateBotSettings({ videoReplyEnabled: !settings.videoReplyEnabled });
    await answerCallbackQuery({
      callbackQueryId: cb.id,
      text: settings.videoReplyEnabled ? '⭕️ Dumaloq video javob ON' : '⭕️ Dumaloq video javob OFF',
    });
    const view = buildVideoView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('cfg:conf:')) {
    const val = Number(data.slice('cfg:conf:'.length));
    if ([60, 70, 85].includes(val)) {
      settings = await updateBotSettings({ confidenceThreshold: val });
      await answerCallbackQuery({ callbackQueryId: cb.id, text: `🎯 ${val}%` });
      const view = buildSettingsView(settings);
      await updateMenu(view.text, view.markup);
    }
    return;
  }

  if (data.startsWith('voice:mode:')) {
    const mode = data.slice('voice:mode:'.length) as VoiceOutputMode;
    settings = await updateBotSettings({
      voiceOutputMode: mode,
      voiceReplyEnabled: mode !== 'text',
    });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `🔊 Chiqish: ${mode}` });
    const view = buildVoiceView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('voice:style:')) {
    const voiceStyle = data.slice('voice:style:'.length) as VoiceStyle;
    settings = await updateBotSettings({ voiceStyle });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `🎙 Uslub: ${voiceStyle}` });
    const view = buildVoiceView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('voice:speed:')) {
    const speakingSpeed = data.slice('voice:speed:'.length) as SpeakingSpeed;
    settings = await updateBotSettings({ speakingSpeed });
    await answerCallbackQuery({ callbackQueryId: cb.id, text: `⏱ Tezlik: ${speakingSpeed}` });
    const view = buildVoiceView(settings);
    await updateMenu(view.text, view.markup);
    return;
  }

  if (data.startsWith('voice:set:')) {
    const voice = data.slice('voice:set:'.length) as TtsVoice;
    if (['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].includes(voice)) {
      settings = await updateBotSettings({ ttsVoice: voice });
      await answerCallbackQuery({ callbackQueryId: cb.id, text: `🎙 ${voice}` });
      const view = buildVoiceView(settings);
      await updateMenu(view.text, view.markup);
    }
    return;
  }

  if (data.startsWith('appr:')) {
    const [, approvalId, action] = data.split(':');
    if (!approvalId) return;

    if (action === 'send') {
      try {
        const res = await approveAndSendPendingReply(approvalId);
        await answerCallbackQuery({ callbackQueryId: cb.id, text: `✅ Yuborildi (${res.contactName})` });
        await updateMenu(`✅ Tasdiqlandi va ${res.contactName} ga yuborildi (Msg ID: ${res.messageId}).`);
      } catch (err) {
        await answerCallbackQuery({
          callbackQueryId: cb.id,
          text: err instanceof Error ? err.message : 'Yuborishda xatolik',
          showAlert: true,
        });
      }
      return;
    }

    if (action === 'reject') {
      const appr = await getPendingApprovalById(approvalId);
      if (appr && appr.status === 'pending') {
        await updatePendingApproval(approvalId, { status: 'rejected' });
        await writeAuditLog({
          channel: 'business_chat',
          eventType: 'manual_approval_rejected',
          severity: 'info',
          chatId: appr.chatId,
          summary: `Egasi #${approvalId} qoralamani rad etdi (${appr.contactName})`,
        });
      }
      await answerCallbackQuery({ callbackQueryId: cb.id, text: '❌ Rad etildi' });
      await updateMenu(`❌ Javob #${approvalId} rad etildi.`);
      return;
    }

    if (action === 'exclude') {
      const appr = await getPendingApprovalById(approvalId);
      if (appr) {
        if (appr.status === 'pending') {
          await updatePendingApproval(approvalId, { status: 'rejected' });
        }
        await upsertChatRule({
          channel: 'business_chat',
          chatId: appr.chatId,
          contactName: appr.contactName,
          permission: 'exclude',
        });
        await writeAuditLog({
          channel: 'business_chat',
          eventType: 'chat_excluded',
          severity: 'warn',
          chatId: appr.chatId,
          summary: `Egasi ${appr.contactName} (${appr.chatId}) chatini AI dan chekladi`,
        });
      }
      await answerCallbackQuery({ callbackQueryId: cb.id, text: '🚫 Chat cheklandi' });
      await updateMenu(`🚫 Chat (${appr?.contactName || approvalId}) AI dan cheklandi.`);
    }
  }
}
