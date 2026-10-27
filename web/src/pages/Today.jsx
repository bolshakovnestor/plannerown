import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb, fn } from '../lib/supa.js';
import { Icon, Md, Ring } from '../ui.jsx';
import TaskRow from '../components/TaskRow.jsx';
import TaskEditor from '../components/TaskEditor.jsx';
import AdviceCard from '../components/AdviceCard.jsx';
import { liquidNow, nextDue, safeToSpend, cushionTargetUAH } from '../lib/forecast.js';
import { uah, todayStr, daysBetween, habitDueToday, habitStreak, money2, prettyDate, kShort } from '../lib/util.js';

export function monthStats(s) {
  const m = todayStr().slice(0, 7);
  const cats = Object.fromEntries((s.categories || []).map((c) => [c.id, c]));
  let spent = 0, income = 0;
  const byCat = {};
  for (const t of s.transactions || []) {
    if (!t.occurred_at?.startsWith(m)) continue;
    const c = cats[t.category_id];
    if (c?.kind === 'transfer') continue;
    const v = Number(t.amount) * (t.currency === 'USD' ? +s.params.usd_rate : 1);
    if (v > 0) income += v; else { spent -= v; byCat[t.category_id] = (byCat[t.category_id] || 0) - v; }
  }
  const budget = (s.categories || []).filter((c) => c.kind === 'expense').reduce((a, c) => a + (+c.monthly_budget || 0), 0);
  return { spent, income, budget, byCat };
}

export function upcomingPayments(s, days = 7) {
  const now = new Date();
  const lim = new Date(); lim.setDate(lim.getDate() + days);
  return (s.debts || []).filter((d) => d.is_active && d.kind !== 'credit_line')
    .map((d) => ({ d, date: nextDue(d, now) })).filter((x) => x.date && x.date <= lim)
    .sort((a, b) => a.date - b.date);
}

const HABIT_ICON = (n) => (/молит/i.test(n) ? '🙏' : /біблі|читан/i.test(n) ? '📖' : /церкв/i.test(n) ? '⛪' : /сповід/i.test(n) ? '🕊' : /обід|їж|бутер/i.test(n) ? '🥪' : /спорт|зал|біг/i.test(n) ? '🏃' : /сон|спати/i.test(n) ? '😴' : '✓');

