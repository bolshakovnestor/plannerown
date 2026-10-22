const TZ = "Europe/Kyiv";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export async function googleToken(refresh: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google token: " + (j.error_description || j.error));
  return j.access_token as string;
}

const addMin = (date: string, time: string, min: number) => {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + min;
  const dayShift = Math.floor(t / 1440);
  const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() + dayShift);
  const tt = ((t % 1440) + 1440) % 1440;
  return `${d.toISOString().slice(0, 10)}T${String(Math.floor(tt / 60)).padStart(2, "0")}:${String(tt % 60).padStart(2, "0")}:00`;
};

function eventBody(t: any) {
  const time = String(t.due_time).slice(0, 5);
  return {
    summary: t.title,
    description: (t.notes || "") + "\n\n— Планер",
    start: { dateTime: `${t.due_date}T${time}:00`, timeZone: TZ },
    end: { dateTime: addMin(t.due_date, time, t.duration_min || 30), timeZone: TZ },
    extendedProperties: { private: { planner_task_id: t.id } },
  };
}

export async function gcalSync(db: any, uid: string) {
  const { data: sec } = await db.from("user_secrets").select("*").eq("user_id", uid).single();
  if (!sec?.google_refresh_token) return { skipped: "not connected" };
  const token = await googleToken(sec.google_refresh_token);
  const H = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  const since = sec.gcal_last_sync || "2000-01-01T00:00:00Z";
  const startedAt = new Date().toISOString();
  let pushed = 0, removed = 0, pulled = 0;

  // App → Google
  const { data: changed } = await db.from("tasks").select("*").eq("user_id", uid).gt("updated_at", since);
  for (const t of changed || []) {
    const shouldExist = t.status === "todo" && t.due_date && t.due_time;
    if (shouldExist) {
      const r = t.gcal_event_id
        ? await fetch(`${API}/${t.gcal_event_id}`, { method: "PATCH", headers: H, body: JSON.stringify(eventBody(t)) })
        : await fetch(API, { method: "POST", headers: H, body: JSON.stringify(eventBody(t)) });
      if (r.ok) {
        const ev = await r.json();
        if (!t.gcal_event_id) await db.from("tasks").update({ gcal_event_id: ev.id }).eq("id", t.id);
        pushed++;
      } else if (r.status === 404 || r.status === 410) {
        await db.from("tasks").update({ gcal_event_id: null }).eq("id", t.id);
      }
    } else if (t.gcal_event_id) {
      await fetch(`${API}/${t.gcal_event_id}`, { method: "DELETE", headers: H });
      await db.from("tasks").update({ gcal_event_id: null }).eq("id", t.id);
      removed++;
    }
  }

  // Google → App (лише події, створені планером)
  const q = new URLSearchParams({ updatedMin: since, showDeleted: "true", singleEvents: "true", maxResults: "250", privateExtendedProperty: "planner_task_id" });
  // privateExtendedProperty потребує значення; беремо всі оновлені й фільтруємо самі
  q.delete("privateExtendedProperty");
  const r = await fetch(`${API}?${q}`, { headers: H });
  if (r.ok) {
    const j = await r.json();
    for (const ev of j.items || []) {
      const tid = ev.extendedProperties?.private?.planner_task_id;
      if (!tid) continue;
      const { data: t } = await db.from("tasks").select("*").eq("id", tid).eq("user_id", uid).maybeSingle();
      if (!t) continue;
      if (ev.status === "cancelled") {
        if (t.gcal_event_id) { await db.from("tasks").update({ gcal_event_id: null, due_time: null }).eq("id", tid); pulled++; }
        continue;
      }
      if (new Date(ev.updated) <= new Date(t.updated_at)) continue;
      const s = ev.start?.dateTime ? new Date(ev.start.dateTime).toLocaleString("sv-SE", { timeZone: TZ }) : null;
      const e = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
      if (!s) continue;
      const dur = e ? Math.round((e.getTime() - new Date(ev.start.dateTime).getTime()) / 60000) : t.duration_min;
      await db.from("tasks").update({ title: ev.summary || t.title, due_date: s.slice(0, 10), due_time: s.slice(11, 16), duration_min: dur }).eq("id", tid);
      pulled++;
    }
  }
  // updated_at задач, змінених нами під час синку, > startedAt — щоб не ганяти їх по колу, фіксуємо час після синку
  await db.from("user_secrets").update({ gcal_last_sync: new Date().toISOString() }).eq("user_id", uid);
  return { pushed, removed, pulled, startedAt };
}

export async function gcalEvents(db: any, uid: string, from: string, to: string) {
  const { data: sec } = await db.from("user_secrets").select("google_refresh_token").eq("user_id", uid).single();
  if (!sec?.google_refresh_token) return [];
  const token = await googleToken(sec.google_refresh_token);
  const q = new URLSearchParams({ timeMin: from + "T00:00:00Z", timeMax: to + "T23:59:59Z", singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  const r = await fetch(`${API}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || [])
    .filter((ev: any) => !ev.extendedProperties?.private?.planner_task_id)
    .map((ev: any) => ({
      id: ev.id, title: ev.summary || "(без назви)",
      start: ev.start?.dateTime || ev.start?.date, end: ev.end?.dateTime || ev.end?.date, allDay: !!ev.start?.date,
    }));
}
