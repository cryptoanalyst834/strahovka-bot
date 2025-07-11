import 'dotenv/config';
import express           from 'express';
import { Telegraf, session } from 'telegraf';
import OpenAI            from 'openai';

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

// 1) Express + webhook
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// 2) Telegraf + session
const bot = new Telegraf(TELEGRAM_TOKEN);
bot.use(session());

const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 3) Виджет-ссылки
const services = {
  ОСАГО:                   'https://widgets.inssmart.ru/contract/eosago?appId=bbac9045…&secret=2d2759b…',
  'МИНИ-КАСКО':            'https://widgets.inssmart.ru/contract/kasko?appId=293563a…&secret=5d05a…',
  Ипотека:                 'https://widgets.inssmart.ru/contract/mortgage?appId=e06a1…&secret=695a…',
  'Страхование имущества': 'https://widgets.inssmart.ru/contract/property?appId=34dad…&secret=ff27…',
  Путешествия:            'https://widgets.inssmart.ru/contract/travel?appId=a8bf5…&secret=95f2…'
};

// 4) Вне-виджетный шаблон / контакты
const outsideWidgetResponse = `
К сожалению, нужный вид страхования в онлайн-приложении не представлен.  
Свяжитесь с нами для индивидуального подбора:

📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37  

Мы — операторы обработки ПДн.  
Политика конфиденциальности: https://straxovka-go.ru/privacy
`.trim();

// 5) Триггеры «вне-виджетных» тем
const outsideTriggers = [
  'КАСКО по рискам','ТОТАЛ','УГОН',
  'ДМС','СТРАХОВАНИЕ БИЗНЕСА'
];

// 6) Ключевые слова для AI-обработки
const insuranceKeywords = [
  'ОСАГО','КАСКО','ДМС','ИПОТЕКА','ИМУЩЕСТВО',
  'СТРАХОВАНИЕ','ПОЛИС','ДОКУМЕНТ','ДТП'
];

// 7) /start — главное меню
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

// 9) Обработка текстовых сообщений
bot.on('text', async ctx => {
  const txt = ctx.message.text.trim();

  // 9.1 — Кнопка-виджет
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${txt}</b>:`,
      {
        reply_markup:{
          inline_keyboard:[
            [{ text:'▶ Открыть виджет', url:services[txt] }]
          ]
        }
      }
    );
  }

  // 9.2 — Запросы вне виджетов
  if (outsideTriggers.some(tr => txt.toUpperCase().includes(tr))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 9.3 — Если это не вопрос по страхованию — сразу контакты
  if (!insuranceKeywords.some(kw => txt.toUpperCase().includes(kw))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 9.4 — AI-обработка тематических вопросов
  const firstTime = !ctx.session.privacyMentioned;
  let systemPrompt = `
Ты — ассистент по страхованию Straxovka-Go. Отвечай коротко и по теме.
`;
  if (firstTime) {
    systemPrompt += `
В первом ответе упомяни, что мы — операторы ПДн, и дай ссылку: https://straxovka-go.ru/privacy
`;
    ctx.session.privacyMentioned = true;
  } else {
    systemPrompt += `Не упоминай политику повторно.`;
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
    return ctx.reply('Упс, ошибка при обращении к модели. Попробуйте позже.');
  }
});

// 10) Запуск сервера и регистрация webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
