// index.js
import 'dotenv/config';
import express      from 'express';
import { Telegraf, session } from 'telegraf';  // ← здесь правильно
import OpenAI       from 'openai';

const { TELEGRAM_TOKEN, OPENROUTER_API_KEY, DOMAIN, PORT = 8080 } = process.env;
if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error('❌ Задайте TELEGRAM_TOKEN, OPENROUTER_API_KEY и DOMAIN в env');
  process.exit(1);
}

// 1) Express + Webhook endpoint
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// 2) Telegraf + сессии
const bot = new Telegraf(TELEGRAM_TOKEN);
bot.use(session());  // теперь работает без ошибки

const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 3) Ссылки на виджеты
const services = {
  ОСАГО:       'https://widgets.inssmart.ru/contract/eosago?appId=…&secret=…',
  'МИНИ-КАСКО':'https://widgets.inssmart.ru/contract/kasko?appId=…&secret=…',
  Ипотека:     'https://widgets.inssmart.ru/contract/mortgage?appId=…&secret=…',
  'Страхование имущества':'https://widgets.inssmart.ru/contract/property?appId=…&secret=…',
  Путешествия:'https://widgets.inssmart.ru/contract/travel?appId=…&secret=…'
};

// Шаблон «вне-виджетных» запросов
const outsideTriggers = ['КАСКО по рискам','ТОТАЛ','УГОН','ДМС','страхование бизнеса'];
const outsideWidgetResponse = `
К сожалению, нужный вид страхования в онлайн-приложении не представлен. 
Пожалуйста, свяжитесь с нами:

📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37

Мы — операторы ПДн. Политика конфиденциальности: https://straxovka-go.ru/privacy
`.trim();

// 4) /start — меню
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    '👋 Здравствуйте! Я ваш помощник. Выберите услугу или задайте вопрос:',
    { reply_markup:{ keyboard, resize_keyboard:true } }
  );
});

// 5) Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 6) Обработка текста
bot.on('text', async ctx => {
  const txt = ctx.message.text.trim();

  // 6.1 Кнопка
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${txt}</b>:`,
      { reply_markup:{ inline_keyboard:[
          [{ text:'▶ Открыть виджет', url:services[txt] }]
      ] } }
    );
  }

  // 6.2 Вне-виджетные темы
  if (outsideTriggers.some(tr => txt.toUpperCase().includes(tr))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 6.3 OpenRouter запрос
  const firstTime = !ctx.session.privacyMentioned;
  const systemPrompt = `
Ты — ассистент по страхованию Straxovka-Go.
Используй короткие шаблоны ответов по теме.
${firstTime
    ? 'В первом ответе обязательно упомяни, что мы — операторы ПДн, и дай ссылку на политику: https://straxovka-go.ru/privacy'
    : 'Не упоминай политику конфиденциальности повторно.'}
`.trim();

  if (firstTime) ctx.session.privacyMentioned = true;

  try {
    const resp = await openai.chat.completions.create({
      model:       'openai/gpt-3.5-turbo',
      messages:    [
        { role:'system', content:systemPrompt },
        { role:'user',   content:txt }
      ],
      temperature: 0.5,
      max_tokens:  200
    });
    return ctx.reply(resp.choices[0].message.content.trim());
  } catch (err) {
    console.error('OpenRouter Error:', err);
    return ctx.reply('Упс, ошибка при обращении к модели. Попробуйте позже.');
  }
});

// 7) Запуск и регистрация webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook set to ${DOMAIN}/webhook`);
});
