// api/broadcast.js
// ================================================================
// Vercel Serverless Function — Рассылка всем пользователям
// Вызывается из admin.html
// ================================================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const BROADCAST_SECRET = process.env.BROADCAST_SECRET; // секрет для защиты endpoint

// Пауза между сообщениями чтобы не превысить лимиты Telegram (30 msg/sec)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Получить всех пользователей из Supabase
async function getAllUsers() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bot_users?select=chat_id&limit=100000`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

// Отправить одно сообщение одному пользователю
async function sendToUser(chat_id, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${payload.method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, ...payload.body }),
  });
  const data = await res.json();
  // Если пользователь заблокировал бота — не считаем ошибкой
  if (!data.ok && data.error_code !== 403 && data.error_code !== 400) {
    console.error(`Failed for ${chat_id}:`, data.description);
  }
  return data.ok;
}

export default async function handler(req, res) {
  // CORS — разрешаем запросы из любого источника (в т.ч. локального файла)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Broadcast-Secret");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Проверка секрета
  const secret = req.headers["x-broadcast-secret"];
  if (!BROADCAST_SECRET || secret !== BROADCAST_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { type, text, caption, file_url, button_text, button_url, parse_mode } = req.body;

    if (!type) {
      return res.status(400).json({ error: "type is required" });
    }

    // Получаем всех пользователей
    const users = await getAllUsers();
    const total = users.length;

    if (total === 0) {
      return res.status(200).json({ ok: true, sent: 0, total: 0 });
    }

    // Строим inline keyboard если есть кнопка
    const reply_markup = (button_text && button_url)
      ? { inline_keyboard: [[{ text: button_text, url: button_url }]] }
      : undefined;

    // Строим payload в зависимости от типа
    function buildPayload(chat_id) {
      const pm = parse_mode || "HTML";

      if (type === "text") {
        return {
          method: "sendMessage",
          body: { text, parse_mode: pm, ...(reply_markup ? { reply_markup } : {}) },
        };
      }

      if (type === "photo") {
        return {
          method: "sendPhoto",
          body: {
            photo: file_url,
            ...(caption ? { caption, parse_mode: pm } : {}),
            ...(reply_markup ? { reply_markup } : {}),
          },
        };
      }

      if (type === "video") {
        return {
          method: "sendVideo",
          body: {
            video: file_url,
            ...(caption ? { caption, parse_mode: pm } : {}),
            ...(reply_markup ? { reply_markup } : {}),
          },
        };
      }

      if (type === "audio") {
        return {
          method: "sendAudio",
          body: {
            audio: file_url,
            ...(caption ? { caption, parse_mode: pm } : {}),
            ...(reply_markup ? { reply_markup } : {}),
          },
        };
      }

      if (type === "document") {
        return {
          method: "sendDocument",
          body: {
            document: file_url,
            ...(caption ? { caption, parse_mode: pm } : {}),
            ...(reply_markup ? { reply_markup } : {}),
          },
        };
      }

      // Fallback — просто текст
      return {
        method: "sendMessage",
        body: { text: text || caption || "—", parse_mode: pm },
      };
    }

    // Рассылаем с задержкой 35ms между сообщениями (~28/сек, в пределах лимита)
    let sent    = 0;
    let failed  = 0;

    for (const user of users) {
      const payload = buildPayload(user.chat_id);
      const ok = await sendToUser(user.chat_id, payload);
      if (ok) sent++; else failed++;
      await sleep(35);
    }

    return res.status(200).json({ ok: true, sent, failed, total });

  } catch (err) {
    console.error("Broadcast error:", err);
    return res.status(500).json({ error: err.message });
  }
}
