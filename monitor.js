import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import { getAllDoctors } from './doctors.js'; // <--- добавлено

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('❌ BOT_TOKEN не найден в .env');

const bot = new Telegraf(BOT_TOKEN);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_DIR = path.join(__dirname, 'users');
const DOCTORS_CACHE_FILE = path.join(__dirname, 'doctors.json');

const START_DATE = new Date().toISOString();
const END_DATE = new Date(new Date().setMonth(new Date().getMonth() + 3)).toISOString();
const API_URL = `https://z-api-lode.vot.by/getAllData?start=${START_DATE}&end=${END_DATE}`;

// Безопасная отправка сообщений
async function safeSendMessage(userId, text, options = {}) {
  try {
    await bot.telegram.sendMessage(userId, text, options);
  } catch (err) {
    console.error(`⚠️ Ошибка отправки сообщения ${userId}:`, err.code || err.message);
  }
}

// Получить список пользователей с включённым мониторингом
function getUsersWithMonitoring() {
  const users = [];
  if (!fs.existsSync(USERS_DIR)) return users;

  for (const userId of fs.readdirSync(USERS_DIR)) {
    const userDir = path.join(USERS_DIR, userId);
    const settingsPath = path.join(userDir, 'settings.json');

    if (!fs.existsSync(settingsPath)) continue;

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.monitoring) {
        users.push(userId);
      }
    } catch (e) {
      console.error(`⚠️ Ошибка чтения settings для ${userId}:`, e.message);
    }
  }

  return users;
}

// Получить все слоты
async function getAllSlots() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    return data.slots || data.tickets || [];
  } catch (err) {
    console.error('❌ Ошибка загрузки слотов с API:', err.message);
    return [];
  }
}

// Найти врача по ФИО или ID
function findDoctor(query, workers) {
  query = query.toLowerCase().trim();
  const parts = query.split(/\s+/);

  if (/^\d+$/.test(query)) {
    return workers.find(w => String(w.id) === query);
  }

  return workers.find(w =>
    parts.every(p =>
      (`${w.surname} ${w.name ?? ''} ${w.father ?? ''}`.toLowerCase().includes(p))
    )
  );
}

// Сравнение слотов
function diffSlots(oldSlots, newSlots) {
  const serialize = (s) => `${s.date}_${s.time}`;
  const oldSet = new Set((oldSlots || []).map(serialize));
  const newSet = new Set((newSlots || []).map(serialize));

  const added = [...newSet].filter(x => !oldSet.has(x));
  const removed = [...oldSet].filter(x => !newSet.has(x));

  return { added, removed };
}

function formatSlots(slots) {
  return slots
    .slice(0, 20)
    .map(s => s.replace('_', ' — '))
    .join('\n');
}

// Обработка одного пользователя
async function processUser(userId, workers, slots) {
  const userDir = path.join(USERS_DIR, userId);
  const doctorsFile = path.join(userDir, 'doctors.json');

  if (!fs.existsSync(doctorsFile)) return;

  let doctorsData;
  try {
    doctorsData = JSON.parse(fs.readFileSync(doctorsFile, 'utf8'));
  } catch (e) {
    console.error(`⚠️ Ошибка чтения doctors.json для ${userId}:`, e.message);
    return;
  }

  let updated = false;

  for (const doctorName of Object.keys(doctorsData)) {
    const prevSlots = Array.isArray(doctorsData[doctorName]) ? doctorsData[doctorName] : [];

    const doctor = findDoctor(doctorName, workers);
    if (!doctor) {
      await safeSendMessage(userId, `⚠️ Врач "${doctorName}" не найден`);
      continue;
    }

    const currentSlots = slots
      .filter(s => s.worker_id === doctor.id)
      .map(s => ({ date: s.date, time: s.time }));

    const { added, removed } = diffSlots(prevSlots, currentSlots);

    if (prevSlots.length > 0 && currentSlots.length === 0) {
      await safeSendMessage(userId, `ℹ️ У врача ${doctor.surname} ${doctor.name} больше нет свободных слотов.`);
      updated = true;
    }

    if (removed.length > 0) {
      await safeSendMessage(
        userId,
        `🔻 У врача ${doctor.surname} ${doctor.name} удалены слоты:\n` +
        formatSlots(removed) +
        (removed.length > 20 ? '\n...и другие' : '')
      );
      updated = true;
    }

    if (added.length > 0) {
      await safeSendMessage(
        userId,
        `🆕 У врача ${doctor.surname} ${doctor.name} появились новые слоты:\n` +
        formatSlots(added) +
        (added.length > 20 ? '\n...и другие' : '')
      );
      updated = true;
    }

    doctorsData[doctorName] = currentSlots.length > 0 ? currentSlots : null;
  }

  if (updated) {
    try {
      fs.writeFileSync(doctorsFile, JSON.stringify(doctorsData, null, 2));
    } catch (e) {
      console.error(`⚠️ Не удалось сохранить обновлённый doctors.json для ${userId}:`, e.message);
    }
  }
}

// Запуск мониторинга
export async function runMonitor() {
  const users = getUsersWithMonitoring();
  console.log(`📘 Пользователей с мониторингом: ${users.length}`);
  console.log(`🌐 API: ${API_URL}`);

  if (users.length === 0) return;

  const workers = await getAllDoctors();
  const slots = await getAllSlots();

  for (const userId of users) {
    try {
      await processUser(userId, workers, slots);
    } catch (err) {
      console.error(`❌ Ошибка при обработке пользователя ${userId}:`, err.message);
    }
  }

  const now = new Date().toLocaleString('ru-RU');
  console.log(`✅ Мониторинг завершён: ${now}`);
}

// CLI запуск
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMonitor();
}