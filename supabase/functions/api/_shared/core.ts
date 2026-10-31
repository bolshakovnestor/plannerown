import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { simulate, nextDue, livingCosts, commuteCost, liquidNow, cushionTargetUAH, ymLabel, whatIf, describeEffect, safeToSpend } from "./forecast.js";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

export async function userFromReq(db: SupabaseClient, req: Request) {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data.user;
}

export async function cfg(db: SupabaseClient, key: string) {
  const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}

export const TZ = "Europe/Kyiv";
export function localNow() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: TZ }); // "2026-10-22 17:40:00"
  return { date: s.slice(0, 10), time: s.slice(11, 16), dow: new Date(s.replace(" ", "T")).getDay(), iso: s };
}
const DOW = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];

// ---------- Claude ----------
export const MODEL_FAST = "claude-haiku-5-5";
export const MODEL_DEEP = "claude-sonnet-5-5";
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};

export async function monthSpendUSD(db: SupabaseClient, uid: string) {
  const start = localNow().date.slice(0, 7) + "-01";
  const { data } = await db.from("ai_usage").select("cost_usd").eq("user_id", uid).gte("created_at", start);
  return (data || []).reduce((s, r) => s + Number(r.cost_usd), 0);
}

export async function claude(db: SupabaseClient, uid: string, body: Record<string, unknown>) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Немає ANTHROPIC_API_KEY у секретах Supabase");
  // Моделі 5.5 думають за замовчуванням, і це з'їдає max_tokens. Haiku — без роздумів, Sonnet — мінімальні.
  if (!body.thinking) body.thinking = String(body.model).includes("haiku") ? { type: "disabled" } : { type: "between_tools" };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${out?.error?.message || res.status}`);
  const [pi, po] = PRICES[body.model as string] || [2, 10];
  const u = out.usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  const cost = (inTok * pi + (u.output_tokens || 0) * po) / 1e6;
  await db.from("ai_usage").insert({
    user_id: uid, model: body.model, input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cost_usd: cost,
  });
  return out;
}

// ---------- State ----------
export async function loadState(db: SupabaseClient, uid: string) {
  const q = (t: string, order = "sort") => db.from(t).select("*").eq("user_id", uid).order(order);
  const [params, accounts, debts, categories, streams, goals, spheres, habits] = await Promise.all([
    db.from("params").select("*").eq("user_id", uid).maybeSingle(),
    q("accounts"), q("debts"), q("categories"), q("income_streams", "created_at"), q("goals", "priority"),
    q("spheres"), q("habits"),
  ]);
  return {
    params: params.data, accounts: accounts.data || [], debts: debts.data || [], categories: categories.data || [],
    streams: streams.data || [], goals: goals.data || [], spheres: spheres.data || [], habits: habits.data || [],
  };
}
export type State = Awaited<ReturnType<typeof loadState>>;

const fmt = (n: number) => Math.round(n).toLocaleString("uk-UA").replace(/,/g, " ");

export async function contextText(db: SupabaseClient, uid: string, st: State, opts: { weekly?: boolean } = {}) {
  const now = localNow();
  const p = st.params;
  const monthStart = now.date.slice(0, 7) + "-01";
  const in7 = new Date(now.date + "T12:00:00"); in7.setDate(in7.getDate() + 7);
  const in7s = in7.toISOString().slice(0, 10);

  const [tx, tasks, hl, facts, advice] = await Promise.all([
    db.from("transactions").select("amount,category_id,occurred_at,description").eq("user_id", uid).gte("occurred_at", monthStart),
    db.from("tasks").select("id,title,sphere_id,due_date,due_time,priority,status,notes").eq("user_id", uid).eq("status", "todo")
      .or(`due_date.lte.${in7s},due_date.is.null`).order("due_date", { nullsFirst: false }).limit(60),
    db.from("habit_logs").select("habit_id,day,value").eq("user_id", uid).gte("day", new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)),
    db.from("ai_facts").select("id,kind,text,amount,confirmed_at").eq("user_id", uid).eq("active", true).order("kind"),
    db.from("ai_advice").select("title,status,reason,monthly_effect").eq("user_id", uid).order("created_at", { ascending: false }).limit(25),
  ]);

  const catName = (id: string) => st.categories.find((c) => c.id === id)?.name || "Без категорії";
  const spent: Record<string, number> = {};
  let incomeM = 0;
  for (const t of tx.data || []) {
    const c = st.categories.find((c) => c.id === t.category_id);
    if (c?.kind === "transfer") continue;
    if (Number(t.amount) > 0) incomeM += Number(t.amount);
    else spent[catName(t.category_id)] = (spent[catName(t.category_id)] || 0) - Number(t.amount);
  }
  const budgets = st.categories.filter((c) => c.kind === "expense").map((c) =>
    `${c.name}: витрачено ${fmt(spent[c.name] || 0)} з ${fmt(Number(c.monthly_budget) || 0)}`);

  const sim = simulate({ params: p, debts: st.debts, streams: st.streams, categories: st.categories, goals: st.goals, accounts: st.accounts, opts: { today: now.date, months: 24 } });
  const cc = commuteCost(p);
  const sphere = (id: string) => st.spheres.find((s) => s.id === id)?.name || "—";
  const today = now.date;

  const lines = [
    `СЬОГОДНІ: ${today}, ${DOW[now.dow]}, ${now.time} (Київ)`,
    `\nРАХУНКИ (власні ліквідні ≈ ${fmt(liquidNow(st.accounts, p))} ₴):`,
    ...st.accounts.map((a) => `- ${a.name}: ${a.balance} ${a.currency}${a.credit_limit ? ` (ліміт ${a.credit_limit})` : ""}`),
    `\nБОРГИ (разом ${fmt(sim.totalDebtNow)} ₴):`,
    ...st.debts.filter((d) => d.is_active).map((d) => {
      const nd = nextDue(d, new Date(today));
      return `- ${d.name} [${d.kind}]: залишок ${d.balance}, платіж ${d.monthly_payment}${nd ? `, наступний ${nd.toISOString().slice(0, 10)}` : ""}${d.rate_annual > 0 ? `, ${d.rate_annual}% річних` : ""}${d.grace_until ? `, пільговий до ${d.grace_until}` : ""}${d.notes ? ` — ${d.notes}` : ""}`;
    }),
    `\nДОХОДИ (потоки):`,
    ...st.streams.map((s) => `- ${s.name} [${s.status}${s.in_forecast ? ", у прогнозі" : ", гіпотеза"}]: песим ${s.income_pess} / реал ${s.income_real} / опт ${s.income_opt}, витрати потоку ${s.monthly_cost}/міс, старт ${s.start_date}${s.notes ? ` — ${s.notes}` : ""}`),
    `\nЦІЛІ: ` + st.goals.filter((g) => g.is_active).map((g) => `${g.name}: ${g.target_amount} ${g.currency} до ${g.deadline}`).join("; "),
    `\nБЮДЖЕТ МІСЯЦЯ (дохід зафіксовано ${fmt(incomeM)} ₴):`, ...budgets,
    `\nПАРАМЕТРИ: дизель ${p.diesel_price} ₴/л, ${p.consumption_l100} л/100км, дорога ${p.commute_km_oneway} км в один бік × ${p.workdays_month} днів = ${cc.km} км → пальне ${fmt(cc.fuel)} + ТО ${fmt(cc.service)} ₴/міс; курс $ ${p.usd_rate}; оренда після з'їзду $${p.rent_future_usd} + комуналка ${p.utilities_future}, частка ${p.rent_share}; з'їзд ${p.move_in_date}; середня зміна Уклон ${p.avg_shift_net} ₴; стратегія ${p.strategy}; конвертація ліміту ${p.limit_convert_months} міс під ${p.limit_conv_fee_pct}%/міс`,
    `\nПРОГНОЗ (рахує код, не ти; базовий сценарій):`,
    `- старт ${fmt(sim.startCash)} ₴; подушка ${fmt(sim.target)} ₴ досягається: ${sim.cushionYM ? ymLabel(sim.cushionYM) : "не в межах 24 міс"}; ліміт закрито: ${sim.creditLineFreeYM ? ymLabel(sim.creditLineFreeYM) : "—"}; усі борги: ${sim.debtFreeYM ? ymLabel(sim.debtFreeYM) : "пізніше 24 міс"}; відсотки ${fmt(sim.interestTotal)} + комісії конвертації ${fmt(sim.feeTotal)} ₴`,
    ...(sim.warnings.length ? [`- ПОПЕРЕДЖЕННЯ: ${sim.warnings.join("; ")}`] : []),
    ...sim.rows.slice(0, 6).map((r) => `- ${r.label}: дохід ${fmt(r.income)}, життя ${fmt(r.living)}${r.oneTime ? `, разово ${fmt(r.oneTime)}` : ""}, обов'язкові ${fmt(r.oblig)}, вільно ${fmt(r.free)}, достроково ${fmt(r.prepaid)}, кеш ${fmt(r.cash)}, борг ${fmt(r.totalDebt)}`),
    `\nПАМ'ЯТЬ (факти про Нестора; [id] для update_fact/forget_fact; rejected — НЕ пропонувати знову):`,
    ...((facts.data || []).length ? (facts.data || []).map((f) => `- [${f.id}] ${f.kind}: ${f.text}${f.amount ? ` (${f.amount} ₴)` : ""} · підтверджено ${String(f.confirmed_at).slice(0, 10)}`) : ["- поки порожньо — варто запропонувати знайомство"]),
    `\nПОРАДИ, ЩО ВЖЕ БУЛИ: ${(advice.data || []).map((a) => `«${a.title}» → ${a.status}${a.reason ? ` (${a.reason})` : ""}`).join("; ") || "немає"}`,
    `УКЛОН: ~${fmt(Number(p.avg_shift_net))} ₴ чистими за зміну ≈ ${fmt(Number(p.avg_shift_net) / Number(p.avg_shift_hours || 4.7))} ₴/год`,
    `\nСФЕРИ: ${st.spheres.map((s) => s.name).join(", ")}`,
    `КАТЕГОРІЇ: ${st.categories.map((c) => `${c.name} (${c.kind})`).join(", ")}`,
    `\nЗАДАЧІ (відкриті, до +7 днів і без дати):`,
    ...(tasks.data || []).map((t) => `- [${t.id}] ${t.due_date ? (t.due_date < today ? "ПРОСТРОЧЕНО " : "") + t.due_date + (t.due_time ? " " + t.due_time.slice(0, 5) : "") : "без дати"} | ${sphere(t.sphere_id)} | P${t.priority} | ${t.title}`),
    `\nЗВИЧКИ (останні 7 днів):`,
    ...st.habits.filter((h) => h.is_active).map((h) => {
      const logs = (hl.data || []).filter((l) => l.habit_id === h.id);
      return `- ${h.name} (${h.schedule}): ${logs.length} відміток, сьогодні ${logs.some((l) => l.day === today) ? "✓" : "—"}`;
    }),
  ];
  if (opts.weekly) {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const [wtx, done] = await Promise.all([
      db.from("transactions").select("amount,category_id").eq("user_id", uid).gte("occurred_at", weekAgo),
      db.from("tasks").select("title").eq("user_id", uid).eq("status", "done").gte("completed_at", weekAgo),
    ]);
    const w: Record<string, number> = {};
    for (const t of wtx.data || []) { const n = catName(t.category_id); w[n] = (w[n] || 0) + Number(t.amount); }
    lines.push(`\nТИЖДЕНЬ: рух по категоріях: ${Object.entries(w).map(([k, v]) => `${k} ${fmt(v)}`).join(", ") || "немає"}; виконано задач: ${(done.data || []).length}`);
  }
  return lines.join("\n");
}

