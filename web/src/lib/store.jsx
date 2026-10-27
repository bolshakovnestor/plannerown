import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sb } from './supa.js';
import { addDays, todayStr, nextRecurrence, habitStreak } from './util.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const LOADERS = {
  params: () => sb.from('params').select('*').maybeSingle(),
  spheres: () => sb.from('spheres').select('*').order('sort'),
  tasks: () => sb.from('tasks').select('*')
    .or(`status.eq.todo,completed_at.gte.${addDays(todayStr(), -30)}`)
    .order('due_date', { nullsFirst: false }).order('due_time', { nullsFirst: false }).limit(1000),
  checklist: () => sb.from('task_checklist').select('*').order('sort'),
  accounts: () => sb.from('accounts').select('*').order('sort'),
  categories: () => sb.from('categories').select('*').order('sort'),
  debts: () => sb.from('debts').select('*').order('sort'),
  transactions: () => sb.from('transactions').select('*').gte('occurred_at', addDays(todayStr(), -400)).order('occurred_at', { ascending: false }).limit(3000),
  streams: () => sb.from('income_streams').select('*').order('created_at'),
  goals: () => sb.from('goals').select('*').order('priority'),
  habits: () => sb.from('habits').select('*').order('sort'),
  habitLogs: () => sb.from('habit_logs').select('*').gte('day', addDays(todayStr(), -60)),
  dates: () => sb.from('important_dates').select('*').order('date'),
  facts: () => sb.from('ai_facts').select('*').eq('active', true).order('created_at'),
  advice: () => sb.from('ai_advice').select('*').order('created_at', { ascending: false }).limit(40),
};

export function StoreProvider({ children }) {
  const [data, setData] = useState({});
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);
  const [party, setParty] = useState(null);
  const [capture, setCapture] = useState(false);

  const reload = useCallback(async (keys) => {
    const ks = keys || Object.keys(LOADERS);
    const res = await Promise.all(ks.map((k) => LOADERS[k]()));
    setData((d) => {
      const n = { ...d };
      ks.forEach((k, i) => { if (!res[i].error) n[k] = res[i].data ?? (k === 'params' ? null : []); });
      return n;
    });
  }, []);

  useEffect(() => {
    (async () => {
      await sb.rpc('seed_defaults');
      await reload();
      setReady(true);
    })();
    const onFocus = () => reload(['tasks', 'accounts', 'debts', 'transactions', 'habitLogs']);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const flash = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, id: Date.now() });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const api = useMemo(() => ({
    reload, flash,
    celebrate: (title, text, emoji = '🎉') => setParty({ title, text, emoji, id: Date.now() }),
    closeParty: () => setParty(null),
    openCapture: () => setCapture(true),
    closeCapture: () => setCapture(false),
    async insert(table, row, key) {
      const { data: r, error } = await sb.from(table).insert(row).select().single();
      if (error) { flash(error.message, 'err'); throw error; }
      if (key) await reload([key].flat());
      return r;
    },
    async update(table, id, patch, key) {
      const { error } = await sb.from(table).update(patch).eq('id', id);
      if (error) { flash(error.message, 'err'); throw error; }
      if (key) await reload([key].flat());
    },
    async remove(table, id, key) {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) { flash(error.message, 'err'); throw error; }
      if (key) await reload([key].flat());
    },
    async setParams(patch) {
      const { error } = await sb.from('params').update(patch).eq('user_id', data.params.user_id);
      if (error) return flash(error.message, 'err');
      await reload(['params']);
    },
    async toggleTask(t) {
      if (t.status === 'done') {
        await sb.from('tasks').update({ status: 'todo', completed_at: null }).eq('id', t.id);
      } else {
        await sb.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', t.id);
        const nd = nextRecurrence(t.due_date, t.recurrence);
        if (nd) {
          const { id: _i, created_at: _c, updated_at: _u, completed_at: _d, gcal_event_id: _g, ...rest } = t;
          const { data: nt } = await sb.from('tasks').insert({ ...rest, status: 'todo', due_date: nd }).select().single();
          const items = (data.checklist || []).filter((c) => c.task_id === t.id);
          if (nt && items.length) await sb.from('task_checklist').insert(items.map((c) => ({ task_id: nt.id, text: c.text, sort: c.sort })));
        }
      }
      await reload(['tasks', 'checklist']);
    },
    async toggleHabit(h, day) {
      const ex = (data.habitLogs || []).find((l) => l.habit_id === h.id && l.day === day);
      if (ex) await sb.from('habit_logs').delete().eq('id', ex.id);
      else await sb.from('habit_logs').insert({ habit_id: h.id, day, value: 1 });
      const { data: logs } = await sb.from('habit_logs').select('*').gte('day', addDays(todayStr(), -60));
      setData((d) => ({ ...d, habitLogs: logs || [] }));
      if (!ex) {
        const st = habitStreak(h, logs || []);
        if ([3, 7, 14, 21, 30, 50, 100].includes(st)) setParty({ title: `${st} ${st < 5 ? 'дні' : 'днів'} поспіль`, text: `«${h.name}» — серія триває. Не зривай ланцюжок.`, emoji: '🔥', id: Date.now() });
      }
    },
  }), [reload, flash, data.params, data.checklist, data.habitLogs]);

  return <Ctx.Provider value={{ ...data, ready, toast, party, capture, ...api }}>{children}</Ctx.Provider>;
}
