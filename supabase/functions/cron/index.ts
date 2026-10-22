import {
  admin, json, cfg, loadState, contextText, claude, monthSpendUSD, PERSONA, MODEL_FAST, MODEL_DEEP,
  localNow, sendPush, applyMonoItem, monoClientInfo,
} from "./_shared/core.ts";
import { gcalSync } from "./_shared/gcal.ts";

async function brief(db: any, uid: string, weekly: boolean) {
  const st = await loadState(db, uid);
  const spent = await monthSpendUSD(db, uid);
  const budget = Number(st.params.ai_budget_usd || 5);
  const useDeep = weekly && spent < budget * 0.7;
  const ctx = await contextText(db, uid, st, { weekly });
  const task = weekly
    ? `Зроби НЕДІЛЬНИЙ ОГЛЯД тижня і план на наступний. Структура (markdown, коротко):
## Гроші — рух тижня, бюджет місяця (де перевищення), прогрес по ліміту і подушці, що змінилось у прогнозі.
## Задачі й звички — що виконано, що провисло.
## 3 рекомендації — конкретні, з цифрами (де зрізати, скільки змін, що з нішами).
## План на тиждень — 3–5 пунктів.`
    : `Зроби РАНКОВИЙ БРИФ (6–10 рядків, markdown, без заголовка):
- головні задачі на сьогодні (прострочені — першими),
- гроші: платежі в найближчі 3 дні, скільки днів до кінця пільгового періоду Моно, перевищення бюджету якщо є,
- звички на сьогодні,
- одна порада на день (гроші/енергія/фокус).`;
  if (spent >= budget) {
    return { title: weekly ? "Огляд тижня" : "Бриф", text: "Ліміт AI на місяць вичерпано — бриф без Claude. Відкрий «Сьогодні»." };
  }
  const out = await claude(db, uid, {
    model: useDeep ? MODEL_DEEP : MODEL_FAST, max_tokens: weekly ? 1800 : 700,
    system: PERSONA + "\n\nКОНТЕКСТ:\n" + ctx,
    messages: [{ role: "user", content: task }],
  });
  const text = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
  return { title: weekly ? "Огляд тижня" : "Ранковий бриф", text };
}

Deno.serve(async (req) => {
  const db = admin();
  const secret = await cfg(db, "cron_secret");
  const url = new URL(req.url);
  if (req.headers.get("x-cron-secret") !== secret && url.searchParams.get("k") !== secret) return json({ error: "forbidden" }, 403);
  const uid = await cfg(db, "owner_uid");
  if (!uid) return json({ ok: true, note: "no owner yet" });
  const force = url.searchParams.get("force"); // brief | weekly
  const log: string[] = [];
  const now = localNow();
  const { data: p } = await db.from("params").select("*").eq("user_id", uid).single();
  const { data: sec } = await db.from("user_secrets").select("*").eq("user_id", uid).single();

  // 1) Бриф / тижневий огляд
  try {
    const due = now.time >= String(p.brief_time).slice(0, 5) && p.last_brief_date !== now.date;
    if (due || force) {
      const weekly = force === "weekly" || (!force && now.dow === 0);
      await db.from("params").update({ last_brief_date: now.date }).eq("user_id", uid);
      const b = await brief(db, uid, weekly);
      await db.from("ai_messages").insert({ user_id: uid, role: "brief", content: `**${b.title}, ${now.date}**\n\n${b.text}` });
      const first = b.text.replace(/[#*_>-]/g, "").split("\n").map((s: string) => s.trim()).filter(Boolean)[0] || "";
      await sendPush(db, uid, b.title, first.slice(0, 140), "./#claude");
      log.push("brief " + (weekly ? "weekly" : "daily"));
    }
  } catch (e) { log.push("brief error: " + (e as Error).message); }

  // 2) Нагадування про важливі дати (раз на день, разом з брифом)
  try {
    if (now.time >= "09:00" && now.time < "09:15") {
      const { data: dates } = await db.from("important_dates").select("*").eq("user_id", uid);
      for (const d of dates || []) {
        let dt = new Date(d.date + "T12:00:00");
        if (d.yearly) { dt.setFullYear(Number(now.date.slice(0, 4))); if (dt < new Date(now.date + "T00:00:00")) dt.setFullYear(dt.getFullYear() + 1); }
        const days = Math.round((dt.getTime() - new Date(now.date + "T12:00:00").getTime()) / 864e5);
        if (days === Number(d.remind_days) || days === 1 || days === 0) {
          await sendPush(db, uid, days === 0 ? "Сьогодні" : `Через ${days} дн.`, d.title, "./#plan");
        }
      }
    }
  } catch (e) { log.push("dates error: " + (e as Error).message); }

  // 3) Monobank: бекфіл виписки (1 рахунок за запуск — ліміт API 1/60с) і баланси щогодини
  if (Deno.env.get("MONO_TOKEN")) {
    try {
      const backlog: string[] = sec?.mono_backfill || [];
      if (backlog.length) {
        const acc = backlog[0];
        const to = Math.floor(Date.now() / 1000), from = to - 31 * 86400 + 3600;
        const r = await fetch(`https://api.monobank.ua/personal/statement/${acc}/${from}/${to}`, { headers: { "X-Token": Deno.env.get("MONO_TOKEN")! } });
        if (r.ok) {
          const items = await r.json();
          const st = await loadState(db, uid);
          for (const it of items) await applyMonoItem(db, uid, acc, it, st);
          await db.from("user_secrets").update({ mono_backfill: backlog.slice(1) }).eq("user_id", uid);
          log.push(`mono backfill ${acc}: ${items.length}`);
        } else log.push("mono backfill " + r.status);
      } else if (!sec?.mono_last_sync || Date.now() - new Date(sec.mono_last_sync).getTime() > 55 * 60e3) {
        await monoClientInfo(db, uid);
        log.push("mono balances");
      }
    } catch (e) { log.push("mono error: " + (e as Error).message); }
  }

  // 4) Google Calendar щогодини
  try {
    if (sec?.google_refresh_token && now.time.slice(3, 5) < "15") {
      const r = await gcalSync(db, uid);
      log.push(`gcal: ${JSON.stringify(r).slice(0, 120)}`);
    }
  } catch (e) { log.push("gcal error: " + (e as Error).message); }

  return json({ ok: true, at: now.iso, log });
});
