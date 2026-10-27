import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { fn } from '../lib/supa.js';
import { Icon } from '../ui.jsx';
import { todayStr, prettyDate } from '../lib/util.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

export function useSpeech(onText) {
  const [rec, setRec] = useState(false);
  const [interim, setInterim] = useState('');
  const ref = useRef(null);
  const stop = () => { try { ref.current?.stop(); } catch { /* */ } setRec(false); setInterim(''); };
  const start = () => {
    if (!SR) return false;
    const r = new SR();
    r.lang = 'uk-UA'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let fin = '', mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript; else mid += e.results[i][0].transcript;
      }
      if (fin) onText(fin.trim());
      setInterim(mid);
    };
    r.onend = () => { setRec(false); setInterim(''); };
    r.onerror = () => { setRec(false); setInterim(''); };
    ref.current = r; r.start(); setRec(true);
    return true;
  };
  useEffect(() => () => { try { ref.current?.abort(); } catch { /* */ } }, []);
  return { supported: !!SR, rec, interim, start, stop };
}

const ICON = { task: '📅', expense: '💸', income: '💰', habit: '✅', date: '🎂', fact: '🧠', debt_payment: '🏦', shift: '🚕' };
const LABEL = { task: 'Задача', expense: 'Витрата', income: 'Дохід', habit: 'Звичка', date: 'Важлива дата', fact: 'Запам\'ятати', debt_payment: 'Платіж по боргу', shift: 'Зміна Уклон' };

