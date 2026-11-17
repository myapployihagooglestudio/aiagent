import {
  handleBotCallbackQuery,
  handleBotDirectMessage,
  type IncomingCallbackQuery,
  type IncomingTelegramChat,
  type IncomingTelegramMessage,
  type IncomingTelegramUser,
} from './botCommands.ts';
import {
  addConversationMessage,
  claimDedupKey,
  createPendingApproval,
  enqueueJob,
  fetchQueuedJobs,
  getBotSettings,
  getChatRule,
  getConversationHistory,
  getUserLanguagePreference,
  setUserLanguagePreference,
  updateBotSettings,
  updateMessageStatusByTelegramId,
  updatePendingApproval,
  updateQueueJobStatus,
  upsertChatRule,
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
  formatLanguageChangedConfirmation,
  parseLanguageShortcut,
  t,
} from './i18nBot.ts';
import {
  downloadTelegramFile,
  getBotEnv,
  markBusinessMessageRead,
  sendBotTextMessage,
  sendBusinessTextMessage,
  type TelegramBusinessConnectionPayload,
} from './telegramClient.ts';
import type { UILanguage } from './types.ts';

export interface TelegramUpdatePayload {
  update_id: number;
  business_connection?: TelegramBusinessConnectionPayload;
  business_message?: IncomingTelegramMessage;
  edited_business_message?: IncomingTelegramMessage;
  deleted_business_messages?: {
    business_connection_id: string;
    chat: IncomingTelegramChat;
    message_ids: number[];
  };
  message?: IncomingTelegramMessage;
  callback_query?: IncomingCallbackQuery;
}

const outboundTimestamps: number[] = [];
let workerLoopTimer: NodeJS.Timeout | null = null;
let isProcessingQueue = false;

function formatContactName(chat: IncomingTelegramChat, from?: IncomingTelegramUser): string {
  const first = chat.first_name || from?.first_name || '';
  const last = chat.last_name || from?.last_name || '';
  const full = `${first} ${last}`.trim();
  return full || chat.title || chat.username || `Chat ${chat.id}`;
}

function detectMediaType(
  msg: IncomingTelegramMessage
): 'text' | 'voice' | 'photo' | 'video' | 'video_note' | 'document' {
  if (msg.voice || msg.audio) return 'voice';
  if (msg.video_note) return 'video_note';
  if (msg.video) return 'video';
  if (msg.photo && msg.photo.length > 0) return 'photo';
  if (msg.document) return 'document';
  return 'text';
}

