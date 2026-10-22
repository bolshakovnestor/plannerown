import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb, fn } from '../lib/supa.js';
import { Icon, Md, Bar } from '../ui.jsx';
import TaskRow from '../components/TaskRow.jsx';
import TaskEditor from '../components/TaskEditor.jsx';
import { liquidNow, nextDue } from '../lib/forecast.js';
import { uah, todayStr, prettyDate, daysBetween, habitDueToday, money2 } from '../lib/util.js';

export function monthStats(s) {
  const m = todayStr().slice(0, 7);
  const cats = Object.fromEntries((s.categories || []).map((c) => [c.id, c]));
  let spent = 0, income = 0;
  const byCat = {};
  for (const t of s.transactions || []) {
    if (!t.occurred_at?.startsWith(m)) continue;
    const c = cats[t.category_id];
    if (c?.kind === 'transfer') continue;
    const v = Number(t.amount) * (t.currency === 'USD' ? +s.params.usd_rate : 1);
    if (v > 0) income += v; else { spent -= v; byCat[t.category_id] = (byCat[t.category_id] || 0) - v; }
  }
  const budget = (s.categories || []).filter((c) => c.kind === 'expense').reduce((a, c) => a + (+c.monthly_budget || 0), 0);
  return { spent, income, budget, byCat };
}

export function upcomingPayments(s, days = 7) {
  const now = new Date();
  const lim = new Date(); lim.setDate(lim.getDate() + days);
  return (s.debts || []).filter((d) => d.is_active && d.kind !== 'credit_line')
    .map((d) => ({ d, date: nextDue(d, now) })).filter((x) => x.date && x.date <= lim)
    .sort((a, b) => a.date - b.date);
}