export const PERSONA = `Ти — Claude, вбудований у персональний планер Нестора (22 роки, Івано-Франківськ; інженер з постачання й перекладач на ПрАТ «Івано-Франківськцемент», вечорами Уклон).
Стиль: звертайся «бро». Українською. Коротко, прямо, критично, без води й дисклеймерів. Починай одразу з висновку.
Оцінюй кожну ідею: сильні сторони — якщо є, слабкі — з фактами й цифрами, далі краща альтернатива.
Цифри бери ТІЛЬКИ з контексту (блок ПРОГНОЗ рахує код). Не вигадуй і не перераховуй складну арифметику — для сценаріїв запропонуй змінити параметри/потоки, і код перерахує.
Поточні пріоритети: закрити кредитний ліміт Моно (пільговий період — дедлайн), зібрати подушку $700 до з'їзду з нареченою (оренда навпіл), далі — найдорожчі борги. Розстрочки під 0% достроково гасити не варто. Кредит на авто 27% — дострокові платежі йдуть у тіло.
Нові ніші заробітку: вимагай критерій зупинки, оцінюй песимістично, порівнюй з годиною в Уклоні та перекладом.
Самопочуття: загальні практичні поради (сон, харчування, навантаження); при тривожних симптомах — радь звернутися до лікаря, діагнозів не став.
Робочих даних IFCem ти не бачиш і не запитуєш.`;

