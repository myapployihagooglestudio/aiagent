import type { BotSettings, LanguagePreference, UILanguage } from './types.ts';
import type { InlineKeyboardMarkup, TelegramLiveStatus } from './telegramClient.ts';

export const BOT_COMMANDS_LIST = [
  { command: 'start', description: 'OMNIA AI boshqaruv markazini ochish' },
  { command: 'help', description: 'Barcha buyruqlar va qo‘llanma' },
  { command: 'status', description: 'Tizim va akkauntlarning haqiqiy holati' },
  { command: 'settings', description: 'AI, uslub va xavfsizlik sozlamalari' },
  { command: 'auto', description: 'Avtonom javob rejimini yoqish' },
  { command: 'pause', description: 'Avtomatik javoblarni pauza qilish' },
  { command: 'resume', description: 'Pauzadan chiqarish va davom ettirish' },
  { command: 'stop', description: 'Favqulodda to‘xtatish (Emergency Stop)' },
  { command: 'accounts', description: 'A va B Telegram akkauntlar holati' },
  { command: 'account_status', description: 'Ikkala akkaunt ulanish tekshiruvi' },
  { command: 'personal_status', description: 'Shaxsiy akkaunt (Business) holati' },
  { command: 'bot_status', description: 'OMNIA AI bot (B komponent) holati' },
  { command: 'connect', description: 'Shaxsiy Telegram akkauntni ulash' },
  { command: 'disconnect', description: 'Shaxsiy Business ulanishni uzish' },
  { command: 'language', description: 'Interfeys va javob tilini tanlash' },
  { command: 'til', description: 'Tilni tez almashtirish (5 ta alifbo/til)' },
  { command: 'uz', description: 'O‘zbek lotin tilini yoqish' },
  { command: 'uzcyr', description: 'Ўзбек кирилл ёзувини yoqish' },
  { command: 'uznew', description: 'Yangi o‘zbek lotin (ş, ç, ö, ğ) yoqish' },
  { command: 'ru', description: 'Рус тилини (Русский) yoqish' },
  { command: 'en', description: 'Ingliz tilini (English) yoqish' },
  { command: 'style', description: 'Muloqot uslubi va ohangini sozlash' },
  { command: 'memory', description: 'Xotirani boshqarish va qo‘shish' },
  { command: 'memory_show', description: 'Saqlangan xotira yozuvlarini ko‘rish' },
  { command: 'memory_clear', description: 'Xotirani tozalash' },
  { command: 'memory_search', description: 'Xotiradan kalit so‘z bilan qidirish' },
  { command: 'activity', description: 'Oxirgi faoliyat va tasdiqlar' },
  { command: 'voice', description: 'Ovozli javoblar va TTS sozlamalari' },
  { command: 'voice_on', description: 'Ovozli javoblarni yoqish' },
  { command: 'voice_off', description: 'Ovozli javoblarni o‘chirish' },
  { command: 'voice_style', description: 'Ovoz ohangi va tezligini sozlash' },
  { command: 'video', description: 'Video tahlili va dumaloq video javob' },
  { command: 'video_on', description: 'Dumaloq video javobni (video_note) yoqish' },
  { command: 'video_off', description: 'Dumaloq video javobni o‘chirish' },
  { command: 'calls', description: 'Jonli qo‘ng‘iroqlar arxitekturasi va holati' },
  { command: 'calls_on', description: 'Qo‘ng‘iroqlar tayyorlik ruxsatini yoqish' },
  { command: 'calls_off', description: 'Qo‘ng‘iroqlar tayyorlik ruxsatini o‘chirish' },
  { command: 'permissions', description: 'Chat ruxsatlari va cheklash qoidalari' },
  { command: 'privacy', description: 'Maxfiylik va AI ma’lumot siyosati' },
  { command: 'logs', description: 'Tizim xatolari va audit jurnali' },
];

export interface LocalizedStrings {
  unauthorized: string;
  welcomeTitle: string;
  welcomeBody: string;
  helpText: string;
  connectText: string;
  pausedToast: string;
  resumedToast: string;
  stoppedToast: string;
  autonomousEnabledText: string;
  autonomousNeedsConsentText: string;
  consentConfirmedToast: string;
  memoryHeader: string;
  memoryCleared: string;
  memorySaved: string;
  memoryUsage: string;
  voiceHeader: string;
  videoHeader: string;
  styleHeader: string;
  permissionsHeader: string;
  privacyText: string;
  settingsHeader: string;
  languageHeader: string;
  activityHeader: string;
  logsHeader: string;
  noActivity: string;
  emergencyBlockedReply: string;
  geminiMissingReply: string;
  disconnectedText: string;
  btnStatus: string;
  btnAccounts: string;
  btnConnect: string;
  btnSettings: string;
  btnLanguage: string;
  btnStyle: string;
  btnVoice: string;
  btnVideo: string;
  btnCalls: string;
  btnMemory: string;
  btnPermissions: string;
  btnActivity: string;
  btnPause: string;
  btnResume: string;
  btnStop: string;
  btnAutonomous: string;
  btnCheckBusiness: string;
  btnConfirmConsent: string;
  btnRevokeConsent: string;
  btnToggleDisclosure: string;
  btnToggleVoice: string;
  btnToggleVideoReply: string;
  btnToggleTranscribe: string;
  btnToggleVideo: string;
  btnClearMemory: string;
  btnApproveSend: string;
  btnReject: string;
  btnExcludeChat: string;
  btnBack: string;
}

