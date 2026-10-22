import {
  admin, cors, json, userFromReq, loadState, contextText, claude, monthSpendUSD, PERSONA,
  MODEL_FAST, MODEL_DEEP, localNow, sendPush, monoClientInfo, cfg, type State,
} from "./_shared/core.ts";

const MONEY_TOOLS = new Set([
  "add_transaction", "set_account_balance", "update_debt", "add_debt", "update_params",
  "upsert_income_stream", "update_goal", "add_uklon_shift", "set_category_budget",
]);

const TOOLS = [
  { name: "create_task", description: "Створити задачу в планері. Дата YYYY-MM-DD, час HH:MM. Сфера — одна з наявних.",
    input_schema: { type: "object", properties: {
      title: { type: "string" }, sphere: { type: "string" }, due_date: { type: "string" }, due_time: { type: "string" },
      duration_min: { type: "integer" }, priority: { type: "integer", enum: [1, 2, 3], description: "1 — високий" },
      notes: { type: "string" }, checklist: { type: "array", items: { type: "string" } },
      recurrence: { type: "string", description: "daily | weekly:1,3,5 (1=пн..7=нд) | monthly:15" } }, required: ["title"] } },
  { name: "update_task", description: "Змінити задачу за id.", input_schema: { type: "object", properties: {
      id: { type: "string" }, title: { type: "string" }, sphere: { type: "string" }, due_date: { type: "string" }, due_time: { type: "string" },
      priority: { type: "integer" }, notes: { type: "string" }, recurrence: { type: "string" } }, required: ["id"] } },
  { name: "complete_task", description: "Позначити задачу виконаною.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "delete_task", description: "Видалити задачу.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "add_checklist_items", description: "Додати пункти чекліста до задачі.", input_schema: { type: "object", properties: {
      task_id: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["task_id", "items"] } },
  { name: "log_habit", description: "Відмітити звичку (за назвою) на дату.", input_schema: { type: "object", properties: {
      habit: { type: "string" }, day: { type: "string" }, value: { type: "number" } }, required: ["habit"] } },
  { name: "create_habit", description: "Створити нову звичку.", input_schema: { type: "object", properties: {
      name: { type: "string" }, kind: { type: "string", enum: ["bool", "count"] }, target: { type: "number" }, unit: { type: "string" },
      schedule: { type: "string", description: "daily | weekly:1,3 | monthly" } }, required: ["name"] } },
  { name: "add_important_date", description: "Додати важливу дату (день народження, дедлайн).", input_schema: { type: "object", properties: {
      title: { type: "string" }, date: { type: "string" }, yearly: { type: "boolean" }, remind_days: { type: "integer" } }, required: ["title", "date"] } },
  // ---- гроші: лише пропозиція, застосовується після підтвердження ----
  { name: "add_transaction", description: "Записати витрату/дохід/платіж. amount завжди додатне, kind визначає знак. Для платежу по боргу вкажи debt і debt_effect.",
    input_schema: { type: "object", properties: {
      amount: { type: "number" }, kind: { type: "string", enum: ["expense", "income"] }, category: { type: "string" },
      account: { type: "string" }, date: { type: "string" }, description: { type: "string" },
      debt: { type: "string", description: "назва боргу, якщо це його погашення" },
      debt_effect: { type: "string", enum: ["scheduled", "prepay"], description: "scheduled — плановий платіж, prepay — дострокове в тіло" },
      stream: { type: "string", description: "назва потоку доходу (для сайд-проєктів)" } }, required: ["amount", "kind"] } },
  { name: "set_account_balance", description: "Виставити баланс рахунку (готівка, Crédit Agricole тощо).", input_schema: { type: "object", properties: {
      account: { type: "string" }, balance: { type: "number" } }, required: ["account", "balance"] } },
  { name: "update_debt", description: "Змінити поля боргу (залишок, платіж, дата, ставка, пільговий).", input_schema: { type: "object", properties: {
      debt: { type: "string" }, balance: { type: "number" }, monthly_payment: { type: "number" }, next_payment_date: { type: "string" },
      payments_left: { type: "integer" }, rate_annual: { type: "number" }, grace_until: { type: "string" }, is_active: { type: "boolean" },
      credit_limit: { type: "number" }, notes: { type: "string" } }, required: ["debt"] } },
  { name: "add_debt", description: "Додати новий борг/розстрочку.", input_schema: { type: "object", properties: {
      name: { type: "string" }, lender: { type: "string" }, kind: { type: "string", enum: ["credit_line", "installment", "annuity_loan"] },
      balance: { type: "number" }, monthly_payment: { type: "number" }, rate_annual: { type: "number" }, next_payment_date: { type: "string" },
      payment_day: { type: "integer" }, payments_left: { type: "integer" }, own_funds_required: { type: "boolean" } }, required: ["name", "kind", "balance"] } },
  { name: "update_params", description: "Змінити параметри розрахунків.", input_schema: { type: "object", properties: {
      diesel_price: { type: "number" }, consumption_l100: { type: "number" }, commute_km_oneway: { type: "number" }, workdays_month: { type: "integer" },
      maintenance_per_km: { type: "number" }, usd_rate: { type: "number" }, rent_future_usd: { type: "number" }, utilities_future: { type: "number" },
      rent_share: { type: "number" }, move_in_date: { type: "string" }, avg_shift_net: { type: "number" }, food_after_move: { type: "number" },
      leisure_after_move: { type: "number" }, strategy: { type: "string", enum: ["cushion_first", "debt_first"] },
      limit_convert_months: { type: "integer" }, limit_conv_fee_pct: { type: "number" }, move_extra_months: { type: "number" } } } },
  { name: "upsert_income_stream", description: "Створити або змінити потік доходу (нова ніша/спосіб заробітку). Нова ніша за замовчуванням — гіпотеза поза основним прогнозом (in_forecast=false).",
    input_schema: { type: "object", properties: {
      name: { type: "string" }, kind: { type: "string", enum: ["salary", "taxi", "side"] }, start_date: { type: "string" },
      monthly_cost: { type: "number" }, income_pess: { type: "number" }, income_real: { type: "number" }, income_opt: { type: "number" },
      confidence: { type: "integer" }, kill_after_weeks: { type: "integer" }, kill_threshold_pct: { type: "integer" },
      in_forecast: { type: "boolean" }, status: { type: "string", enum: ["idea", "active", "stopped"] }, notes: { type: "string" } }, required: ["name"] } },
  { name: "update_goal", description: "Змінити ціль (подушка тощо).", input_schema: { type: "object", properties: {
      goal: { type: "string" }, target_amount: { type: "number" }, currency: { type: "string" }, deadline: { type: "string" },
      saved_amount: { type: "number" } }, required: ["goal"] } },
  { name: "add_uklon_shift", description: "Записати зміну в Уклоні (чистий дохід уже без комісії/пального/ТО).", input_schema: { type: "object", properties: {
      day: { type: "string" }, hours: { type: "number" }, km: { type: "number" }, net: { type: "number" }, notes: { type: "string" } }, required: ["net"] } },
  { name: "set_category_budget", description: "Змінити місячний бюджет категорії.", input_schema: { type: "object", properties: {
      category: { type: "string" }, monthly_budget: { type: "number" } }, required: ["category", "monthly_budget"] } },
];

const norm = (s: string) => (s || "").toLowerCase().replace(/[«»"'’`]/g, "").trim();
function find<T extends { name: string }>(list: T[], name?: string): T | undefined {
  if (!name) return undefined;
  const n = norm(name);
  return list.find((x) => norm(x.name) === n) || list.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
}
const money = (n: number) => `${Number(n).toLocaleString("uk-UA", { maximumFractionDigits: 2 })}`;

type Op = { table: string; op: "insert" | "update" | "delete"; id?: string; before?: Record<string, unknown>; row?: Record<string, unknown> };

// ---------- Негайні (не грошові) ----------
async function runImmediate(db: any, uid: string, st: State, name: string, a: any): Promise<{ text: string; undo: Op[] }> {
  const sphereId = (s?: string) => find(st.spheres, s)?.id ?? null;
  if (name === "create_task") {
    const { data, error } = await db.from("tasks").insert({
      user_id: uid, title: a.title, sphere_id: sphereId(a.sphere), due_date: a.due_date || null, due_time: a.due_time || null,
      duration_min: a.duration_min || null, priority: a.priority || 2, notes: a.notes || null, recurrence: a.recurrence || null,
    }).select("id").single();
    if (error) throw error;
    if (a.checklist?.length) await db.from("task_checklist").insert(a.checklist.map((t: string, i: number) => ({ user_id: uid, task_id: data.id, text: t, sort: i })));
    return { text: `Задача створена: ${a.title}${a.due_date ? ` (${a.due_date}${a.due_time ? " " + a.due_time : ""})` : ""}`, undo: [{ table: "tasks", op: "insert", id: data.id }] };
  }
  if (["update_task", "complete_task", "delete_task"].includes(name)) {
    const { data: before } = await db.from("tasks").select("*").eq("id", a.id).eq("user_id", uid).maybeSingle();
    if (!before) throw new Error("Задачу не знайдено");
    if (name === "delete_task") {
      await db.from("tasks").delete().eq("id", a.id);
      return { text: `Видалено: ${before.title}`, undo: [{ table: "tasks", op: "delete", row: before }] };
    }
    const patch: Record<string, unknown> = name === "complete_task"
      ? { status: "done", completed_at: new Date().toISOString() }
      : Object.fromEntries(Object.entries({ title: a.title, due_date: a.due_date, due_time: a.due_time, priority: a.priority, notes: a.notes, recurrence: a.recurrence }).filter(([, v]) => v !== undefined));
    if (a.sphere) patch.sphere_id = sphereId(a.sphere);
    await db.from("tasks").update(patch).eq("id", a.id);
    // повторювана задача: створюємо наступну
    if (name === "complete_task" && before.recurrence && before.due_date) {
      const nd = nextRecurrence(before.due_date, before.recurrence);
      if (nd) await db.from("tasks").insert({ ...stripTask(before), due_date: nd });
    }
    const beforePatch = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]]));
    return { text: `${name === "complete_task" ? "Виконано" : "Оновлено"}: ${before.title}`, undo: [{ table: "tasks", op: "update", id: a.id, before: beforePatch }] };
  }
  if (name === "add_checklist_items") {
    const { data } = await db.from("task_checklist").insert(a.items.map((t: string, i: number) => ({ user_id: uid, task_id: a.task_id, text: t, sort: 100 + i }))).select("id");
    return { text: `Додано ${a.items.length} пункт(и) чекліста`, undo: (data || []).map((r: any) => ({ table: "task_checklist", op: "insert", id: r.id })) };
  }
  if (name === "log_habit") {
    const h = find(st.habits, a.habit);
    if (!h) throw new Error(`Звичку «${a.habit}» не знайдено. Є: ${st.habits.map((h) => h.name).join(", ")}`);
    const day = a.day || localNow().date;
    const { data } = await db.from("habit_logs").upsert({ user_id: uid, habit_id: h.id, day, value: a.value ?? 1 }, { onConflict: "habit_id,day" }).select("id").single();
    return { text: `Звичка «${h.name}» відмічена ${day}`, undo: [{ table: "habit_logs", op: "insert", id: data.id }] };
  }
  if (name === "create_habit") {
    const { data } = await db.from("habits").insert({ user_id: uid, name: a.name, kind: a.kind || "bool", target: a.target ?? null, unit: a.unit ?? null, schedule: a.schedule || "daily" }).select("id").single();
    return { text: `Нова звичка: ${a.name}`, undo: [{ table: "habits", op: "insert", id: data.id }] };
  }
  if (name === "add_important_date") {
    const { data } = await db.from("important_dates").insert({ user_id: uid, title: a.title, date: a.date, yearly: a.yearly ?? true, remind_days: a.remind_days ?? 7 }).select("id").single();
    return { text: `Дата додана: ${a.title} ${a.date}`, undo: [{ table: "important_dates", op: "insert", id: data.id }] };
  }
  throw new Error("Невідомий інструмент " + name);
}

