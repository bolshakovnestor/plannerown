import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb, fn } from '../lib/supa.js';
import { Icon, Md } from '../ui.jsx';
import AdviceCard from '../components/AdviceCard.jsx';
import { useSpeech } from '../components/Capture.jsx';

const QUICK = [
  ['💡 Дай пораду', 'Подивись мої витрати й пам\'ять і запропонуй 2 найвигідніші зміни через картки-поради.'],
  ['🚕 Потаксувати 2 год?', 'Чи варто сьогодні поїхати потаксувати 2 години? Порахуй, скільки дасть і наскільки наблизить ціль, з урахуванням втоми.'],
  ['💼 Оцінити підробіток', 'Хочу оцінити підробіток: '],
  ['🛒 Чи можу купити…', 'Хочу купити '],
  ['📅 Скільки відкласти', 'Скільки реально відкласти цього місяця і куди саме?'],
];

export default function Claude({ go }) {
  const s = useStore();
  const [msgs, setMsgs] = useState([]);
  const [pending, setPending] = useState([]);
  const [text, setText] = useState('');
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState(0);
  const [iv, setIv] = useState(() => (window.location.hash.includes('interview') ? { transcript: [], q: null, options: [], done: false, loading: true } : null));
  const end = useRef(null);
  const sp = useSpeech((t) => setText((x) => (x ? x + ' ' : '') + t));

  const load = async () => {
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const [m, a, u] = await Promise.all([
      sb.from('ai_messages').select('*').in('role', ['user', 'assistant']).order('created_at', { ascending: false }).limit(40),
      sb.from('ai_actions').select('*').eq('status', 'proposed').order('created_at'),
      sb.from('ai_usage').select('cost_usd').gte('created_at', m0.toISOString()),
    ]);
    setMsgs((m.data || []).reverse()); setPending(a.data || []);
    setSpent((u.data || []).reduce((x, r) => x + +r.cost_usd, 0));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, pending.length, busy, iv?.q]);

  // --- Знайомство ---
  const ivStep = async (transcript) => {
    setIv((x) => ({ ...x, loading: true, transcript }));
    try {
      const r = await fn('assistant', { action: 'interview', transcript });
      setIv({ transcript, q: r.question, options: r.options || [], done: r.done, summary: r.summary, saved: r.saved, loading: false });
      if (r.done) { await s.reload(['params', 'facts']); s.celebrate('Знайомство завершено', 'Тепер поради будуть під тебе. Пам\'ять можна правити будь-коли.', '🤝'); }
      else if (r.saved?.length) s.reload(['facts']);
    } catch (e) { s.flash(e.message, 'err'); setIv((x) => ({ ...x, loading: false })); }
  };
  useEffect(() => { if (iv && !iv.q && iv.loading && !iv.transcript.length) ivStep([]); }, []); // eslint-disable-line
  const ivAnswer = (ans) => { const a = (ans ?? text).trim(); if (!a || !iv?.q) return; setText(''); sp.stop(); ivStep([...iv.transcript, { q: iv.q, a }]); };

  // --- Чат ---
  const send = async (t) => {
    const message = (t ?? text).trim(); if (!message) return;
    if (iv && !iv.done) return ivAnswer(message);
    setText(''); setBusy(true); sp.stop();
    setMsgs((m) => [...m, { id: 'tmp' + Date.now(), role: 'user', content: message }]);
    try {
      const r = await fn('assistant', { action: 'chat', message, deep });
      if (r.applied?.length) await s.reload(['tasks', 'checklist', 'habits', 'habitLogs', 'dates', 'facts']);
      if (r.advice?.length) await s.reload(['advice']);
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
  const newAdvice = (s.advice || []).filter((a) => a.status === 'new');
  const budget = +s.params.ai_budget_usd || 5;

  return (
    <>
      <div className="top"><h1>Claude</h1>
        <div className="row"><span className="muted num small">${spent.toFixed(2)}/${budget}</span>
          <button className="btn ghost sm" onClick={() => go('memory')}><Icon n="brain" size={16} />Пам'ять</button></div></div>

      {iv ? (
        <div className="card" style={{ paddingBottom: 18 }}>
          <div className="between"><span className="tag">Знайомство · {iv.transcript.length + 1}</span><button className="btn ghost sm" onClick={() => { setIv(null); window.history.replaceState(null, '', '#claude'); }}>Вийти</button></div>
          {iv.loading && <div className="muted mt">Думаю над наступним питанням…</div>}
          {!iv.loading && iv.done && (<>
            <div className="iv-q">Дякую, бро 🤝</div>
            {iv.summary && <Md text={iv.summary} />}
            <button className="btn pri block mt" onClick={() => { setIv(null); go('memory'); }}>Подивитись, що я запам'ятав</button>
          </>)}
          {!iv.loading && !iv.done && iv.q && (<>
            {iv.saved?.length > 0 && <div className="small pos" style={{ marginTop: 6 }}>🧠 {iv.saved.join(' · ')}</div>}
            <div className="iv-q">{iv.q}</div>
            <div className="chips-q">{(iv.options || []).map((o) => <button key={o} className="qchip" onClick={() => ivAnswer(o)}>{o}</button>)}</div>
            <div className="muted small">Або відповідай голосом/текстом унизу. Можна з деталями й сумами.</div>
            {iv.transcript.length >= 3 && <button className="btn ghost sm mt" onClick={() => ivAnswer('Досить питань, підсумуй і заверши.')}>Завершити зараз</button>}
          </>)}
        </div>
      ) : (
        <>
          {!s.params.interview_done && (
            <button className="btn block" style={{ marginBottom: 10, justifyContent: 'flex-start', background: 'var(--accent-soft)', borderColor: '#c7d2fe' }}
              onClick={() => setIv({ transcript: [], q: null, options: [], done: false, loading: true }) || ivStep([])}>👋 Пройти знайомство (10 хв) — поради стануть точнішими</button>
          )}
          <div className="chips" style={{ marginBottom: 10 }}>
            {QUICK.map(([l, q]) => <button key={l} className="chip" onClick={() => (q.endsWith(': ') || q.endsWith(' ') ? setText(q) : send(q))}>{l}</button>)}
          </div>
        </>
      )}

      {!iv && (
        <div style={{ paddingBottom: 100 }}>
          {msgs.map((m) => <div key={m.id + (m.created_at || '')} className={`msg ${m.role}`}>{m.role === 'user' ? m.content : <Md text={m.content} />}</div>)}
          {newAdvice.slice(0, 3).map((a) => <AdviceCard key={a.id} a={a} />)}
          {pending.length > 0 && (
            <div className="card" style={{ border: '1px solid var(--accent)' }}>
              <h3>Підтверди зміни {pending.length > 1 && <span className="act row"><button className="btn sm" onClick={() => decide(pending.map((p) => p.id), 'reject')}>Усі ні</button><button className="btn ok sm" onClick={() => decide(pending.map((p) => p.id), 'confirm')}>Усі так</button></span>}</h3>
              {pending.map((p) => (
                <div key={p.id} className="proposal">
                  {(p.preview || []).map((l, i) => <div key={i} className={i ? 'small' : ''}>{i ? '→ ' : ''}{l}</div>)}
                  <div className="row mt"><div className="grow" /><button className="btn sm" onClick={() => decide([p.id], 'reject')}>Ні</button><button className="btn ok sm" onClick={() => decide([p.id], 'confirm')}><Icon n="check" size={14} />Застосувати</button></div>
                </div>
              ))}
            </div>
          )}
          {busy && <div className="msg assistant muted">Рахую…</div>}
          <div ref={end} />
        </div>
      )}

      {(!iv || (!iv.done && !iv.loading)) && (
        <div className="composer"><div className="in">
          {sp.supported && <button className={`btn ${sp.rec ? 'pri' : ''}`} style={{ height: 44, width: 44, padding: 0 }} onClick={() => (sp.rec ? sp.stop() : sp.start())} aria-label="Голос"><Icon n="mic" size={20} /></button>}
          <textarea className="input" rows={1} value={text + (sp.interim ? ' ' + sp.interim : '')} placeholder={iv ? 'Твоя відповідь…' : 'Запитай або порадься…'} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); send(); } }} />
          {!iv && <button className={`btn sm ${deep ? 'pri' : ''}`} style={{ height: 44 }} onClick={() => setDeep(!deep)} title="Глибокий аналіз (дорожче)">{deep ? '🧠' : '⚡'}</button>}
          <button className="btn pri" style={{ height: 44 }} disabled={busy || !text.trim()} onClick={() => send()}><Icon n="send" size={18} /></button>
        </div></div>
      )}
    </>
  );
}
