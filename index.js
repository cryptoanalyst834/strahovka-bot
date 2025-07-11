import 'dotenv/config';
import express      from 'express';
import { Telegraf } from 'telegraf';
import OpenAI       from 'openai';

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

// in-memory flag per chat to mention privacy only once
const privacyMentioned = new Map();

// 1) Express + healthcheck + webhook
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// 2) Telegraf bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// 3) OpenRouter client
const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 4) Виджет-ссылки (полные, без усечений)
const services = {
  "ОСАГО":                   "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740",
  "МИНИ-КАСКО":              "https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6",
  "Ипотека":                 "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93",
  "Страхование имущества":   "https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84",
  "Путешествия":             "https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c"
};

// 5) Шаблон для «вне-виджетных» запросов
const outsideTriggers = [
  "КАСКО ПО РИСКАМ", "ТОТАЛ", "УГОН",
  "ДМС", "СТРАХОВАНИЕ БИЗНЕСА"
];
const outsideWidgetResponse = `
К сожалению, нужный вид страхования в онлайн-приложении не представлен.  
Свяжитесь с нами для индивидуального подбора:

📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37  

Мы — операторы обработки ПДн.  
Политика конфиденциальности: https://straxovka-go.ru/privacy
`.trim();

// 6) Ключевые слова по страхованию
const insuranceKeywords = [
  "ОСАГО","КАСКО","ДМС","ИПОТЕКА",
  "ИМУЩЕСТВО","СТРАХОВАНИЕ","ПОЛИС",
  "ДОКУМЕНТ","ДТП"
];

// 7) /start — главное меню
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    "👋 Здравствуйте! Помогу оформить страховку. Выберите услугу или задайте вопрос:",
    { reply_markup: { keyboard, resize_keyboard: true } }
  );
});

// 8) Webhook-handler
app.post("/webhook", (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 9) Универсальный обработчик сообщений
bot.on("text", async ctx => {
  const txt = ctx.message.text.trim();
  const chatId = String(ctx.chat.id);
  const upper = txt.toUpperCase();

  // 9.1 Кнопка-виджет
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${txt}</b>:`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "▶ Открыть виджет", url: services[txt] }]]
        }
      }
    );
  }

  // 9.2 «Вне-виджетные» темы
  if (outsideTriggers.some(tr => upper.includes(tr))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 9.3 Не про страхование → сразу контакты
  if (!insuranceKeywords.some(kw => upper.includes(kw))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 9.4 AI-ответ по теме
  const firstTime = !privacyMentioned.get(chatId);
  let systemPrompt = `
Ты — ассистент Straxovka-Go. Отвечай коротко и по теме.
`;
  if (firstTime) {
    systemPrompt += `
В этом ответе упомяни, что мы — операторы обработки ПДн, и дай ссылку на политику: https://straxovka-go.ru/privacy
`;
    privacyMentioned.set(chatId, true);
  } else {
    systemPrompt += "\nНе упоминай политику повторно.";
  }

  try {
    const resp = await openai.chat.completions.create({
      model:       "openai/gpt-3.5-turbo",
      messages:    [
        { role: "system", content: systemPrompt.trim() },
        { role: "user",   content: txt }
      ],
      temperature: 0.5,
      max_tokens:  200
    });
    return ctx.reply(resp.choices[0].message.content.trim());
  } catch (err) {
    console.error("OpenRouter Error:", err);
    return ctx.reply("Упс, ошибка при обращении к модели. Попробуйте позже.");
  }
});

// 10) Запуск сервера и регистрация webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
