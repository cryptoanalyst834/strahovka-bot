// index.js
import 'dotenv/config';
import express    from 'express';
import { Telegraf } from 'telegraf';
import OpenAI       from 'openai';

// ─── 0) Проверка переменных окружения ────────────────────────────────
const {
  TELEGRAM_TOKEN,
  OPENROUTER_API_KEY,
  DOMAIN,            // e.g. "https://strahovka-bot.up.railway.app"
  PORT = 3000
} = process.env;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error("❌ Не заданы TELEGRAM_TOKEN, OPENROUTER_API_KEY или DOMAIN в env");
  process.exit(1);
}

// ─── 1) Настраиваем Express ──────────────────────────────────────────
const app = express();
app.use(express.json());

// Healthcheck для Railway
app.get('/', (_req, res) => res.send('OK'));

// ─── 2) Инициализация Telegraf + OpenRouter ─────────────────────────
const bot = new Telegraf(TELEGRAM_TOKEN);
const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// ─── 3) Словарь ваших виджет-ссылок ──────────────────────────────────
const services = {
  ОСАГО:       "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740",
  КАСКО:       "https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6",
  Ипотека:     "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93",
  Имущество:   "https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84",
  Путешествия: "https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c"
};

// ─── 4) Обработчики Telegraf ─────────────────────────────────────────
// /start → меню кнопок
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    "👋 Здравствуйте! Выберите услугу или задайте вопрос:",
    { reply_markup: { keyboard, resize_keyboard: true } }
  );
});

// Любой текст
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();

  // 4.1 — кнопка-виджет
  if (services[text]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${text}</b>:`,
      { reply_markup:{ inline_keyboard:[
          [{ text: '▶ Открыть виджет', url: services[text] }]
      ] } }
    );
  }

  // 4.2 — свободный вопрос → OpenRouter
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role:'system', content:'Ты — ассистент по страхованию. Отвечай по теме и предлагай виджеты.' },
        { role:'user',   content:text }
      ],
      temperature:0.7,
      max_tokens: 400
    });
    return ctx.reply(resp.choices[0].message.content.trim());
  } catch (err) {
    console.error('OpenRouter Error:', err);
    return ctx.reply('Упс, при обращении к модели произошла ошибка. Попробуйте позже.');
  }
});

// ─── 5) Endpoint для Webhook ─────────────────────────────────────────
const hookPath = '/webhook';
app.post(hookPath, (req, res) => {
  // Telegraf внутри разберёт update и отправит ответ
  bot.handleUpdate(req.body, res)
    .then(() => res.sendStatus(200))
    .catch(err => {
      console.error('handleUpdate Error', err);
      res.sendStatus(500);
    });
});

// ─── 6) Запуск сервера + установка Webhook ───────────────────────────
app.listen(PORT, async () => {
  console.log(`🌐 Express listening on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}${hookPath}`);
  console.log(`✅ Webhook registered at ${DOMAIN}${hookPath}`);
});
