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

// In-memory storage
const sessions = new Map();
const privacyMentioned = new Map();

// Express + healthcheck
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// Telegram + OpenRouter
const bot = new Telegraf(TELEGRAM_TOKEN);
const openai = new OpenAI({
  apiKey:  OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// 1) Виджеты
const services = {
  ОСАГО:                   "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740",
  "МИНИ-КАСКО":            "https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6",
  Ипотека:                 "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93",
  "Страхование имущества": "https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84",
  Путешествия:             "https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c"
};

// 2) Off-widget & blocked
const outsideTriggers = ["КАСКО ПО РИСКАМ","ТОТАЛ","УГОН","ДМС","СТРАХОВАНИЕ БИЗНЕСА"];
const outsideResp = `
К сожалению, этот вид онлайн-оформления не поддерживается.
Свяжитесь с нами:
📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37
`.trim();
const blockedTopics = ["ПОЛИТИКА","ЦЕРКОВЬ","РЕЛИГИЯ","ВОЙНА","ВЫБОРЫ","МЕДИЦИН","ЛЕКАРСТВО","ВРАЧ"];
const blockedResp = `
Извините, я не могу обсуждать эту тему.
📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru
`.trim();

// 3) Главное меню
bot.start(ctx => {
  const kb = Object.keys(services).map(k=>([{ text: k }]));
  return ctx.reply('👋 Здравствуйте! Я виртуальный помощник. Выберите услугу или задайте вопрос:', {
    reply_markup:{ keyboard:kb, resize_keyboard:true }
  });
});

// 4) Webhook
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 5) Универсальный хэндлер
bot.on('text', async ctx => {
  const txt   = ctx.message.text.trim();
  const up    = txt.toUpperCase();
  const cid   = String(ctx.chat.id);

  // init session
  let sess = sessions.get(cid);
  if (!sess) {
    sess = { history: [] };
    sessions.set(cid, sess);
  }

  // 5.1 Виджет-кнопка
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Оформление <b>${txt}</b>:`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶', url:services[txt] } ]]
        }
      }
    );
  }

  // 5.2 Off-widget
  if (outsideTriggers.some(tr=>up.includes(tr))) {
    return ctx.reply(outsideResp);
  }

  // 5.3 Блокировка
  if (blockedTopics.some(bt=>up.includes(bt))) {
    return ctx.reply(blockedResp);
  }

  // 5.4 Жёсткие шаблоны:

  // 1) ОСАГО для физлиц
  if (/КАК ОФОРМИТЬ ОСАГО|ОСАГО ДЛЯ ФИЗИЧЕСКИХ ЛИЦ/.test(up)) {
    return ctx.replyWithHTML(
      `Для физических лиц. ▶ Оформите ОСАГО онлайн — быстро и удобно. Чтобы надежно защитить себя от водителей без ОСАГО или с поддельными полисами, рекомендуем оформить КАСКО от Бесполисных — это быстрый и удобный способ получить расширенную защиту.
Если нужно классическое КАСКО — подготовим индивидуальное предложение по заявке.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
 Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶ Оформите ОСАГО онлайн', url:services['ОСАГО'] } ]]
        }
      }
    );
  }

  // 2) ОСАГО для юрлиц
  if (/КАК ОФОРМИТЬ ОСАГО ДЛЯ ЮРИДИЧЕСКИХ ЛИЦ|ОСАГО ДЛЯ ЮРЛИЦ/.test(up)) {
    return ctx.replyWithHTML(
      `Оформление ОСАГО для юридических лиц — доступно онлайн:
▶ Перейти к оформлению
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
 Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶ Перейти к оформлению', url:services['ОСАГО'] } ]]
        }
      }
    );
  }

  // 3) Мини-КАСКО
  if (/МИНИ[- ]?КАСКО|КАК ОФОРМИТЬ МИНИ[- ]?КАСКО/.test(up)) {
    return ctx.replyWithHTML(
      `МИНИ-КАСКО от Бесполисных покрывает ущерб в ДТП по вине третьих лиц, когда виновник не имеет ОСАГО или использует поддельный/просроченный полис.
Оформление через онлайн-виджет:
▶ Оформить МИНИ-КАСКО
Если нужна расширенная защита — классическое КАСКО по заявке.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
 Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶ Оформить МИНИ-КАСКО', url:services['МИНИ-КАСКО'] } ]]
        }
      }
    );
  }

  // 4) Ипотека
  if (/ИПОТЕК|КАК ОФОРМИТЬ ИПОТЕКУ/.test(up)) {
    return ctx.replyWithHTML(
      `Страхование ипотеки — защита по рискам имущества, жизни и титула с выгодой 10% для клиентов Сбербанка при оформлении через наше приложение.
Помните, банк страхует только конструктивные части вашего жилья. Чтобы полностью защитить дом — отделку, мебель и личные вещи — рекомендуем оформить дополнительное страхование с расширенным покрытием.
Мы поможем оформить быстро и удобно онлайн:
▶ Оформить
Если возникнут вопросы — всегда на связи:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку на странице виджета или пишите нам`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶ Оформить', url:services['Ипотека'] } ]]
        }
      }
    );
  }

  // 5) Имущество (личное)
  if (/КАК ЗАСТРАХОВАТЬ ИМУЩЕСТВО|ИМУЩЕСТВО/.test(up)) {
    return ctx.replyWithHTML(
      `Страхование имущества — личное. Подходит для квартиры, дома, апартаментов, комнаты, таунхауса, дома с участком, бани.
📌 Если объект недвижимости в ипотеке — выбирайте покрытие без конструктивных элементов. Это дополнит полис, оформленный для банка, и обеспечит полную защиту вашего имущества.
▶ Оформить онлайн`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶Оформить онлайн', url:services['Страхование имущества'] } ]]
        }
      }
    );
  }

  // 6) Имущество (коммерческое)
  if (/КОММЕРЧЕСКОЕ ИМУЩЕСТВО|КАК ЗАСТРАХОВАТЬ КОММЕРЧ/.test(up)) {
    return ctx.replyWithHTML(
      `Страхование имущества — коммерческое. Подходит для офиса, склада, магазина, производственных помещений.
Чтобы ознакомиться с перечнем рисков и рассчитать полис переходите в приложение.
▶ Оформить онлайн
Вы не нашли в приложении подходящий вариант ?
Оставьте нам заявку.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶ Оформить онлайн', url:services['Страхование имущества'] } ]]
        }
      }
    );
  }

  // 7) Путешествия
  if (/ПУТЕШЕСТВИЯ|КАК ОФОРМИТЬ ПОЛИС ДЛЯ ПУТЕШЕСТВИЙ/.test(up)) {
    return ctx.replyWithHTML(
      `Чтобы оформить страховой полис для путешествий за границу, пожалуйста, воспользуйтесь нашим приложением.Там вы сможете быстро выбрать параметры и оформить полис самостоятельно:
▶ Оформить полис для путешествий
Если возникнут вопросы — пишите, мы  всегда готовы помочь!
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru`,
      {
        reply_markup:{
          inline_keyboard:[[ { text:'▶ Оформить полис', url:services['Путешествия'] } ]]
        }
      }
    );
  }

  // 5.5) AI-fallback
  session.history.push({ role:'user', content:txt });
  const first = !privacyMentioned.get(cid);
  let sys = `
Ты — виртуальный ассистент Straxovka-Go, эксперт по страхованию.
Отвечай коротко, с эмпатией и призывом к действию.
`;
  if (first) {
    sys += `
Упомяни, что мы — операторы ПДн, и оставьте ссылку:
https://straxovka-go.ru/privacy
`;
    privacyMentioned.set(cid, true);
  } else {
    sys += "\nНе упоминай политику повторно.";
  }
  const msgs = [{ role:'system', content:sys.trim() }, ...session.history];

  try {
    const r = await openai.chat.completions.create({
      model:       'openai/gpt-4o-mini',
      messages:    msgs,
      temperature: 0.6,
      max_tokens: 200
    });
    const ans = r.choices[0].message.content.trim();
    session.history.push({ role:'assistant', content:ans });
    return ctx.reply(ans);
  } catch (e) {
    console.error("OpenRouter Error:", e);
    return ctx.reply("Упс, ошибка — попробуйте позже.");
  }
});

// 6) Launch + webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