export async function handleTelegramWebhookUpdate(update: TelegramUpdatePayload): Promise<void> {
  if (!update || typeof update.update_id !== 'number') {
    return;
  }

  const claimedUpdate = await claimDedupKey(`upd_${update.update_id}`);
  if (!claimedUpdate) {
    return;
  }

  const eventLabel = update.business_connection
    ? 'business_connection'
    : update.business_message
      ? 'business_message'
      : update.edited_business_message
        ? 'edited_business_message'
        : update.deleted_business_messages
          ? 'deleted_business_messages'
          : update.callback_query
            ? 'callback_query'
            : update.message
              ? 'message'
              : 'unknown';

  await updateBotSettings({
    lastWebhookAt: new Date().toISOString(),
    lastWebhookEvent: eventLabel,
  });

  if (update.business_connection) {
    const bc = update.business_connection;
    const settings = await getBotSettings();
    const expectedOwner = getBotEnv().ownerUserId ?? (settings.ownerTelegramId || null);

    if (expectedOwner !== null && expectedOwner !== 0 && bc.user.id !== expectedOwner) {
      await writeAuditLog({
        channel: 'business_chat',
        eventType: 'unauthorized_business_connection',
        severity: 'critical',
        summary: `Kutilmagan foydalanuvchi (${bc.user.id}) dan business_connection rad etildi`,
        details: `Kutilgan egasi ${expectedOwner}, kelgan ID ${bc.user.id}`,
      });
      return;
    }

    const canReply = bc.rights?.can_reply ?? bc.can_reply ?? false;
    const canRead = bc.rights?.can_read_messages ?? false;
    const canDeleteSent = bc.rights?.can_delete_sent_messages ?? false;
    const ownerName = `${bc.user.first_name} ${bc.user.last_name || ''}`.trim();

    await updateBotSettings({
      businessConnectionId: bc.id,
      connectionEnabled: bc.is_enabled,
      businessOwnerId: bc.user.id,
      businessOwnerName: ownerName,
      rightsCanReply: canReply,
      rightsCanReadMessages: canRead,
      rightsCanDeleteSent: canDeleteSent,
      ...(settings.ownerTelegramId === 0 ? { ownerTelegramId: bc.user.id } : {}),
    });

    await writeAuditLog({
      channel: 'business_chat',
      eventType: 'business_connection',
      severity: bc.is_enabled ? 'info' : 'warn',
      summary: bc.is_enabled
        ? `Business ulanishi faollashdi (${ownerName}, ID ${bc.user.id})`
        : `Business ulanishi o‘chirildi (${ownerName})`,
      details: JSON.stringify({ connectionId: bc.id, canReply, canRead, canDeleteSent }),
    });

    const notifyChatId = bc.user_chat_id || bc.user.id;
    await sendBotTextMessage({
      chatId: notifyChatId,
      text: bc.is_enabled
        ? `✅ Shaxsiy Telegram Business akkauntingiz ulandi (${ownerName}).\nRuxsatlar: O‘qish=${canRead ? 'ha' : 'yo‘q'}, Javob=${canReply ? 'ha' : 'yo‘q'}.\nAvtonom rejim: ${settings.autonomousEnabled ? 'FAOL' : 'O‘CHIQ'}. Holat: /status`
        : `⚠️ Telegram Business ulanishi o‘chirildi (${ownerName}).`,
    }).catch(() => {});
    return;
  }

  if (update.deleted_business_messages) {
    const del = update.deleted_business_messages;
    const chatId = String(del.chat.id);
    for (const msgId of del.message_ids) {
      await updateMessageStatusByTelegramId('business_chat', chatId, msgId, { status: 'deleted' });
    }
    await writeAuditLog({
      channel: 'business_chat',
      eventType: 'deleted_business_messages',
      severity: 'info',
      chatId,
      summary: `${chatId} chatida ${del.message_ids.length} ta xabar o‘chirildi`,
    });
    return;
  }

  if (update.edited_business_message) {
    const edited = update.edited_business_message;
    const chatId = String(edited.chat.id);
    await updateMessageStatusByTelegramId('business_chat', chatId, edited.message_id, {
      text: edited.text || edited.caption || '[media]',
      status: 'edited',
    });
    await writeAuditLog({
      channel: 'business_chat',
      eventType: 'edited_business_message',
      severity: 'info',
      chatId,
      summary: `${chatId} chatida ${edited.message_id}-xabar tahrirlandi`,
    });
    return;
  }

  if (update.business_message) {
    const msg = update.business_message;
    const chatId = String(msg.chat.id);

    if (msg.chat.type !== 'private') return;
    if (msg.from?.is_bot || msg.sender_business_bot) return;

    const settings = await getBotSettings();
    if (settings.businessOwnerId && msg.from?.id === settings.businessOwnerId) {
      const ownerText = (msg.text || msg.caption || `[${detectMediaType(msg)}]`).slice(0, 8000);
      await addConversationMessage({
        channel: 'business_chat',
        chatId,
        telegramMessageId: msg.message_id,
        role: 'owner',
        mediaType: detectMediaType(msg),
        text: ownerText,
        status: 'sent',
      });
      return;
    }

    const msgClaimed = await claimDedupKey(`bmsg_${chatId}_${msg.message_id}`);
    if (!msgClaimed) return;

    await enqueueJob({
      channel: 'business_chat',
      chatId,
      messageId: msg.message_id,
      payload: msg,
    });

    void drainMessageQueue();
    return;
  }

  if (update.callback_query) {
    await handleBotCallbackQuery(update.callback_query);
    return;
  }

  if (update.message) {
    await handleBotDirectMessage(update.message);
  }
}