const STRINGS: Record<UILanguage, LocalizedStrings> = {
  uz_lat: {
    unauthorized:
      'Ushbu shaxsiy OMNIA AI boti faqat tasdiqlangan egasi uchun ishlaydi. Ruxsat berilmagan.',
    welcomeTitle: 'OMNIA AI — Avtonom Shaxsiy Telegram Yordamchisi',
    welcomeBody:
      'Men Telegram ichida bevosita ishlaydigan, ko‘p bosqichli Google Gemini intellektiga ega shaxsiy AI agentingizman.\n\n• B komponent (Ushbu bot): Menga matn, ovoz, video, dumaloq video yoki rasm yuboring — aqlli tahlil, Google Qidiruv va ovozli/dumaloq video javob bilan yordam beraman.\n• A komponent (Shaxsiy akkauntingiz): Telegram Business Chatbots orqali ruxsat berilgan suhbatlarga odatda avtomatik (avtonom) javob beraman; faqat moliyaviy, parol/OTP yoki xavfli vaziyatlarda sizdan tasdiq so‘rayman.',
    helpText:
      '📘 OMNIA AI To‘liq Boshqaruv Buyruqlari\n\nAsosiy:\n/start — Boshqaruv markazi\n/status — Haqiqiy server, Gemini, bazalar va ulanish holati\n/settings — AI, xavfsizlik va oshkoralik sozlamalari\n\nAvtonom boshqaruv:\n/auto — Avtonom javob rejimini yoqish\n/pause [bot|personal|all] — Pauza qilish\n/resume [bot|personal|all] — Qayta yoqish\n/stop — Favqulodda to‘xtatish (Emergency Stop)\n\nAkkauntlar (A va B):\n/accounts, /account_status, /personal_status, /bot_status\n/connect — Shaxsiy Business akkauntni ulash\n/disconnect — Shaxsiy Business ulanishni uzish\n\nIntellekt, Til, Uslub, Xotira:\n/language (/lang) — Interfeys va javob tili\n/style — Ohang, uzunlik va emoji darajasi\n/memory [add|set] — Xotiraga yozish\n/memory_show — Xotirani ko‘rish\n/memory_search <so‘z> — Xotiradan qidirish\n/memory_clear — Xotirani tozalash\n\nOvoz, Video, Qo‘ng‘iroqlar:\n/voice, /voice_on, /voice_off, /voice_style\n/video, /video_on, /video_off\n/calls, /calls_on, /calls_off\n\nXavfsizlik va audit:\n/permissions — Chat ruxsatlari (/exclude, /approve, /allow <chat_id>)\n/privacy — Maxfiylik siyosati\n/activity — Oxirgi harakatlar\n/logs — Tizim jurnali',
    connectText:
      '🔗 Shaxsiy Telegram akkauntni ulash (A komponent)\n\nRasmiy Telegram Business Connected Bots tartibi:\n1. @BotFather → /mybots → ushbu bot → Bot Settings → Business Mode → Turn On.\n2. Shaxsiy Telegramda: Settings (Sozlamalar) → Telegram Business → Chatbots.\n3. Ushbu botni tanlang va «Read messages» hamda «Reply to messages» ruxsatlarini bering.\n4. Ulanish tasdiqlangach Telegram real `business_connection` hodisasini yuboradi va avtonom rejim darhol ishga tushadi.\n\n⚠️ Xavfsizlik kafolati:\n• Men hech qachon SMS/Telegram tasdiqlash kodingiz, 2FA parolingiz yoki Secret Chatlaringizni so‘ramayman.',
    pausedToast: '⏸ Avtomatik javoblar pauza qilindi.',
    resumedToast: '▶️ OMNIA AI qayta faollashtirildi.',
    stoppedToast: '🛑 FAVQULODDA TO‘XTATISH (Emergency Stop) yoqildi. Barcha AI chiqish javoblari darhol to‘xtatildi.',
    autonomousEnabledText:
      '✅ Avtonom rejim faol. Oddiy suhbatlarga AI egangizni bezovta qilmasdan avtomatik javob beradi; faqat moliyaviy, parol/OTP, shartnoma yoki xavfli so‘rovlar tasdiqlashga chiqariladi.',
    autonomousNeedsConsentText:
      '⚠️ Avtonom rejim uchun avval /settings orqali AI ma’lumotlarni qayta ishlash roziligini tasdiqlang.',
    consentConfirmedToast: '✅ AI ma’lumot qayta ishlash roziligi tasdiqlandi.',
    memoryHeader: '🧠 Tuzilgan Uzoq Muddatli Xotira',
    memoryCleared: '🗑 Tanlangan xotira yozuvlari tozalandi.',
    memorySaved: '💾 Ma’lumot xavfsiz tekshiruvdan o‘tdi va uzoq muddatli xotiraga saqlandi.',
    memoryUsage:
      'Buyruqlar:\n• /memory <matn> — egasi fakti sifatida qo‘shish\n• /memory_show — barcha xotirani ko‘rish\n• /memory_search <kalit> — qidirish\n• /memory_clear — tozalash',
    voiceHeader: '🎙 Ovozli Javoblar (TTS) va Transkripsiya',
    videoHeader: '🎬 Video Tahlili va Dumaloq Video (Video Note) Sozlamalari',
    styleHeader: '✍️ Shaxsiy Muloqot Uslubi Sozlamalari',
    permissionsHeader: '🔐 Chat Ruxsatlari va Xavfsizlik Qoidalari',
    privacyText:
      '🛡 OMNIA AI Maxfiylik va Xavfsizlik Siyosati\n\n• Parollar, SMS/Telegram kirish kodlari (OTP), PIN, CVV va karta raqamlari xotiraga va audit jurnaliga saqlanmaydi.\n• Har bir chat xotirasi qat’iy `(kanal, chat_id)` bo‘yicha ajratilgan — bir chatning shaxsiy konteksti boshqa chatga o‘tmaydi.\n• Prompt-injection (yashirin ko‘rsatmalarni buzish urinishlari) va shubhali havolalar avtomatik bloklanadi yoki egasiga eskalatsiya qilinadi.\n• Tashqi Business chatlarda oshkoralik (AI Disclosure) yoqilgan bo‘lsa, bot o‘zini hech qachon inson sifatida yolg‘on ko‘rsatmaydi.',
    settingsHeader: '⚙️ OMNIA AI Asosiy Sozlamalar',
    languageHeader: '🌐 Interfeys va Muloqot Tilini Tanlang',
    activityHeader: '📋 Oxirgi Faoliyat va Tasdiqlashlar',
    logsHeader: '📜 Tizim Audit va Xatolik Jurnali',
    noActivity: 'Hozircha qayd etilgan faoliyat yo‘q.',
    emergencyBlockedReply: '🛑 Favqulodda to‘xtatish (Emergency Stop) faol. Qayta yoqish uchun /resume yuboring.',
    geminiMissingReply: '⚠️ Serverda GEMINI_API_KEY sozlanmagan.',
    disconnectedText: '🔌 Shaxsiy Telegram Business ulanishi server sozlamalaridan o‘chirildi. To‘liq uzish uchun Telegramda Settings → Telegram Business → Chatbots dan ham botni olib tashlang.',
    btnStatus: '📊 Holat',
    btnAccounts: '👥 Akkauntlar',
    btnConnect: '🔗 Ulash',
    btnSettings: '⚙️ Sozlamalar',
    btnLanguage: '🌐 Til',
    btnStyle: '✍️ Uslub',
    btnVoice: '🎙 Ovoz',
    btnVideo: '🎬 Video',
    btnCalls: '📞 Qo‘ng‘iroqlar',
    btnMemory: '🧠 Xotira',
    btnPermissions: '🔐 Ruxsatlar',
    btnActivity: '📋 Faoliyat',
    btnPause: '⏸ Pauza',
    btnResume: '▶️ Davom etish',
    btnStop: '🛑 Emergency Stop',
    btnAutonomous: '🤖 Avtonom rejim',
    btnCheckBusiness: '🔄 Business ulanishni tekshirish',
    btnConfirmConsent: '✅ AI roziligini tasdiqlash',
    btnRevokeConsent: '🚫 AI roziligini o‘chirish',
    btnToggleDisclosure: '🏷 AI belgisini almashtirish',
    btnToggleVoice: '🔊 Ovozli javob',
    btnToggleVideoReply: '⭕️ Dumaloq video javob',
    btnToggleTranscribe: '🎧 Ovozni matnga o‘girish',
    btnToggleVideo: '🎬 Video tahlili',
    btnClearMemory: '🗑 Xotirani tozalash',
    btnApproveSend: '✅ Tasdiqlash va yuborish',
    btnReject: '❌ Rad etish',
    btnExcludeChat: '🚫 Chatni cheklash',
    btnBack: '⬅️ Bosh menyu',
  },
  uz_cyr: {
    unauthorized: 'Ушбу шахсий OMNIA AI боти фақат тасдиқланган эгаси учун ишлайди.',
    welcomeTitle: 'OMNIA AI — Автоном Шахсий Telegram Ёрдамчиси',
    welcomeBody:
      'Мен Telegram ичида тўғридан-тўғри ишлайдиган Google Gemini асосидаги шахсий AI агентингизман.\n\n• Б компонент (Ушбу бот): Матн, овоз, видео, думалоқ видео ёки расм юборинг.\n• А компонент (Шахсий аккаунтингиз): Рухсат берилган Business чатларда оддий суҳбатларга автоном жавоб беради.',
    helpText:
      '📘 Буйруқлар:\n/start, /status, /settings, /auto, /pause, /resume, /stop\n/accounts, /account_status, /personal_status, /bot_status, /connect, /disconnect\n/language (/lang), /style, /memory, /memory_show, /memory_search, /memory_clear\n/voice, /voice_on, /voice_off, /voice_style, /video, /video_on, /video_off, /calls, /calls_on, /calls_off\n/permissions, /privacy, /activity, /logs',
    connectText:
      '🔗 Шахсий аккаунтни улаш:\n1. @BotFather да Business Mode ни ёқинг.\n2. Settings → Telegram Business → Chatbots орқали ботни танланг ва Read/Reply рухсатларини беринг.',
    pausedToast: '⏸ Автоматик жавоблар пауза қилинди.',
    resumedToast: '▶️ Ёрдамчи қайта фаоллаштирилди.',
    stoppedToast: '🛑 ФАВҚУЛОДДА ТЎХТАТИШ ёқилди.',
    autonomousEnabledText: '✅ Автоном режим фаол.',
    autonomousNeedsConsentText: '⚠️ Аввал /settings орқали AI розилигини тасдиқланг.',
    consentConfirmedToast: '✅ AI розилиги тасдиқланди.',
    memoryHeader: '🧠 Узоқ Муддатли Хотира',
    memoryCleared: '🗑 Хотира тозаланди.',
    memorySaved: '💾 Хотирага сақланди.',
    memoryUsage: 'Буйруқлар: /memory <матн>, /memory_show, /memory_search <сўз>, /memory_clear',
    voiceHeader: '🎙 Овозли Жавоблар Созламалари',
    videoHeader: '🎬 Видео Таҳлили ва Думалоқ Видео',
    styleHeader: '✍️ Шахсий Мулоқот Услуби',
    permissionsHeader: '🔐 Чат Рухсатлари',
    privacyText: '🛡 Махфийлик сиёсати: Парол, OTP код ва карта маълумотлари хотирага сақланмайди. Ҳар бир чат контексти алоҳида изоляция қилинган.',
    settingsHeader: '⚙️ OMNIA AI Созламалари',
    languageHeader: '🌐 Тилни танланг',
    activityHeader: '📋 Охирги Фаолият',
    logsHeader: '📜 Тизим Журнали',
    noActivity: 'Ёзувлар йўқ.',
    emergencyBlockedReply: '🛑 Emergency Stop фаол. /resume юборинг.',
    geminiMissingReply: '⚠️ GEMINI_API_KEY созланмаган.',
    disconnectedText: '🔌 Шахсий Business уланиш ўчирилди.',
    btnStatus: '📊 Ҳолат',
    btnAccounts: '👥 Аккаунтлар',
    btnConnect: '🔗 Улаш',
    btnSettings: '⚙️ Созламалар',
    btnLanguage: '🌐 Тил',
    btnStyle: '✍️ Услуб',
    btnVoice: '🎙 Овоз',
    btnVideo: '🎬 Видео',
    btnCalls: '📞 Қўнғироқлар',
    btnMemory: '🧠 Хотира',
    btnPermissions: '🔐 Рухсатлар',
    btnActivity: '📋 Фаолият',
    btnPause: '⏸ Пауза',
    btnResume: '▶️ Давом этиш',
    btnStop: '🛑 Emergency Stop',
    btnAutonomous: '🤖 Автоном',
    btnCheckBusiness: '🔄 Текшириш',
    btnConfirmConsent: '✅ AI розилиги',
    btnRevokeConsent: '🚫 Розиликни ўчириш',
    btnToggleDisclosure: '🏷 AI белгиси',
    btnToggleVoice: '🔊 Овозли жавоб',
    btnToggleVideoReply: '⭕️ Думалоқ видео',
    btnToggleTranscribe: '🎧 Транскрипция',
    btnToggleVideo: '🎬 Видео таҳлили',
    btnClearMemory: '🗑 Тозалаш',
    btnApproveSend: '✅ Юбориш',
    btnReject: '❌ Рад этиш',
    btnExcludeChat: '🚫 Чеклаш',
    btnBack: '⬅️ Бош меню',
  },
  uz_new: {
    unauthorized:
      'Uşbu şaxsiy OMNIA AI boti faqat tasdiqlangan egasi uçun işlaydi. Ruxsat berilmagan.',
    welcomeTitle: 'OMNIA AI — Avtonom Şaxsiy Telegram Yordamçisi',
    welcomeBody:
      'Men Telegram içida bevosita işlaydigan, köp bosqiçli Google Gemini intellektiga ega şaxsiy AI agentingizman.\n\n• B komponent (Uşbu bot): Menga matn, ovoz, video, dumaloq video yoki rasm yuboring — aqlli tahlil, Google Qidiruv va ovozli/dumaloq video javob bilan yordam beraman.\n• A komponent (Şaxsiy akkauntingiz): Telegram Business Chatbots orqali ruxsat berilgan suhbatlarga odatda avtomatik (avtonom) javob beraman; faqat moliyaviy, parol/OTP yoki xavfli vaziyatlarda sizdan tasdiq sörayman.',
    helpText:
      '📘 OMNIA AI Töliq Boşqaruv Buyruqlari\n\nAsosiy:\n/start — Boşqaruv markazi\n/status — Haqiqiy server, Gemini, bazalar va ulaniş holati\n/settings — AI, uslub va xavfsizlik sozlamalari\n\nTillar va alifbolar (5 xil):\n/language, /til — Til tanlaş menyusi\n/uz — Özbek lotin | /uzcyr — Ўзбек кирилл\n/uznew — Yangi özbek lotin (ş, ç, ö, ğ)\n/ru — Русский | /en — English\n\nAvtonom boşqaruv:\n/auto, /pause, /resume, /stop\nAkkauntlar: /accounts, /connect, /disconnect\nXotira va media: /memory, /memory_show, /style, /voice, /video, /calls\nXavfsizlik: /permissions, /privacy, /activity, /logs',
    connectText:
      '🔗 Şaxsiy Telegram akkauntni ulaş (A komponent)\n\n1. @BotFather → /mybots → bot → Bot Settings → Business Mode → Turn On.\n2. Şaxsiy Telegramda: Settings → Telegram Business → Chatbots.\n3. Uşbu botni tanlang va «Read messages» hamda «Reply to messages» ruxsatlarini bering.\n\n⚠️ Xavfsizlik: Men heç qaçon SMS/Telegram tasdiq kodingiz yoki parolingizni söramayman.',
    pausedToast: '⏸ Avtomatik javoblar pauza qilindi.',
    resumedToast: '▶️ OMNIA AI qayta faollaşdirildi.',
    stoppedToast: '🛑 FAVQULODDA TÖXTATIŞ (Emergency Stop) yoqildi.',
    autonomousEnabledText:
      '✅ Avtonom rejim faol. Oddiy suhbatlarga AI avtomatik javob beradi; faqat moliyaviy, parol/OTP yoki xavfli sörovlar tasdiqqa çiqariladi.',
    autonomousNeedsConsentText:
      '⚠️ Avtonom rejim uçun avval /settings orqali AI roziligini tasdiqlang.',
    consentConfirmedToast: '✅ AI ma’lumot qayta işlaş roziligi tasdiqlandi.',
    memoryHeader: '🧠 Tuzilgan Uzoq Muddatli Xotira',
    memoryCleared: '🗑 Tanlangan xotira yozuvlari tozalandi.',
    memorySaved: '💾 Ma’lumot xavfsiz tekşiruvdan ötdi va xotiraga saqlandi.',
    memoryUsage:
      'Buyruqlar:\n• /memory <matn> — fakt qöşiş\n• /memory_show — köriş\n• /memory_search <kalit> — qidiriş\n• /memory_clear — tozalaş',
    voiceHeader: '🎙 Ovozli Javoblar (TTS) va Transkripsiya',
    videoHeader: '🎬 Video Tahlili va Dumaloq Video (Video Note)',
    styleHeader: '✍️ Şaxsiy Muloqot Uslubi',
    permissionsHeader: '🔐 Çat Ruxsatlari va Xavfsizlik Qoidalari',
    privacyText:
      '🛡 Maxfiylik Siyosati: Parollar, OTP kodlar va karta raqamlari heç qaçon xotiraga saqlanmaydi. Har bir çat xotirasi alohida izolyatsiya qilingan.',
    settingsHeader: '⚙️ OMNIA AI Asosiy Sozlamalar',
    languageHeader: '🌐 Interfeys va Muloqot Tilini Tanlang',
    activityHeader: '📋 Oxirgi Faoliyat va Tasdiqlaşlar',
    logsHeader: '📜 Tizim Audit va Xatolik Jurnali',
    noActivity: 'Hozirça qayd etilgan faoliyat yöq.',
    emergencyBlockedReply: '🛑 Emergency Stop faol. Qayta yoqiş uçun /resume yuboring.',
    geminiMissingReply: '⚠️ Serverda GEMINI_API_KEY sozlanmagan.',
    disconnectedText: '🔌 Şaxsiy Telegram Business ulanişi server sozlamalaridan öçirildi.',
    btnStatus: '📊 Holat',
    btnAccounts: '👥 Akkauntlar',
    btnConnect: '🔗 Ulaş',
    btnSettings: '⚙️ Sozlamalar',
    btnLanguage: '🌐 Til',
    btnStyle: '✍️ Uslub',
    btnVoice: '🎙 Ovoz',
    btnVideo: '🎬 Video',
    btnCalls: '📞 Qönğiroqlar',
    btnMemory: '🧠 Xotira',
    btnPermissions: '🔐 Ruxsatlar',
    btnActivity: '📋 Faoliyat',
    btnPause: '⏸ Pauza',
    btnResume: '▶️ Davom etiş',
    btnStop: '🛑 Emergency Stop',
    btnAutonomous: '🤖 Avtonom rejim',
    btnCheckBusiness: '🔄 Business ulanişni tekşiriş',
    btnConfirmConsent: '✅ AI roziligini tasdiqlaş',
    btnRevokeConsent: '🚫 AI roziligini öçiriş',
    btnToggleDisclosure: '🏷 AI belgisini almaştiriş',
    btnToggleVoice: '🔊 Ovozli javob',
    btnToggleVideoReply: '⭕️ Dumaloq video javob',
    btnToggleTranscribe: '🎧 Ovozni matnga ögiriş',
    btnToggleVideo: '🎬 Video tahlili',
    btnClearMemory: '🗑 Xotirani tozalaş',
    btnApproveSend: '✅ Tasdiqlaş va yuboriş',
    btnReject: '❌ Rad etiş',
    btnExcludeChat: '🚫 Çatni çeklaş',
    btnBack: '⬅️ Boş menyu',
  },
  ru: {
    unauthorized: 'Этот персональный бот OMNIA AI доступен только авторизованному владельцу.',
    welcomeTitle: 'OMNIA AI — Автономный Персональный Telegram Ассистент',
    welcomeBody:
      'Я ваш персональный AI-ассистент на базе Google Gemini прямо внутри Telegram.\n\n• Компонент B (Этот бот): Отправляйте текст, голос, видео, кружки или фото.\n• Компонент A (Личный аккаунт): Автономно отвечает в разрешённых чатах Telegram Business и эскалирует только чувствительные/финансовые запросы.',
    helpText:
      '📘 Команды OMNIA AI:\n/start, /status, /settings, /auto, /pause, /resume, /stop\n/accounts, /account_status, /personal_status, /bot_status, /connect, /disconnect\n/language (/lang), /style, /memory, /memory_show, /memory_search, /memory_clear\n/voice, /voice_on, /voice_off, /voice_style, /video, /video_on, /video_off, /calls, /calls_on, /calls_off\n/permissions, /privacy, /activity, /logs',
    connectText:
      '🔗 Подключение личного аккаунта:\n1. Включите Business Mode в @BotFather.\n2. Настройки → Telegram Business → Чат-боты → выберите бота и выдайте права Read & Reply.',
    pausedToast: '⏸ Автоматические ответы приостановлены.',
    resumedToast: '▶️ Ассистент снова активен.',
    stoppedToast: '🛑 ЭКСТРЕННАЯ ОСТАНОВКА активирована.',
    autonomousEnabledText: '✅ Автономный режим включён.',
    autonomousNeedsConsentText: '⚠️ Подтвердите согласие AI в /settings.',
    consentConfirmedToast: '✅ Согласие подтверждено.',
    memoryHeader: '🧠 Долговременная Память',
    memoryCleared: '🗑 Память очищена.',
    memorySaved: '💾 Сохранено в долговременную память.',
    memoryUsage: 'Команды: /memory <текст>, /memory_show, /memory_search <слово>, /memory_clear',
    voiceHeader: '🎙 Настройки голоса и TTS',
    videoHeader: '🎬 Анализ видео и видеокружки (Video Note)',
    styleHeader: '✍️ Стиль общения',
    permissionsHeader: '🔐 Права чатов',
    privacyText: '🛡 Политика конфиденциальности: Пароли, OTP-коды и номера карт никогда не сохраняются в память. Контекст каждого чата строго изолирован.',
    settingsHeader: '⚙️ Настройки OMNIA AI',
    languageHeader: '🌐 Выберите язык',
    activityHeader: '📋 Последняя активность',
    logsHeader: '📜 Журнал аудита и ошибок',
    noActivity: 'Записей пока нет.',
    emergencyBlockedReply: '🛑 Включён Emergency Stop. Отправьте /resume.',
    geminiMissingReply: '⚠️ GEMINI_API_KEY не настроен.',
    disconnectedText: '🔌 Подключение Telegram Business отключено в настройках.',
    btnStatus: '📊 Статус',
    btnAccounts: '👥 Аккаунты',
    btnConnect: '🔗 Подключить',
    btnSettings: '⚙️ Настройки',
    btnLanguage: '🌐 Язык',
    btnStyle: '✍️ Стиль',
    btnVoice: '🎙 Голос',
    btnVideo: '🎬 Видео',
    btnCalls: '📞 Звонки',
    btnMemory: '🧠 Память',
    btnPermissions: '🔐 Права',
    btnActivity: '📋 Активность',
    btnPause: '⏸ Пауза',
    btnResume: '▶️ Возобновить',
    btnStop: '🛑 Emergency Stop',
    btnAutonomous: '🤖 Автономный режим',
    btnCheckBusiness: '🔄 Проверить подключение',
    btnConfirmConsent: '✅ Подтвердить AI согласие',
    btnRevokeConsent: '🚫 Отозвать согласие',
    btnToggleDisclosure: '🏷 Метка AI',
    btnToggleVoice: '🔊 Голосовой ответ',
    btnToggleVideoReply: '⭕️ Видеокружок (ответ)',
    btnToggleTranscribe: '🎧 Транскрибация',
    btnToggleVideo: '🎬 Анализ видео',
    btnClearMemory: '🗑 Очистить память',
    btnApproveSend: '✅ Одобрить и отправить',
    btnReject: '❌ Отклонить',
    btnExcludeChat: '🚫 Исключить чат',
    btnBack: '⬅️ Главное меню',
  },
  en: {
    unauthorized: 'This personal OMNIA AI bot is restricted to its authorized owner.',
    welcomeTitle: 'OMNIA AI — Autonomous Personal Telegram Agent',
    welcomeBody:
      'I am your multi-module Google Gemini assistant operating directly inside Telegram.\n\n• Component B (This bot): Send text, voice, video, round video notes, or photos.\n• Component A (Personal account): Autonomously handles authorized Telegram Business chats and escalates only genuinely high-risk actions.',
    helpText:
      '📘 OMNIA AI Command Reference:\n/start, /status, /settings, /auto, /pause, /resume, /stop\n/accounts, /account_status, /personal_status, /bot_status, /connect, /disconnect\n/language (/lang), /style, /memory, /memory_show, /memory_search, /memory_clear\n/voice, /voice_on, /voice_off, /voice_style, /video, /video_on, /video_off, /calls, /calls_on, /calls_off\n/permissions, /privacy, /activity, /logs',
    connectText:
      '🔗 Connecting Your Personal Account:\n1. Enable Business Mode in @BotFather.\n2. Open Settings → Telegram Business → Chatbots → add this bot with Read & Reply rights.',
    pausedToast: '⏸ Automatic replies paused.',
    resumedToast: '▶️ Assistant resumed.',
    stoppedToast: '🛑 EMERGENCY STOP activated. All outbound AI replies halted.',
    autonomousEnabledText: '✅ Autonomous mode active for ordinary authorized chats.',
    autonomousNeedsConsentText: '⚠️ Confirm AI data consent in /settings first.',
    consentConfirmedToast: '✅ AI processing consent confirmed.',
    memoryHeader: '🧠 Structured Long-Term Memory',
    memoryCleared: '🗑 Memory records cleared.',
    memorySaved: '💾 Saved securely to long-term memory.',
    memoryUsage: 'Usage: /memory <text>, /memory_show, /memory_search <query>, /memory_clear',
    voiceHeader: '🎙 Voice & TTS Settings',
    videoHeader: '🎬 Video Analysis & Round Video Notes',
    styleHeader: '✍️ Personal Communication Style',
    permissionsHeader: '🔐 Chat Permissions & Exclusions',
    privacyText: '🛡 Privacy Policy: Passwords, OTPs, and card details are never stored in memory. Every chat memory is strictly isolated per (channel, chatId).',
    settingsHeader: '⚙️ OMNIA AI Settings',
    languageHeader: '🌐 Select Language',
    activityHeader: '📋 Recent Activity & Approvals',
    logsHeader: '📜 System Audit & Error Logs',
    noActivity: 'No recorded activity yet.',
    emergencyBlockedReply: '🛑 Emergency Stop is active. Send /resume to re-enable.',
    geminiMissingReply: '⚠️ GEMINI_API_KEY is not configured.',
    disconnectedText: '🔌 Telegram Business link disabled in bot state.',
    btnStatus: '📊 Status',
    btnAccounts: '👥 Accounts',
    btnConnect: '🔗 Connect',
    btnSettings: '⚙️ Settings',
    btnLanguage: '🌐 Language',
    btnStyle: '✍️ Style',
    btnVoice: '🎙 Voice',
    btnVideo: '🎬 Video',
    btnCalls: '📞 Calls',
    btnMemory: '🧠 Memory',
    btnPermissions: '🔐 Permissions',
    btnActivity: '📋 Activity',
    btnPause: '⏸ Pause',
    btnResume: '▶️ Resume',
    btnStop: '🛑 Emergency Stop',
    btnAutonomous: '🤖 Autonomous',
    btnCheckBusiness: '🔄 Verify Business Link',
    btnConfirmConsent: '✅ Confirm AI Consent',
    btnRevokeConsent: '🚫 Disable AI Consent',
    btnToggleDisclosure: '🏷 AI Disclosure',
    btnToggleVoice: '🔊 Voice Reply',
    btnToggleVideoReply: '⭕️ Round Video Reply',
    btnToggleTranscribe: '🎧 Transcribe Voice',
    btnToggleVideo: '🎬 Analyze Video',
    btnClearMemory: '🗑 Clear Memory',
    btnApproveSend: '✅ Approve & Send',
    btnReject: '❌ Reject',
    btnExcludeChat: '🚫 Exclude Chat',
    btnBack: '⬅️ Main Menu',
  },
};