export default function Capture() {
  const s = useStore();
  const [text, setText] = useState('');
  const [stage, setStage] = useState('input'); // input | parsing | drafts | saving
  const [items, setItems] = useState([]);
  const [comment, setComment] = useState('');
  const sp = useSpeech((t) => setText((x) => (x ? x + ' ' : '') + t));

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    if (sp.supported) setTimeout(() => sp.start(), 250);
    return () => { document.body.style.overflow = ''; };
  }, []); // eslint-disable-line

  const close = () => { sp.stop(); s.closeCapture(); if (window.location.hash.startsWith('#capture')) window.history.replaceState(null, '', '#today'); };
  const parse = async () => {
    sp.stop();
    const t = text.trim(); if (!t) return;
    setStage('parsing');
    try {
      const r = await fn('assistant', { action: 'capture', text: t });
      setItems((r.items || []).map((x, i) => ({ ...x, _k: i })));
      setComment(r.comment || '');
      setStage('drafts');
    } catch (e) { s.flash(e.message, 'err'); setStage('input'); }
  };
  const commit = async () => {
    setStage('saving');
    try {
      const clean = items.map(({ _k, ...x }) => x); // eslint-disable-line no-unused-vars
      const r = await fn('assistant', { action: 'commit', items: clean, source_text: text.trim() });
      await s.reload();
      if (r.failed?.length) s.flash(`Внесено ${r.done.length}, помилки: ${r.failed.map((f) => f.error).join('; ')}`, 'err');
      else s.flash(`Внесено: ${r.done.length} ✓`);
      close();
    } catch (e) { s.flash(e.message, 'err'); setStage('drafts'); }
  };
  const upd = (k, patch) => setItems((xs) => xs.map((x) => (x._k === k ? { ...x, ...patch } : x)));
  const del = (k) => setItems((xs) => xs.filter((x) => x._k !== k));

  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ minHeight: '70dvh' }}>
        <div className="between"><h2>{stage === 'drafts' ? 'Перевір і внеси' : 'Що сталось?'}</h2>
          <button className="btn ghost" onClick={close} aria-label="Закрити"><Icon n="x" /></button></div>

        {(stage === 'input' || stage === 'parsing') && (
          <>
            {sp.supported && (
              <button className={`cap-mic ${sp.rec ? 'rec' : ''}`} onClick={() => (sp.rec ? sp.stop() : sp.start())} aria-label="Мікрофон">
                <Icon n="mic" />
              </button>
            )}
            <div className="muted" style={{ textAlign: 'center', marginBottom: 10 }}>
              {sp.rec ? 'Слухаю… говори вільно' : sp.supported ? 'Натисни і говори, або пиши' : 'Голос недоступний у цьому браузері — пиши'}
            </div>
            <textarea className="input" rows={4} value={text + (sp.interim ? (text ? ' ' : '') + sp.interim : '')} onChange={(e) => setText(e.target.value)}
              placeholder="Заправився на 1200, кава 60 готівкою, завтра о 10 деканат, помолився" />
            <div className="chips-q">
              {['Обід у їдальні 228', 'Зміна Уклон 1100, 5 год', 'Помолився і читав Біблію'].map((q) => (
                <button key={q} className="qchip" onClick={() => setText((x) => (x ? x + ', ' : '') + q)}>{q}</button>))}
            </div>
            <button className="btn pri block mt" style={{ height: 48 }} disabled={!text.trim() || stage === 'parsing'} onClick={parse}>
              {stage === 'parsing' ? 'Розбираю…' : 'Розібрати'}
            </button>
          </>
        )}

        {(stage === 'drafts' || stage === 'saving') && (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>«{text.trim()}»</div>
            {comment && <div className="tag warn" style={{ marginBottom: 8 }}>{comment}</div>}
            {!items.length && <div className="card muted">Нічого не розпізнав. Повернись і скажи інакше.</div>}
            {items.map((it) => <Draft key={it._k} it={it} upd={(p) => upd(it._k, p)} del={() => del(it._k)} />)}
            <div className="row mt">
              <button className="btn" onClick={() => setStage('input')}>← Змінити текст</button>
              <div className="grow" />
              <button className="btn ok" style={{ height: 46 }} disabled={!items.length || stage === 'saving'} onClick={commit}>
                {stage === 'saving' ? 'Вношу…' : `Внести все (${items.length})`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Draft({ it, upd, del }) {
  const s = useStore();
  const exp = s.categories.filter((c) => c.kind !== 'income');
  const inc = s.categories.filter((c) => c.kind === 'income');
  const typeSel = (
    <select className="input" style={{ width: 'auto', padding: '4px 6px', fontSize: 13 }} value={it.type} onChange={(e) => upd({ type: e.target.value })}>
      {Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
  const I = (k, ph, type = 'text', extra = {}) => (
    <input className="input" type={type} inputMode={type === 'number' ? 'decimal' : undefined} placeholder={ph} value={it[k] ?? ''} onChange={(e) => upd({ [k]: type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value })} {...extra} />
  );
  const sel = (k, list, ph) => (
    <select className="input" value={it[k] || ''} onChange={(e) => upd({ [k]: e.target.value })}>
      <option value="">{ph}</option>{list.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
    </select>
  );
  return (
    <div className="draft">
      <div className="hd"><span className="ic">{ICON[it.type] || '•'}</span>{typeSel}<div className="grow" />
        {it.date && <span className="muted">{prettyDate(it.date)}</span>}
        <button className="btn ghost sm" onClick={del} aria-label="Прибрати"><Icon n="x" size={16} /></button></div>
      {it.type === 'task' && (<>
        {I('title', 'Що зробити')}
        <div className="row2">{I('date', '', 'date')}{I('time', '', 'time')}</div>
        <div className="row2">{sel('sphere', s.spheres, 'Сфера')}
          <select className="input" value={it.priority || 2} onChange={(e) => upd({ priority: +e.target.value })}><option value={1}>Високий</option><option value={2}>Звичайний</option><option value={3}>Низький</option></select></div>
      </>)}
      {(it.type === 'expense' || it.type === 'income') && (<>
        <div className="row2">{I('amount', '₴', 'number', { style: { fontWeight: 700, fontSize: 17 } })}{I('title', 'Опис')}</div>
        <div className="row2">{sel('category', it.type === 'income' ? inc : exp, 'Категорія')}{sel('account', s.accounts, 'Готівка')}</div>
        {I('date', '', 'date')}
      </>)}
      {it.type === 'debt_payment' && (<>
        <div className="row2">{I('amount', '₴', 'number')}{sel('debt', s.debts.filter((d) => d.is_active), 'Борг')}</div>
        <div className="row2">{sel('account', s.accounts, 'Рахунок')}
          <select className="input" value={it.debt_effect || 'scheduled'} onChange={(e) => upd({ debt_effect: e.target.value })}><option value="scheduled">Плановий</option><option value="prepay">Дострокове в тіло</option></select></div>
      </>)}
      {it.type === 'habit' && <div className="row2">{sel('habit', s.habits.filter((h) => h.is_active), 'Звичка')}{I('date', '', 'date')}</div>}
      {it.type === 'date' && <div className="row2">{I('title', 'Подія')}{I('date', '', 'date')}</div>}
      {it.type === 'fact' && I('title', 'Що запам\'ятати')}
      {it.type === 'shift' && <div className="row2">{I('amount', 'Чистими ₴', 'number')}{I('hours', 'Годин', 'number')}</div>}
      {!it.date && ['expense', 'income', 'habit', 'shift'].includes(it.type) && <div className="muted" style={{ marginTop: 4 }}>Дата: сьогодні ({todayStr()})</div>}
    </div>
  );
}