async function notifyOwnerOfPendingApproval(params: {
  approvalId: string;
  contactName: string;
  chatId: string;
  incomingText: string;
  draftReply: string;
  reason: string;
  confidenceScore: number;
}): Promise<void> {
  const settings = await getBotSettings();
  const ownerChatId = settings.ownerTelegramId || settings.businessOwnerId;
  if (!ownerChatId) return;

  const s = t(settings.uiLanguage);
  const text = [
    `⚠️ Ega tasdig‘i talab qilinadi (#${params.approvalId})`,
    `👤 Kontakt: ${params.contactName} (ID: ${params.chatId})`,
    `🔍 Sabab: ${params.reason} (Ishonch: ${params.confidenceScore}%)`,
    '',
    `📩 Kelgan xabar:\n${params.incomingText.slice(0, 800)}`,
    '',
    `🤖 Tayyorlangan javob:\n${params.draftReply.slice(0, 1200)}`,
  ].join('\n');

  const sent = await sendBotTextMessage({
    chatId: ownerChatId,
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: s.btnApproveSend, callback_data: `appr:${params.approvalId}:send` },
          { text: s.btnReject, callback_data: `appr:${params.approvalId}:reject` },
        ],
        [{ text: s.btnExcludeChat, callback_data: `appr:${params.approvalId}:exclude` }],
      ],
    },
  }).catch(() => null);

  if (sent) {
    await updatePendingApproval(params.approvalId, { notificationMessageId: sent.message_id });
  }
}