export function t(lang: UILanguage): LocalizedStrings {
  return STRINGS[lang] || STRINGS.uz_lat;
}

export const LANGUAGE_DISPLAY_NAMES: Record<LanguagePreference, string> = {
  uz_lat: '🇺🇿 O‘zbek lotin',
  uz_cyr: '🇺🇿 Ўзбек кирилл',
  uz_new: '✨ Yangi o‘zbek lotin',
  ru: '🇷🇺 Русский',
  en: '🇬🇧 English',
  auto: '🔄 Avtomatik aniqlash',
};

export function parseLanguageShortcut(cmd: string, argLower: string): LanguagePreference | null {
  if (cmd === '/uz') return 'uz_lat';
  if (cmd === '/uzcyr') return 'uz_cyr';
  if (cmd === '/uznew') return 'uz_new';
  if (cmd === '/ru') return 'ru';
  if (cmd === '/en') return 'en';

  if (cmd === '/language' || cmd === '/lang' || cmd === '/til') {
    const clean = argLower.trim();
    if (!clean) return null;
    if (['uz_lat', 'uzlat', 'uz', 'lotin', 'latin'].includes(clean)) return 'uz_lat';
    if (['uz_cyr', 'uzcyr', 'cyr', 'kirill', 'cyrillic'].includes(clean)) return 'uz_cyr';
    if (['uz_new', 'uznew', 'new', 'yangi', 'ozbek', 'özbek'].includes(clean)) return 'uz_new';
    if (['ru', 'rus', 'russian'].includes(clean)) return 'ru';
    if (['en', 'eng', 'english'].includes(clean)) return 'en';
    if (['auto', 'avto', 'automatic'].includes(clean)) return 'auto';
  }
  return null;
}

