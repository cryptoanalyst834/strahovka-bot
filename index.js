import 'dotenv/config';
import express         from 'express';
import session         from 'telegraf/session';
import { Telegraf }    from 'telegraf';
import OpenAI          from 'openai';

const { TELEGRAM_TOKEN, OPENROUTER_API_KEY, DOMAIN, PORT = 8080 } = process.env;
if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error('❌ Задайте TELEGRAM_TOKEN, OPENROUTER_API_KEY и DOMAIN в env');
  process.exit(1);
}

// ─── 1) Express + Webhook endpoint ────────────────────────────────────
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));  // Healthcheck

// ─── 2) Инициализация бота и сессий ───────────────────────────────────
const bot = new Telegraf(TELEGRAM_TOKEN);
bot.use(session());  // для ctx.session.privacyMentioned

const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// ─── 3) Виджет-ссылки ─────────────────────────────────────────────────
const services = {
  ОСАГО:       'https://widgets.inssmart.ru/contract/eosago?appId=bbac9045…&secret=2d2759b…',
  'МИНИ-КАСКО': 'https://widgets.inssmart.ru/contract/kasko?appId=293563a…&secret=5d05a…',
  Ипотека:     'https://widgets.inssmart.ru/contract/mortgage?appId=e06a1…&secret=695a…',
  'Страхование имущества': 'https://widgets.inssmart.ru/contract/property?appId=34dad…&secret=ff27…',
  Путешествия: 'https://widgets.inssmart.ru/contract/travel?appId=a8bf5…&secret=95f2…'
};

// ─── 4) Шаблон «вне-виджетных» запросов ───────────────────────────────
const outsideWidgetResponse = `
К сожалению, нужный вид страхования в онлайн-приложении не представлен. 
Рекомендуем связаться с нашей компанией для индивидуального подбора:

📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37

Обращаем ваше внимание, что мы являемся операторами обработки персональных данных. 
Подробности в нашей Политике конфиденциальности: https://straxovka-go.ru/privacy
`.trim();

// ключевые фразы для «вне-виджетных» тем :contentReference[oaicite:9]{index=9}
const outsideTriggers = [
  'КАСКО по рискам', 'ТОТАЛ', 'УГОН',
  'ДМС', 'страхование бизнеса'
];

// ─── 5) /start — вывод меню кнопок ────────────────────────────────────
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    '👋 Здравствуйте! Я ваш помощник. Помогу быстро и просто оформить страховку. ' +
    'Пожалуйста, выберите услугу или задайте вопрос:',
    { reply_markup:{ keyboard, resize_keyboard:true } }
  );
});

// ─── 6) Webhook endpoint для Telegraf ─────────────────────────────────
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// ─── 7) Универсальный хэндлер текста ──────────────────────────────────
bot.on('text', async ctx => {
  const txt = ctx.message.text.trim();

  // 7.1 — Кнопка-виджет
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Перейдите по ссылке для оформления <b>${txt}</b>:`,
      { reply_markup:{ inline_keyboard:[
          [{ text:'▶ Открыть виджет', url:services[txt] }]
      ] } }
    );
  }

  // 7.2 — «вне-виджетный» запрос
  if (outsideTriggers.some(tr => txt.toUpperCase().includes(tr))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 7.3 — Вызов OpenRouter для остальных вопросов
  // Подготовим system prompt с шаблонами из Пример ответов.docx 
  const firstTime = !ctx.session.privacyMentioned;
  const systemPrompt = `
Ты — ассистент по страхованию Straxovka-Go. 
Используй эти короткие шаблоны ответа по теме:

— ОСАГО (физики): «Оформите ОСАГО онлайн — быстро и удобно: Перейти к оформлению. 
Контакты: 🌐 straxovka-go.ru, 📲 WhatsApp +7 989 120 66 37, 📧 info@straxovka-go.ru.»

— ОСАГО (юр лица): «Оформление ОСАГО для юридических лиц — доступно онлайн: Перейти к оформлению. 
Контакты: …»

— МИНИ-КАСКО: «МИНИ-КАСКО от Бесполисных… Оформить МИНИ-КАСКО. 
Контакты: …»

— КАСКО: «Для классического КАСКО подготовим индивидуальное предложение по заявке. 
Контакты: …»

— Ипотека: «Страхование ипотеки… Оформить. 
Контакты: …»

— Страхование имущества (личное): «Подходит для квартиры, дома… Оформить онлайн. 
Контакты: …»

— Страхование имущества (коммерческое): «Подходит для офиса, склада… Оформить онлайн. 
Контакты: …»

— Путешествия: «Для путешествий за границу… Оформить полис для путешествий. 
Контакты: …»

Если запрос совпал с одним из ключевых слов (ОСАГО, КАСКО и т.п.), отдай готовый шаблон. 
Иначе дай краткий тематичный ответ. 
${ firstTime 
    ? 'Обязательно упомяни, что мы — операторы по обработке персональных данных, и дайте ссылку на политику: https://straxovka-go.ru/privacy' 
    : 'Не упоминайте политику конфиденциальности повторно.' 
}
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
      max_tokens: 200
    });
    return ctx.reply(resp.choices[0].message.content.trim());
  } catch (err) {
    console.error('OpenRouter Error:', err);
    return ctx.reply('Упс, ошибка при обращении к модели. Попробуйте позже.');
  }
});

// ─── 8) Запуск сервера и регистрация webhook ──────────────────────────
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
