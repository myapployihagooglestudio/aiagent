import {
  addConversationMessage,
  getBotSettings,
  getChatRule,
  getPendingApprovalById,
  updatePendingApproval,
  writeAuditLog,
} from './db.ts';
import { deliverAssistantResponse } from './deliveryHelper.ts';

export async function approveAndSendPendingReply(
  approvalId: string,
  editedText?: string
): Promise<{ messageId: number; chatId: string; contactName: string }> {
  const approval = await getPendingApprovalById(approvalId);
  if (!approval) {
    throw new Error(`Tasdiqlash so‘rovi #${approvalId} topilmadi.`);
  }
  if (approval.status !== 'pending') {
    throw new Error(`So‘rov #${approvalId} allaqachon "${approval.status}" holatida.`);
  }

  const settings = await getBotSettings();
  if (settings.emergencyStop) {
    throw new Error('Emergency Stop faol — xabar yuborish to‘xtatilgan. Avval /resume yuboring.');
  }

  const businessConnectionId = approval.businessConnectionId || settings.businessConnectionId;
  if (!businessConnectionId || !settings.connectionEnabled || !settings.rightsCanReply) {
    throw new Error('Telegram Business ulanishi yoki javob berish ruxsati faol emas.');
  }

  const chatRule = await getChatRule('business_chat', approval.chatId);
  if (chatRule?.lastInboundAt) {
    const elapsedMs = Date.now() - new Date(chatRule.lastInboundAt).getTime();
    if (elapsedMs > 24 * 60 * 60 * 1000) {
      await updatePendingApproval(approvalId, { status: 'expired' });
      throw new Error('Ushbu chat uchun 24 soatlik Telegram Business javob oynasi tugagan.');
    }
  }

  const finalReply = (editedText !== undefined ? editedText : approval.draftReply).trim();
  if (!finalReply) {
    throw new Error('Javob matni bo‘sh bo‘lishi mumkin emas.');
  }

  const delivered = await deliverAssistantResponse({
    channel: 'business_chat',
    chatId: approval.chatId,
    replyText: finalReply,
    settings,
    businessConnectionId,
    replyToMessageId: approval.replyToMessageId || undefined,
  });

  await updatePendingApproval(approvalId, { status: 'approved' });

  await addConversationMessage({
    channel: 'business_chat',
    chatId: approval.chatId,
    telegramMessageId: delivered.sentMessageId,
    role: 'assistant',
    mediaType: delivered.mediaType,
    text: finalReply,
    status: 'sent',
  });

  await writeAuditLog({
    channel: 'business_chat',
    eventType: 'manual_approval_sent',
    severity: 'info',
    chatId: approval.chatId,
    summary: `Owner approved & sent ${delivered.mediaType} reply #${approvalId} to ${approval.contactName}`,
    details: delivered.fallbackNote || '',
  });

  return {
    messageId: delivered.sentMessageId,
    chatId: approval.chatId,
    contactName: approval.contactName,
  };
}
