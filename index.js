import 'dotenv/config';               // загружаем .env
import { Telegraf } from 'telegraf';  // Telegram SDK
import OpenAI from 'openai';          // официальный клиент OpenAI/OpenRouter

// 1) Инициализация
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const openai = new OpenAI({
  apiKey:  process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 2) Меню виджетов
const services = {
  ОСАГО:       "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740",
  КАСКО:       "https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6",
  Ипотека:     "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93",
  Имущество:   "https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84",
  Путешествия: "https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c"
};

// 3) /start — показываем Reply-клавиатуру
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    "👋 Здравствуйте! Выберите услугу или задайте вопрос:",
    { reply_markup: { keyboard, resize_keyboard: true } }
  );
});

// 4) Универсальный обработчик текстовых сообщений
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();

  // 4.1 — если это одна из кнопок меню
  if (services[text]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${text}</b>:`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: '▶ Открыть виджет', url: services[text] }]]
        }
      }
    );
  }

  // 4.2 — иначе отправляем в OpenRouter (GPT-3.5-turbo)
  try {
    const resp = await openai.chat.completions.create({
      model:       'gpt-3.5-turbo',
      messages:    [
        { role: 'system', content: 'Ты — ассистент по страхованию. Отвечай по теме и предлагай виджеты.' },
        { role: 'user',   content: text }
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

// 5) Запуск long-polling
(async () => {
  await bot.launch();
  console.log('Bot started (polling mode)');
})();