function stripTask(t: any) {
  const { id: _i, created_at: _c, updated_at: _u, completed_at: _d, gcal_event_id: _g, status: _s, ...rest } = t;
  return { ...rest, status: "todo" };
}
function nextRecurrence(date: string, rec: string): string | null {
  const d = new Date(date + "T12:00:00");
  if (rec === "daily") d.setDate(d.getDate() + 1);
  else if (rec.startsWith("weekly")) {
    const days = (rec.split(":")[1] || "").split(",").map(Number).filter(Boolean); // 1..7
    if (!days.length) d.setDate(d.getDate() + 7);
    else { do { d.setDate(d.getDate() + 1); } while (!days.includes(((d.getDay() + 6) % 7) + 1)); }
  } else if (rec.startsWith("monthly")) {
    const day = Number(rec.split(":")[1]) || d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  } else return null;
  return d.toISOString().slice(0, 10);
}

// ---------- Грошові: preview → confirm → apply ----------
function previewMoney(st: State, name: string, a: any): { lines: string[]; error?: string } {
  const L: string[] = [];
  if (name === "add_transaction") {
    const sign = a.kind === "income" ? 1 : -1;
    const acc = find(st.accounts, a.account) || (a.account ? undefined : find(st.accounts, "Готівка"));
    if (a.account && !acc) return { lines: [], error: `Рахунок «${a.account}» не знайдено. Є: ${st.accounts.map((x) => x.name).join(", ")}` };
    const cat = find(st.categories, a.category) || (a.debt ? find(st.categories, "Погашення боргів") : undefined);
    L.push(`${a.kind === "income" ? "Дохід" : "Витрата"} ${sign > 0 ? "+" : "−"}${money(a.amount)} ₴ · ${cat?.name || "Інше"} · ${acc?.name || "Готівка"}${a.date ? " · " + a.date : ""}${a.description ? " · " + a.description : ""}`);
    if (acc && !acc.mono_account_id) L.push(`${acc.name}: ${money(acc.balance)} → ${money(Number(acc.balance) + sign * a.amount)}`);
    if (a.debt) {
      const d = find(st.debts, a.debt);
      if (!d) return { lines: [], error: `Борг «${a.debt}» не знайдено` };
      const body = bodyPart(d, a.amount, a.debt_effect);
      L.push(`${d.name}: ${money(d.balance)} → ${money(Math.max(0, Number(d.balance) - body))}${body < a.amount ? ` (у тіло ${money(body)}, відсотки ${money(a.amount - body)})` : ""}`);
    }
    return { lines: L };
  }
  if (name === "set_account_balance") {
    const acc = find(st.accounts, a.account);
    if (!acc) return { lines: [], error: `Рахунок «${a.account}» не знайдено` };
    return { lines: [`${acc.name}: ${money(acc.balance)} → ${money(a.balance)}`] };
  }
  if (name === "update_debt") {
    const d = find(st.debts, a.debt);
    if (!d) return { lines: [], error: `Борг «${a.debt}» не знайдено` };
    for (const [k, v] of Object.entries(a)) if (k !== "debt") L.push(`${d.name} · ${k}: ${(d as any)[k] ?? "—"} → ${v}`);
    return { lines: L };
  }
  if (name === "add_debt") return { lines: [`Новий борг: ${a.name} (${a.kind}) ${money(a.balance)} ₴, платіж ${money(a.monthly_payment || 0)}`] };
  if (name === "update_params") {
    for (const [k, v] of Object.entries(a)) L.push(`${k}: ${(st.params as any)[k]} → ${v}`);
    return { lines: L };
  }
  if (name === "upsert_income_stream") {
    const s = find(st.streams, a.name);
    if (s) for (const [k, v] of Object.entries(a)) { if (k !== "name") L.push(`${s.name} · ${k}: ${(s as any)[k]} → ${v}`); }
    else L.push(`Новий потік «${a.name}»: ${money(a.income_pess || 0)} / ${money(a.income_real || 0)} / ${money(a.income_opt || 0)} ₴, витрати ${money(a.monthly_cost || 0)}/міс, ${a.in_forecast ? "у прогнозі" : "гіпотеза (поза прогнозом)"}`);
    return { lines: L };
  }
  if (name === "update_goal") {
    const g = find(st.goals, a.goal);
    if (!g) return { lines: [], error: `Ціль «${a.goal}» не знайдено` };
    for (const [k, v] of Object.entries(a)) if (k !== "goal") L.push(`${g.name} · ${k}: ${(g as any)[k]} → ${v}`);
    return { lines: L };
  }
  if (name === "add_uklon_shift") return { lines: [`Зміна Уклон ${a.day || localNow().date}: +${money(a.net)} ₴${a.hours ? `, ${a.hours} год` : ""}${a.km ? `, ${a.km} км` : ""} (+ дохід «Уклон» у готівку)`] };
  if (name === "set_category_budget") {
    const c = find(st.categories, a.category);
    if (!c) return { lines: [], error: `Категорію «${a.category}» не знайдено` };
    return { lines: [`Бюджет «${c.name}»: ${money(c.monthly_budget || 0)} → ${money(a.monthly_budget)}`] };
  }
  return { lines: [], error: "Невідомий інструмент" };
}

