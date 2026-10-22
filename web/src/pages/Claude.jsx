import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb, fn } from '../lib/supa.js';
import { Icon, Md } from '../ui.jsx';

const SUGGEST = [
  'Скільки реально відкласти цього місяця і куди?',
  'Де я перевитрачаю і як врізати їжу на 3к?',
  'Хочу спробувати нову нішу — допоможи оцінити',
  'Переїзд у лютому замість грудня — що зміниться?',
];

export default function Claude() {
  const s = useStore();
  const [msgs, setMsgs] = useState([]);
  const [pending, setPending] = useState([]);
  const [log, setLog] = useState([]);
  const [text, setText] = useState('');
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const end = useRef(null);

  const load = async () => {
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const [m, a, l, u] = await Promise.all([
      sb.from('ai_messages').select('*').order('created_at', { ascending: false }).limit(40),
      sb.from('ai_actions').select('*').eq('status', 'proposed').order('created_at'),
      sb.from('ai_actions').select('*').in('status', ['applied', 'undone']).order('created_at', { ascending: false }).limit(30),
      sb.from('ai_usage').select('cost_usd').gte('created_at', m0.toISOString()),
    ]);
    setMsgs((m.data || []).reverse()); setPending(a.data || []); setLog(l.data || []);
    setSpent((u.data || []).reduce((x, r) => x + +r.cost_usd, 0));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, pending.length, busy]);

  const send = async (t) => {
    const message = (t ?? text).trim(); if (!message) return;
    setText(''); setBusy(true);
    setMsgs((m) => [...m, { id: 'tmp', role: 'user', content: message }]);
    try {
      const r = await fn('assistant', { action: 'chat', message, deep });
      if (r.applied?.length) await s.reload(['tasks', 'checklist', 'habits', 'habitLogs', 'dates']);
    } catch (e) { s.flash(e.message, 'err'); }
    await load(); setBusy(false);
  };
  const decide = async (ids, action) => {
    try {
      await fn('assistant', { action, ids });
      await s.reload(['transactions', 'accounts', 'debts', 'params', 'streams', 'goals', 'categories']);
      s.flash(action === 'confirm' ? 'Застосовано' : 'Відхилено');
    } catch (e) { s.flash(e.message, 'err'); }
    load();
  };
  const undo = async (id) => {
    try { await fn('assistant', { action: 'undo', id }); await s.reload(); s.flash('Скасовано'); } catch (e) { s.flash(e.message, 'err'); }
    load();
  };
  const budget = +s.params.ai_budget_usd || 5;

  return (
    <>
      <div className="top"><h1>Claude</h1>
        <div className="row"><span className="muted num">${spent.toFixed(2)} / ${budget}</span>
          <button className="btn ghost sm" onClick={() => setShowLog(!showLog)}>{showLog ? 'Чат' : 'Журнал'}</button></div></div>

      {showLog ? (
        <div className="card"><h3>Журнал змін</h3>
          {!log.length && <div className="muted">Поки порожньо.</div>}
          {log.map((a) => (
            <div key={a.id} className="list-row">
              <div className="grow"><div className="small" style={a.status === 'undone' ? { textDecoration: 'line-through', color: 'var(--ink3)' } : null}>{(a.preview || []).join(' · ')}</div>
                <div className="muted">{new Date(a.created_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
              {a.status === 'applied' && <button className="btn sm" onClick={() => undo(a.id)}><Icon n="undo" size={14} />Відмінити</button>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ paddingBottom: 90 }}>
          {!msgs.length && (
            <div className="card"><div className="small" style={{ marginBottom: 8 }}>Пиши як людині: «закинув 8000 на ліміт», «дизель 98», «завтра о 10 зустріч з постачальником», «скільки відкласти?». Задачі змінюються одразу, гроші — після «Застосувати».</div>
              <div className="stack">{SUGGEST.map((q) => <button key={q} className="btn block" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => send(q)}>{q}</button>)}</div></div>
          )}
          {msgs.map((m) => (
            <div key={m.id + m.created_at} className={`msg ${m.role}`}>{m.role === 'user' ? m.content : <Md text={m.content} />}</div>
          ))}
          {pending.length > 0 && (
            <div className="card" style={{ border: '1px solid var(--accent)' }}>
              <h3>Підтверди зміни {pending.length > 1 && <span className="act row"><button className="btn sm" onClick={() => decide(pending.map((p) => p.id), 'reject')}>Усі ні</button><button className="btn ok sm" onClick={() => decide(pending.map((p) => p.id), 'confirm')}>Застосувати всі</button></span>}</h3>
              {pending.map((p) => (
                <div key={p.id} className="proposal">
                  {(p.preview || []).map((l, i) => <div key={i} className={i ? 'small' : ''}>{i ? '→ ' : ''}{l}</div>)}
                  <div className="row mt"><div className="grow" /><button className="btn sm" onClick={() => decide([p.id], 'reject')}>Ні</button><button className="btn ok sm" onClick={() => decide([p.id], 'confirm')}><Icon n="check" size={14} />Застосувати</button></div>
                </div>
              ))}
            </div>
          )}
          {busy && <div className="msg assistant muted">Думаю…</div>}
          <div ref={end} />
        </div>
      )}

      {!showLog && (
        <div className="composer"><div className="in">
          <button className={`btn sm ${deep ? 'pri' : ''}`} style={{ height: 44 }} onClick={() => setDeep(!deep)} title="Глибокий аналіз (Sonnet, дорожче)">{deep ? 'Глибоко' : 'Швидко'}</button>
          <textarea className="input" rows={1} value={text} placeholder="Напиши Claude…" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); send(); } }} />
          <button className="btn pri" style={{ height: 44 }} disabled={busy || !text.trim()} onClick={() => send()}><Icon n="send" size={18} /></button>
        </div></div>
      )}
    </>
  );
}
