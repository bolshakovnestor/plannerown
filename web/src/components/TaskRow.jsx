import { useStore } from '../lib/store.jsx';
import { Icon } from '../ui.jsx';
import { prettyDate, recurrenceLabel, todayStr } from '../lib/util.js';

export default function TaskRow({ t, onOpen, showDate = true }) {
  const s = useStore();
  const sp = s.spheres.find((x) => x.id === t.sphere_id);
  const items = (s.checklist || []).filter((c) => c.task_id === t.id);
  const overdue = t.status === 'todo' && t.due_date && t.due_date < todayStr();
  return (
    <div className={`task ${t.status === 'done' ? 'done' : ''}`}>
      <button className={`check p${t.priority} ${t.status === 'done' ? 'on' : ''}`} onClick={() => s.toggleTask(t)} aria-label="Виконано">
        {t.status === 'done' && <Icon n="check" />}
      </button>
      <div className="t grow" onClick={() => onOpen(t)}>
        <div className="title">{t.title}</div>
        <div className="meta">
          {sp && <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: sp.color }} />{sp.name}</span>}
          {showDate && t.due_date && <span className={overdue ? 'neg' : ''}>{prettyDate(t.due_date)}</span>}
          {t.due_time && <span>{t.due_time.slice(0, 5)}</span>}
          {t.recurrence && <span>↻ {recurrenceLabel(t.recurrence)}</span>}
          {items.length > 0 && <span>☑ {items.filter((i) => i.done).length}/{items.length}</span>}
          {t.notes && <span>📝</span>}
          {t.gcal_event_id && <span title="У Google Календарі">G</span>}
        </div>
      </div>
    </div>
  );
}