async function processQueuedBusinessJob(msg: IncomingTelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id);
  const contactName = formatContactName(msg.chat, msg.from);
  const mediaType = detectMediaType(msg);
  const settings = await getBotSettings();

  const existingRule = await getChatRule('business_chat', chatId);
  if (existingRule?.permission === 'exclude') {
    await writeAuditLog({
      channel: 'business_chat',
      eventType: 'contact_excluded',
      severity: 'info',
      chatId,
      summary: `Cheklangan chat o‘tkazib yuborildi: ${contactName} (${chatId})`,
    });
    return;
  }

  await upsertChatRule({
    channel: 'business_chat',
    chatId,
    contactName,
    username: msg.chat.username || '',
    lastInboundAt: new Date().toISOString(),
  });

  if (settings.emergencyStop || settings.paused || settings.businessPaused) {
    await addConversationMessage({
      channel: 'business_chat',
      chatId,
      telegramMessageId: msg.message_id,
      role: 'user',
      mediaType,
      text: (msg.text || msg.caption || `[${mediaType}]`).slice(0, 8000),
      status: 'received',
    });
    await writeAuditLog({
      channel: 'business_chat',
      eventType: settings.emergencyStop ? 'emergency_stop_blocked' : 'paused_skipped',
      severity: 'warn',
      chatId,
      summary: `${contactName} xabari saqlandi (javob pauzada/to‘xtatilgan)`,
    });
    return;
  }

  const chatConsentOk = existingRule?.aiConsentGranted ?? true;
  if (!settings.aiConsentConfirmed || !chatConsentOk) {
    await addConversationMessage({
      channel: 'business_chat',
      chatId,
      telegramMessageId: msg.message_id,
      role: 'user',
      mediaType,
      text: (msg.text || msg.caption || `[${mediaType}]`).slice(0, 8000),
      status: 'received',
    });
    await writeAuditLog({
      channel: 'business_chat',
      eventType: 'ai_consent_disabled',
      severity: 'warn',
      chatId,
      summary: `${contactName} xabari saqlandi; AI qayta ishlash roziligi o‘chiq`,
    });
    return;
  }

  let inboundText = (msg.text || msg.caption || '').trim();
  const businessConnectionIdEarly = msg.business_connection_id || settings.businessConnectionId;

  // Instant self-service language/script selection for Business users — never escalates to admin approval
  if (mediaType === 'text' && inboundText.startsWith('/')) {
    const [rawCmd, ...args] = inboundText.split(/\s+/);
    const cmd = rawCmd.toLowerCase().split('@')[0];
    if (['/language', '/lang', '/til', '/uz', '/uzcyr', '/uznew', '/ru', '/en'].includes(cmd)) {
      const argLower = args.join(' ').trim().toLowerCase();
      const requestedPref = parseLanguageShortcut(cmd, argLower);
      const userId = String(msg.from?.id || chatId);
      const displayName = formatContactName(msg.chat, msg.from);
      const existingPref = await getUserLanguagePreference(userId).catch(() => null);

      let responseText: string;
      let activePref = existingPref?.preferredLanguage ?? settings.defaultReplyLanguage;
      let activeUiLang: UILanguage = existingPref?.uiLanguage ?? settings.uiLanguage;

      if (requestedPref) {
        activePref = requestedPref;
        activeUiLang = requestedPref === 'auto' ? activeUiLang : requestedPref;
        await setUserLanguagePreference({
          userId,
          preferredLanguage: requestedPref,
          uiLanguage: activeUiLang,
          username: msg.from?.username || msg.chat.username || '',
          displayName,
        });
        await writeAuditLog({
          channel: 'business_chat',
          eventType: 'user_language_changed',
          severity: 'info',
          chatId,
          summary: `${contactName} (${userId}) tilini "${requestedPref}" ga o‘zgartirdi`,
        }).catch(() => {});
        responseText = formatLanguageChangedConfirmation(requestedPref, activeUiLang);
      } else {
        responseText = '';
      }

      const view = buildLanguageSelectionView(activeUiLang, activePref, false);
      const finalMsg = responseText ? `${responseText}\n\n${view.text}` : view.text;

      if (businessConnectionIdEarly && settings.connectionEnabled && settings.rightsCanReply) {
        await sendBusinessTextMessage({
          businessConnectionId: businessConnectionIdEarly,
          chatId,
          text: finalMsg,
          replyToMessageId: msg.message_id,
          replyMarkup: view.markup,
        });
      }
      return;
    }
  }

  let transcript = '';
  const attachments: Array<{ mimeType: string; buffer: Buffer; label: string }> = [];

  if (mediaType === 'voice' && (msg.voice || msg.audio) && settings.autoTranscribeVoice) {
    const fileId = msg.voice?.file_id || msg.audio!.file_id;
    const mime = msg.voice?.mime_type || msg.audio?.mime_type || 'audio/ogg';
    const { buffer } = await downloadTelegramFile(fileId);
    if (isGeminiConfigured()) {
      transcript = await transcribeAudioBuffer(buffer, mime);
      inboundText = transcript || '[Ovozli xabar aniq eshitilmadi]';
    } else {
      inboundText = '[Ovozli xabar — GEMINI_API_KEY yo‘q]';
    }
  } else if (mediaType === 'photo' && msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    const { buffer } = await downloadTelegramFile(largest.file_id);
    attachments.push({ mimeType: 'image/jpeg', buffer, label: 'photo' });
  } else if (mediaType === 'video_note' && msg.video_note && settings.autoAnalyzeVideo) {
    const { buffer } = await downloadTelegramFile(msg.video_note.file_id);
    const analyzed = await analyzeVideoWithFfmpeg({
      videoBuffer: buffer,
      isVideoNote: true,
      caption: inboundText,
    });
    transcript = analyzed.transcript;
    inboundText = analyzed.summaryContext;
    for (const fr of analyzed.frames) attachments.push(fr);
  } else if (mediaType === 'video' && msg.video && settings.autoAnalyzeVideo) {
    const { buffer } = await downloadTelegramFile(msg.video.file_id);
    const analyzed = await analyzeVideoWithFfmpeg({
      videoBuffer: buffer,
      isVideoNote: false,
      caption: inboundText,
    });
    transcript = analyzed.transcript;
    inboundText = analyzed.summaryContext;
    for (const fr of analyzed.frames) attachments.push(fr);
  } else if (mediaType === 'document' && msg.document) {
    const supported = ['application/pdf', 'text/plain', 'image/png', 'image/jpeg'];
    if (msg.document.mime_type && supported.includes(msg.document.mime_type)) {
      const { buffer } = await downloadTelegramFile(msg.document.file_id);
      attachments.push({
        mimeType: msg.document.mime_type,
        buffer,
        label: `document (${msg.document.file_name || 'file'})`,
      });
    } else {
      inboundText = `${inboundText} [Fayl: ${msg.document.file_name || 'hujjat'}]`.trim();
    }
  }

  await addConversationMessage({
    channel: 'business_chat',
    chatId,
    telegramMessageId: msg.message_id,
    role: 'user',
    mediaType,
    text: inboundText || `[${mediaType}]`,
    transcript,
    status: 'received',
  });

  if (settings.autoReplyMode === 'off') {
    await writeAuditLog({
      channel: 'business_chat',
      eventType: 'message_logged_only',
      severity: 'info',
      chatId,
      summary: `${contactName} xabari saqlandi (autoReplyMode=off)`,
    });
    return;
  }

  if (!isGeminiConfigured()) {
    throw new Error('GEMINI_API_KEY sozlanmagan; Business javob yaratilmadi.');
  }

  const userPref = await getUserLanguagePreference(String(msg.from?.id || chatId)).catch(() => null);
  const history = await getConversationHistory('business_chat', chatId, 16);
  const draft = await generateAssistantReply({
    mode: 'business_chat',
    chatId,
    personaPrompt: settings.personaPrompt,
    memorySummary: settings.memorySummary,
    defaultLanguage: userPref?.preferredLanguage ?? settings.defaultReplyLanguage,
    uiLanguage: userPref?.uiLanguage ?? settings.uiLanguage,
    responseStyle: settings.responseStyle,
    verbosityMode: settings.verbosityMode,
    emojiLevel: settings.emojiLevel,
    customStyleExamples: settings.customStyleExamples,
    disclosureEnabled: settings.disclosureEnabled,
    disclosureText: settings.disclosureText,
    confidenceThreshold: settings.confidenceThreshold,
    escalationKeywords: settings.escalationKeywords,
    contactName,
    contactStyleOverride: existingRule?.styleOverride,
    contactNotes: existingRule?.notes,
    conversationHistory: history,
    inboundText: inboundText || `[${mediaType}]`,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  const lowConfidence = draft.confidenceScore < settings.confidenceThreshold;
  const businessConnectionId = msg.business_connection_id || settings.businessConnectionId;

  // AUTONOMOUS BY DEFAULT: only escalate when manual mode is explicitly chosen OR genuine risk/low-confidence triggers
  const requiresApproval =
    !settings.autonomousEnabled ||
    settings.autoReplyMode === 'manual_approval' ||
    existingRule?.permission === 'manual_approve' ||
    draft.safetyBlocked ||
    draft.shouldEscalate ||
    lowConfidence;

  const reasonLabel = draft.safetyBlocked
    ? draft.escalationReason || 'Xavfsizlik / moliyaviy cheklov'
    : lowConfidence
      ? `Past ishonchlilik (${draft.confidenceScore}% < ${settings.confidenceThreshold}%)`
      : draft.shouldEscalate
        ? draft.escalationReason || 'Egasi tasdig‘i talab qilinadi'
        : 'Qo‘lda tasdiqlash rejimi faol';

  if (requiresApproval) {
    const approvalId = await createPendingApproval({
      chatId,
      contactName,
      businessConnectionId,
      replyToMessageId: msg.message_id,
      incomingText: inboundText || `[${mediaType}]`,
      incomingMediaType: mediaType,
      draftReply: draft.replyText,
      escalationReason: reasonLabel,
      confidenceScore: draft.confidenceScore,
    });

    await notifyOwnerOfPendingApproval({
      approvalId,
      contactName,
      chatId,
      incomingText: inboundText || `[${mediaType}]`,
      draftReply: draft.replyText,
      reason: reasonLabel,
      confidenceScore: draft.confidenceScore,
    });

    await writeAuditLog({
      channel: 'business_chat',
      eventType: draft.safetyBlocked ? 'human_escalation' : 'approval_queued',
      severity: draft.safetyBlocked ? 'warn' : 'info',
      chatId,
      summary: `Tasdiqlash so‘rovi #${approvalId} yuborildi (${contactName}: ${reasonLabel})`,
    });
    return;
  }

  // Sliding-window rate limit check
  const now = Date.now();
  while (outboundTimestamps.length > 0 && now - outboundTimestamps[0] >= 60_000) {
    outboundTimestamps.shift();
  }
  if (outboundTimestamps.length >= settings.rateLimitPerMinute) {
    throw new Error(`Daqiqalik limit (${settings.rateLimitPerMinute}/min) ga yetildi; qayta uriniladi.`);
  }

  if (!businessConnectionId || !settings.connectionEnabled || !settings.rightsCanReply) {
    throw new Error('Telegram Business ulanishi yoki javob berish ruxsati faol emas.');
  }

  outboundTimestamps.push(now);

  if (settings.rightsCanReadMessages) {
    await markBusinessMessageRead({
      businessConnectionId,
      chatId,
      messageId: msg.message_id,
    }).catch(() => {});
  }

  const delivered = await deliverAssistantResponse({
    channel: 'business_chat',
    chatId,
    replyText: draft.replyText,
    settings,
    businessConnectionId,
    replyToMessageId: msg.message_id,
  });

  await addConversationMessage({
    channel: 'business_chat',
    chatId,
    telegramMessageId: delivered.sentMessageId,
    role: 'assistant',
    mediaType: delivered.mediaType,
    text: draft.replyText,
    status: 'sent',
  });

  await writeAuditLog({
    channel: 'business_chat',
    eventType: 'autonomous_reply_sent',
    severity: 'info',
    chatId,
    summary: `Avtonom ${delivered.mediaType} javob yuborildi -> ${contactName} (QC=${draft.confidenceScore}%)`,
    details: delivered.fallbackNote || '',
  });
}

export async function drainMessageQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const jobs = await fetchQueuedJobs(10);
    for (const job of jobs) {
      const nextAttempts = job.attempts + 1;
      await updateQueueJobStatus(job.id, { status: 'processing', attempts: nextAttempts });

      try {
        const msg = JSON.parse(job.payloadJson) as IncomingTelegramMessage;
        await processQueuedBusinessJob(msg);
        await updateQueueJobStatus(job.id, { status: 'done' });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const terminal = nextAttempts >= 3;
        await updateQueueJobStatus(job.id, {
          status: terminal ? 'dead_letter' : 'queued',
          lastError: errMsg,
        });
        await writeAuditLog({
          channel: job.channel,
          eventType: terminal ? 'queue_dead_letter' : 'queue_retry',
          severity: 'error',
          chatId: job.chatId,
          summary: terminal
            ? `${job.messageId}-xabar 3 urinishdan so‘ng dead_letter ga o‘tdi`
            : `${job.messageId}-xabar qayta urinish #${nextAttempts}`,
          details: errMsg,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[QueueWorker] Error:', err instanceof Error ? err.message : err);
  } finally {
    isProcessingQueue = false;
  }
}

export function startQueueWorker(): void {
  if (workerLoopTimer) return;
  workerLoopTimer = setInterval(() => {
    void drainMessageQueue();
  }, 5000);
}

export function stopQueueWorker(): void {
  if (workerLoopTimer) {
    clearInterval(workerLoopTimer);
    workerLoopTimer = null;
  }
}
