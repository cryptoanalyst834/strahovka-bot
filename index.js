import 'dotenv/config';
import express      from 'express';
import { Telegraf } from 'telegraf';

const {
  TELEGRAM_TOKEN,
  DOMAIN,
  PORT = 8080
} = process.env;

if (!TELEGRAM_TOKEN || !DOMAIN) {
  console.error('❌ Задайте TELEGRAM_TOKEN и DOMAIN в env');
  process.exit(1);
}

// Express + healthcheck
const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.send('OK'));

// Telegram bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// 1) Виджеты
const services = {
  ОСАГО:                   "https://widgets.inssmart.ru/contract/eosago?appId=bbac9045-39c4-5530-a953-d63f4d081fe0&secret=2d2759bd-a1b0-57a7-803b-520c1a262740",
  "МИНИ-КАСКО":            "https://widgets.inssmart.ru/contract/kasko?appId=293563a6-dcb8-543c-84a7-7a455578884f&secret=5d05ad7d-7fc6-58b8-8851-6de24394a0a6",
  Ипотека:                 "https://widgets.inssmart.ru/contract/mortgage?appId=e06a1d3f-604c-52d2-bc8a-b9b8e2e7e167&secret=695aa6ff-001b-52ec-99de-0dbd38762b93",
  "Страхование имущества": "https://widgets.inssmart.ru/contract/property?appId=34daded4-ba8c-5e60-883b-bddd168b35b0&secret=ff271c00-fb5a-5de2-9b9e-fcfb8660da84",
  Путешествия:             "https://widgets.inssmart.ru/contract/travel?appId=a8bf576a-c303-5c66-8952-5a2a5bcf0b04&secret=95f250f5-b561-5593-99ad-575fec648e4c"
};

// 2) Off-widget & blocked
const outsideTriggers = [
  "КАСКО ПО РИСКАМ","ТОТАЛ","УГОН","ДМС","СТРАХОВАНИЕ БИЗНЕСА",
  "УЩЕРБ","ПОДХОДИТ ДЛЯ БАНКА","ДОБРОВОЛЬНОЕ МЕДИЦИНСКОЕ СТРАХОВАНИЕ"
];
const outsideResp = `
К сожалению, этот вид онлайн-оформления не поддерживается.
Свяжитесь с нами:
📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru  
📱 WhatsApp: +7 989 120 66 37
`.trim();

const blockedTopics = [
  "ПОЛИТИКА","РЕЛИГИЯ","ВОЙНА","ВЫБОРЫ",
  "МЕДИЦИН","ЛЕКАРСТВО","ВРАЧ"
];
const blockedResp = `
Извините, я не могу обсуждать эту тему.
📧 info@straxovka-go.ru  
🌐 https://straxovka-go.ru
`.trim();

// 3) Главное меню
bot.start(ctx => {
  const keyboard = Object.keys(services).map(k => ([{ text: k }]));
  return ctx.reply(
    '👋 Здравствуйте! Я виртуальный помощник. Выберите услугу или задайте вопрос:',
    { reply_markup: { keyboard, resize_keyboard: true } }
  );
});

// 4) Webhook
app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body, res).catch(console.error);
});

