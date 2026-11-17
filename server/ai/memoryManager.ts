import {
  clearMemoryRecords,
  createMemoryRecord,
  listAllMemories,
  listScopedMemories,
  searchMemoryRecords,
} from '../db.ts';
import type { ChatChannel, MemoryEntry, MemoryScope, MemoryType } from '../types.ts';
import { containsSensitiveSecret } from './securityFilter.ts';

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
}): Promise<{ entries: MemoryEntry[]; formattedContext: string }> {
  const limit = params.limit ?? 10;
  let scoped: MemoryEntry[] = [];
  try {
    scoped = await listScopedMemories({
      channel: params.channel,
      chatId: params.chatId,
      limit: 40,
    });
  } catch {
    scoped = [];
  }

  // Strict cross-chat isolation filter in memory too (belt-and-suspenders)
  const isolated = scoped.filter((m) => {
    if (m.scope === 'owner') return true;
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
  if (params.legacyMemorySummary?.trim()) {
    lines.push(`[Owner Global Notes]\n${params.legacyMemorySummary.trim()}`);
  }
  for (const m of ranked) {
    const scopeLabel = m.scope === 'owner' ? 'owner' : `chat:${m.chatId}`;
    lines.push(`[${m.type}/${scopeLabel}] ${m.content}`);
  }

  return {
    entries: ranked,
    formattedContext: lines.join('\n'),
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
