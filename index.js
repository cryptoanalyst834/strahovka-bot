// index.js
import 'dotenv/config';
import express from 'express';
import { Telegraf } from 'telegraf';
import OpenAI     from 'openai';

// ─── 0) Проверяем переменные
const { TELEGRAM_TOKEN, OPENROUTER_API_KEY, DOMAIN, PORT } = process.env;
if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error('❌ Убедитесь, что заданы TELEGRAM_TOKEN, OPENROUTER_API_KEY и DOMAIN');
  process.exit(1);
}

// ─── 1) Express-сервер для вебхука
const app = express();
app.use(express.json()); // парсинг JSON

// корневой маршрут для Healthcheck
app.get('/', (_req, res) => res.send('OK'));

// ─── 2) Telegram-бот и OpenRouter-клиент
const bot = new Telegraf(TELEGRAM_TOKEN);
const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// ─── 3) Меню виджетов
const services = {
  ОСАГО:       'https://widgets.inssmart.ru/contract/eosago?appId=…&secret=…',
  КАСКО:       'https://widgets.inssmart.ru/contract/kasko?appId=…&secret=…',
  Ипотека:     'https://widgets.inssmart.ru/contract/mortgage?appId=…&secret=…',
  Имущество:   'https://widgets.inssmart.ru/contract/property?appId=…&secret=…',
  Путешествия: 'https://widgets.inssmart.ru/contract/travel?appId=…&secret=…'
};

// ─── 4) Обработчики бота
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    '👋 Здравствуйте! Выберите услугу или задайте вопрос:',
    { reply_markup: { keyboard, resize_keyboard: true } }
  );
});

bot.on('text', async ctx => {
  const text = ctx.message.text.trim();

  if (services[text]) {
    // если нажали кнопку
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${text}</b>:`,
      { reply_markup:{ inline_keyboard:[[ { text:'▶ Открыть виджет', url:services[text] } ]] } }
    );
  }

  // иначе – запрос в OpenRouter
  try {
    const resp = await openai.chat.completions.create({
      model:    'gpt-3.5-turbo',
      messages: [
        { role:'system', content:'Ты — ассистент по страхованию. Отвечай по теме и предлагай виджеты.' },
        { role:'user',   content:text }
      ],
      temperature:0.7,
      max_tokens:  400
    });
    await ctx.reply(resp.choices[0].message.content.trim());
  } catch (err) {
    console.error('OpenRouter Error:', err);
    await ctx.reply('Упс, при обращении к модели произошла ошибка. Попробуйте позже.');
  }
});

// ─── 5) Webhook endpoint
const webhookPath = '/webhook';
app.post(webhookPath, (req, res) => {
  bot.handleUpdate(req.body, res)
    .then(() => res.sendStatus(200))
    .catch(() => res.sendStatus(500));
});

// ─── 6) Устанавливаем Webhook в Telegram при запуске
(async () => {
  await bot.telegram.setWebhook(`${DOMAIN}${webhookPath}`);
  console.log('✅ Webhook set to', `${DOMAIN}${webhookPath}`);
  // запускаем HTTP-сервер
  const port = PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Express server listening on port ${port}`);
  });
})();