function bodyPart(d: any, amount: number, effect?: string) {
  if (d.kind === "annuity_loan" && effect !== "prepay") {
    const interest = Number(d.balance) * Number(d.rate_annual) / 1200;
    return Math.max(0, amount - interest);
  }
  return amount;
}

async function applyMoney(db: any, uid: string, st: State, name: string, a: any): Promise<Op[]> {
  const undo: Op[] = [];
  const upd = async (table: string, row: any, patch: Record<string, unknown>) => {
    undo.push({ table, op: "update", id: row.id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, row[k]])) });
    const { error } = await db.from(table).update(patch).eq("id", row.id);
    if (error) throw error;
  };
  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await db.from(table).insert({ user_id: uid, ...row }).select("id").single();
    if (error) throw error;
    undo.push({ table, op: "insert", id: data.id });
    return data.id;
  };
  if (name === "add_transaction") {
    const sign = a.kind === "income" ? 1 : -1;
    const acc = find(st.accounts, a.account) || find(st.accounts, "Готівка");
    const d = a.debt ? find(st.debts, a.debt) : undefined;
    const cat = find(st.categories, a.category) || (d ? find(st.categories, "Погашення боргів") : find(st.categories, a.kind === "income" ? "Інший дохід" : "Інше"));
    const stream = a.stream ? find(st.streams, a.stream) : undefined;
    await ins("transactions", {
      account_id: acc?.id, category_id: cat?.id, debt_id: d?.id || null, stream_id: stream?.id || null,
      amount: sign * a.amount, occurred_at: a.date ? new Date(a.date + "T12:00:00").toISOString() : new Date().toISOString(),
      description: a.description || null, source: "ai",
    });
    if (acc && !acc.mono_account_id) await upd("accounts", acc, { balance: Number(acc.balance) + sign * a.amount });
    if (d) {
      const patch: Record<string, unknown> = { balance: Math.max(0, Number(d.balance) - bodyPart(d, a.amount, a.debt_effect)) };
      if (a.debt_effect !== "prepay" && d.next_payment_date) {
        const x = new Date(d.next_payment_date + "T12:00:00"); x.setMonth(x.getMonth() + 1);
        patch.next_payment_date = x.toISOString().slice(0, 10);
        if (d.payments_left) patch.payments_left = d.payments_left - 1;
      }
      await upd("debts", d, patch);
    }
  } else if (name === "set_account_balance") {
    await upd("accounts", find(st.accounts, a.account), { balance: a.balance });
  } else if (name === "update_debt") {
    const { debt, ...rest } = a; await upd("debts", find(st.debts, debt), rest);
  } else if (name === "add_debt") {
    await ins("debts", { ...a, sort: 50 });
  } else if (name === "update_params") {
    const before = Object.fromEntries(Object.keys(a).map((k) => [k, (st.params as any)[k]]));
    await db.from("params").update(a).eq("user_id", uid);
    undo.push({ table: "params", op: "update", id: uid, before });
  } else if (name === "upsert_income_stream") {
    const s = find(st.streams, a.name);
    if (s) { const { name: _n, ...rest } = a; await upd("income_streams", s, rest); }
    else await ins("income_streams", { kind: "side", in_forecast: false, status: "idea", ...a });
  } else if (name === "update_goal") {
    const { goal, ...rest } = a; await upd("goals", find(st.goals, goal), rest);
  } else if (name === "add_uklon_shift") {
    const day = a.day || localNow().date;
    await ins("uklon_shifts", { day, hours: a.hours ?? null, km: a.km ?? null, net: a.net, notes: a.notes ?? null });
    const cash = find(st.accounts, "Готівка"); const cat = find(st.categories, "Уклон");
    await ins("transactions", { account_id: cash?.id, category_id: cat?.id, amount: a.net, occurred_at: new Date(day + "T21:00:00").toISOString(), description: "Зміна Уклон", source: "ai" });
    if (cash) await upd("accounts", cash, { balance: Number(cash.balance) + Number(a.net) });
  } else if (name === "set_category_budget") {
    await upd("categories", find(st.categories, a.category), { monthly_budget: a.monthly_budget });
  }
  return undo;
}