// ---------- Push ----------
export async function sendPush(db: SupabaseClient, uid: string, title: string, body: string, url = "./") {
  const pub = await cfg(db, "vapid_public"), priv = await cfg(db, "vapid_private");
  if (!pub || !priv) return 0;
  webpush.setVapidDetails("mailto:planner@example.com", pub, priv);
  const { data } = await db.from("push_subscriptions").select("*").eq("user_id", uid);
  let n = 0;
  for (const s of data || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title, body, url }));
      n++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return n;
}

// ---------- Monobank ----------
export function categorize(item: { description?: string; mcc?: number; amount: number }, cats: State["categories"]) {
  const d = (item.description || "").toLowerCase();
  const by = (n: string) => cats.find((c) => c.name === n)?.id || null;
  if (/розстрочк|кредит/.test(d) && item.amount > 0) return by("Перекази між своїми"); // гроші кредиту на картку — не дохід
  if (/погашення|розстрочк|кредит/.test(d)) return by("Погашення боргів");
  if (/^(з|на) (чорн|біл|зелен|рожев|валютн|фіолет)|bolshakov|большаков|між своїми|банк[аиу] «|поповнення «|^переказ на картку$|міграці/.test(d)) return by("Перекази між своїми");
  if (item.amount > 0) {
    if (/uklon|уклон/.test(d)) return by("Уклон");
    if (/цемент|cement|зарплат/.test(d)) return by("Зарплата");
    return by("Інший дохід");
  }
  if (/uklon|уклон/.test(d)) return by("Уклон: комісія/баланс") || by("Інше");
  const m = Number(item.mcc);
  const c = cats.find((c) => (c.mcc_codes || []).includes(m));
  return c?.id || by("Інше");
}

