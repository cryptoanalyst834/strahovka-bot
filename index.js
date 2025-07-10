import 'dotenv/config';
import express    from 'express';
import { Telegraf } from 'telegraf';
import OpenAI      from 'openai';

// ─── 0) Инициализация HTTP-сервера для Railway ─────────────────────────
const app = express();
// простой маршрут здоровья
app.get('/', (req, res) => res.send('OK'));

// Railway передаёт порт в env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Express server listening on port ${PORT}`);
});
// ────────────────────────────────────────────────────────────────────────

// ─── 1) Инициализация Telegram-бота и OpenRouter ───────────────────────
if (!process.env.TELEGRAM_TOKEN || !process.env.OPENROUTER_API_KEY) {
  console.error("❌ Отсутствуют TELEGRAM_TOKEN или OPENROUTER_API_KEY в env");
  process.exit(1);
}
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const openai = new OpenAI({
  apiKey:  process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});
// ────────────────────────────────────────────────────────────────────────

// ─── 2) Меню виджетов ───────────────────────────────────────────────────
const services = {
  "ОСАГО":       "https://widgets.inssmart.ru/contract/eosago?appId=...&secret=...",
  "КАСКО":       "https://widgets.inssmart.ru/contract/kasko?appId=...&secret=...",
  "Ипотека":     "https://widgets.inssmart.ru/contract/mortgage?appId=...&secret=...",
  "Имущество":   "https://widgets.inssmart.ru/contract/property?appId=...&secret=...",
  "Путешествия": "https://widgets.inssmart.ru/contract/travel?appId=...&secret=..."
};
// ────────────────────────────────────────────────────────────────────────

// ─── 3) /start ─────────────────────────────────────────────────────────
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    "👋 Здравствуйте! Выберите услугу или задайте вопрос:",
    { reply_markup: { keyboard, resize_keyboard: true } }
  );
});
// ────────────────────────────────────────────────────────────────────────

// ─── 4) Универсальный обработчик ────────────────────────────────────────
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();

  // 4.1 — если текст совпал с кнопкой
  if (services[text]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${text}</b>:`,
      { reply_markup:{ inline_keyboard:[[{ text:"▶ Открыть виджет", url:services[text] }]] } }
    );
  }

  // 4.2 — иначе отправляем в OpenRouter
  try {
    const resp = await openai.chat.completions.create({
      model:       'gpt-3.5-turbo',
      messages:    [
        { role:'system', content:'Ты — ассистент по страхованию. Отвечай по теме и предлагай виджеты.' },
        { role:'user',   content:text }
      ],
      temperature: 0.7,
      max_tokens:  400
    });
    const answer = resp.choices[0].message.content.trim();
    return ctx.reply(answer);
  } catch (err) {
    console.error('OpenRouter Error:', err);
    return ctx.reply('Упс, при обращении к модели произошла ошибка. Попробуйте позже.');
  }
});
// ────────────────────────────────────────────────────────────────────────

// ─── 5) Запуск long-polling ─────────────────────────────────────────────
(async () => {
  await bot.launch({ dropPendingUpdates: true });
  console.log('🤖 Bot started (long-polling)');
})();
