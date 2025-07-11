import 'dotenv/config';
import express           from 'express';
import { Telegraf }      from 'telegraf';
import OpenAI            from 'openai';

const {
  TELEGRAM_TOKEN,
  OPENROUTER_API_KEY,
  DOMAIN,
  PORT = 8080
} = process.env;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY || !DOMAIN) {
  console.error('❌ Set TELEGRAM_TOKEN, OPENROUTER_API_KEY and DOMAIN in env');
  process.exit(1);
}

// simple in-memory session & privacy tracking
const sessions = new Map();
const privacyMentioned = new Map();

// 1) Express + healthcheck + webhook endpoint
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// 2) Telegram bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// 3) OpenRouter client
const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 4) Widget links
const services = {
  "ОСАГО":                   "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740",
  "МИНИ-КАСКО":              "https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6",
  "Ипотека":                 "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93",
  "Страхование имущества":   "https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84",
  "Путешествия":             "https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c"
};

// 5) Off-widget topics
const outsideTriggers = [
  "КАСКО ПО РИСКАМ","ТОТАЛ","УГОН","ДМС","СТРАХОВАНИЕ БИЗНЕСА","УЩЕРБ","ДОБРОВОЛЬНОЕ МЕДИЦИНСКОЕ СТРАХОВАНИЕ"

];
const outsideWidgetResponse = `
К сожалению, нужный вид страхования в онлайн-приложении не представлен. Рекомендуем связаться с нашей компанией для индивидуального подбора:
📧 info@straxovka-go.ru
🌐 https://straxovka-go.ru
📱 WhatsApp: +7 989 120 66 37

`.trim();

// 6) Insurance keywords
const insuranceKeywords = [
  "ОСАГО","КАСКО","ДМС","ИПОТЕКА","ИМУЩЕСТВО",
  "СТРАХОВАНИЕ","ПОЛИС","ДОКУМЕНТ","ДТП","СТОИМОСТЬ","ПУТЕШЕСТВИЕ","ПОДРОБНЕЕ","ПРОДОЛЖИ"
];

// 7) Topics to block
const blockedTopics = [
  // politics
  "ПОЛИТИКА","ПРАВИТЕЛЬСТВО","ВЫБОРЫ","МИЛИТАР","ВОЙНА",
  // religion
  "БОГ","ЦЕРКОВЬ","РЕЛИГИЯ","МОЛИТВА","ИСТИНО","СВЯТОЕ",
  // medicine
  "ЛЕКАРСТВО","БОЛЕЗН","МЕДИЦИН","ВРАЧ","ЛЕЧЕНИЕ"
];
const blockedResponse = `
Извините, я не могу обсуждать эту тему.
Если нужны консультации, пожалуйста, свяжитесь с нами:
📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
`.trim();

// 8) /start — menu
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    "👋 Здравствуйте! Я ваш виртуальный помощник. " +
    "Выберите услугу или задайте вопрос:",
    { reply_markup:{ keyboard, resize_keyboard:true } }
  );
});

// 9) Webhook
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 10) Text handler
bot.on('text', async ctx => {
  const txt = ctx.message.text.trim();
  const chatId = String(ctx.chat.id);
  const upper = txt.toUpperCase();

  // 10.1 widget button
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Оформление <b>${txt}</b> здесь:`,
      { reply_markup:{ inline_keyboard:
        [[{ text:'▶ Открыть виджет', url:services[txt] }]]
      } }
    );
  }

  // 10.2 off-widget
  if (outsideTriggers.some(tr => upper.includes(tr))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 10.3 blocked topics
  if (blockedTopics.some(bt => upper.includes(bt))) {
    return ctx.reply(blockedResponse);
  }

  // 10.4 not insurance → off-widget
  if (!insuranceKeywords.some(kw => upper.includes(kw))) {
    return ctx.reply(outsideWidgetResponse);
  }

  // 10.5 AI session
  let session = sessions.get(chatId);
  if (!session) {
    session = { history: [] };
    sessions.set(chatId, session);
  }
  session.history.push({ role:'user', content:txt });

  const firstTime = !privacyMentioned.get(chatId);
  let systemPrompt = `
Ты — виртуальный sales-ассистент Straxovka-Go, эксперт по страхованию, имеешь опыт работы марткетологом более 5 лет. Ведешь и поддерживаешь диалог с клиентом. Общаешься дружелюбно.
Цели:
• Закрыть страхи и боли клиента.
• Показать выгоды (экономия, скорость).
• Подтолкнуть к оформлению страховки.

Стиль: коротко, дружелюбно, профессионально, по делу.
Примеры условий диалога:
1) Если клиент спрашивает "Какие документы нужны", сначала уточни услугу (ОСАГО, МИНИ-КАСКО, Ипотека, Страхование имущества, Путешествия).
2) Если услуга известна, перечисли документы для неё.
3) Если клиент запрашивает оформление вида, которого нет в виджетах (ДМС, бизнес-страхование, автолизинг), предложи консультацию:
   «Пожалуйста, свяжитесь с нами по телефону +7 989 120 66 37, email info@straxovka-go.ru или оставьте заявку на сайте https://straxovka-go.ru».
