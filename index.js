import 'dotenv/config';
import express        from 'express';
import { Telegraf }   from 'telegraf';
import OpenAI         from 'openai';

const {
  TELEGRAM_TOKEN,
  OPENROUTER_API_KEY,
  DOMAIN,
  PORT = 8080
} = process.env;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error('❌ Задайте TELEGRAM_TOKEN, OPENROUTER_API_KEY и DOMAIN в env');
  process.exit(1);
}

// in-memory storage для упоминания политики
const privacyMentioned = new Map();

// 1) Express + healthcheck
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// 2) Telegraf bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// 3) OpenRouter клиент
const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 4) Виджет-ссылки
const services = {
  "ОСАГО":                 "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045…&secret=2d2759b…",
  "МИНИ-КАСКО":            "https://widgets.inssmart.ru/contract/kasko?appId=293563a…&secret=5d05a…",
  "Ипотека":               "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1…&secret=695a…",
  "Страхование имущества": "https://widgets.inssmart.ru/contract/property?appId=34dad…&secret=ff27…",
  "Путешествия":           "https://widgets.inssmart.ru/contract/travel?appId=a8bf5…&secret=95f2…"
};

// 5) «Вне-виджетные» темы и ответ
const outsideTriggers = [
  'КАСКО ПО РИСКАМ','ТОТАЛ','УГОН',
  'ДМС','СТРАХОВАНИЕ БИЗНЕСА'
];
const outsideWidgetResponse = `
К сожалению, этот вид страхования недоступен онлайн.
Свяжитесь для подбора:

📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37  

Мы — операторы ПДн. Политика: https://straxovka-go.ru/privacy
`.trim();

// 6) Ключевые слова для страховки
const insuranceKeywords = [
  'ОСАГО','КАСКО','ДМС','ИПОТЕКА',
  'ИМУЩЕСТВО','СТРАХОВАНИЕ','ПОЛИС',
  'ДОКУМЕНТ','ДТП'
];

// 7) /start — меню кнопок
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    '👋 Здравствуйте! Помогу оформить страховку. Выберите услугу или задайте вопрос:',
    { reply_markup:{ keyboard, resize_keyboard:true } }
  );
});

// 8) Webhook-endpoint
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 9) Обработка всех текстовых сообщений
bot.on('text', async ctx => {
  const txt = ctx.message.text.trim();
  const chatId = String(ctx.chat.id);
  const upper = txt.toUpperCase();

  // 9.1 — кнопка-виджет
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${txt}</b>:`,
      { reply_markup:{ inline_keyboard:[
        [{ text:'▶ Открыть виджет', url:services[txt] }]
      ] } }
    );
  }

  // 9.2 — «вне-виджетные» темы
  if (outsideTriggers.some(tr => upper.includes(tr))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 9.3 — не про страхование → сразу контакты
  if (!insuranceKeywords.some(kw => upper.includes(kw))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 9.4 — AI-ответ по теме
  const firstTime = !privacyMentioned.get(chatId);
  let systemPrompt = `
Ты — ассистент Straxovka-Go. Отвечай коротко и по теме.
`;
  if (firstTime) {
    systemPrompt += `
В этом ответе упомяни, что мы — операторы обработки персональных данных, 
и дай ссылку на политику: https://straxovka-go.ru/privacy
`;
    privacyMentioned.set(chatId, true);
  } else {
    systemPrompt += `\nНе упоминай политику повторно.`;
  }

  try {
    const resp = await openai.chat.completions.create({
      model:       'openai/gpt-3.5-turbo',
      messages:    [
        { role:'system', content:systemPrompt.trim() },
        { role:'user',   content:txt }
      ],
      temperature: 0.5,
      max_tokens:  200
    });
    return ctx.reply(resp.choices[0].message.content.trim());
  } catch (err) {
    console.error('OpenRouter Error:', err);
    return ctx.reply('Упс, ошибка при обращении к модели. Попробуйте чуть позже.');
  }
});

// 10) Запуск сервера + webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
