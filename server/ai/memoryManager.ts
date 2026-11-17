import {
  clearMemoryRecords,
  createMemoryRecord,
  listAllMemories,
  listScopedMemories,
  searchMemoryRecords,
} from '../db.ts';
import type { ChatChannel, MemoryEntry, MemoryScope, MemoryType } from '../types.ts';
import { containsSensitiveSecret, sanitizeMemoryTextForPrompt } from './securityFilter.ts';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яёўқғҳ0-9']+/iu)
    .filter((w) => w.length >= 3);
}

export async function retrieveRelevantMemories(params: {
  channel: ChatChannel;
  chatId: string;
  queryText: string;
  legacyMemorySummary?: string;
  limit?: number;
}): Promise<{ entries: MemoryEntry[]; formattedContext: string; loadError: boolean }> {
  const limit = params.limit ?? 10;
  let scoped: MemoryEntry[] = [];
  let loadError = false;

  try {
    scoped = await listScopedMemories({
      channel: params.channel,
      chatId: params.chatId,
      limit: 40,
    });
  } catch {
    scoped = [];
    loadError = true;
  }

  // Strict cross-chat and owner-privacy isolation filter:
  // Owner-scoped memories are available ONLY in bot_direct (owner private channel), NEVER in business_chat.
  const isolated = scoped.filter((m) => {
    if (!m || typeof m.content !== 'string' || !m.content.trim()) return false;
    if (m.expiresAtMs > 0 && m.expiresAtMs <= Date.now()) return false;
    if (m.scope === 'owner') {
      return params.channel === 'bot_direct';
    }
    return m.scope === 'chat' && m.channel === params.channel && m.chatId === params.chatId;
  });

  const queryTokens = new Set(tokenize(params.queryText));
  const ranked = isolated
    .map((entry) => {
      let score = entry.scope === 'chat' ? 3 : 2;
      if (entry.type === 'instruction' || entry.type === 'style' || entry.type === 'preference') {
        score += 2;
      }
      const haystackTokens = tokenize(`${entry.content} ${entry.tags}`);
      for (const tok of haystackTokens) {
        if (queryTokens.has(tok)) score += 3;
      }
      const ageHours = Math.max(0, (Date.now() - entry.createdAtMs) / (3600 * 1000));
      score += Math.max(0, 2 - ageHours / 168);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry);

  const lines: string[] = [];
  if (params.channel === 'bot_direct' && params.legacyMemorySummary?.trim()) {
    const safeLegacy = sanitizeMemoryTextForPrompt(params.legacyMemorySummary.trim());
    if (safeLegacy) {
      lines.push(`[Owner Global Notes]\n${safeLegacy}`);
    }
  }
  for (const m of ranked) {
    const safeContent = sanitizeMemoryTextForPrompt(m.content);
    if (!safeContent) continue;
    const scopeLabel = m.scope === 'owner' ? 'owner' : `chat:${m.chatId}`;
    lines.push(`[${m.type}/${scopeLabel}] ${safeContent}`);
  }

  return {
    entries: ranked,
    formattedContext: lines.join('\n'),
    loadError,
  };
}

export async function saveMemorySafely(params: {
  type: MemoryType;
  scope: MemoryScope;
  channel: ChatChannel | 'global';
  chatId?: string;
  content: string;
  provenance: string;
  tags?: string;
  ttlHours?: number;
}): Promise<MemoryEntry | null> {
  const clean = params.content.trim();
  if (!clean || clean.length < 3) return null;

  const secretCheck = containsSensitiveSecret(clean);
  if (secretCheck.hasSecret) {
    return null;
  }

  return createMemoryRecord({
    type: params.type,
    scope: params.scope,
    channel: params.channel,
    chatId: params.chatId,
    content: clean,
    provenance: params.provenance,
    tags: params.tags,
    ttlHours: params.ttlHours,
  });
}

export async function formatMemoriesForTelegram(limit = 20): Promise<string> {
  const items = await listAllMemories(limit);
  if (items.length === 0) return '';
  return items
    .map((m, i) => {
      const scopeTag = m.scope === 'owner' ? 'egasi' : `${m.channel}:${m.chatId}`;
      const exp = m.expiresAtMs > 0 ? ' (vaqtinchalik)' : '';
      return `${i + 1}. [${m.type} | ${scopeTag}]${exp} ${m.content}`;
    })
    .join('\n');
}

export { searchMemoryRecords, clearMemoryRecords };
