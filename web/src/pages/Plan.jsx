import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { fn } from '../lib/supa.js';
import { Icon } from '../ui.jsx';
import TaskRow from '../components/TaskRow.jsx';
import TaskEditor from '../components/TaskEditor.jsx';
import { nextDue } from '../lib/forecast.js';
import { todayStr, addDays, dstr, prettyDate, MONTHS_NOM, money2 } from '../lib/util.js';

function groupTasks(tasks, today) {
  const wk = addDays(today, 7);
  const g = { 'Прострочено': [], 'Сьогодні': [], 'Завтра': [], 'Цього тижня': [], 'Пізніше': [], 'Без дати': [] };
  for (const t of tasks) {
    if (!t.due_date) g['Без дати'].push(t);
    else if (t.due_date < today) g['Прострочено'].push(t);
    else if (t.due_date === today) g['Сьогодні'].push(t);
    else if (t.due_date === addDays(today, 1)) g['Завтра'].push(t);
    else if (t.due_date <= wk) g['Цього тижня'].push(t);
    else g['Пізніше'].push(t);
  }
  return g;
}

export default function Plan() {
  const s = useStore();
  const [view, setView] = useState(() => localStorage.getItem('plan-view') || 'list');
  const [sphere, setSphere] = useState('all');
  const [edit, setEdit] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const today = todayStr();
  useEffect(() => { try { localStorage.setItem('plan-view', view); } catch { /* */ } }, [view]);

  const filt = (t) => sphere === 'all' || t.sphere_id === sphere;
  const open = (s.tasks || []).filter((t) => t.status === 'todo' && filt(t));
  const done = (s.tasks || []).filter((t) => t.status === 'done' && filt(t)).sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  const groups = groupTasks(open, today);

  return (
    <>
      <div className="top">
        <h1>Планер</h1>
        <div className="seg">{[['list', 'Список'], ['week', 'Тиждень'], ['month', 'Місяць']].map(([k, l]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>))}</div>
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${sphere === 'all' ? 'on' : ''}`} onClick={() => setSphere('all')}>Усі</button>
        {s.spheres.map((sp) => (
          <button key={sp.id} className={`chip ${sphere === sp.id ? 'on' : ''}`} onClick={() => setSphere(sp.id)}>
            <span className="dot" style={{ background: sp.color, marginRight: 6 }} />{sp.name}
            <span className="muted" style={{ marginLeft: 5 }}>{(s.tasks || []).filter((t) => t.status === 'todo' && t.sphere_id === sp.id).length}</span>
          </button>
        ))}
      </div>

      {view === 'list' && (
        <>
          {Object.entries(groups).map(([name, ts]) => ts.length > 0 && (
            <div key={name} className="card">
              <h3><span className={name === 'Прострочено' ? 'neg' : ''}>{name}</span><span className="muted act">{ts.length}</span></h3>
              {ts.map((t) => <TaskRow key={t.id} t={t} onOpen={setEdit} showDate={!['Сьогодні'].includes(name)} />)}
            </div>
          ))}
          {!open.length && <div className="card muted">Відкритих задач немає. Додай через «+» або напиши в інбокс на головній.</div>}
          {done.length > 0 && (
            <div className="card">
              <h3>Виконано за 30 днів <button className="btn ghost sm act" onClick={() => setShowDone(!showDone)}>{showDone ? 'Сховати' : `Показати (${done.length})`}</button></h3>
              {showDone && done.map((t) => <TaskRow key={t.id} t={t} onOpen={setEdit} />)}
            </div>
          )}
        </>
      )}
      {view !== 'list' && <CalendarView mode={view} filt={filt} onOpen={setEdit} onNew={(date) => setEdit({ _new: true, due_date: date })} />}

      <button className="fab" onClick={() => setEdit({ _new: true, sphere_id: sphere !== 'all' ? sphere : undefined })} aria-label="Нова задача"><Icon n="plus" /></button>
      {edit && <TaskEditor task={edit._new ? null : edit} defaults={edit._new ? Object.fromEntries(Object.entries(edit).filter(([k, v]) => k !== '_new' && v)) : {}} onClose={() => setEdit(null)} />}
    </>
  );
}

function CalendarView({ mode, filt, onOpen, onNew }) {
  const s = useStore();
  const today = todayStr();
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState(today);
  const [gEvents, setGEvents] = useState([]);

  const days = useMemo(() => {
    const a = new Date(anchor + 'T12:00:00');
    if (mode === 'week') {
      const start = new Date(a); start.setDate(a.getDate() - ((a.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return dstr(d); });
    }
    const first = new Date(a.getFullYear(), a.getMonth(), 1, 12);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return dstr(d); });
  }, [anchor, mode]);

  useEffect(() => {
    fn('gcal', { action: 'events', from: days[0], to: days[days.length - 1] }).then((r) => setGEvents(r.events || [])).catch(() => setGEvents([]));
  }, [days]);

  // Платежі по боргах на видимий період
  const payments = useMemo(() => {
    const out = {};
    for (const d of (s.debts || []).filter((x) => x.is_active && x.kind !== 'credit_line' && x.next_payment_date)) {
      let x = nextDue(d, new Date());
      for (let i = 0; i < 3 && x; i++) {
        const k = dstr(x);
        (out[k] = out[k] || []).push(d);
        const day = +d.payment_day || x.getDate();
        const y = x.getFullYear(), m = x.getMonth() + 1;
        x = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12);
      }
    }
    for (const d of (s.debts || []).filter((x) => x.is_active && x.kind === 'credit_line' && x.grace_until && +x.balance > 0)) {
      (out[d.grace_until] = out[d.grace_until] || []).push({ ...d, name: 'Моно: кінець пільгового', monthly_payment: d.balance });
    }
    return out;
  }, [s.debts]);

  const tasksBy = useMemo(() => {
    const m = {};
    for (const t of (s.tasks || []).filter((t) => t.due_date && filt(t))) (m[t.due_date] = m[t.due_date] || []).push(t);
    return m;
  }, [s.tasks, filt]);
  const evBy = useMemo(() => {
    const m = {};
    for (const e of gEvents) { const k = String(e.start).slice(0, 10); (m[k] = m[k] || []).push(e); }
    return m;
  }, [gEvents]);

  const a = new Date(anchor + 'T12:00:00');
  const shift = (n) => {
    const d = new Date(a);
    if (mode === 'week') d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n, 1);
    setAnchor(dstr(d));
  };
  const sphereColor = (id) => s.spheres.find((x) => x.id === id)?.color || '#94a3b8';
  const selTasks = (tasksBy[sel] || []).sort((x, y) => String(x.due_time || '99').localeCompare(String(y.due_time || '99')));

  const DayList = ({ day }) => (
    <>
      {(payments[day] || []).map((d, i) => <div key={'p' + i} className="list-row"><span className="tag bad">₴</span><div className="grow">{d.name}</div><b className="num">{money2(d.monthly_payment)}</b></div>)}
      {(evBy[day] || []).map((e) => <div key={e.id} className="list-row"><span className="tag grey">G</span><div className="grow">{e.title}</div><span className="muted">{e.allDay ? 'весь день' : new Date(e.start).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span></div>)}
      {(tasksBy[day] || []).sort((x, y) => String(x.due_time || '99').localeCompare(String(y.due_time || '99'))).map((t) => <TaskRow key={t.id} t={t} onOpen={onOpen} showDate={false} />)}
    </>
  );

  return (
    <>
      <div className="between" style={{ marginBottom: 8 }}>
        <button className="btn ghost" onClick={() => shift(-1)}><Icon n="left" /></button>
        <b>{mode === 'week' ? `${prettyDate(days[0], false)} – ${prettyDate(days[6], false)}` : `${MONTHS_NOM[a.getMonth()]} ${a.getFullYear()}`}</b>
        <button className="btn ghost" onClick={() => shift(1)}><Icon n="right" /></button>
      </div>
      {mode === 'month' ? (
        <>
          <div className="cal" style={{ marginBottom: 12 }}>
            {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'].map((d) => <div key={d} className="h">{d}</div>)}
            {days.map((d) => {
              const ts = tasksBy[d] || [];
              return (
                <div key={d} className={`d ${d.slice(5, 7) !== anchor.slice(5, 7) ? 'out' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)}>
                  <div className="n">{+d.slice(8)}</div>
                  {payments[d] && <div className="pay">₴</div>}
                  {ts.slice(0, 3).map((t) => <i key={t.id} className="pip" style={{ background: t.status === 'done' ? '#d1d5db' : sphereColor(t.sphere_id) }} />)}
                  {(evBy[d] || []).length > 0 && <i className="pip" style={{ background: '#cbd5e1' }} />}
                </div>
              );
            })}
          </div>
          <div className="card">
            <h3>{prettyDate(sel)} <button className="btn ghost sm act" onClick={() => onNew(sel)}><Icon n="plus" size={16} />Задача</button></h3>
            <DayList day={sel} />
            {!selTasks.length && !(payments[sel] || []).length && !(evBy[sel] || []).length && <div className="muted">Порожньо</div>}
          </div>
        </>
      ) : (
        days.map((d) => (
          <div key={d} className="card" style={d === today ? { boxShadow: '0 0 0 2px var(--accent)' } : null}>
            <h3><span>{prettyDate(d)}</span><button className="btn ghost sm act" onClick={() => onNew(d)}><Icon n="plus" size={16} /></button></h3>
            <DayList day={d} />
            {!(tasksBy[d] || []).length && !(payments[d] || []).length && !(evBy[d] || []).length && <div className="muted">—</div>}
          </div>
        ))
      )}
    </>
  );
}
