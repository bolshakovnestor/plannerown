import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from 'recharts';
import { useStore } from '../lib/store.jsx';
import { Icon, Sheet } from '../ui.jsx';
import { simulate, ymLabel, addMonths, ym } from '../lib/forecast.js';
import { uah, todayStr, daysBetween } from '../lib/util.js';

const COLORS = ['#dc2626', '#f59e0b', '#8b5cf6', '#0ea5e9', '#4338ca', '#059669', '#db2777', '#64748b'];
const k = (v) => `${Math.round(v / 1000)}к`;
const tip = { contentStyle: { borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12 }, formatter: (v) => uah(v) };

export default function Forecast({ go }) {
  const s = useStore();
  const p = s.params;
  const [o, setO] = useState({
    scenario: 'real', strategy: p.strategy || 'cushion_first', moveDate: p.move_in_date || '', extraShifts: 0, foodCut: 0,
    convertMonths: +p.limit_convert_months || 6, feePct: +p.limit_conv_fee_pct || 1.9, streamOverrides: {}, months: 24,
  });
  const [editStream, setEditStream] = useState(null);
  const set = (key, v) => setO((x) => ({ ...x, [key]: v }));
  const input = { params: p, debts: s.debts, streams: s.streams, categories: s.categories, goals: s.goals, accounts: s.accounts };
  const sim = useMemo(() => simulate({ ...input, opts: o }), [s.debts, s.streams, s.categories, s.goals, s.accounts, p, o]); // eslint-disable-line
  const base = useMemo(() => simulate({ ...input, opts: { months: 24 } }), [s.debts, s.streams, s.categories, s.goals, s.accounts, p]); // eslint-disable-line

  const debtNames = [...new Set(sim.rows.flatMap((r) => Object.keys(r.perDebt)))];
  const chartRows = sim.rows.map((r) => ({ label: r.label, борг: r.totalDebt, гроші: r.cash, дохід: r.income, витрати: r.living + r.oneTime + r.oblig, ...r.perDebt }));
  const diff = (a, b) => (a && b ? (Number(a.slice(0, 4)) * 12 + Number(a.slice(5))) - (Number(b.slice(0, 4)) * 12 + Number(b.slice(5))) : null);
  const delta = (a, b) => { const d = diff(a, b); return d === null || d === 0 ? null : d < 0 ? <span className="pos"> {d} міс</span> : <span className="neg"> +{d} міс</span>; };
  const defaults = { scenario: 'real', strategy: p.strategy, moveDate: p.move_in_date || '', extraShifts: 0, foodCut: 0, convertMonths: +p.limit_convert_months, feePct: +p.limit_conv_fee_pct };
  const changed = Object.entries(defaults).some(([key, v]) => String(o[key] ?? '') !== String(v ?? '')) || Object.keys(o.streamOverrides).length > 0;

  // Факт за останні 6 місяців
  const history = useMemo(() => {
    const cats = Object.fromEntries(s.categories.map((c) => [c.id, c]));
    const cur = ym(new Date());
    const ms = Array.from({ length: 6 }, (_, i) => addMonths(cur, i - 5));
    const m = Object.fromEntries(ms.map((x) => [x, { label: ymLabel(x), дохід: 0, витрати: 0 }]));
    for (const t of s.transactions || []) {
      const key = t.occurred_at.slice(0, 7);
      if (!m[key] || cats[t.category_id]?.kind === 'transfer') continue;
      const v = +t.amount * (t.currency === 'USD' ? +p.usd_rate : 1);
      if (v > 0) m[key].дохід += v; else m[key].витрати -= v;
    }
    return ms.map((x) => m[x]);
  }, [s.transactions, s.categories, p.usd_rate]);
  const hasHistory = history.some((h) => h.дохід || h.витрати);

  const saveDefaults = async () => {
    await s.setParams({ strategy: o.strategy, move_in_date: o.moveDate || null, limit_convert_months: o.convertMonths, limit_conv_fee_pct: o.feePct });
    for (const [id, on] of Object.entries(o.streamOverrides)) await s.update('income_streams', id, { in_forecast: on });
    await s.reload(['streams']); set('streamOverrides', {});
    s.flash('Збережено як базовий план');
  };

  return (
    <>
      <div className="top"><div className="row"><button className="btn ghost" onClick={() => go('money')}><Icon n="left" /></button><h1>А що як…</h1></div><span className="muted">на {o.months} міс</span></div>

      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="l">Подушка {uah(sim.target)}</div><div className="v">{sim.cushionYM ? ymLabel(sim.cushionYM) : '> 2 років'}{changed && delta(sim.cushionYM, base.cushionYM)}</div></div>
        <div className="kpi"><div className="l">Ліміт Моно = 0</div><div className="v">{sim.creditLineFreeYM ? ymLabel(sim.creditLineFreeYM) : '—'}{changed && delta(sim.creditLineFreeYM, base.creditLineFreeYM)}</div></div>
        <div className="kpi"><div className="l">Усі борги = 0</div><div className="v">{sim.debtFreeYM ? ymLabel(sim.debtFreeYM) : '> 2 років'}{changed && delta(sim.debtFreeYM, base.debtFreeYM)}</div></div>
        <div className="kpi"><div className="l">Відсотки + комісії</div><div className="v num">{uah(sim.interestTotal + sim.feeTotal)}</div>
          {changed && <div className="muted" style={{ fontSize: 11 }}>база {uah(base.interestTotal + base.feeTotal)}</div>}</div>
      </div>
      {sim.warnings.length > 0 && <div className="card" style={{ borderLeft: '4px solid var(--bad)' }}><b className="neg">Касові розриви</b><div className="small mt">{sim.warnings.slice(0, 4).join(' · ')}</div>
        <div className="muted mt">Гроші закінчуються — посунь з'їзд, збільш конвертацію або додай змін.</div></div>}

      <div className="card">
        <h3>Сценарій {changed && <button className="btn pri sm act" onClick={saveDefaults}>Зберегти як план</button>}</h3>
        <div className="field"><label className="f">Доходи</label><div className="seg">{[['pess', 'Песимістично'], ['real', 'Реально'], ['opt', 'Оптимістично']].map(([v, l]) => (
          <button key={v} className={o.scenario === v ? 'on' : ''} onClick={() => set('scenario', v)}>{l}</button>))}</div></div>
        <div className="field"><label className="f">Куди йде надлишок</label><div className="seg">{[['cushion_first', 'Спершу подушка'], ['debt_first', 'Спершу борги']].map(([v, l]) => (
          <button key={v} className={o.strategy === v ? 'on' : ''} onClick={() => set('strategy', v)}>{l}</button>))}</div></div>
        <div className="grid2">
          <div className="field"><label className="f">З'їзд</label><input className="input" type="date" value={o.moveDate || ''} onChange={(e) => set('moveDate', e.target.value)} /></div>
          <div className="field"><label className="f">Конвертація ліміту</label><div className="row">
            <select className="input" value={o.convertMonths} onChange={(e) => set('convertMonths', +e.target.value)}>{[0, 2, 3, 4, 5, 6, 9, 12].map((n) => <option key={n} value={n}>{n ? `${n} міс` : 'не конвертувати'}</option>)}</select>
            <input className="input" style={{ width: 80 }} type="number" step="0.1" value={o.feePct} onChange={(e) => set('feePct', +e.target.value)} title="% на місяць" /></div></div>
        </div>
        <div className="field"><label className="f">Додаткові зміни в Уклоні: <b>{o.extraShifts}</b>/міс (+{uah(o.extraShifts * p.avg_shift_net)})</label>
          <input className="slider" type="range" min={0} max={12} value={o.extraShifts} onChange={(e) => set('extraShifts', +e.target.value)} /></div>
        <div className="field"><label className="f">Економія на їжі: <b>{uah(o.foodCut)}</b>/міс</label>
          <input className="slider" type="range" min={0} max={6000} step={500} value={o.foodCut} onChange={(e) => set('foodCut', +e.target.value)} /></div>
        <div className="muted">Старт: {uah(sim.startCash)} власних{sim.startNotes.length ? ` (вже з мінусом: ${sim.startNotes.join('; ')})` : ''}.</div>
      </div>

      <div className="card"><h3>Борг і гроші</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartRows} margin={{ left: -12, right: 6, top: 6 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} /><YAxis tickFormatter={k} tick={{ fontSize: 11 }} />
            <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={sim.target} stroke="#059669" strokeDasharray="4 4" />
            <Line dataKey="борг" stroke="#dc2626" strokeWidth={2.5} dot={false} />
            <Line dataKey="гроші" stroke="#059669" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="muted">Пунктир — ціль подушки.</div>
      </div>

      <div className="card"><h3>Кожен борг</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartRows} margin={{ left: -12, right: 6, top: 6 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} /><YAxis tickFormatter={k} tick={{ fontSize: 11 }} />
            <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            {debtNames.map((n, i) => <Area key={n} dataKey={n} stackId="1" stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.55} />)}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card"><h3>Дохід і витрати (план)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartRows.slice(0, 12)} margin={{ left: -12, right: 6, top: 6 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={k} tick={{ fontSize: 11 }} />
            <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <RBar dataKey="дохід" fill="#059669" radius={[4, 4, 0, 0]} /><RBar dataKey="витрати" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {hasHistory && (
        <div className="card"><h3>Факт: останні 6 місяців</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={history} margin={{ left: -12, right: 6, top: 6 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={k} tick={{ fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <RBar dataKey="дохід" fill="#059669" radius={[4, 4, 0, 0]} /><RBar dataKey="витрати" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card"><h3>Помісячно</h3>
        <div className="scroll-x"><table className="t">
          <thead><tr><th>Міс</th><th>Дохід</th><th>Життя</th><th>Борги</th><th>Вільно</th><th>Достр.</th><th>Гроші</th><th>Борг</th></tr></thead>
          <tbody>{sim.rows.slice(0, 12).map((r) => (
            <tr key={r.ym}><td>{r.label}{r.afterMove ? ' 🏠' : ''}</td><td>{k(r.income)}</td><td>{k(r.living + r.oneTime)}</td><td>{k(r.oblig)}</td>
              <td className={r.free < 0 ? 'neg' : ''}>{k(r.free)}</td><td>{r.prepaid ? k(r.prepaid) : '—'}</td><td className={r.cash < 0 ? 'neg' : ''}>{k(r.cash)}</td><td>{k(r.totalDebt)}</td></tr>))}</tbody>
        </table></div>
        <div className="muted mt">«Борги» включає обов'язкові платежі й погашення ліміту в пільговий місяць. «Достр.» — надлишок, спрямований у найдорожчий борг.</div>
      </div>

      <Streams o={o} set={set} onEdit={setEditStream} />
      {editStream && <StreamEditor st={editStream.id ? editStream : null} onClose={() => setEditStream(null)} />}
    </>
  );
}

function Streams({ o, set, onEdit }) {
  const s = useStore();
  const today = todayStr();
  return (
    <div className="card">
      <h3>Потоки доходу <button className="btn ghost sm act" onClick={() => onEdit({})}><Icon n="plus" size={16} />Нова ніша</button></h3>
      {s.streams.map((st) => {
        const on = o.streamOverrides[st.id] ?? st.in_forecast;
        const facts = (s.transactions || []).filter((t) => t.stream_id === st.id);
        const fact = facts.reduce((a, t) => a + +t.amount, 0);
        const weeks = st.start_date ? Math.max(0, daysBetween(st.start_date, today) / 7) : 0;
        const planSoFar = weeks * ((+st.income_real || 0) / 4.33);
        const pct = planSoFar > 0 ? Math.round((fact / planSoFar) * 100) : null;
        const kill = st.kind === 'side' && st.kill_after_weeks && weeks >= st.kill_after_weeks && pct !== null && pct < (st.kill_threshold_pct || 50);
        return (
          <div key={st.id} className="list-row" style={{ display: 'block' }}>
            <div className="between">
              <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!on} onChange={(e) => set('streamOverrides', { ...o.streamOverrides, [st.id]: e.target.checked })} />
                <b>{st.name}</b>{st.status === 'idea' && <span className="tag grey">гіпотеза</span>}{st.status === 'stopped' && <span className="tag bad">зупинено</span>}</label>
              <button className="btn ghost sm" onClick={() => onEdit(st)}>Змінити</button>
            </div>
            <div className="muted">{uah(st.income_pess, { noCur: true })} / {uah(st.income_real, { noCur: true })} / {uah(st.income_opt)} {+st.monthly_cost ? `· витрати ${uah(st.monthly_cost)}/міс` : ''}{st.kind === 'side' ? ` · впевненість ${st.confidence}%` : ''}</div>
            {st.kind === 'side' && st.start_date <= today && (
              <div className="small mt">Факт: <b>{uah(fact)}</b>{pct !== null ? ` · ${pct}% від плану за ${Math.floor(weeks)} тиж.` : ''}
                {st.kill_after_weeks ? ` · критерій: ${st.kill_threshold_pct || 50}% за ${st.kill_after_weeks} тиж.` : ' · без критерію зупинки'}</div>
            )}
            {kill && <div className="tag bad mt">Критерій зупинки спрацював — закривай або доводь, що ні</div>}
          </div>
        );
      })}
      <div className="muted mt">Галочка — увімкнути потік у цьому сценарії. Нова ніша за замовчуванням поза прогнозом: план ≠ факт. Позначай реальні надходження потоком в операціях (через Claude: «+2000 з ніші X»).</div>
    </div>
  );
}

function StreamEditor({ st, onClose }) {
  const s = useStore();
  const [f, setF] = useState(() => ({ name: '', kind: 'side', start_date: todayStr(), monthly_cost: 0, income_pess: 0, income_real: 0, income_opt: 0, confidence: 30, kill_after_weeks: 6, kill_threshold_pct: 50, in_forecast: false, status: 'idea', notes: '', ...(st || {}) }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const N = (k, l) => <div className="field"><label className="f">{l}</label><input className="input" type="number" inputMode="decimal" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></div>;
  const save = async () => {
    const row = { ...f };
    for (const x of ['monthly_cost', 'income_pess', 'income_real', 'income_opt', 'confidence', 'kill_after_weeks', 'kill_threshold_pct']) row[x] = row[x] === '' ? null : +row[x];
    delete row.id; delete row.user_id; delete row.created_at;
    if (st) await s.update('income_streams', st.id, row, ['streams']); else await s.insert('income_streams', row, ['streams']);
    onClose();
  };
  return (
    <Sheet title={st ? st.name : 'Нова ніша / потік'} onClose={onClose}>
      <div className="field"><label className="f">Назва</label><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label className="f">Старт</label><input className="input" type="date" value={f.start_date || ''} onChange={(e) => set('start_date', e.target.value)} /></div>
        {N('monthly_cost', 'Витрати потоку, ₴/міс')}
      </div>
      <div className="grid3">{N('income_pess', 'Песим., ₴/міс')}{N('income_real', 'Реал., ₴/міс')}{N('income_opt', 'Оптим., ₴/міс')}</div>
      <div className="grid3">{N('confidence', 'Впевненість %')}{N('kill_after_weeks', 'Перевірка, тиж.')}{N('kill_threshold_pct', 'Мін. % плану')}</div>
      <div className="field"><label className="f">Статус</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
        <option value="idea">Гіпотеза</option><option value="active">Працює</option><option value="stopped">Зупинено</option></select></div>
      <label className="row field small"><input type="checkbox" checked={!!f.in_forecast} onChange={(e) => set('in_forecast', e.target.checked)} />Включити в основний прогноз</label>
      <div className="field"><label className="f">Нотатки / гіпотеза</label><textarea className="input" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="row">{st && <button className="btn danger" onClick={async () => { await s.remove('income_streams', st.id, ['streams']); onClose(); }}><Icon n="trash" size={16} /></button>}<div className="grow" />
        <button className="btn pri" onClick={save} disabled={!f.name}>Зберегти</button></div>
    </Sheet>
  );
}
