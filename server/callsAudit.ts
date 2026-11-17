import type { BotSettings } from './types.ts';

export function buildCallsStatusReport(settings: BotSettings): string {
  const lines: Record<BotSettings['uiLanguage'], string[]> = {
    uz_lat: [
      '📞 OMNIA AI — Jonli Qo‘ng‘iroqlar (Voice/Video Calls) Arxitekturasi',
      '',
      `• Sozlama holati: ${settings.callsEnabled ? '🟢 Ruxsat yoqilgan (tayyorlik rejimi)' : '⚪️ O‘chirilgan (/calls_on bilan yoqiladi)'}`,
      '• Bot API holati: ❌ Texnik cheklangan (rasmiy Telegram Bot API qo‘ng‘iroqlarni qabul qila olmaydi)',
      '',
      '🔍 Texnik audit natijasi:',
      '1. Jonli shaxsiy Telegram qo‘ng‘iroqlariga javob berish uchun Bot API o‘rniga doimiy (stateful) MTProto foydalanuvchi sessiyasi (GramJS / TDLib), native `tgcalls` WebRTC kutubxonasi va doimiy ICE/UDP media server zarur.',
      '2. Serverless/webhook muhitida (Cloud Run HTTP webhook) uzoq muddatli WebRTC UDP ovoz oqimini ushlab turish mumkin emas.',
      '3. Agar keyinchalik alohida VM/Stateful konteynerda MTProto + `tgcalls` + Gemini Live (`gemini-3.8-live`, 16kHz in / 24kHz out PCM) ishga tushirilsa, ushbu ruxsat kaliti (`/calls_on` / `/calls_off`) tayyor boshqaruv sifatida ishlaydi.',
      '',
      '✅ Hozirgi ishlaydigan muqobil yechim:',
      '• Telegramda ovozli xabar (`voice`) yoki dumaloq video (`video_note`) yuboring — OMNIA AI real vaqtga yaqin tezlikda ovozli (`sendVoice`) yoki dumaloq video (`sendVideoNote`) javob qaytaradi.',
    ],
    uz_cyr: [
      '📞 OMNIA AI — Жонли Қўнғироқлар (Calls) Архитектураси',
      '',
      `• Созлама ҳолати: ${settings.callsEnabled ? '🟢 Рухсат ёқилган' : '⚪️ Ўчирилган (/calls_on)'}`,
      '• Bot API ҳолати: ❌ Расмий Bot API орқали жонли қўнғироқларга жавоб бериш имконсиз.',
      '• Талаб қилинадиган инфратузилма: Доимий MTProto сессия + native `tgcalls` WebRTC + Gemini Live (`gemini-3.8-live`).',
      '• Ҳозирги ишлайдиган муқобил: Овозли хабар (`voice`) ва думалоқ видео (`video_note`) диалоги.',
    ],
    uz_new: [
      '📞 OMNIA AI — Jonli Qönğiroqlar (Calls) Arxitekturasi',
      '',
      `• Sozlama holati: ${settings.callsEnabled ? '🟢 Ruxsat yoqilgan' : '⚪️ Öçirilgan (/calls_on)'}`,
      '• Bot API holati: ❌ Rasmiy Telegram Bot API qönğiroqlarni qabul qila olmaydi.',
      '• Zarur infratuzilma: Doimiy MTProto sessiya + native `tgcalls` WebRTC + Gemini Live (`gemini-3.8-live`).',
      '• Hozirgi işlaydigan muqobil: Ovozli xabar (`sendVoice`) va dumaloq video (`sendVideoNote`) muloqoti.',
    ],
    ru: [
      '📞 OMNIA AI — Архитектура живых звонков (Voice/Video Calls)',
      '',
      `• Статус настройки: ${settings.callsEnabled ? '🟢 Разрешено (режим готовности)' : '⚪️ Выключено (/calls_on)'}`,
      '• Telegram Bot API: ❌ Официальный Bot API не поддерживает приём или совершение звонков.',
      '• Что необходимо для живых звонков: Stateful MTProto-клиент (TDLib/GramJS) + native `tgcalls` (WebRTC) + Gemini Live (`gemini-3.8-live`, 16 кГц PCM вход / 24 кГц выход) на выделенном stateful-сервере.',
      '• Доступная альтернатива сейчас: Голосовые сообщения (`sendVoice`) и видеокружки (`sendVideoNote`).',
    ],
    en: [
      '📞 OMNIA AI — Live Calls Capability & Architecture',
      '',
      `• Owner policy toggle: ${settings.callsEnabled ? '🟢 Enabled (standby)' : '⚪️ Disabled (/calls_on)'}`,
      '• Official Bot API support: ❌ Not supported by Telegram Bot API webhooks.',
      '• Real architecture required: A separate stateful MTProto user-session daemon (TDLib/GramJS) + native `tgcalls` WebRTC transport + Gemini Live API (`gemini-3.8-live`, 16kHz input / 24kHz output PCM) with explicit user authorization.',
      '• Working alternative today: Near-real-time Voice Notes (`sendVoice`) and Round Video Notes (`sendVideoNote`).',
    ],
  };

  return (lines[settings.uiLanguage] || lines.uz_lat).join('\n');
}
