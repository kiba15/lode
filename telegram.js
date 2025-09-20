import { Telegraf, Markup, session } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('❌ BOT_TOKEN не найден в .env!');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startTelegramBot(existingBot) {
  const bot = existingBot || new Telegraf(BOT_TOKEN);
  bot.use(session());

  const mainKeyboard = Markup.keyboard([
    ['✅ Добавить врача', '❌ Удалить врача'],
    ['📋 Ваши врачи'],
    ['📅 Следующие 7 дней', '📅 Предыдущие 7 дней'],
    ['🔄 Включить/Отключить мониторинг']
  ]).resize();

  function getUserPaths(userId) {
    const base = path.join(__dirname, 'users', userId.toString());
    fs.mkdirSync(base, { recursive: true });
    return {
      base,
      log: path.join(base, 'log.json'),
      doctors: path.join(base, 'doctors.json'),
      settings: path.join(base, 'settings.json'),
    };
  }

  function logMessage(userId, text) {
    const { log } = getUserPaths(userId);
    const timestamp = new Date().toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const logLine = `${timestamp}, ${userId}, ${text}\n`;
    fs.appendFileSync(log, logLine);
  }

  function getSettings(userId) {
    const { settings } = getUserPaths(userId);
    if (!fs.existsSync(settings)) {
      return { id: userId, monitoring: false };
    }

    try {
      const raw = fs.readFileSync(settings, 'utf-8').replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`Ошибка чтения settings.json: ${err.message}`);
      return { id: userId, monitoring: false };
    }
  }

  function saveSettings(userId, data) {
    const { settings } = getUserPaths(userId);
    fs.writeFileSync(settings, JSON.stringify(data, null, 2));
  }

  function getDoctorsObject(userId) {
    const { doctors } = getUserPaths(userId);
    if (!fs.existsSync(doctors)) {
      fs.writeFileSync(doctors, JSON.stringify({}, null, 2));
      return {};
    }

    try {
      const raw = fs.readFileSync(doctors, 'utf-8');
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        const converted = {};
        for (const name of parsed) {
          converted[name] = null;
        }
        fs.writeFileSync(doctors, JSON.stringify(converted, null, 2));
        return converted;
      }

      if (typeof parsed === 'object' && parsed !== null) return parsed;

      throw new Error('Неверный формат doctors.json');
    } catch (err) {
      console.error(`Ошибка чтения doctors.json: ${err.message}`);
      fs.writeFileSync(doctors, JSON.stringify({}, null, 2));
      return {};
    }
  }

  function saveDoctorsObject(userId, obj) {
    const { doctors } = getUserPaths(userId);
    fs.writeFileSync(doctors, JSON.stringify(obj, null, 2));
  }

  function getDateRange(offsetDays = 0) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(now.getTime() + offsetDays * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      label: `${start.toLocaleDateString()} — ${end.toLocaleDateString()}`
    };
  }

  async function sendLongMessage(ctx, message, options = {}) {
    const MAX_LENGTH = 4096;
    const lines = message.split('\n');
    let chunk = '';

    for (const line of lines) {
      if ((chunk + '\n' + line).length > MAX_LENGTH) {
        await ctx.reply(chunk.trim(), options);
        chunk = line;
      } else {
        chunk += '\n' + line;
      }
    }

    if (chunk.length > 0) {
      await ctx.reply(chunk.trim(), options);
    }
  }

  async function checkSchedule(ctx, userId, doctorsList, offset = 0) {
    const { startISO, endISO, label } = getDateRange(offset);

    const res = await fetch('https://z-api-lode.vot.by/getAllData?start=' + startISO + '&end=' + endISO);
    const data = await res.json();
    const slots = data.slots || data.tickets || [];
    const workers = data.workers || [];

    await ctx.reply(`📅 Расписание на: <b>${label}</b>`, { parse_mode: 'HTML' });

    for (const doctor of doctorsList) {
      const query = doctor.trim();
      const parts = query.toLowerCase().split(/\s+/);
      const worker = /^\d+$/.test(query)
        ? workers.find(w => String(w.id) === query)
        : workers.find(w =>
            parts.every(p =>
              (`${w.surname} ${w.name ?? ''} ${w.father ?? ''}`.toLowerCase().includes(p))
            )
          );

      if (!worker) {
        await ctx.reply(`⚠️ Врач <b>${query}</b> не найден`, { parse_mode: 'HTML' });
        continue;
      }

      const relevant = slots.filter(s => {
        if (s.worker_id !== worker.id) return false;
        const dt = new Date(`${s.date}T${s.time}:00`);
        return dt >= new Date(startISO) && dt <= new Date(endISO);
      });

      if (relevant.length === 0) {
        await ctx.reply(`ℹ️ Нет слотов у <b>${worker.surname} ${worker.name}</b>`, { parse_mode: 'HTML' });
      } else {
        const msg = `🟢 Слоты у <b>${worker.surname} ${worker.name}</b>:\n\n` +
          relevant.map(s => `${s.date} - ${s.time}`).join('\n');
        await sendLongMessage(ctx, msg, { parse_mode: 'HTML' });
      }
    }
  }

  bot.start(ctx => {
    const userId = ctx.from.id.toString();
    const { settings } = getUserPaths(userId);

    if (!fs.existsSync(settings)) {
      const userInfo = {
        id: ctx.from.id,
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || '',
        username: ctx.from.username || '',
        language_code: ctx.from.language_code || '',
        monitoring: false
      };
      fs.writeFileSync(settings, JSON.stringify(userInfo, null, 2));
      console.log(`🆕 Новый пользователь: ${userInfo.first_name} ${userInfo.last_name} (@${userInfo.username})`);
    }

    ctx.reply('👋 Добро пожаловать! Данный бот позволяет отслеживать свободные записи к врачам Лоде. Не болейте!', mainKeyboard);
  });

  bot.on('text', async ctx => {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text.trim();
    const lower = text.toLowerCase();

    logMessage(userId, text);
    ctx.session ??= {};
    const doctors = getDoctorsObject(userId);
    const doctorNames = Object.keys(doctors);
    const settingsData = getSettings(userId);

    if (lower === '📋 ваши врачи') {
      return ctx.reply(doctorNames.length ? doctorNames.join('\n') : '📭 Список пуст', mainKeyboard);
    }

    if (lower === '✅ добавить врача') {
      ctx.session.awaitingAdd = true;
      return ctx.reply('Введите Фамилию, Фамилию Имя или полное ФИО врача:');
    }

    if (ctx.session.awaitingAdd) {
      ctx.session.awaitingAdd = false;
      const input = text.trim();
      let allDoctors = [];

      try {
        const raw = fs.readFileSync(path.join(__dirname, 'doctors.json'), 'utf8');
        allDoctors = JSON.parse(raw);
      } catch (e) {
        console.error('❌ Ошибка загрузки doctors.json:', e.message);
        return ctx.reply('⚠️ Не удалось загрузить список врачей. Попробуйте позже.', mainKeyboard);
      }

      const query = input.toLowerCase();
      const parts = query.split(/\s+/);
      let matchedDoctor = null;

      if (/^\d+$/.test(query)) {
        matchedDoctor = allDoctors.find(d => String(d.id) === query);
      } else if (parts.length === 1) {
        matchedDoctor = allDoctors.find(d => d.surname?.toLowerCase() === parts[0]);
      } else if (parts.length === 2) {
        matchedDoctor = allDoctors.find(d =>
          d.surname?.toLowerCase() === parts[0] &&
          d.name?.toLowerCase() === parts[1]
        );
      } else if (parts.length >= 3) {
        matchedDoctor = allDoctors.find(d =>
          d.surname?.toLowerCase() === parts[0] &&
          d.name?.toLowerCase() === parts[1] &&
          d.father?.toLowerCase() === parts[2]
        );
      }

      if (!matchedDoctor) {
        return ctx.reply(`❌ Врач "${input}" не найден в базе`, mainKeyboard);
      }

      const displayName = `${matchedDoctor.surname} ${matchedDoctor.name ?? ''} ${matchedDoctor.father ?? ''}`.trim();

      if (!doctors.hasOwnProperty(displayName)) {
        doctors[displayName] = null;
        saveDoctorsObject(userId, doctors);
        return ctx.reply(`✅ Врач "${displayName}" добавлен`, mainKeyboard);
      } else {
        return ctx.reply(`ℹ️ Врач "${displayName}" уже есть в вашем списке`, mainKeyboard);
      }
    }

    if (lower === '❌ удалить врача') {
      ctx.session.awaitingDelete = true;
      return ctx.reply('Введите Фамилию, Фамилию Имя или полное ФИО врача для удаления:');
    }

    if (ctx.session.awaitingDelete) {
      ctx.session.awaitingDelete = false;
      const input = text.toLowerCase().trim();

      const matches = Object.keys(doctors).filter(name =>
        name.toLowerCase().includes(input)
      );

      if (matches.length === 0) {
        return ctx.reply('❗ Врач не найден', mainKeyboard);
      }

      for (const name of matches) {
        delete doctors[name];
      }

      saveDoctorsObject(userId, doctors);
      return ctx.reply(`✅ Удалено врачей: ${matches.length}\n${matches.join('\n')}`, mainKeyboard);
    }

    if (lower === '🔄 включить/отключить мониторинг') {
      settingsData.monitoring = !settingsData.monitoring;
      saveSettings(userId, settingsData);
      return ctx.reply(settingsData.monitoring ? '✅ Включено' : '⛔ Выключено', mainKeyboard);
    }

    if (lower.includes('следующие')) {
      ctx.session.offset = (ctx.session.offset || 0) + 7;
    } else if (lower.includes('предыдущие')) {
      ctx.session.offset = Math.max((ctx.session.offset || 0) - 7, 0);
    } else {
      return ctx.reply('🤖 Неизвестная команда', mainKeyboard);
    }

    if (doctorNames.length === 0) return ctx.reply('📭 Список ваших врачей пуст');
    await checkSchedule(ctx, userId, doctorNames, ctx.session.offset);
  });

  bot.launch();
  return bot;
}

export async function safeSendMessage(bot, userId, message, options = {}) {
  try {
    await bot.telegram.sendMessage(userId, message, options);
  } catch (err) {
    console.error(`❌ Ошибка отправки сообщения пользователю ${userId}: ${err.code || err.message}`);
  }
}