export function buildLanguageSelectionView(
  uiLang: UILanguage,
  activePreference: LanguagePreference = uiLang,
  includeBackButton = true
): { text: string; markup: InlineKeyboardMarkup } {
  const s = t(uiLang);
  const mark = (pref: LanguagePreference, label: string) =>
    `${activePreference === pref ? '✅ ' : ''}${label}`;

  const inline_keyboard: InlineKeyboardMarkup['inline_keyboard'] = [
    [
      { text: mark('uz_lat', '🇺🇿 O‘zbek lotin'), callback_data: 'lang:uz_lat' },
      { text: mark('uz_cyr', '🇺🇿 Ўзбек кирилл'), callback_data: 'lang:uz_cyr' },
    ],
    [{ text: mark('uz_new', '✨ Yangi o‘zbek lotin'), callback_data: 'lang:uz_new' }],
    [
      { text: mark('ru', '🇷🇺 Русский'), callback_data: 'lang:ru' },
      { text: mark('en', '🇬🇧 English'), callback_data: 'lang:en' },
    ],
    [{ text: mark('auto', '🔄 Avtomatik aniqlash'), callback_data: 'lang:auto' }],
  ];

  if (includeBackButton) {
    inline_keyboard.push([{ text: s.btnBack, callback_data: 'cmd:home' }]);
  }

  return {
    text: `${s.languageHeader}\n\n• Faol / Active: ${LANGUAGE_DISPLAY_NAMES[activePreference]}`,
    markup: { inline_keyboard },
  };
}