const kk = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',').replace(',0', '')}к` : String(Math.round(v)));

export default function Today({ go }) {
  const s = useStore();
  const [edit, setEdit] = useState(null);
  const [brief, setBrief] = useState(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [moreAdvice, setMoreAdvice] = useState(false);
  const today = todayStr();

  useEffect(() => {
    sb.from('ai_messages').select('content,created_at').eq('role', 'brief').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setBrief(data?.[0] || null));
  }, []);

  // Головна цифра
  const sts = safeToSpend({ categories: s.categories, transactions: s.transactions, params: s.params });
  const over = sts.today < 0;
  const target = cushionTargetUAH(s.goals, s.params);
  const liquid = liquidNow(s.accounts, s.params);
  const cushionPct = target ? Math.max(0, liquid) / target : 0;
  const debtNow = (s.debts || []).filter((d) => d.is_active).reduce((a, d) => a + +d.balance, 0);
  const debtStart = +s.params.debt_start_total || debtNow;
  const debtPct = debtStart ? Math.max(0, (debtStart - debtNow) / debtStart) : 0;

  // Задачі «Зараз»
  const open = useMemo(() => (s.tasks || []).filter((t) => t.status === 'todo' && t.due_date && t.due_date <= today)
    .sort((a, b) => (a.due_date < today ? 0 : 1) - (b.due_date < today ? 0 : 1) || a.priority - b.priority || String(a.due_time || '99').localeCompare(String(b.due_time || '99'))), [s.tasks, today]);
  const now3 = open.slice(0, 3);
  const doneToday = (s.tasks || []).filter((t) => t.status === 'done' && t.completed_at?.slice(0, 10) === today).length;

  const habits = (s.habits || []).filter((h) => h.is_active && habitDueToday(h))
    .filter((h) => !(h.schedule === 'monthly' && (s.habitLogs || []).some((l) => l.habit_id === h.id && l.day.slice(0, 7) === today.slice(0, 7) && l.day !== today)));

  const pays = upcomingPayments(s, 3);
  const cl = (s.debts || []).find((d) => d.is_active && d.kind === 'credit_line' && +d.balance > 0);
  const graceDays = cl?.grace_until ? daysBetween(today, cl.grace_until) : null;
  const newAdvice = (s.advice || []).filter((a) => a.status === 'new');
  const stale = (s.facts || []).filter((f) => f.kind !== 'rejected' && daysBetween(f.confirmed_at.slice(0, 10), today) > 30)
    .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at))[0];

  const getAdvice = async () => {
    setMoreAdvice(true);
    try { const r = await fn('assistant', { action: 'advice_generate', count: 2 }); await s.reload(['advice']); if (!r.advice?.length) s.flash(r.text || 'Нових ідей поки немає'); }
    catch (e) { s.flash(e.message, 'err'); }
    setMoreAdvice(false);
  };
  const confirmFact = async (f) => { await sb.from('ai_facts').update({ confirmed_at: new Date().toISOString() }).eq('id', f.id); s.reload(['facts']); };

  const d = new Date();
  const hour = d.getHours();
  const hello = hour < 12 ? 'Доброго ранку' : hour < 18 ? 'Привіт' : 'Добрий вечір';
  const briefLines = (brief?.content || '').split('\n').filter((l) => l.trim() && !/^\*\*(Ранковий бриф|Огляд тижня)/.test(l));
  const briefIsToday = brief && brief.created_at.slice(0, 10) >= new Date(Date.now() - 864e5).toISOString().slice(0, 10);

  return (
    <>
      <div className="top">
        <div><h1>{hello}, бро</h1><div className="sub">{d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
        <button className="btn ghost" onClick={() => go('settings')} aria-label="Налаштування"><Icon n="gear" /></button>
      </div>

      <div className={`hero ${over ? 'over' : ''}`} onClick={() => go('money')}>
        <div className="l">{over ? 'Сьогодні вже понад норму' : 'Можна витратити сьогодні'}</div>
        <div className="v num">{uah(over ? -sts.today : sts.today)}</div>
        <div className="s">{over ? `Завтра норма буде менша. ` : sts.spentToday ? `Вже витрачено ${uah(sts.spentToday)}. ` : ''}На їжу й дрібниці до кінця місяця: {uah(sts.leftMonth)} · {sts.daysLeft} дн.</div>
        <div className="ring-row">
          <div className="ring-item"><Ring pct={cushionPct}>{Math.round(cushionPct * 100)}%</Ring>
            <div style={{ minWidth: 0 }}><b>Подушка</b><div className="s">{kk(Math.max(0, liquid))} з {kk(target)} ₴</div></div></div>
          <div className="ring-item"><Ring pct={debtPct}>{Math.round(debtPct * 100)}%</Ring>
            <div style={{ minWidth: 0 }}><b>Борг знято</b><div className="s">лишилось {kk(debtNow)} ₴</div></div></div>
        </div>
      </div>

      {cl && graceDays !== null && graceDays >= 0 && graceDays <= 14 && (
        <div className="card" style={{ borderLeft: '4px solid var(--bad)' }}>
          <b>Пільговий Моно: {graceDays} дн.</b>
          <div className="small">До {prettyDate(cl.grace_until, false)} погасити або конвертувати ліміт ({uah(cl.balance)}). Інакше 3,1%/міс.</div>
        </div>
      )}
      {pays.length > 0 && (
        <div className="card">{pays.map(({ d: x, date }) => (
          <div key={x.id} className="between small" style={{ padding: '3px 0' }}><span>🏦 {x.name} · {prettyDate(date.toISOString().slice(0, 10))}</span><b className="num">{money2(x.monthly_payment)} ₴</b></div>))}</div>
      )}

      {briefIsToday && briefLines.length > 0 && (
        <div className="brief" onClick={() => setBriefOpen(!briefOpen)}>
          <Md text={(briefOpen ? briefLines : briefLines.slice(0, 3)).join('\n')} />
          {briefLines.length > 3 && <div className="muted small">{briefOpen ? 'Згорнути' : 'Більше…'}</div>}
        </div>
      )}

      <div className="sec-title"><span>Зараз</span><button className="btn ghost sm" onClick={() => go('plan')}>{open.length > 3 ? `Усі (${open.length})` : 'План'}</button></div>
      <div className="card">
        {now3.map((t) => <TaskRow key={t.id} t={t} onOpen={setEdit} showDate={t.due_date !== today} />)}
        {!now3.length && <div className="muted">{doneToday ? `Усе на сьогодні зроблено: ${doneToday} ✓` : 'На сьогодні порожньо. Натисни 🎙 і скажи, що плануєш.'}</div>}
      </div>

      {habits.length > 0 && (<>
        <div className="sec-title"><span>Звички</span></div>
        <div className="habits">
          {habits.map((h) => {
            const on = (s.habitLogs || []).some((l) => l.habit_id === h.id && l.day === today);
            const st = habitStreak(h, s.habitLogs);
            return (
              <button key={h.id} className={`habit ${on ? 'on' : ''}`} onClick={() => s.toggleHabit(h, today)}>
                <span className="c">{on ? '✓' : HABIT_ICON(h.name)}</span>
                <span className="n">{h.name}</span>
                {st > 1 && <span className="st">🔥 {st}</span>}
              </button>
            );
          })}
        </div>
      </>)}

      {!s.params.interview_done && (
        <div className="card" style={{ background: 'var(--accent-soft)' }} onClick={() => go('claude?interview')}>
          <div className="row"><span style={{ fontSize: 26 }}>👋</span><div className="grow"><b>Знайомство з Claude</b><div className="small">10 хв питань — і поради стануть точними саме під тебе</div></div><Icon n="right" size={20} /></div>
        </div>
      )}

      {stale && (
        <div className="card">
          <div className="small muted">Ще актуально?</div>
          <div style={{ margin: '4px 0 8px' }}>{stale.text}</div>
          <div className="row"><button className="btn sm" onClick={() => go('memory')}>Змінити</button><button className="btn ok sm" onClick={() => confirmFact(stale)}>Так</button></div>
        </div>
      )}

      <div className="sec-title"><span>Порада дня</span>
        <button className="btn ghost sm" disabled={moreAdvice} onClick={getAdvice}>{moreAdvice ? 'Думаю…' : newAdvice.length ? 'Ще ідеї' : 'Дай ідею'}</button></div>
      {newAdvice.slice(0, 1).map((a) => <AdviceCard key={a.id} a={a} />)}
      {!newAdvice.length && <div className="card muted small">Натисни «Дай ідею» — Claude подивиться твої витрати й запропонує, де виграти гроші, з розрахунком, наскільки це наблизить ціль.</div>}

      {edit && <TaskEditor task={edit.id ? edit : null} defaults={{ due_date: today }} onClose={() => setEdit(null)} />}
    </>
  );
}
