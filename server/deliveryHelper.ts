import {
  generateRoundVideoNote,
  synthesizeVoiceNote,
} from './geminiEngine.ts';
import {
  sendBotTextMessage,
  sendBotVideoNote,
  sendBotVoiceMessage,
  sendBusinessTextMessage,
  sendChatAction,
} from './telegramClient.ts';
import type { BotSettings, ChatChannel } from './types.ts';

export async function deliverAssistantResponse(params: {
  channel: ChatChannel;
  chatId: string;
  replyText: string;
  settings: BotSettings;
  businessConnectionId?: string;
  replyToMessageId?: number;
}): Promise<{ sentMessageId: number; mediaType: 'text' | 'voice' | 'video_note'; fallbackNote?: string }> {
  const { channel, chatId, replyText, settings, businessConnectionId, replyToMessageId } = params;
  const connId = channel === 'business_chat' ? businessConnectionId || settings.businessConnectionId : undefined;

  // 1. Outgoing round video_note if enabled
  if (settings.videoReplyEnabled) {
    await sendChatAction({
      chatId,
      businessConnectionId: connId,
      action: 'record_video_note',
    });

    try {
      const { mp4Buffer, durationSec } = await generateRoundVideoNote({
        text: replyText.slice(0, 600),
        ttsVoice: settings.ttsVoice,
        voiceStyle: settings.voiceStyle,
        speakingSpeed: settings.speakingSpeed,
      });

      const sentVideo = await sendBotVideoNote({
        chatId,
        mp4Buffer,
        durationSec,
        lengthPx: 384,
        replyToMessageId,
        businessConnectionId: connId,
      });

      // If text is longer than spoken summary or voiceOutputMode === 'both', also send full text cleanly
      if (replyText.length > 500 || settings.voiceOutputMode === 'both') {
        if (channel === 'business_chat' && connId) {
          await sendBusinessTextMessage({ businessConnectionId: connId, chatId, text: replyText }).catch(() => {});
        } else {
          await sendBotTextMessage({ chatId, text: replyText }).catch(() => {});
        }
      }

      return { sentMessageId: sentVideo.message_id, mediaType: 'video_note' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Clean fallback to voice or text
      if (channel === 'business_chat' && connId) {
        const sent = await sendBusinessTextMessage({
          businessConnectionId: connId,
          chatId,
          text: replyText,
          replyToMessageId,
        });
        return { sentMessageId: sent.message_id, mediaType: 'text', fallbackNote: `video_note fallback: ${reason}` };
      }
      const sent = await sendBotTextMessage({ chatId, text: replyText, replyToMessageId });
      return { sentMessageId: sent.message_id, mediaType: 'text', fallbackNote: `video_note fallback: ${reason}` };
    }
  }

  // 2. Voice or Text+Voice output modes
  const wantsVoice =
    settings.voiceOutputMode === 'voice' ||
    settings.voiceOutputMode === 'both' ||
    settings.voiceReplyEnabled;

  if (wantsVoice) {
    await sendChatAction({
      chatId,
      businessConnectionId: connId,
      action: 'record_voice',
    });

    try {
      const { oggBuffer } = await synthesizeVoiceNote(
        replyText,
        settings.ttsVoice,
        settings.voiceStyle,
        settings.speakingSpeed
      );

      if (settings.voiceOutputMode === 'both') {
        if (channel === 'business_chat' && connId) {
          await sendBusinessTextMessage({
            businessConnectionId: connId,
            chatId,
            text: replyText,
            replyToMessageId,
          });
        } else {
          await sendBotTextMessage({ chatId, text: replyText, replyToMessageId });
        }
      }

      const sentVoice = await sendBotVoiceMessage({
        chatId,
        businessConnectionId: connId,
        oggBuffer,
        caption: settings.voiceOutputMode === 'voice' ? replyText.slice(0, 1024) : undefined,
        replyToMessageId: settings.voiceOutputMode === 'voice' ? replyToMessageId : undefined,
      });
      return { sentMessageId: sentVoice.message_id, mediaType: 'voice' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (channel === 'business_chat' && connId) {
        const sent = await sendBusinessTextMessage({
          businessConnectionId: connId,
          chatId,
          text: replyText,
          replyToMessageId,
        });
        return { sentMessageId: sent.message_id, mediaType: 'text', fallbackNote: `voice fallback: ${reason}` };
      }
      const sent = await sendBotTextMessage({ chatId, text: replyText, replyToMessageId });
      return { sentMessageId: sent.message_id, mediaType: 'text', fallbackNote: `voice fallback: ${reason}` };
    }
  }

  // 3. Standard Text output
  await sendChatAction({
    chatId,
    businessConnectionId: connId,
    action: 'typing',
  });

  if (channel === 'business_chat' && connId) {
    const sent = await sendBusinessTextMessage({
      businessConnectionId: connId,
      chatId,
      text: replyText,
      replyToMessageId,
    });
    return { sentMessageId: sent.message_id, mediaType: 'text' };
  }

  const sent = await sendBotTextMessage({
    chatId,
    text: replyText,
    replyToMessageId,
  });
  return { sentMessageId: sent.message_id, mediaType: 'text' };
}
