import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_ID = 938184349;
const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Проверяем initData от Telegram — это серверная проверка, её нельзя обойти
async function verifyTelegram(initData: string): Promise<number | null> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const encoder = new TextEncoder();

    // HMAC ключ из строки "WebAppData"
    const webAppKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Подписываем bot token этим ключом
    const secretBytes = await crypto.subtle.sign(
      "HMAC",
      webAppKey,
      encoder.encode(BOT_TOKEN)
    );

    // Финальный ключ для проверки данных
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      encoder.encode(dataCheckString)
    );

    const expectedHash = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (expectedHash !== hash) return null;

    const user = JSON.parse(params.get("user") || "{}");
    return user.id || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const { action, id, data, initData } = body;

    // 1. Проверяем Telegram подпись
    const userId = await verifyTelegram(initData || "");
    if (!userId || userId !== ADMIN_ID) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // 2. Выполняем операцию через service role (обходит RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (action === "delete") {
      const { error } = await supabase.from("clubs").delete().eq("id", id);
      if (error) throw error;
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (action === "update") {
      const { error } = await supabase.from("clubs").update(data).eq("id", id);
      if (error) throw error;
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