async function revert(db: any, uid: string, ops: Op[]) {
  for (const o of [...ops].reverse()) {
    if (o.op === "insert") await db.from(o.table).delete().eq("id", o.id).eq("user_id", uid);
    else if (o.op === "update") {
      if (o.table === "params") await db.from("params").update(o.before).eq("user_id", uid);
      else await db.from(o.table).update(o.before).eq("id", o.id).eq("user_id", uid);
    } else if (o.op === "delete") await db.from(o.table).insert(o.row);
  }
}

// ---------- Handler ----------
export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const user = await userFromReq(db, req);
  if (!user) return json({ error: "Не авторизовано" }, 401);
  const uid = user.id;
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === "confirm" || body.action === "reject") {
      const { data: acts } = await db.from("ai_actions").select("*").eq("user_id", uid).in("id", body.ids || []).eq("status", "proposed");
      const results = [];
      for (const act of acts || []) {
        if (body.action === "reject") { await db.from("ai_actions").update({ status: "rejected" }).eq("id", act.id); continue; }
        const st = await loadState(db, uid);
        const undo = await applyMoney(db, uid, st, act.tool, act.args);
        await db.from("ai_actions").update({ status: "applied", undo }).eq("id", act.id);
        results.push(act.id);
      }
      return json({ ok: true, applied: results });
    }

    if (body.action === "undo") {
      const { data: act } = await db.from("ai_actions").select("*").eq("user_id", uid).eq("id", body.id).eq("status", "applied").maybeSingle();
      if (!act) return json({ error: "Дію не знайдено" }, 404);
      await revert(db, uid, act.undo || []);
      await db.from("ai_actions").update({ status: "undone" }).eq("id", act.id);
      return json({ ok: true });
    }

    if (body.action === "mono_setup") {
      const info = await monoClientInfo(db, uid);
      const secret = await cfg(db, "cron_secret");
      const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/api/mono-hook?k=${secret}`;
      const r = await fetch("https://api.monobank.ua/personal/webhook", {
        method: "POST", headers: { "X-Token": Deno.env.get("MONO_TOKEN")!, "content-type": "application/json" },
        body: JSON.stringify({ webHookUrl: hook }),
      });
      const st = await loadState(db, uid);
      const ids = st.accounts.filter((a) => a.mono_account_id && !a.mono_account_id.startsWith("pan:")).map((a) => a.mono_account_id);
      await db.from("user_secrets").update({ mono_backfill: ids, mono_webhook_set: r.ok }).eq("user_id", uid);
      return json({ ok: true, webhook: r.ok, webhookStatus: r.status, accounts: (info.accounts || []).length, backfill: ids.length });
    }

    if (body.action === "mono_balances") {
      await monoClientInfo(db, uid);
      return json({ ok: true });
    }

    if (body.action === "push_test") {
      const n = await sendPush(db, uid, "Планер", "Сповіщення працюють ✓");
      return json({ ok: true, sent: n });
    }

    if (body.action === "chat") {
      const st = await loadState(db, uid);
      const budget = Number(st.params?.ai_budget_usd || 5);
      const spent = await monthSpendUSD(db, uid);
      if (spent >= budget) return json({ error: `Ліміт AI на місяць вичерпано ($${spent.toFixed(2)} з $${budget}). Підніми в налаштуваннях.` }, 402);

      const deep = !!body.deep || spent < budget * 0.8 && /аналіз|проаналізуй|стратег|огляд/i.test(body.message || "");
      const model = deep ? MODEL_DEEP : MODEL_FAST;
      const userText = body.mode === "inbox"
        ? `ІНБОКС (розклади на задачі, витрати, звички, дати; задачам постав сферу і дату, якщо вона випливає з тексту; відповідь — 1–3 рядки):\n${body.message}`
        : body.message;
      await db.from("ai_messages").insert({ user_id: uid, role: "user", content: body.mode === "inbox" ? `📥 ${body.message}` : body.message });

      const { data: hist } = await db.from("ai_messages").select("role,content").eq("user_id", uid).in("role", ["user", "assistant"])
        .order("created_at", { ascending: false }).limit(9);
      const history = (hist || []).reverse().slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      const ctx = await contextText(db, uid, st);
      const system = [
        { type: "text", text: PERSONA + "\nГрошові зміни (транзакції, борги, параметри, потоки, цілі, бюджети) — це пропозиції: вони застосуються лише після того, як Нестор натисне «Застосувати». Задачі й звички змінюються одразу.\nЯкщо потрібна інформація, якої немає — коротко запитай." },
        { type: "text", text: "КОНТЕКСТ:\n" + ctx },
      ];
      const messages: any[] = [...history, { role: "user", content: userText }];
      const applied: any[] = [], proposals: any[] = [];
      let finalText = "";
      for (let i = 0; i < 6; i++) {
        const out = await claude(db, uid, { model, max_tokens: deep ? 2500 : 1200, system, tools: TOOLS, messages });
        messages.push({ role: "assistant", content: out.content });
        const uses = (out.content || []).filter((c: any) => c.type === "tool_use");
        finalText = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim() || finalText;
        if (!uses.length || out.stop_reason !== "tool_use") break;
        const results = [];
        for (const u of uses) {
          try {
            if (MONEY_TOOLS.has(u.name)) {
              const pv = previewMoney(st, u.name, u.input);
              if (pv.error) throw new Error(pv.error);
              const { data } = await db.from("ai_actions").insert({ user_id: uid, tool: u.name, args: u.input, preview: pv.lines, needs_confirm: true }).select("id").single();
              proposals.push({ id: data!.id, tool: u.name, preview: pv.lines });
              results.push({ type: "tool_result", tool_use_id: u.id, content: "Запропоновано, чекає підтвердження: " + pv.lines.join("; ") });
            } else {
              const r = await runImmediate(db, uid, st, u.name, u.input);
              const { data } = await db.from("ai_actions").insert({ user_id: uid, tool: u.name, args: u.input, preview: [r.text], undo: r.undo, status: "applied" }).select("id").single();
              applied.push({ id: data!.id, tool: u.name, text: r.text });
              results.push({ type: "tool_result", tool_use_id: u.id, content: "Готово: " + r.text });
            }
          } catch (e) {
            results.push({ type: "tool_result", tool_use_id: u.id, content: "Помилка: " + (e as Error).message, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
      }
      if (!finalText) finalText = proposals.length ? "Перевір зміни нижче і застосуй." : "Готово.";
      await db.from("ai_messages").insert({ user_id: uid, role: "assistant", content: finalText });
      return json({ reply: finalText, applied, proposals, model, spentUSD: await monthSpendUSD(db, uid) });
    }
    return json({ error: "Невідома дія" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
