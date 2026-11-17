import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import {
  closeDatabase,
  getBotSettings,
  getDbInfo,
  getQueueMetrics,
  initDatabase,
  probeFirestoreConnection,
  writeAuditLog,
} from './server/db.ts';
import { isGeminiConfigured } from './server/geminiEngine.ts';
import { BOT_COMMANDS_LIST } from './server/i18nBot.ts';
import {
  handleTelegramWebhookUpdate,
  startQueueWorker,
  stopQueueWorker,
  type TelegramUpdatePayload,
} from './server/queueProcessor.ts';
import {
  getBotEnv,
  getLiveBotStatus,
  registerTelegramWebhook,
  setBotCommands,
  verifyWebhookSecretHeader,
} from './server/telegramClient.ts';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));

function resolvePublicAppUrl(): string | null {
  const configured = process.env.APP_URL?.trim();
  if (!configured || configured === 'MY_APP_URL') return null;
  if (!/^https:\/\//i.test(configured)) return null;
  return configured.replace(/\/+$/, '');
}

app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'OMNIA AI Telegram Bot',
    mode: 'telegram-bot-backend',
    interface: 'Telegram Bot & Telegram Business Connected Bots',
    database: 'Google Cloud Firestore',
    webhookPath: '/telegram/webhook',
    healthPath: '/health',
  });
});

interface TelegramStartupStatus {
  checkedAt: string | null;
  commandsRegistered: boolean;
  botUsername: string | null;
  canConnectToBusiness: boolean | null;
  webhookUrl: string | null;
  lastErrorMessage: string | null;
  startupError: string | null;
}

const telegramStartup: TelegramStartupStatus = {
  checkedAt: null,
  commandsRegistered: false,
  botUsername: null,
  canConnectToBusiness: null,
  webhookUrl: null,
  lastErrorMessage: null,
  startupError: null,
};