4) При вопросах о ДТП/убытках уточни страховую компанию и дай инструкцию по европротоколу или обращению в страховую.
5) Не предлагай никакие другие каналы, кроме наших консультаций.
6) Без запроса не присылает никакие документы.
Примеры диалога:
1. Вропрос: Как оформить осаго?
Ответ: Для физических лиц
Оформите ОСАГО онлайн — быстро и удобно:
Перейти к оформлению
Чтобы надежно защитить себя от водителей без ОСАГО или с поддельными полисами, рекомендуем оформить КАСКО от Бесполисных — это быстрый и удобный способ получить расширенную защиту.
Если нужно классическое КАСКО — подготовим индивидуальное предложение по заявке.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите нам 
2. Вопрос: Как оформить МИНИ-КАСКО?
Ответ: Мини-каско от Бесполисных покрывает ущерб в ДТП по вине третьих лиц,  когда виновник не имеет ОСАГО или использует поддельный либо просроченный полис.
Оформление происходит быстро и удобно через онлайн-виджет:
Оформить МИНИ-КАСКО
Если нужна расширенная защита — классическое КАСКО по заявке.
Контакты для связи:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите нам 
3. Вопрос: как оформить ипотеку?
Ответ: Страхование ипотеки — защита по рискам имущества, жизни и титула с выгодой 10% для клиентов Сбербанка при оформлении через наше приложение.
Помните, банк страхует только конструктивные части вашего жилья. Чтобы полностью защитить дом — отделку, мебель и личные вещи — рекомендуем оформить дополнительное страхование с расширенным покрытием.
Мы поможем оформить быстро и удобно онлайн:
Оформить
Если возникнут вопросы — всегда на связи:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
________________________________________
Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите нам 
4. Вопрос: как оформить срахование имущества?
Ответ: Страхование имущества — личное
Подходит для квартиры, дома, апартаментов, комнаты, таунхауса, дома с участком, бани.

📌 Если объект недвижимости в ипотеке — выбирайте покрытие без конструктивных элементов. Это дополнит полис, оформленный для банка, и обеспечит полную защиту вашего имущества.
Оформить онлайн
________________________________________
Страхование имущества — коммерческое
Подходит для офиса, склада, магазина, производственных помещений.
Чтобы ознакомиться с перечнем рисков и рассчитать полис переходите в приложение.
 Оформить онлайн
________________________________________
Вы не нашли в приложении подходящий вариант ?
Оставьте нам заявку.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
5. Вопрос: как оформить страховой полис путешествия?
Ответ: Чтобы оформить страховой полис для путешествий за границу, пожалуйста, воспользуйтесь нашим приложением.Там вы сможете быстро выбрать параметры и оформить полис самостоятельно:
Оформить полис для путешествий
Если возникнут вопросы — пишите, мы  всегда готовы помочь!
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
`;
  if (firstTime) {
    systemPrompt += `
Единожды в первом ответе упомяни, что мы — операторы ПДн, и дай ссылку:
https://straxovka-go.ru/privacy
`;
    privacyMentioned.set(chatId, true);
  } else {
    systemPrompt += "\nНе упоминай политику повторно.";
  }

  // build messages
  const messages = [
    { role:'system', content:systemPrompt.trim() },
    ...session.history
  ];

  try {
    const resp = await openai.chat.completions.create({
      model:       'openai/gpt-4o', // or your OpenRouter endpoint
      messages,
      temperature: 0.7,
      max_tokens: 150
    });
    const answer = resp.choices[0].message.content.trim();
    session.history.push({ role:'assistant', content:answer });
    return ctx.reply(answer);
  } catch (err) {
    console.error("OpenRouter Error:", err);
    return ctx.reply("Упс, ошибка при обращении к модели. Попробуйте позже.");
  }
});

// 11) Launch + webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
