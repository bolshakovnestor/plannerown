import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb, fn } from '../lib/supa.js';
import { Icon } from '../ui.jsx';
import { download, toCSV, todayStr } from '../lib/util.js';
import { commuteCost, housingAfterMove } from '../lib/forecast.js';

const PARAMS = [
  ['Авто і дорога', [['diesel_price', 'Дизель, ₴/л'], ['consumption_l100', 'Витрата, л/100 км'], ['commute_km_oneway', 'До роботи, км (в один бік)'], ['workdays_month', 'Робочих днів/міс'], ['maintenance_per_km', 'ТО, ₴/км']]],
  ["З'їзд", [['move_in_date', "Дата з'їзду", 'date'], ['rent_future_usd', 'Оренда, $/міс (повна)'], ['utilities_future', 'Комуналка, ₴/міс'], ['rent_share', 'Твоя частка (0.5 = навпіл)'], ['move_extra_months', 'Депозит, міс оренди'], ['food_after_move', "Їжа після з'їзду (твоя частка)"], ['leisure_after_move', 'Дозвілля після з\'їзду']]],
  ['Доходи і курс', [['avg_shift_net', 'Середня зміна Уклон, ₴ чистими'], ['avg_shift_hours', 'Тривалість зміни, год'], ['usd_rate', 'Курс $, ₴']]],
  ['Claude', [['ai_budget_usd', 'Ліміт AI, $/міс'], ['brief_time', 'Ранковий бриф', 'time']]],
];

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function Settings({ go }) {
  const s = useStore();
  const [st, setSt] = useState(null);
  const [p, setP] = useState(s.params);
  const [busy, setBusy] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const loadStatus = () => fn('gcal', { action: 'status' }).then(setSt).catch((e) => setSt({ error: e.message }));

  useEffect(() => {
    loadStatus();
    const appUrl = window.location.origin + window.location.pathname;
    if (s.params.app_url !== appUrl) s.setParams({ app_url: appUrl });
    if (window.location.hash.includes('gcal=ok')) s.flash('Google Календар підключено');
    navigator.serviceWorker?.ready.then((r) => r.pushManager.getSubscription()).then((x) => setPushOn(!!x)).catch(() => {});
  }, []); // eslint-disable-line

  const run = async (label, f) => {
    setBusy(label);
    try { await f(); } catch (e) { s.flash(e.message, 'err'); }
    setBusy(''); loadStatus();
  };
  const saveParams = async () => {
    const patch = {};
    for (const [, fields] of PARAMS) for (const [k, , t] of fields) patch[k] = t ? (p[k] || null) : (p[k] === '' ? null : +p[k]);
    await s.setParams(patch); s.flash('Параметри збережено');
  };
  const enablePush = () => run('push', async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Браузер не підтримує push. Встанови застосунок на головний екран.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Дозвіл на сповіщення не надано');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(st.vapid) });
    const j = sub.toJSON();
    await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, keys: j.keys }, { onConflict: 'endpoint' });
    setPushOn(true);
    await fn('assistant', { action: 'push_test' });
  });
  const exportAll = () => run('export', async () => {
    const tables = ['tasks', 'task_checklist', 'spheres', 'accounts', 'categories', 'debts', 'transactions', 'income_streams', 'goals', 'params', 'habits', 'habit_logs', 'important_dates', 'uklon_shifts', 'ai_messages', 'ai_actions'];
    const out = {};
    for (const t of tables) { const { data } = await sb.from(t).select('*'); out[t] = data; }
    download(`planner-${todayStr()}.json`, JSON.stringify(out, null, 2), 'application/json');
  });
  const exportCSV = (table) => run('csv', async () => {
    const { data } = await sb.from(table).select('*');
    download(`${table}-${todayStr()}.csv`, toCSV(data || []), 'text/csv');
  });
  const cc = commuteCost(p);
  const ok = (v) => <span className={`tag ${v ? 'ok' : 'grey'}`}>{v ? '✓' : '—'}</span>;

  return (
    <>
      <div className="top"><div className="row"><button className="btn ghost" onClick={() => go('today')}><Icon n="left" /></button><h1>Налаштування</h1></div></div>

      <div className="card"><h3>Підключення</h3>
        {st?.error && <div className="neg small">{st.error}</div>}
        <div className="list-row"><div className="grow"><b>Claude API</b><div className="muted">Секрет ANTHROPIC_API_KEY у Supabase</div></div>{ok(st?.has?.anthropic)}</div>
        <div className="list-row"><div className="grow"><b>Monobank</b><div className="muted">{st?.has?.mono ? (st.mono_webhook ? `Вебхук активний${st.mono_backfill_left ? ` · імпорт історії: ще ${st.mono_backfill_left} рах. (по 1 за 15 хв)` : ''}` : 'Токен є — натисни «Підключити»') : 'Секрет MONO_TOKEN у Supabase'}</div></div>
          {st?.has?.mono ? <button className="btn sm" disabled={!!busy} onClick={() => run('mono', async () => { const r = await fn('assistant', { action: 'mono_setup' }); s.flash(r.webhook ? `Моно підключено: ${r.accounts} рахунки` : `Баланси є, вебхук: ${r.webhookStatus}`); await s.reload(['accounts', 'debts']); })}>{busy === 'mono' ? '…' : st.mono_webhook ? 'Перепідключити' : 'Підключити'}</button> : ok(false)}</div>
        <div className="list-row"><div className="grow"><b>Google Календар</b><div className="muted">{st?.google ? `Підключено${st.gcal_last_sync ? ` · синк ${new Date(st.gcal_last_sync).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}` : ''}` : st?.has?.google ? 'Готово до підключення' : 'Потрібні GOOGLE_CLIENT_ID / SECRET'}</div></div>
          {st?.google ? <div className="row"><button className="btn sm" disabled={!!busy} onClick={() => run('gs', async () => { const r = await fn('gcal', { action: 'sync' }); s.flash(`Синк: ↑${r.pushed} ↓${r.pulled}`); await s.reload(['tasks']); })}>{busy === 'gs' ? '…' : 'Синк'}</button>
            <button className="btn ghost sm" onClick={() => run('gd', () => fn('gcal', { action: 'disconnect' }))}>Відключити</button></div>
            : st?.has?.google ? <button className="btn pri sm" onClick={() => run('g', async () => { const r = await fn('gcal', { action: 'auth_url' }); window.location.href = r.url; })}>Підключити</button> : ok(false)}</div>
        <div className="list-row"><div className="grow"><b>Сповіщення</b><div className="muted">Бриф о {String(s.params.brief_time).slice(0, 5)}, огляд у неділю, важливі дати</div></div>
          {pushOn ? <button className="btn sm" onClick={() => run('pt', () => fn('assistant', { action: 'push_test' }))}>Тест</button> : <button className="btn pri sm" disabled={!st?.vapid || !!busy} onClick={enablePush}>Увімкнути</button>}</div>
      </div>

      {PARAMS.map(([title, fields]) => (
        <div key={title} className="card"><h3>{title}</h3>
          <div className="grid2">{fields.map(([k, l, t]) => (
            <div key={k} className="field"><label className="f">{l}</label>
              <input className="input" type={t || 'number'} step="any" inputMode={t ? undefined : 'decimal'} value={t === 'time' ? String(p[k] || '').slice(0, 5) : (p[k] ?? '')} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>))}</div>
          {title === 'Авто і дорога' && <div className="muted">{cc.km} км/міс → пальне {Math.round(cc.fuel)} ₴ + ТО {Math.round(cc.service)} ₴</div>}
          {title === "З'їзд" && <div className="muted">Твоя частка житла: {Math.round(housingAfterMove(p))} ₴/міс</div>}
        </div>
      ))}
      <button className="btn pri block" style={{ marginBottom: 12 }} onClick={saveParams}>Зберегти параметри</button>

      <div className="card"><h3>Claude</h3>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={() => go('memory')}>🧠 Що Claude знає</button>
          <button className="btn" onClick={() => go('claude?interview')}>👋 Пройти знайомство ще раз</button>
        </div>
      </div>
      <Goals /><Spheres /><Habits /><Dates />

      <div className="card"><h3>Експорт</h3>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={exportAll}>Усе (JSON)</button>
          <button className="btn" onClick={() => exportCSV('transactions')}>Операції (CSV)</button>
          <button className="btn" onClick={() => exportCSV('tasks')}>Задачі (CSV)</button>
          <button className="btn" onClick={() => exportCSV('debts')}>Борги (CSV)</button>
        </div>
      </div>
      <Password />
      <button className="btn block danger" style={{ marginBottom: 24 }} onClick={() => sb.auth.signOut()}>Вийти</button>
    </>
  );
}

