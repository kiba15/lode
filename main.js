import { startTelegramBot } from './telegram.js';
import { runMonitor } from './monitor.js'; // <-- правильный импорт
import dotenv from 'dotenv';

dotenv.config();

const MONITOR_INTERVAL_MINUTES = Number(process.env.MONITOR_INTERVAL_MINUTES || 10);

// 🟢 Запускаем Telegram-бота
startTelegramBot();

// ⏰ Запускаем мониторинг по таймеру
setTimeout(async function run() {
  await runMonitor(); // 👈 можно передать userId, если нужно
  setTimeout(run, MONITOR_INTERVAL_MINUTES * 60 * 1000);
}, 5000);