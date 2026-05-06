// api/webhook.js
// ================================================================
// Vercel Serverless Function — Telegram Webhook
// Принимает события от Telegram, сохраняет пользователей, отвечает на /start
// ================================================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const APP_URL        = "https://pc-clubs-miniapp.vercel.app/";

// Отправить сообщение через Telegram Bot API
async function sendMessage(chat_id, text, extra = {}) {
  const body = {
    chat_id,
    text,
    parse_mode: "HTML",
    ...extra,
  };
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Сохранить пользователя в Supabase
async function saveUser(chat_id, first_name, username) {
  await fetch(`${SUPABASE_URL}/rest/v1/bot_users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates", // не перезаписывать если уже есть
    },
    body: JSON.stringify({ chat_id, first_name, username }),
  });
}

export default async function handler(req, res) {
  // Telegram шлёт только POST
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body;
    const message = update?.message;

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const chat_id    = message.chat.id;
    const first_name = message.from?.first_name || "";
    const username   = message.from?.username   || "";
    const text       = message.text || "";

    // Сохраняем пользователя при любом сообщении
    await saveUser(chat_id, first_name, username);

    // Обработка команды /start
    if (text === "/start") {
      await sendMessage(
        chat_id,
        `👋 Привет, <b>${first_name}</b>!\n\n🎮 Добро пожаловать в <b>PC Clubs</b> — каталог лучших компьютерных клубов.\n\nНайди клуб рядом с тобой, сравни цены и характеристики ПК!`,
        {
          reply_markup: {
            inline_keyboard: [[
              {
                text: "🎮 Открыть каталог",
                web_app: { url: APP_URL },
              },
            ]],
          },
        }
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: true }); // всегда 200 для Telegram
  }
}