function Goals() {
  const s = useStore();
  return (
    <div className="card"><h3>Цілі</h3>
      {s.goals.map((g) => (
        <div key={g.id} className="grid3" style={{ alignItems: 'end', marginBottom: 8 }}>
          <div><label className="f">Назва</label><input className="input" defaultValue={g.name} onBlur={(e) => s.update('goals', g.id, { name: e.target.value }, ['goals'])} /></div>
          <div><label className="f">Сума ({g.currency})</label><input className="input" type="number" defaultValue={g.target_amount} onBlur={(e) => s.update('goals', g.id, { target_amount: +e.target.value }, ['goals'])} /></div>
          <div><label className="f">До</label><input className="input" type="date" defaultValue={g.deadline || ''} onBlur={(e) => s.update('goals', g.id, { deadline: e.target.value || null }, ['goals'])} /></div>
        </div>
      ))}
    </div>
  );
}

function Spheres() {
  const s = useStore();
  const [n, setN] = useState('');
  return (
    <div className="card"><h3>Сфери</h3>
      {s.spheres.map((sp) => (
        <div key={sp.id} className="row" style={{ marginBottom: 6 }}>
          <input type="color" defaultValue={sp.color} onBlur={(e) => s.update('spheres', sp.id, { color: e.target.value }, ['spheres'])} style={{ width: 36, height: 36, border: 0, background: 'none' }} />
          <input className="input" defaultValue={sp.name} onBlur={(e) => e.target.value !== sp.name && s.update('spheres', sp.id, { name: e.target.value }, ['spheres'])} />
          <button className="btn ghost sm" onClick={() => s.remove('spheres', sp.id, ['spheres'])}><Icon n="x" size={16} /></button>
        </div>
      ))}
      <div className="row"><input className="input" placeholder="Нова сфера" value={n} onChange={(e) => setN(e.target.value)} />
        <button className="btn" onClick={async () => { if (n.trim()) { await s.insert('spheres', { name: n.trim(), sort: s.spheres.length + 1 }, ['spheres']); setN(''); } }}><Icon n="plus" size={16} /></button></div>
    </div>
  );
}

