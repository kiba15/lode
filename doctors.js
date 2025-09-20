// doctors.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCTORS_CACHE_FILE = path.join(__dirname, 'doctors.json');

const START_DATE = new Date().toISOString();
const END_DATE = new Date(new Date().setMonth(new Date().getMonth() + 3)).toISOString();
const API_URL = `https://z-api-lode.vot.by/getAllData?start=${START_DATE}&end=${END_DATE}`;

/**
 * Загружает и сохраняет список всех врачей в `doctors.json`.
 * @param {boolean} forceUpdate - если true, то принудительно перезапрашивает данные с API
 * @returns {Promise<Array>} - массив врачей
 */
export async function getAllDoctors(forceUpdate = false) {
  let cached = [];
  let fromCache = false;

  // 1. Чтение кэша
  if (!forceUpdate && fs.existsSync(DOCTORS_CACHE_FILE)) {
    try {
      cached = JSON.parse(fs.readFileSync(DOCTORS_CACHE_FILE, 'utf8'));
      if (Array.isArray(cached)) {
        fromCache = true;
      }
    } catch (e) {
      console.warn('⚠️ Ошибка чтения doctors.json, будет перезагружен...');
    }
  }

  // 2. Запрос API
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    const workers = data.workers || [];

    // 3. Сравнение длины
    if (!fromCache || cached.length !== workers.length) {
      fs.writeFileSync(DOCTORS_CACHE_FILE, JSON.stringify(workers, null, 2), 'utf8');
      console.log(`📄 doctors.json обновлён (${workers.length} записей)`);
    }

    return workers;
  } catch (err) {
    console.error('❌ Ошибка загрузки данных врачей с API:', err.message);
    return cached; // ⬅️ возвращаем старый кэш, если API упало
  }
}