export function formatLanguageChangedConfirmation(
  pref: LanguagePreference,
  uiLang: UILanguage
): string {
  switch (pref) {
    case 'uz_new':
      return '✅ Til muvaffaqiyatli almaştirildi: ✨ Yangi özbek lotin (ş, ç, ö, ğ). Endi barcha javoblar yangi özbek lotin yozuvida beriladi.';
    case 'uz_cyr':
      return '✅ Тил муваффақиятли алмаштирилди: 🇺🇿 Ўзбек кирилл. Энди барча жавоблар кирилл ёзувида берилади.';
    case 'uz_lat':
      return '✅ Til muvaffaqiyatli almashtirildi: 🇺🇿 O‘zbek lotin. Endi barcha javoblar o‘zbek lotin yozuvida beriladi.';
    case 'ru':
      return '✅ Язык успешно изменён: 🇷🇺 Русский. Все дальнейшие ответы будут на русском языке.';
    case 'en':
      return '✅ Language updated: 🇬🇧 English. All replies will now be generated in English.';
    case 'auto': {
      if (uiLang === 'uz_new') {
        return '✅ Avtomatik til aniqlash rejimi yoqildi. Har bir xabar tili va yozuviga mos javob beriladi.';
      }
      if (uiLang === 'uz_cyr') {
        return '✅ Автоматик тил аниқлаш режими ёқилди. Ҳар бир хабар тили ва ёзувига мос жавоб берилади.';
      }
      if (uiLang === 'ru') {
        return '✅ Включено автоопределение языка. Бот будет отвечать на языке и графике каждого сообщения.';
      }
      if (uiLang === 'en') {
        return '✅ Auto-detect enabled. Replies will automatically match each message language and script.';
      }
      return '✅ Avtomatik til aniqlash yoqildi. Har bir xabar tili va alifbosiga mos javob beriladi.';
    }
  }
}