function Habits() {
  const s = useStore();
  const [n, setN] = useState('');
  const [sch, setSch] = useState('daily');
  return (
    <div className="card"><h3>Звички</h3>
      {s.habits.map((h) => (
        <div key={h.id} className="list-row">
          <div className="grow" style={!h.is_active ? { color: 'var(--ink3)' } : null}>{h.name} <span className="muted">· {h.schedule === 'daily' ? 'щодня' : h.schedule === 'monthly' ? 'щомісяця' : h.schedule === 'weekly:7' ? 'неділя' : h.schedule}</span>
            <div className="muted">{(s.habitLogs || []).filter((l) => l.habit_id === h.id).length} відміток за 60 днів</div></div>
          <button className="btn ghost sm" onClick={() => s.update('habits', h.id, { is_active: !h.is_active }, ['habits'])}>{h.is_active ? 'Пауза' : 'Увімкнути'}</button>
        </div>
      ))}
      <div className="row mt"><input className="input" placeholder="Нова звичка" value={n} onChange={(e) => setN(e.target.value)} />
        <select className="input" style={{ width: 130 }} value={sch} onChange={(e) => setSch(e.target.value)}>
          <option value="daily">щодня</option><option value="weekly:1,2,3,4,5">будні</option><option value="weekly:7">неділя</option><option value="weekly:6,7">вихідні</option><option value="monthly">щомісяця</option></select>
        <button className="btn" onClick={async () => { if (n.trim()) { await s.insert('habits', { name: n.trim(), schedule: sch, sort: s.habits.length + 1 }, ['habits']); setN(''); } }}><Icon n="plus" size={16} /></button></div>
    </div>
  );
}

function Dates() {
  const s = useStore();
  const [f, setF] = useState({ title: '', date: '', yearly: true });
  return (
    <div className="card"><h3>Важливі дати</h3>
      {s.dates.map((d) => (
        <div key={d.id} className="list-row"><div className="grow">{d.title}<div className="muted">{d.date}{d.yearly ? ' · щороку' : ''} · нагадати за {d.remind_days} дн.</div></div>
          <button className="btn ghost sm" onClick={() => s.remove('important_dates', d.id, ['dates'])}><Icon n="x" size={16} /></button></div>
      ))}
      <div className="row mt wrap">
        <input className="input" style={{ flex: '2 1 140px' }} placeholder="Подія" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input className="input" style={{ flex: '1 1 120px' }} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <label className="row small"><input type="checkbox" checked={f.yearly} onChange={(e) => setF({ ...f, yearly: e.target.checked })} />щороку</label>
        <button className="btn" onClick={async () => { if (f.title && f.date) { await s.insert('important_dates', f, ['dates']); setF({ title: '', date: '', yearly: true }); } }}><Icon n="plus" size={16} /></button>
      </div>
    </div>
  );
}

function Password() {
  const s = useStore();
  const [pw, setPw] = useState('');
  return (
    <div className="card"><h3>Пароль</h3>
      <div className="row"><input className="input" type="password" autoComplete="new-password" placeholder="Новий пароль (мін. 6)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn pri" disabled={pw.length < 6} onClick={async () => {
          const { error } = await sb.auth.updateUser({ password: pw });
          if (error) s.flash(error.message, 'err'); else { setPw(''); s.flash('Пароль змінено'); }
        }}>Змінити</button></div>
    </div>
  );
}
