import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { fn } from '../lib/supa.js';
import { Icon } from '../ui.jsx';
import { todayStr, prettyDate } from '../lib/util.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const CAN_REC = typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
let serverOK = true; // false, якщо на сервері немає ключа розпізнавання

const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });

/** Голос: запис аудіо → серверне розпізнавання (Whisper/gpt-4o). Запасний варіант — розпізнавання браузера. */
export function useSpeech(onText, onError) {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [interim, setInterim] = useState('');
  const r = useRef({});
  const cb = useRef({ onText, onError }); cb.current = { onText, onError };

  const startBrowser = () => {
    if (!SR) return false;
    r.current.want = true;
    const run = () => {
      const x = new SR(); x.lang = 'uk-UA'; x.continuous = false; x.interimResults = true;
      x.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        if (res.isFinal) { cb.current.onText(res[0].transcript.trim()); setInterim(''); } else setInterim(res[0].transcript);
      };
      x.onend = () => { if (r.current.want) { try { run(); } catch { setRec(false); } } else { setRec(false); setInterim(''); } };
      x.onerror = (e) => { if (e.error === 'not-allowed') { r.current.want = false; setRec(false); } };
      r.current.sr = x; x.start();
    };
    run(); setRec(true); return true;
  };

  const start = async () => {
    if (rec || busy) return;
    if (!serverOK || !CAN_REC) return startBrowser();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(r.current.timer); setRec(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        const seconds = Math.round((Date.now() - r.current.t0) / 1000);
        if (blob.size < 1500) return;
        setBusy(true);
        try {
          const out = await fn('assistant', { action: 'transcribe', audio: await toB64(blob), mime: blob.type, seconds });
          if (out.text) cb.current.onText(out.text);
        } catch (e) {
          if (String(e.message).includes('NO_OPENAI_KEY')) { serverOK = false; cb.current.onError?.('Немає ключа OPENAI_API_KEY — поки що голос браузера. Надиктуй ще раз.'); }
          else cb.current.onError?.(e.message);
        }
        setBusy(false);
      };
      r.current.mr = mr; r.current.t0 = Date.now(); setSecs(0);
      r.current.timer = setInterval(() => {
        const sec = Math.round((Date.now() - r.current.t0) / 1000); setSecs(sec);
        if (sec >= 180) mr.stop();
      }, 500);
      mr.start(1000); setRec(true);
    } catch (e) {
      cb.current.onError?.(e.name === 'NotAllowedError' ? 'Дозволь доступ до мікрофона в налаштуваннях браузера' : e.message);
    }
    return true;
  };
  const stop = () => {
    r.current.want = false;
    try { r.current.sr?.stop(); } catch { /* */ }
    if (r.current.mr?.state === 'recording') r.current.mr.stop();
  };
  useEffect(() => () => { r.current.want = false; try { r.current.sr?.abort(); } catch { /* */ } if (r.current.mr?.state === 'recording') r.current.mr.stop(); clearInterval(r.current.timer); }, []);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const status = busy ? 'Розпізнаю…' : rec ? (serverOK && CAN_REC ? `Запис ${mmss} · натисни, щоб завершити` : 'Слухаю…') : '';
  return { supported: CAN_REC || !!SR, rec, busy, interim, status, start, stop };
}

const ICON = { task: '📅', expense: '💸', income: '💰', habit: '✅', date: '🎂', fact: '🧠', debt_payment: '🏦', shift: '🚕' };
const LABEL = { task: 'Задача', expense: 'Витрата', income: 'Дохід', habit: 'Звичка', date: 'Важлива дата', fact: 'Запам\'ятати', debt_payment: 'Платіж по боргу', shift: 'Зміна Уклон' };

export default function Capture() {
  const s = useStore();
  const [text, setText] = useState('');
  const [stage, setStage] = useState('input'); // input | parsing | drafts | saving
  const [items, setItems] = useState([]);
  const [comment, setComment] = useState('');
  const sp = useSpeech((t) => setText((x) => (x ? x + ' ' : '') + t), (m) => s.flash(m, 'err'));

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
              <button className={`cap-mic ${sp.rec ? 'rec' : ''}`} disabled={sp.busy} onClick={() => (sp.rec ? sp.stop() : sp.start())} aria-label="Мікрофон">
                <Icon n="mic" />
              </button>
            )}
            <div className="muted" style={{ textAlign: 'center', marginBottom: 10 }}>
              {sp.status || (sp.supported ? 'Натисни і говори скільки треба, паузи не страшні' : 'Голос недоступний — пиши або мікрофон клавіатури')}
            </div>
            <textarea className="input" rows={4} value={text + (sp.interim ? (text ? ' ' : '') + sp.interim : '')} onChange={(e) => setText(e.target.value)}
              placeholder="Заправився на 1200, кава 60 готівкою, завтра о 10 деканат, помолився" />
            <div className="chips-q">
              {['Обід у їдальні 228', 'Зміна Уклон 1100, 5 год', 'Помолився і читав Біблію'].map((q) => (
                <button key={q} className="qchip" onClick={() => setText((x) => (x ? x + ', ' : '') + q)}>{q}</button>))}
            </div>
            <button className="btn pri block mt" style={{ height: 48 }} disabled={!text.trim() || stage === 'parsing' || sp.rec || sp.busy} onClick={parse}>
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