export function buildMainMenuKeyboard(lang: UILanguage, settings: BotSettings): InlineKeyboardMarkup {
  const s = t(lang);
  return {
    inline_keyboard: [
      [
        { text: s.btnStatus, callback_data: 'cmd:status' },
        { text: s.btnAccounts, callback_data: 'cmd:accounts' },
      ],
      [
        { text: s.btnSettings, callback_data: 'cmd:settings' },
        { text: s.btnStyle, callback_data: 'cmd:style' },
      ],
      [
        { text: s.btnVoice, callback_data: 'cmd:voice' },
        { text: s.btnVideo, callback_data: 'cmd:video' },
      ],
      [
        { text: s.btnMemory, callback_data: 'cmd:memory' },
        { text: s.btnPermissions, callback_data: 'cmd:permissions' },
      ],
      [
        { text: s.btnLanguage, callback_data: 'cmd:language' },
        { text: s.btnActivity, callback_data: 'cmd:activity' },
      ],
      [
        settings.paused || settings.emergencyStop || settings.businessPaused
          ? { text: s.btnResume, callback_data: 'act:resume' }
          : { text: s.btnPause, callback_data: 'act:pause' },
        { text: s.btnStop, callback_data: 'act:stop' },
      ],
    ],
  };
}

export function formatStatusMessage(params: {
  settings: BotSettings;
  live: TelegramLiveStatus;
  geminiReady: boolean;
  dbLabel: string;
  queue: { queued: number; processing: number; deadLetter: number; done: number };
  pendingApprovals: number;
}): string {
  const { settings, live, geminiReady, dbLabel, queue, pendingApprovals } = params;
  const businessActive =
    Boolean(settings.businessConnectionId) && settings.connectionEnabled && settings.rightsCanReply;

  const langNames: Record<UILanguage, string> = {
    uz_lat: 'O‘zbekcha (Lotin)',
    uz_cyr: 'Ўзбекча (Кирилл)',
    uz_new: 'Yangi o‘zbek lotin (ş, ç, ö, ğ)',
    ru: 'Русский',
    en: 'English',
  };

  if (settings.uiLanguage === 'en') {
    return [
      '📊 OMNIA AI — Live System Status',
      '',
      `🤖 Component B (Bot): ${live.botInfo ? `@${live.botInfo.username} (ID: ${live.botInfo.id})` : live.tokenConfigured ? `Error: ${live.error || 'unreachable'}` : 'Token missing'}`,
      `🌐 Webhook: ${live.webhookInfo?.url ? `Active (${live.webhookInfo.url})` : 'Not set'}`,
      live.webhookInfo?.lastErrorMessage ? `⚠️ Webhook error: ${live.webhookInfo.lastErrorMessage}` : '',
      '',
      `👤 Component A (Business): ${businessActive ? 'Connected & Ready' : settings.businessConnectionId ? 'Linked (disabled or no reply right)' : 'Not connected yet'}`,
      settings.businessOwnerName ? `• Owner: ${settings.businessOwnerName} (${settings.businessOwnerId})` : '',
      '',
      `🧠 Gemini AI: ${geminiReady ? 'Ready' : 'Missing GEMINI_API_KEY'}`,
      `🗄 Database: ${dbLabel}`,
      `🌐 Language: ${langNames[settings.uiLanguage]}`,
      `⚙️ Mode: ${settings.autoReplyMode} | Autonomous: ${settings.autonomousEnabled ? 'ON' : 'OFF'}`,
      `⏸ Pause: global=${settings.paused ? 'YES' : 'NO'}, bot=${settings.botPaused ? 'YES' : 'NO'}, business=${settings.businessPaused ? 'YES' : 'NO'} | 🛑 Stop: ${settings.emergencyStop ? 'ACTIVE' : 'OFF'}`,
      `🎙 Output: mode=${settings.voiceOutputMode} (${settings.ttsVoice}/${settings.voiceStyle}) | VideoReply=${settings.videoReplyEnabled ? 'ON' : 'OFF'}`,
      `📥 Queue: queued=${queue.queued}, dead=${queue.deadLetter}, done=${queue.done} | Pending approvals: ${pendingApprovals}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (settings.uiLanguage === 'uz_new') {
    return [
      '📊 OMNIA AI — Haqiqiy Tizim Holati',
      '',
      `🤖 B komponent (Bot): ${live.botInfo ? `@${live.botInfo.username} (ID: ${live.botInfo.id})` : live.tokenConfigured ? `Xato: ${live.error || 'ulanib bölmadi'}` : 'Token kiritilmagan'}`,
      `🌐 Webhook: ${live.webhookInfo?.url ? `Faol (${live.webhookInfo.url})` : 'Örnatilmagan'}`,
      live.webhookInfo?.lastErrorMessage ? `⚠️ Webhook xatosi: ${live.webhookInfo.lastErrorMessage}` : '',
      '',
      `👤 A komponent (Şaxsiy Business): ${businessActive ? 'Ulangan va tayyor' : settings.businessConnectionId ? 'Ulangan (öçiq yoki javob ruxsati yöq)' : 'Hali ulanmagan'}`,
      settings.businessOwnerName ? `• Egasi: ${settings.businessOwnerName} (${settings.businessOwnerId})` : '',
      settings.businessConnectionId
        ? `• Ruxsatlar: öqiş=${settings.rightsCanReadMessages ? 'ha' : 'yöq'}, javob=${settings.rightsCanReply ? 'ha' : 'yöq'}`
        : '',
      '',
      `🧠 Gemini AI: ${geminiReady ? 'Faol' : 'GEMINI_API_KEY yöq'}`,
      `🗄 Ma’lumotlar bazasi: ${dbLabel}`,
      `🌐 Interfeys tili: ${langNames[settings.uiLanguage]} (Javob rejimi: ${settings.defaultReplyLanguage})`,
      `⚙️ Rejim: ${settings.autoReplyMode} | Avtonom: ${settings.autonomousEnabled ? 'YONIQ' : 'ÖÇIQ'}`,
      `⏸ Pauza: umumiy=${settings.paused ? 'HA' : 'YÖQ'}, bot=${settings.botPaused ? 'HA' : 'YÖQ'}, şaxsiy=${settings.businessPaused ? 'HA' : 'YÖQ'} | 🛑 Emergency Stop: ${settings.emergencyStop ? 'FAOL' : 'ÖÇIQ'}`,
      `🔐 AI roziligi: ${settings.aiConsentConfirmed ? 'Tasdiqlangan' : 'Yöq'} | 🏷 AI belgisi: ${settings.disclosureEnabled ? 'Yoniq' : 'Öçiq'}`,
      `🎙 Ovoz/Video: çiqiş=${settings.voiceOutputMode} (${settings.ttsVoice}/${settings.voiceStyle}/${settings.speakingSpeed}) | Dumaloq video javob=${settings.videoReplyEnabled ? 'YONIQ' : 'ÖÇIQ'}`,
      '',
      `📥 Navbat: kutilmoqda=${queue.queued}, xato=${queue.deadLetter}, bajarilgan=${queue.done}`,
      `📝 Tasdiqlaş kutilmoqda: ${pendingApprovals}`,
      settings.lastWebhookAt
        ? `🕒 Oxirgi webhook: ${settings.lastWebhookAt} (${settings.lastWebhookEvent})`
        : '🕒 Oxirgi webhook: hali kelmagan',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '📊 OMNIA AI — Haqiqiy Tizim Holati',
    '',
    `🤖 B komponent (Bot): ${live.botInfo ? `@${live.botInfo.username} (ID: ${live.botInfo.id})` : live.tokenConfigured ? `Xato: ${live.error || 'ulanib bo‘lmadi'}` : 'Token kiritilmagan'}`,
    `🌐 Webhook: ${live.webhookInfo?.url ? `Faol (${live.webhookInfo.url})` : 'O‘rnatilmagan'}`,
    live.webhookInfo?.lastErrorMessage ? `⚠️ Webhook xatosi: ${live.webhookInfo.lastErrorMessage}` : '',
    '',
    `👤 A komponent (Shaxsiy Business): ${businessActive ? 'Ulangan va tayyor' : settings.businessConnectionId ? 'Ulangan (o‘chiq yoki javob ruxsati yo‘q)' : 'Hali ulanmagan'}`,
    settings.businessOwnerName ? `• Egasi: ${settings.businessOwnerName} (${settings.businessOwnerId})` : '',
    settings.businessConnectionId
      ? `• Ruxsatlar: o‘qish=${settings.rightsCanReadMessages ? 'ha' : 'yo‘q'}, javob=${settings.rightsCanReply ? 'ha' : 'yo‘q'}`
      : '',
    '',
    `🧠 Gemini AI: ${geminiReady ? 'Faol' : 'GEMINI_API_KEY yo‘q'}`,
    `🗄 Ma’lumotlar bazasi: ${dbLabel}`,
    `🌐 Interfeys tili: ${langNames[settings.uiLanguage]} (Javob rejimi: ${settings.defaultReplyLanguage})`,
    `⚙️ Rejim: ${settings.autoReplyMode} | Avtonom: ${settings.autonomousEnabled ? 'YONIQ' : 'O‘CHIQ'}`,
    `⏸ Pauza: umumiy=${settings.paused ? 'HA' : 'YO‘Q'}, bot=${settings.botPaused ? 'HA' : 'YO‘Q'}, shaxsiy=${settings.businessPaused ? 'HA' : 'YO‘Q'} | 🛑 Emergency Stop: ${settings.emergencyStop ? 'FAOL' : 'O‘CHIQ'}`,
    `🔐 AI roziligi: ${settings.aiConsentConfirmed ? 'Tasdiqlangan' : 'Yo‘q'} | 🏷 AI belgisi: ${settings.disclosureEnabled ? 'Yoniq' : 'O‘chiq'}`,
    `🎙 Ovoz/Video: chiqish=${settings.voiceOutputMode} (${settings.ttsVoice}/${settings.voiceStyle}/${settings.speakingSpeed}) | Dumaloq video javob=${settings.videoReplyEnabled ? 'YONIQ' : 'O‘CHIQ'}`,
    '',
    `📥 Navbat: kutilmoqda=${queue.queued}, xato=${queue.deadLetter}, bajarilgan=${queue.done}`,
    `📝 Tasdiqlash kutilmoqda: ${pendingApprovals}`,
    settings.lastWebhookAt
      ? `🕒 Oxirgi webhook: ${settings.lastWebhookAt} (${settings.lastWebhookEvent})`
      : '🕒 Oxirgi webhook: hali kelmagan',
  ]
    .filter(Boolean)
    .join('\n');
}
