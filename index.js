import 'dotenv/config';
import express     from 'express';
import { Telegraf } from 'telegraf';
import OpenAI       from 'openai';

const {
  TELEGRAM_TOKEN,
  OPENROUTER_API_KEY,
  DOMAIN,
  PORT = 8080
} = process.env;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error('❌ Задайте TELEGRAM_TOKEN, OPENROUTER_API_KEY и DOMAIN в переменных окружения');
  process.exit(1);
}

// 1) Express + Webhook endpoint
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// 2) Telegraf и OpenRouter
const bot = new Telegraf(TELEGRAM_TOKEN);
const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 3) Виджет-ссылки
const services = {
  ОСАГО:       'https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740',
  'МИНИ-КАСКО': 'https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6',
  Ипотека:     'https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93',
  'Страхование имущества': 'https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84',
  Путешествия: 'https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c'
};

// 4) /start — меню
bot.start(ctx => {
  const keys = Object.keys(services);
  const keyboard = keys.map(k => ([{ text: k }]));
  return ctx.reply(
    '👋 Здравствуйте!Я ваш помощник. Помогу быстро и просто оформить страховку. Пожалуйста, выберите интересующую вас услугу или задайте вопрос',
    { reply_markup:{ keyboard, resize_keyboard:true } }
  );
});

// 5) Webhook-конец
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 6) Логика “нажатий + ИИ”
bot.on('text', async ctx => {
  const txt = ctx.message.text.trim();

  // 6.1 Если нажали кнопку
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${txt}</b>:`,
      { reply_markup:{ inline_keyboard:[
          [{ text:'▶ Открыть виджет', url:services[txt] }]
        ] } }
    );
  }

  // 6.2 Всё остальное — в OpenRouter с детальным prompt
  const systemPrompt = `
Ты — ассистент по страхованию Straxovka-Go.
1) Если клиент спрашивает "Какие документы нужны", сначала уточни услугу (ОСАГО, МИНИ-КАСКО, Ипотека, Страхование имущества, Путешествия).
2) Если услуга известна, перечисли документы для неё и напомни, что для оформления через виджет не нужно присылать файлы в чат.
3) Если клиент запрашивает оформление вида, которого нет в виджетах (ДМС, бизнес-страхование, автолизинг), предложи консультацию:
   «Пожалуйста, свяжитесь с нами по телефону +7 989 120 66 37, email info@straxovka-go.ru или на сайте https://straxovka-go.ru».
4) При вопросах о ДТП/убытках уточни страховую компанию и дай инструкцию по европротоколу или обращению в страховую, по примеру в документации.
5) Всегда указывай ссылку на политику конфиденциальности: https://straxovka-go.ru/privacy
6) Не предлагай никакие другие каналы, кроме наших виджетов и консультации.
`.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [
        { role:'system', content: systemPrompt },
        { role:'user',   content: txt }
      ],
      temperature: 0.7,
      max_tokens: 400
    });
    const answer = resp.choices[0].message.content.trim();
    return ctx.reply(answer);
  } catch (e) {
    console.error('OpenRouter Error:', e);
    return ctx.reply('Упс, ошибка при обращении к модели. Попробуйте чуть позже.');
  }
});

// 7) Запуск сервера + установка webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook set to ${DOMAIN}/webhook`);
});
