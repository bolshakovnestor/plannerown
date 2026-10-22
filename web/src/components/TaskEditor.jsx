import { useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb } from '../lib/supa.js';
import { Sheet, Icon } from '../ui.jsx';
import { todayStr } from '../lib/util.js';

const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

export default function TaskEditor({ task, defaults = {}, onClose }) {
  const s = useStore();
  const isNew = !task?.id;
  const [f, setF] = useState(() => ({
    title: '', sphere_id: s.spheres?.[0]?.id || null, due_date: '', duration_min: '', priority: 2, notes: '', recurrence: '',
    ...defaults, ...(task || {}),
    due_time: (task?.due_time || defaults.due_time || '').slice(0, 5),
  }));
  const [items, setItems] = useState(() => (s.checklist || []).filter((c) => c.task_id === task?.id));
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const recKind = !f.recurrence ? '' : f.recurrence.split(':')[0];
  const recDays = f.recurrence?.startsWith('weekly') ? (f.recurrence.split(':')[1] || '').split(',').filter(Boolean).map(Number) : [];

  const save = async () => {
    if (!f.title.trim()) return;
    setBusy(true);
    const row = {
      title: f.title.trim(), sphere_id: f.sphere_id || null, due_date: f.due_date || null, due_time: f.due_time || null,
      duration_min: f.duration_min ? +f.duration_min : null, priority: +f.priority, notes: f.notes || null, recurrence: f.recurrence || null,
    };
    let id = task?.id;
    if (isNew) {
      const { data, error } = await sb.from('tasks').insert(row).select().single();
      if (error) { s.flash(error.message, 'err'); setBusy(false); return; }
      id = data.id;
    } else await sb.from('tasks').update(row).eq('id', id);
    const fresh = items.filter((i) => !i.id);
    if (fresh.length) await sb.from('task_checklist').insert(fresh.map((i, n) => ({ task_id: id, text: i.text, done: i.done, sort: (items.length + n) })));
    await s.reload(['tasks', 'checklist']);
    s.flash(isNew ? 'Задачу додано' : 'Збережено');
    onClose();
  };

  const toggleItem = async (it, idx) => {
    if (it.id) { await sb.from('task_checklist').update({ done: !it.done }).eq('id', it.id); s.reload(['checklist']); }
    setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, done: !x.done } : x)));
  };
  const delItem = async (it, idx) => {
    if (it.id) { await sb.from('task_checklist').delete().eq('id', it.id); s.reload(['checklist']); }
    setItems((xs) => xs.filter((_, i) => i !== idx));
  };
  const addItem = () => { if (!newItem.trim()) return; setItems((xs) => [...xs, { text: newItem.trim(), done: false }]); setNewItem(''); };
  const del = async () => { await s.remove('tasks', task.id, ['tasks', 'checklist']); s.flash('Видалено'); onClose(); };

  return (
    <Sheet title={isNew ? 'Нова задача' : 'Задача'} onClose={onClose}>
      <div className="field"><input className="input" autoFocus={isNew} placeholder="Що зробити?" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
      <div className="field chips">
        {s.spheres.map((sp) => (
          <button key={sp.id} className={`chip ${f.sphere_id === sp.id ? 'on' : ''}`} onClick={() => set('sphere_id', sp.id)}>
            <span className="dot" style={{ background: sp.color, marginRight: 6 }} />{sp.name}
          </button>
        ))}
      </div>
      <div className="grid2">
        <div className="field"><label className="f">Дата</label>
          <div className="row"><input className="input" type="date" value={f.due_date || ''} onChange={(e) => set('due_date', e.target.value)} />
            {!f.due_date && <button className="btn sm" onClick={() => set('due_date', todayStr())}>Сьогодні</button>}</div></div>
        <div className="field"><label className="f">Час (піде в Google Календар)</label><input className="input" type="time" value={f.due_time || ''} onChange={(e) => set('due_time', e.target.value)} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label className="f">Пріоритет</label>
          <div className="seg">{[[1, 'Високий'], [2, 'Звичайний'], [3, 'Низький']].map(([v, l]) => (
            <button key={v} className={+f.priority === v ? 'on' : ''} onClick={() => set('priority', v)}>{l}</button>))}</div></div>
        <div className="field"><label className="f">Тривалість, хв</label><input className="input" type="number" inputMode="numeric" value={f.duration_min || ''} onChange={(e) => set('duration_min', e.target.value)} placeholder="30" /></div>
      </div>
      <div className="field"><label className="f">Повторення</label>
        <select className="input" value={recKind} onChange={(e) => {
          const k = e.target.value;
          set('recurrence', k === '' ? '' : k === 'daily' ? 'daily' : k === 'weekly' ? `weekly:${((new Date().getDay() + 6) % 7) + 1}` : `monthly:${(f.due_date || todayStr()).slice(8, 10).replace(/^0/, '')}`);
        }}>
          <option value="">Не повторювати</option><option value="daily">Щодня</option><option value="weekly">Щотижня</option><option value="monthly">Щомісяця</option>
        </select>
        {recKind === 'weekly' && (
          <div className="chips mt">{WD.map((w, i) => {
            const on = recDays.includes(i + 1);
            return <button key={w} className={`chip ${on ? 'on' : ''}`} onClick={() => {
              const nd = on ? recDays.filter((x) => x !== i + 1) : [...recDays, i + 1].sort();
              set('recurrence', `weekly:${nd.join(',')}`);
            }}>{w}</button>;
          })}</div>
        )}
      </div>
      <div className="field"><label className="f">Нотатки</label><textarea className="input" rows={4} value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="Деталі, кого запитати, що взяти…" /></div>
      <div className="field"><label className="f">Чекліст</label>
        {items.map((it, i) => (
          <div key={it.id || 'n' + i} className="row" style={{ padding: '4px 0' }}>
            <button className={`check ${it.done ? 'on' : ''}`} onClick={() => toggleItem(it, i)}>{it.done && <Icon n="check" />}</button>
            <div className="grow" style={it.done ? { textDecoration: 'line-through', color: 'var(--ink3)' } : null}>{it.text}</div>
            <button className="btn ghost sm" onClick={() => delItem(it, i)}><Icon n="x" size={16} /></button>
          </div>
        ))}
        <div className="row mt"><input className="input" value={newItem} placeholder="Додати пункт" onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())} /><button className="btn" onClick={addItem}><Icon n="plus" size={18} /></button></div>
      </div>
      <div className="row mt">
        {!isNew && <button className="btn danger" onClick={del}><Icon n="trash" size={16} />Видалити</button>}
        <div className="grow" />
        <button className="btn pri" disabled={busy || !f.title.trim()} onClick={save}>Зберегти</button>
      </div>
    </Sheet>
  );
}