export default function Today({ go }) {
  const s = useStore();
  const [edit, setEdit] = useState(null);
  const [inbox, setInbox] = useState('');
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState(null);
  const [showBrief, setShowBrief] = useState(false);
  const today = todayStr();

  useEffect(() => {
    sb.from('ai_messages').select('content,created_at').eq('role', 'brief').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setBrief(data?.[0] || null));
  }, []);

  const tasks = useMemo(() => (s.tasks || []).filter((t) => t.status === 'todo' && t.due_date && t.due_date <= today)
    .sort((a, b) => (a.due_date < today) - (b.due_date < today) || a.priority - b.priority || String(a.due_time || '99').localeCompare(String(b.due_time || '99'))), [s.tasks, today]);
  const overdue = tasks.filter((t) => t.due_date < today);
  const todays = tasks.filter((t) => t.due_date === today);
  const doneToday = (s.tasks || []).filter((t) => t.status === 'done' && t.completed_at?.slice(0, 10) === today);
  const habits = (s.habits || []).filter((h) => h.is_active && habitDueToday(h));
  const habitsShown = habits.filter((h) => !(h.schedule === 'monthly' && (s.habitLogs || []).some((l) => l.habit_id === h.id && l.day.slice(0, 7) === today.slice(0, 7) && l.day !== today)));

  const liquid = liquidNow(s.accounts, s.params);
  const ms = monthStats(s);
  const pays = upcomingPayments(s, 7);
  const cl = (s.debts || []).find((d) => d.is_active && d.kind === 'credit_line' && +d.balance > 0);
  const graceDays = cl?.grace_until ? daysBetween(today, cl.grace_until) : null;
  const soonDates = (s.dates || []).map((d) => {
    let dt = d.date;
    if (d.yearly) { dt = today.slice(0, 4) + d.date.slice(4); if (dt < today) dt = (+today.slice(0, 4) + 1) + d.date.slice(4); }
    return { ...d, next: dt, days: daysBetween(today, dt) };
  }).filter((d) => d.days >= 0 && d.days <= 14).sort((a, b) => a.days - b.days);

  const sendInbox = async () => {
    if (!inbox.trim()) return;
    setBusy(true);
    try {
      const r = await fn('assistant', { action: 'chat', mode: 'inbox', message: inbox.trim() });
      setInbox('');
      await s.reload(['tasks', 'checklist', 'habitLogs', 'dates']);
      const n = r.applied?.length || 0, p = r.proposals?.length || 0;
      s.flash(`${n ? `Додано: ${n}` : ''}${n && p ? ' · ' : ''}${p ? `Гроші: ${p} на підтвердження` : ''}` || r.reply.slice(0, 100));
      if (p) go('claude');
    } catch (e) { s.flash(e.message, 'err'); }
    setBusy(false);
  };

  const d = new Date();
  return (
    <>
      <div className="top">
        <div><h1>{['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'][d.getDay()]}</h1><div className="sub">{prettyDate(today, false).replace('сьогодні', d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }))}</div></div>
        <button className="btn ghost" onClick={() => go('settings')} aria-label="Налаштування"><Icon n="gear" /></button>
      </div>

      <div className="card">
        <div className="row">
          <textarea className="input" rows={1} style={{ minHeight: 44 }} value={inbox} onChange={(e) => setInbox(e.target.value)}
            placeholder="Інбокс: «в четвер деканат, купив пальне 1200, молився»" />
          <button className="btn pri" disabled={busy || !inbox.trim()} onClick={sendInbox} style={{ height: 44 }}>{busy ? '…' : <Icon n="send" size={18} />}</button>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>Claude розкладе на задачі, звички, дати. Гроші — після твого підтвердження.</div>
      </div>

      {cl && graceDays !== null && graceDays >= 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--bad)' }}>
          <div className="between"><b>Пільговий період Моно</b><span className={`tag ${graceDays <= 10 ? 'bad' : 'warn'}`}>{graceDays} дн.</span></div>
          <div className="small mt">До {prettyDate(cl.grace_until, false)} погасити або конвертувати борг станом на кінець попереднього місяця. Зараз використано <b className="num">{uah(cl.balance)}</b>. Інакше 3,1%/міс заднім числом.</div>
        </div>
      )}

      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="kpi" onClick={() => go('money')}><div className="l">Власні гроші</div><div className="v num">{uah(liquid)}</div></div>
        <div className="kpi" onClick={() => go('money')}><div className="l">Витрачено за місяць</div><div className="v num">{uah(ms.spent)}</div>
          <div style={{ marginTop: 6 }}><Bar value={ms.spent} max={ms.budget} /></div><div className="muted" style={{ fontSize: 11, marginTop: 3 }}>з {uah(ms.budget)}</div></div>
      </div>

      {pays.length > 0 && (
        <div className="card"><h3>Платежі на 7 днів</h3>
          {pays.map(({ d, date }) => (
            <div key={d.id} className="list-row"><div className="grow"><div>{d.name}</div><div className="muted">{prettyDate(date.toISOString().slice(0, 10))}{d.own_funds_required ? ' · власними коштами' : ''}</div></div><b className="num">{money2(d.monthly_payment)} ₴</b></div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Задачі <button className="btn ghost sm act" onClick={() => setEdit({})}><Icon n="plus" size={16} />Додати</button></h3>
        {overdue.length > 0 && <div className="tag bad" style={{ marginBottom: 4 }}>Прострочено: {overdue.length}</div>}
        {[...overdue, ...todays].map((t) => <TaskRow key={t.id} t={t} onOpen={setEdit} showDate={t.due_date !== today} />)}
        {!tasks.length && <div className="muted">На сьогодні задач немає. {doneToday.length ? `Виконано: ${doneToday.length} ✓` : ''}</div>}
        {doneToday.length > 0 && tasks.length > 0 && <div className="muted mt">Виконано сьогодні: {doneToday.length} ✓</div>}
      </div>

      {habitsShown.length > 0 && (
        <div className="card"><h3>Звички</h3>
          <div className="chips wrap" style={{ flexWrap: 'wrap' }}>
            {habitsShown.map((h) => {
              const on = (s.habitLogs || []).some((l) => l.habit_id === h.id && l.day === today);
              return <button key={h.id} className={`chip ${on ? 'on' : ''}`} onClick={() => s.toggleHabit(h, today)}>{on ? '✓ ' : ''}{h.name}</button>;
            })}
          </div>
        </div>
      )}

      {soonDates.length > 0 && (
        <div className="card"><h3>Важливі дати</h3>
          {soonDates.map((x) => <div key={x.id} className="list-row"><div className="grow">{x.title}</div><span className="muted">{x.days === 0 ? 'сьогодні' : `через ${x.days} дн.`}</span></div>)}
        </div>
      )}

      {brief && (
        <div className="card">
          <h3>Останній бриф <button className="btn ghost sm act" onClick={() => setShowBrief(!showBrief)}>{showBrief ? 'Згорнути' : 'Показати'}</button></h3>
          {showBrief ? <Md text={brief.content} /> : <div className="muted">{new Date(brief.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</div>}
        </div>
      )}

      <button className="fab" onClick={() => setEdit({})} aria-label="Нова задача"><Icon n="plus" /></button>
      {edit && <TaskEditor task={edit.id ? edit : null} defaults={{ due_date: today }} onClose={() => setEdit(null)} />}
    </>
  );
}
