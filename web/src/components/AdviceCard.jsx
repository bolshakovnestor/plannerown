import { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { fn } from '../lib/supa.js';
import { uah } from '../lib/util.js';

const REASONS = ['Немає часу', 'Не реально в моїх умовах', 'Вже так роблю', 'Не хочу на цьому економити'];

export default function AdviceCard({ a, compact }) {
  const s = useStore();
  const [rej, setRej] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (action, reason) => {
    setBusy(true);
    try {
      const r = await fn('assistant', { action, id: a.id, reason });
      await s.reload(['advice', 'facts', 'habits', 'tasks', 'categories']);
      if (action === 'advice_accept') s.celebrate('Береш у роботу', `${a.title}${+a.monthly_effect ? ` — +${uah(a.monthly_effect)}/міс до цілі` : ''}`, '💪');
      else s.flash('Запам\'ятав, більше не пропоную');
      return r;
    } catch (e) { s.flash(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <div className="advice">
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div className="t">{a.title}</div>
        {+a.monthly_effect > 0 && <div className="money">+{uah(a.monthly_effect, { noCur: true })}<span className="small"> ₴/міс</span></div>}
      </div>
      {a.detail && !compact && <div className="small mt" style={{ color: 'var(--ink2)' }}>{a.detail}</div>}
      {a.effect?.text && <div className="eff">🎯 {a.effect.text}</div>}
      {a.status === 'new' && !rej && (
        <div className="row mt">
          <button className="btn" disabled={busy} onClick={() => setRej(true)}>Не підходить</button>
          <div className="grow" />
          <button className="btn ok" disabled={busy} onClick={() => act('advice_accept')}>Беру 👍</button>
        </div>
      )}
      {rej && (
        <div className="mt">
          <div className="chips-q">{REASONS.map((r) => <button key={r} className="qchip" onClick={() => act('advice_reject', r)}>{r}</button>)}</div>
          <div className="row"><input className="input" placeholder="Своя причина" value={why} onChange={(e) => setWhy(e.target.value)} />
            <button className="btn" disabled={!why.trim() || busy} onClick={() => act('advice_reject', why.trim())}>OK</button></div>
        </div>
      )}
      {a.status === 'accepted' && <div className="tag ok mt">У роботі</div>}
      {a.status === 'rejected' && <div className="tag grey mt">Відхилено{a.reason ? `: ${a.reason}` : ''}</div>}
    </div>
  );
}
