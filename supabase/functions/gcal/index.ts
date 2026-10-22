import { admin, cors, json, userFromReq, cfg } from "./_shared/core.ts";
import { gcalSync, gcalEvents } from "./_shared/gcal.ts";

const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/gcal`;

async function hmac(text: string, key: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const secret = (await cfg(db, "cron_secret"))!;
  const url = new URL(req.url);

  // OAuth callback від Google
  if (req.method === "GET" && url.searchParams.get("state")) {
    const [uid, sig] = (url.searchParams.get("state") || "").split(".");
    if (sig !== await hmac(uid, secret)) return new Response("Bad state", { status: 400 });
    const code = url.searchParams.get("code");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code || "", client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        redirect_uri: redirectUri(), grant_type: "authorization_code",
      }),
    });
    const j = await r.json();
    const { data: p } = await db.from("params").select("app_url").eq("user_id", uid).single();
    const back = (p?.app_url || "/") + "#settings";
    if (!r.ok || !j.refresh_token) {
      return new Response(`<meta charset="utf-8"><p>Помилка Google: ${j.error_description || j.error || "немає refresh_token"}</p><a href="${back}">Назад</a>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    await db.from("user_secrets").update({ google_refresh_token: j.refresh_token, gcal_last_sync: null }).eq("user_id", uid);
    return new Response(null, { status: 302, headers: { Location: back + "?gcal=ok" } });
  }

  const user = await userFromReq(db, req);
  if (!user) return json({ error: "Не авторизовано" }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "auth_url") {
      if (!Deno.env.get("GOOGLE_CLIENT_ID")) return json({ error: "Немає GOOGLE_CLIENT_ID у секретах Supabase" }, 400);
      const state = `${user.id}.${await hmac(user.id, secret)}`;
      const q = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, redirect_uri: redirectUri(), response_type: "code",
        scope: "https://www.googleapis.com/auth/calendar.events", access_type: "offline", prompt: "consent", state,
      });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    }
    if (body.action === "status") {
      const { data } = await db.from("user_secrets").select("google_refresh_token,gcal_last_sync,mono_last_sync,mono_webhook_set,mono_backfill").eq("user_id", user.id).single();
      return json({
        google: !!data?.google_refresh_token, gcal_last_sync: data?.gcal_last_sync, mono_last_sync: data?.mono_last_sync,
        mono_webhook: data?.mono_webhook_set, mono_backfill_left: (data?.mono_backfill || []).length,
        has: { anthropic: !!Deno.env.get("ANTHROPIC_API_KEY"), mono: !!Deno.env.get("MONO_TOKEN"), google: !!Deno.env.get("GOOGLE_CLIENT_ID") },
        vapid: await cfg(db, "vapid_public"),
      });
    }
    if (body.action === "sync") return json(await gcalSync(db, user.id));
    if (body.action === "events") return json({ events: await gcalEvents(db, user.id, body.from, body.to) });
    if (body.action === "disconnect") {
      await db.from("user_secrets").update({ google_refresh_token: null }).eq("user_id", user.id);
      return json({ ok: true });
    }
    return json({ error: "Невідома дія" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