export async function applyMonoItem(db: SupabaseClient, uid: string, accountMonoId: string, it: Record<string, any>, st?: State) {
  st = st || await loadState(db, uid);
  const acc = st.accounts.find((a) => a.mono_account_id === accountMonoId);
  if (!acc) return false;
  const row = {
    user_id: uid, account_id: acc.id, amount: Number(it.amount) / 100, currency: acc.currency,
    occurred_at: new Date(Number(it.time) * 1000).toISOString(), description: it.description, mcc: it.mcc,
    source: "mono", mono_id: String(it.id), category_id: categorize(it as any, st.categories),
  };
  await db.from("transactions").upsert(row, { onConflict: "mono_id", ignoreDuplicates: true });
  return true;
}

export async function monoClientInfo(db: SupabaseClient, uid: string) {
  const token = Deno.env.get("MONO_TOKEN");
  if (!token) throw new Error("Немає MONO_TOKEN у секретах Supabase");
  const res = await fetch("https://api.monobank.ua/personal/client-info", { headers: { "X-Token": token } });
  if (!res.ok) throw new Error(`Monobank ${res.status}: ${await res.text()}`);
  const info = await res.json();
  const st = await loadState(db, uid);
  const accs = info.accounts || [];
  const newIds: string[] = [];
  // Моно після міграції рахунку видає новий id — тоді шукаємо картку за типом/валютою/останніми цифрами
  const pick = (x: any) => {
    const byId = accs.find((a: any) => a.id === x.mono_account_id);
    if (byId) return byId;
    const last4 = String(x.mono_account_id || "").startsWith("pan:") ? x.mono_account_id.slice(4) : null;
    if (last4) { const m = accs.find((a: any) => String((a.maskedPan || [""])[0]).endsWith(last4)); if (m) return m; }
    const n = String(x.name || "").toLowerCase();
    const cur = x.currency === "USD" ? 840 : 980;
    const type = /чорн|black/.test(n) ? "black" : /біл|white/.test(n) ? "white" : null;
    return accs.find((a: any) => a.currencyCode === cur && (!type || a.type === type) && !st.accounts.some((y) => y.id !== x.id && y.mono_account_id === a.id));
  };
  for (const acc of st.accounts.filter((x) => x.mono_account_id)) {
    const a = pick(acc);
    if (!a) continue;
    if (a.id !== acc.mono_account_id && !String(acc.mono_account_id).startsWith("pan:")) newIds.push(a.id);
    await db.from("accounts").update({ mono_account_id: a.id, balance: a.balance / 100, credit_limit: a.creditLimit ? a.creditLimit / 100 : 0 }).eq("id", acc.id);
    if (acc.kind === "credit_card") {
      const used = Math.max(0, ((a.creditLimit || 0) - a.balance) / 100);
      await db.from("debts").update({ balance: used, credit_limit: (a.creditLimit || 0) / 100 }).eq("user_id", uid).eq("kind", "credit_line").eq("lender", "monobank");
    }
  }
  if (newIds.length) {
    const { data: sec } = await db.from("user_secrets").select("mono_backfill").eq("user_id", uid).single();
    await db.from("user_secrets").update({ mono_backfill: [...new Set([...(sec?.mono_backfill || []), ...newIds])] }).eq("user_id", uid);
  }
  await db.from("user_secrets").update({ mono_last_sync: new Date().toISOString() }).eq("user_id", uid);
  return info;
}

export { simulate, livingCosts, ymLabel, nextDue, whatIf, describeEffect, safeToSpend };