async function healthHandler(_req: Request, res: Response) {
  await probeFirestoreConnection();
  const dbInfo = getDbInfo();
  const botEnv = getBotEnv();
  let queue = { queued: 0, processing: 0, deadLetter: 0, done: 0 };
  let settingsSummary: Record<string, unknown> | null = null;

  if (dbInfo.ready) {
    try {
      const [q, s] = await Promise.all([getQueueMetrics(), getBotSettings()]);
      queue = q;
      settingsSummary = {
        uiLanguage: s.uiLanguage,
        autoReplyMode: s.autoReplyMode,
        autonomousEnabled: s.autonomousEnabled,
        paused: s.paused,
        botPaused: s.botPaused,
        businessPaused: s.businessPaused,
        emergencyStop: s.emergencyStop,
        voiceOutputMode: s.voiceOutputMode,
        videoReplyEnabled: s.videoReplyEnabled,
        callsEnabled: s.callsEnabled,
        businessConnected: Boolean(s.businessConnectionId) && s.connectionEnabled,
        lastWebhookAt: s.lastWebhookAt || null,
      };
    } catch {
      // Captured in dbInfo
    }
  }

  res.status(dbInfo.ready ? 200 : 503).json({
    ok: dbInfo.ready,
    service: 'omnia-ai-telegram-bot',
    uptimeSeconds: Math.round(process.uptime()),
    database: dbInfo,
    secretsConfigured: {
      TELEGRAM_BOT_TOKEN: Boolean(botEnv.token),
      TELEGRAM_WEBHOOK_SECRET: Boolean(botEnv.webhookSecret),
      GEMINI_API_KEY: isGeminiConfigured(),
      TELEGRAM_OWNER_USER_ID: botEnv.ownerUserId !== null,
      APP_URL: Boolean(resolvePublicAppUrl()),
    },
    telegramStartup,
    queue,
    botState: settingsSummary,
  });
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

async function webhookHandler(req: Request, res: Response): Promise<void> {
  const secretHeader = req.header('x-telegram-bot-api-secret-token');
  if (!verifyWebhookSecretHeader(secretHeader)) {
    await writeAuditLog({
      channel: 'system',
      eventType: 'webhook_auth_rejected',
      severity: 'warn',
      summary: 'Rejected Telegram webhook request due to missing or invalid secret token',
    }).catch(() => {});
    res.status(401).json({ ok: false, error: 'Invalid webhook secret token' });
    return;
  }

  res.status(200).json({ ok: true });

  const update = req.body as TelegramUpdatePayload;
  void handleTelegramWebhookUpdate(update).catch(async (err) => {
    await writeAuditLog({
      channel: 'system',
      eventType: 'webhook_processing_error',
      severity: 'error',
      summary: `Failed processing update ${update?.update_id ?? 'unknown'}`,
      details: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  });
}

app.post('/telegram/webhook', webhookHandler);
app.post('/api/telegram/webhook', webhookHandler);

async function bootstrapTelegramOnStart(): Promise<void> {
  const botEnv = getBotEnv();
  telegramStartup.checkedAt = new Date().toISOString();

  if (!botEnv.token) {
    console.log('[Omnia AI] TELEGRAM_BOT_TOKEN not set; skipping Telegram API command/webhook sync.');
    return;
  }

  try {
    await setBotCommands(BOT_COMMANDS_LIST);
    telegramStartup.commandsRegistered = true;
    console.log(`[Omnia AI] Registered ${BOT_COMMANDS_LIST.length} Telegram bot commands via setMyCommands.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    telegramStartup.startupError = msg;
    console.warn('[Omnia AI] setMyCommands skipped:', msg);
  }

  try {
    const live = await getLiveBotStatus();
    telegramStartup.botUsername = live.botInfo?.username ?? null;
    telegramStartup.canConnectToBusiness = live.botInfo?.canConnectToBusiness ?? null;
    telegramStartup.webhookUrl = live.webhookInfo?.url || null;
    telegramStartup.lastErrorMessage = live.webhookInfo?.lastErrorMessage || null;
    if (live.error) {
      telegramStartup.startupError = live.error;
    }

    const publicUrl = resolvePublicAppUrl();
    if (publicUrl && botEnv.webhookSecret) {
      const targetUrl = `${publicUrl}/telegram/webhook`;
      if (live.webhookInfo?.url !== targetUrl) {
        const res = await registerTelegramWebhook(publicUrl);
        telegramStartup.webhookUrl = res.webhookInfo.url || res.webhookUrl;
        telegramStartup.lastErrorMessage = res.webhookInfo.last_error_message || null;
        console.log(`[Omnia AI] Registered Telegram webhook -> ${res.webhookUrl} (@${res.me.username})`);
      } else {
        console.log(`[Omnia AI] Telegram webhook already active -> ${targetUrl}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    telegramStartup.startupError = msg;
    console.warn('[Omnia AI] Auto webhook registration skipped:', msg);
  }
}

async function startServer(): Promise<void> {
  await initDatabase();
  const dbInfo = getDbInfo();
  if (dbInfo.ready) {
    console.log(`[Omnia AI] Firestore connected (${dbInfo.projectId} / ${dbInfo.databaseId})`);
  } else {
    console.error(
      `[Omnia AI] Firestore probe failed (${dbInfo.projectId} / ${dbInfo.databaseId}) as ${
        dbInfo.serviceAccount || 'unknown ADC'
      }: ${dbInfo.error}`
    );
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Omnia AI] Telegram bot backend listening on http://0.0.0.0:${PORT}`);
    if (dbInfo.ready) {
      startQueueWorker();
    }
    void bootstrapTelegramOnStart();
  });

  const shutdown = async () => {
    stopQueueWorker();
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

process.on('unhandledRejection', (reason) => {
  console.error('[Omnia AI] Unhandled promise rejection:', reason);
});

void startServer();
