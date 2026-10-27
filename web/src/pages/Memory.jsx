import { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb } from '../lib/supa.js';
import { Icon } from '../ui.jsx';
import AdviceCard from '../components/AdviceCard.jsx';

const KINDS = {
  spending: ['💸', 'Витрати'], schedule: ['🗓', 'Розклад'], habit: ['🔁', 'Звички'], income: ['💰', 'Доходи'],
  constraint: ['🚫', 'Не обговорюється'], preference: ['❤️', 'Вподобання'], goal: ['🎯', 'Цілі'], rejected: ['✋', 'Відхилені поради'], other: ['📝', 'Інше'],
};

export default function Memory({ go }) {
  const s = useStore();
  const [edit, setEdit] = useState(null);
  const [val, setVal] = useState('');
  const [add, setAdd] = useState({ kind: 'spending', text: '' });
  const [tab, setTab] = useState('facts');
  const facts = s.facts || [];
  const groups = Object.keys(KINDS).map((k) => [k, facts.filter((f) => f.kind === k)]).filter(([, v]) => v.length);

  const save = async (f) => { await sb.from('ai_facts').update({ text: val, confirmed_at: new Date().toISOString() }).eq('id', f.id); setEdit(null); s.reload(['facts']); };
  const del = async (f) => { await sb.from('ai_facts').delete().eq('id', f.id); s.reload(['facts']); s.flash('Забув'); };
  const create = async () => { if (!add.text.trim()) return; await sb.from('ai_facts').insert({ kind: add.kind, text: add.text.trim() }); setAdd({ ...add, text: '' }); s.reload(['facts']); };

  return (
    <>
      <div className="top"><div className="row"><button className="btn ghost" onClick={() => go('claude')}><Icon n="left" /></button><h1>Що Claude знає</h1></div></div>
      <div className="seg" style={{ display: 'flex', marginBottom: 12 }}>
        <button style={{ flex: 1 }} className={tab === 'facts' ? 'on' : ''} onClick={() => setTab('facts')}>Факти ({facts.length})</button>
        <button style={{ flex: 1 }} className={tab === 'advice' ? 'on' : ''} onClick={() => setTab('advice')}>Поради ({(s.advice || []).length})</button>
      </div>
      {tab === 'facts' && (<>
        <div className="muted small" style={{ marginBottom: 10 }}>Claude спирається на це в кожній відповіді. Застаріле — виправ або видали тут, або просто скажи йому в чаті.</div>
        {groups.map(([k, list]) => (
          <div key={k} className="card"><h3>{KINDS[k][0]} {KINDS[k][1]}</h3>
            {list.map((f) => (
              <div key={f.id} className="fact">
                {edit === f.id ? (
                  <div className="grow"><textarea className="input" rows={2} value={val} onChange={(e) => setVal(e.target.value)} />
                    <div className="row mt"><button className="btn sm" onClick={() => setEdit(null)}>Скасувати</button><button className="btn pri sm" onClick={() => save(f)}>Зберегти</button></div></div>
                ) : (<>
                  <div className="grow" onClick={() => { setEdit(f.id); setVal(f.text); }} style={{ cursor: 'pointer' }}>{f.text}
                    <div className="muted" style={{ fontSize: 11 }}>оновлено {new Date(f.confirmed_at).toLocaleDateString('uk-UA')}</div></div>
                  <button className="btn ghost sm" onClick={() => del(f)} aria-label="Видалити"><Icon n="x" size={16} /></button>
                </>)}
              </div>
            ))}
          </div>
        ))}
        {!facts.length && <div className="card muted">Поки нічого. Пройди знайомство у вкладці Claude або розкажи сам.</div>}
        <div className="card"><h3>Додати факт</h3>
          <div className="row"><select className="input" style={{ width: 140 }} value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="input" placeholder="Напр.: кава щодня ~45 ₴" value={add.text} onChange={(e) => setAdd({ ...add, text: e.target.value })} />
            <button className="btn" onClick={create}><Icon n="plus" size={16} /></button></div>
        </div>
      </>)}
      {tab === 'advice' && (<>
        {(s.advice || []).map((a) => <AdviceCard key={a.id} a={a} />)}
        {!(s.advice || []).length && <div className="card muted">Порад ще не було.</div>}
      </>)}
    </>
  );
}