// 5) Универсальный хэндлер: только шаблоны и контакты
bot.on('text', ctx => {
  const txt = ctx.message.text.trim();
  const up  = txt.toUpperCase();

  // 5.1 Виджет-кнопка
  if (services[txt]) {
    return ctx.replyWithHTML(
      `Оформление <b>${txt}</b>:`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ оформить', url: services[txt] }
          ]]
        }
      }
    );
  }

  // 5.2 Off-widget
  if (outsideTriggers.some(tr => up.includes(tr))) {
    return ctx.reply(outsideResp);
  }

  // 5.3 Блокировка
  if (blockedTopics.some(bt => up.includes(bt))) {
    return ctx.reply(blockedResp);
  }

  // 5.4 Жёсткие шаблоны:

  // 1) ОСАГО для физлиц
  if (/КАК ОФОРМИТЬ ОСАГО|ОСАГО ДЛЯ ФИЗИЧЕСКИХ/.test(up)) {
    return ctx.replyWithHTML(
      `Для физических лиц. Оформите ОСАГО онлайн — быстро и удобно. Чтобы надежно защитить себя от водителей без ОСАГО или с поддельными полисами, рекомендуем оформить КАСКО от Бесполисных — это быстрый и удобный способ получить расширенную защиту.
Если нужно классическое КАСКО — подготовим индивидуальное предложение по заявке.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
Если возникли вопросы или сложности с оформлением через виджет — обращайтесь в поддержку.`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Оформите ОСАГО онлайн', url: services['ОСАГО'] }
          ]]
        }
      }
    );
  }

  // 2) ОСАГО для юрлиц
  if (/ОСАГО ДЛЯ ЮРИДИЧЕСКИХ ЛИЦ|КАК ОФОРМИТЬ ОСАГО ДЛЯ ЮР/.test(up)) {
    return ctx.replyWithHTML(
      `Оформление ОСАГО для юридических лиц — доступно онлайн:
▶ Перейти к оформлению
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru
Если возникли вопросы — обращайтесь в поддержку.`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Перейти к оформлению', url: services['ОСАГО'] }
          ]]
        }
      }
    );
  }

  // 3) МИНИ-КАСКО
  if (/МИНИ[- ]?КАСКО|КАК ОФОРМИТЬ МИНИ/.test(up)) {
    return ctx.replyWithHTML(
      `МИНИ-КАСКО от Бесполисных покрывает ущерб в ДТП по вине третьих лиц, когда виновник не имеет ОСАГО или использует поддельный/просроченный полис.
▶ Оформить МИНИ-КАСКО
Если нужна расширенная защита — классическое КАСКО по заявке.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Оформить МИНИ-КАСКО', url: services['МИНИ-КАСКО'] }
          ]]
        }
      }
    );
  }

  // 4) Ипотека
  if (/ИПОТЕК|КАК ОФОРМИТЬ ИПОТЕКУ/.test(up)) {
    return ctx.replyWithHTML(
      `Страхование ипотеки — защита по рискам имущества, жизни и титула с выгодой 10% для клиентов Сбербанка при оформлении через наше приложение.
▶ Оформить ипотеку`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Оформить ипотеку', url: services['Ипотека'] }
          ]]
        }
      }
    );
  }

  // 5) Личное имущество
  if (/КАК ЗАСТРАХОВАТЬ ИМУЩЕСТВО|ИМУЩЕСТВО/.test(up)) {
    return ctx.replyWithHTML(
      `Страхование имущества — личное. Подходит для квартиры, дома, апартаментов, комнаты, таунхауса, дома с участком, бани.
📌 Если объект в ипотеке — выбирайте покрытие без конструктивных элементов.
▶ Оформить онлайн`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Оформить онлайн', url: services['Страхование имущества'] }
          ]]
        }
      }
    );
  }

  // 6) Коммерческое имущество
  if (/КОММЕРЧЕСКОЕ ИМУЩЕСТВО|КАК ЗАСТРАХОВАТЬ КОММЕРЧ/.test(up)) {
    return ctx.replyWithHTML(
      `Страхование имущества — коммерческое. Подходит для офиса, склада и т. д.
▶ Оформить онлайн
Если не нашли подходящий вариант — оставьте заявку.
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Оформить онлайн', url: services['Страхование имущества'] }
          ]]
        }
      }
    );
  }

  // 7) Путешествия
  if (/ПУТЕШЕСТВИЯ|КАК ОФОРМИТЬ ПОЛИС ДЛЯ ПУТЕШЕСТВИЙ/.test(up)) {
    return ctx.replyWithHTML(
      `Чтобы оформить страховой полис для путешествий за границу, воспользуйтесь приложением:
▶ Оформить полис для путешествий
Если возникнут вопросы — пишите, мы всегда готовы помочь!
Контакты:
 🌐 straxovka-go.ru
 📲 WhatsApp: +7 989 120 66 37
 📧 info@straxovka-go.ru`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '▶ Оформить полис для путешествий', url: services['Путешествия'] }
          ]]
        }
      }
    );
  }

  // 5.5) Фолбэк: предложить выбрать одну из услуг
  return ctx.reply(
    'Пожалуйста, выберите одну из услуг или задайте вопрос\n' +
    'Вы можете уточнить любой вопрос, свяжитесь с нами:\n' +
    'Контакты:
  📧 info@straxovka-go.ru  
  🌐 https://straxovka-go.ru  
  📱 +7 989 120 66 37'
  );
});

// 6) Запуск + webhook
app.listen(PORT, async () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
  await bot.telegram.setWebhook(`${DOMAIN}/webhook`);
  console.log(`✅ Webhook registered at ${DOMAIN}/webhook`);
});
