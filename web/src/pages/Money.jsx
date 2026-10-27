import { useMemo, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { sb, fn } from '../lib/supa.js';
import { Icon, Sheet, Bar } from '../ui.jsx';
import { liquidNow, nextDue, allocateIncome, commuteCost, simulate, ymLabel } from '../lib/forecast.js';
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from 'recharts';
import { uah, money2, todayStr, prettyDate } from '../lib/util.js';
import { monthStats } from './Today.jsx';

const KIND = { credit_line: 'Кредитна лінія', installment: 'Розстрочка', annuity_loan: 'Кредит (ануїтет)' };

export default function Money({ go }) {
  const [tab, setTab] = useState(() => localStorage.getItem('money-tab') || 'overview');
  const pick = (t) => { setTab(t); try { localStorage.setItem('money-tab', t); } catch { /* */ } };
  const [txOpen, setTxOpen] = useState(null);
  return (
    <>
      <div className="top"><h1>Гроші</h1>
        <button className="btn pri sm" onClick={() => setTxOpen({})}><Icon n="plus" size={16} />Операція</button></div>
      <div className="seg" style={{ marginBottom: 12, width: '100%', display: 'flex' }}>
        {[['overview', 'Огляд'], ['tx', 'Операції'], ['debts', 'Борги']].map(([k, l]) => (
          <button key={k} style={{ flex: 1 }} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>))}
      </div>
      {(tab === 'overview' || tab === 'budget') && <Overview go={go} />}
      {tab === 'tx' && <Transactions onOpen={setTxOpen} />}
      {tab === 'debts' && <Debts />}
      {tab === 'budget' && <Budget />}
      {txOpen && <TxEditor tx={txOpen.id ? txOpen : null} onClose={() => setTxOpen(null)} />}
    </>
  );
}

function Overview({ go }) {
  const s = useStore();
  const [editAcc, setEditAcc] = useState(null);
  const [editCat, setEditCat] = useState(null);
  const [alloc, setAlloc] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showAcc, setShowAcc] = useState(false);
  const input = { params: s.params, debts: s.debts, streams: s.streams, categories: s.categories, goals: s.goals, accounts: s.accounts };
  const sim = useMemo(() => simulate({ ...input, opts: { months: 36 } }), [s.debts, s.streams, s.categories, s.goals, s.accounts, s.params]); // eslint-disable-line
  const liquid = liquidNow(s.accounts, s.params);
  const debtNow = s.debts.filter((d) => d.is_active).reduce((a, d) => a + (+d.balance), 0);
  const debtStart = +s.params.debt_start_total || debtNow;
  const paidPct = debtStart ? Math.max(0, (debtStart - debtNow) / debtStart) : 0;
  const ms = monthStats(s);
  const plan = +alloc > 0 ? allocateIncome(+alloc, input) : [];

  // Віхи: кожен борг до нуля + подушка
  const milestones = [];
  const names = [...new Set(sim.rows.flatMap((r) => Object.keys(r.perDebt)))].filter((n) => !/Конвертація/.test(n));
  for (const n of names) {
    const debt = s.debts.find((d) => d.name === n);
    const done = debt && (!debt.is_active || +debt.balance <= 0);
    const isLine = debt?.kind === 'credit_line';
    const row = sim.rows.find((r) => (r.perDebt[n] ?? 0) <= 1 && (!isLine || Object.entries(r.perDebt).filter(([k]) => /Конвертація/.test(k)).every(([, v]) => v <= 1)));
    milestones.push({ key: n, label: isLine ? `${n} (з конвертацією) = 0` : `${n} = 0`, ym: done ? 'done' : row?.ym || null, done });
  }
  milestones.push({ key: 'cushion', label: `Подушка ${uah(sim.target)}`, ym: liquid >= sim.target ? 'done' : sim.cushionYM, done: liquid >= sim.target });
  milestones.sort((a, b) => (a.done ? -1 : b.done ? 1 : 0) || String(a.ym || '9999').localeCompare(String(b.ym || '9999')));
  const chart = [{ label: 'зараз', борг: debtNow }, ...sim.rows.map((r) => ({ label: r.label, борг: r.totalDebt }))];

  const sync = async () => {
    setSyncing(true);
    try { await fn('assistant', { action: 'mono_balances' }); await s.reload(['accounts', 'debts', 'transactions']); s.flash('Баланси Моно оновлено'); }
    catch (e) { s.flash(e.message, 'err'); }
    setSyncing(false);
  };
  const env = s.categories.filter((c) => c.kind === 'expense' && +c.monthly_budget > 0);

  return (
    <>
      <div className="card">
        <h3>Гора боргу <button className="btn ghost sm act" onClick={() => go('forecast')}>А що як…</button></h3>
        <div className="mountain-kpi"><span className="big num">{uah(debtNow)}</span><span className="muted">знято {Math.round(paidPct * 100)}%</span></div>
        <div style={{ height: 150, marginTop: 6 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ left: 0, right: 4, top: 6, bottom: 0 }}>
              <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4338ca" stopOpacity={0.35} /><stop offset="100%" stopColor="#4338ca" stopOpacity={0.02} /></linearGradient></defs>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={5} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => uah(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
              <Area dataKey="борг" stroke="#4338ca" strokeWidth={2.5} fill="url(#mg)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt">
          {milestones.map((m) => (
            <div key={m.key} className={`milestone ${m.done ? 'done' : ''}`}>
              <span className="dotm">{m.done ? '✓' : '⛳'}</span>
              <div className="grow">{m.label}</div>
              <span className={m.done ? 'pos small' : 'muted small'}>{m.done ? 'готово' : m.ym ? ymLabel(m.ym) : '> 3 років'}</span>
            </div>
          ))}
        </div>
        {sim.warnings.length > 0 && <div className="tag bad mt">Касовий розрив: {sim.warnings[0]}</div>}
      </div>

      <div className="card">
        <h3>Конверти місяця <span className="muted act">витрачено {uah(ms.spent)} з {uah(ms.budget)}</span></h3>
        {env.map((c) => {
          const v = ms.byCat[c.id] || 0, left = +c.monthly_budget - v, pct = v / (+c.monthly_budget || 1);
          return (
            <div key={c.id} className="env" onClick={() => setEditCat(c)}>
              <div className="between"><span className="row small"><span className="dot" style={{ background: c.color }} />{c.name}</span>
                <span><span className={`left num ${left < 0 ? 'neg' : ''}`}>{left < 0 ? '−' : ''}{uah(Math.abs(left), { noCur: true })}</span><span className="muted small"> {left < 0 ? 'понад' : 'лишилось'}</span></span></div>
              <div style={{ marginTop: 6 }}><Bar value={v} max={+c.monthly_budget} tone={pct > 1 ? 'bad' : pct > 0.85 ? 'warn' : 'ok'} /></div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Гроші зараз <button className="btn ghost sm act" onClick={sync} disabled={syncing}><Icon n="refresh" size={15} />{syncing ? '…' : 'Моно'}</button></h3>
        <div className="between"><span className="big num pos" style={{ fontSize: 24 }}>{uah(liquid)}</span><button className="btn ghost sm" onClick={() => setShowAcc(!showAcc)}>{showAcc ? 'Сховати' : 'Рахунки'}</button></div>
        {showAcc && s.accounts.map((a) => {
          const own = a.kind === 'credit_card' ? (+a.balance - (+a.credit_limit || 0)) : +a.balance;
          return (
            <div key={a.id} className="list-row" onClick={() => setEditAcc(a)} style={{ cursor: 'pointer' }}>
              <div className="grow"><div>{a.name}</div><div className="muted">{a.mono_account_id ? (a.mono_account_id.startsWith('pan:') ? 'Моно · ще не синхронізовано' : 'Моно · авто') : 'вручну'}</div></div>
              <b className={`num ${own < 0 ? 'neg' : ''}`}>{a.currency === 'USD' ? `$${money2(own)}` : `${money2(own)} ₴`}</b>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Прийшли гроші? Розподілю</h3>
        <input className="input" type="number" inputMode="decimal" placeholder="Сума, ₴" value={alloc} onChange={(e) => setAlloc(e.target.value)} />
        {plan.map((p, i) => (
          <div key={i} className="list-row"><span className={`tag ${p.kind === 'obligation' ? 'bad' : p.kind === 'cushion' ? 'ok' : p.kind === 'debt' ? 'warn' : 'grey'}`}>
            {{ obligation: 'платіж', living: 'життя', cushion: 'подушка', debt: 'борг', rest: 'вільно' }[p.kind]}</span>
            <div className="grow small">{p.label}</div><b className="num">{uah(p.amount)}</b></div>
        ))}
      </div>
      {editAcc && <AccountEditor a={editAcc} onClose={() => setEditAcc(null)} />}
      {editCat && <Sheet title={editCat.name} onClose={() => setEditCat(null)}><BudgetForm c={editCat} onClose={() => setEditCat(null)} /></Sheet>}
    </>
  );
}

function AccountEditor({ a, onClose }) {
  const s = useStore();
  const [bal, setBal] = useState(a.balance);
  const [name, setName] = useState(a.name);
  const [inc, setInc] = useState(a.include_in_total);
  return (
    <Sheet title="Рахунок" onClose={onClose}>
      <div className="field"><label className="f">Назва</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label className="f">Баланс ({a.currency}){a.kind === 'credit_card' ? ' — доступно з урахуванням ліміту' : ''}</label>
        <input className="input" type="number" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} disabled={!!a.mono_account_id && !a.mono_account_id.startsWith('pan:')} /></div>
      {a.mono_account_id && !a.mono_account_id.startsWith('pan:') && <div className="muted field">Баланс оновлюється з Monobank автоматично.</div>}
      <label className="row field small"><input type="checkbox" checked={inc} onChange={(e) => setInc(e.target.checked)} />Враховувати у «власних грошах»</label>
      <button className="btn pri block" onClick={async () => { await s.update('accounts', a.id, { name, balance: +bal, include_in_total: inc }, ['accounts']); onClose(); }}>Зберегти</button>
    </Sheet>
  );
}

function Transactions({ onOpen }) {
  const s = useStore();
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [cat, setCat] = useState('all');
  const cats = Object.fromEntries(s.categories.map((c) => [c.id, c]));
  const accs = Object.fromEntries(s.accounts.map((a) => [a.id, a]));
  const list = (s.transactions || []).filter((t) => t.occurred_at.startsWith(month) && (cat === 'all' || t.category_id === cat));
  const byDay = {};
  for (const t of list) (byDay[t.occurred_at.slice(0, 10)] = byDay[t.occurred_at.slice(0, 10)] || []).push(t);
  const months = [...new Set((s.transactions || []).map((t) => t.occurred_at.slice(0, 7)).concat(todayStr().slice(0, 7)))].sort().reverse();
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m}>{m}</option>)}</select>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">Усі категорії</option>{s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {!list.length && <div className="card muted">Операцій немає. Додай вручну, через інбокс або підключи Monobank у налаштуваннях.</div>}
      {Object.entries(byDay).map(([day, ts]) => (
        <div key={day} className="card">
          <h3>{prettyDate(day)}<span className="muted act num">{uah(ts.filter((t) => cats[t.category_id]?.kind !== 'transfer').reduce((a, t) => a + +t.amount, 0), { sign: true })}</span></h3>
          {ts.map((t) => (
            <div key={t.id} className="list-row" onClick={() => onOpen(t)} style={{ cursor: 'pointer' }}>
              <span className="dot" style={{ background: cats[t.category_id]?.color || '#cbd5e1' }} />
              <div className="grow"><div className="ellipsis">{t.description || cats[t.category_id]?.name || '—'}</div>
                <div className="muted">{cats[t.category_id]?.name || 'Без категорії'} · {accs[t.account_id]?.name || ''}{t.source === 'mono' ? ' · Моно' : t.source === 'ai' ? ' · Claude' : ''}</div></div>
              <b className={`num ${+t.amount > 0 ? 'pos' : ''}`}>{+t.amount > 0 ? '+' : '−'}{money2(Math.abs(t.amount))}{t.currency === 'USD' ? ' $' : ''}</b>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function TxEditor({ tx, onClose }) {
  const s = useStore();
  const isNew = !tx;
  const cash = s.accounts.find((a) => a.kind === 'cash');
  const [f, setF] = useState(() => tx ? {
    amount: Math.abs(tx.amount), kind: +tx.amount > 0 ? 'income' : 'expense', category_id: tx.category_id, account_id: tx.account_id,
    date: tx.occurred_at.slice(0, 10), description: tx.description || '', debt_id: tx.debt_id || '', effect: 'scheduled',
  } : { amount: '', kind: 'expense', category_id: '', account_id: cash?.id, date: todayStr(), description: '', debt_id: '', effect: 'scheduled' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cats = s.categories.filter((c) => (f.kind === 'income' ? c.kind === 'income' : c.kind !== 'income'));
  const acc = s.accounts.find((a) => a.id === f.account_id);
  const manual = acc && !acc.mono_account_id;

  const save = async () => {
    const amt = +f.amount; if (!amt) return;
    const sign = f.kind === 'income' ? 1 : -1;
    const debt = s.debts.find((d) => d.id === f.debt_id);
    const catId = f.category_id || (debt ? s.categories.find((c) => c.name === 'Погашення боргів')?.id : s.categories.find((c) => c.name === (f.kind === 'income' ? 'Інший дохід' : 'Інше'))?.id);
    const row = { amount: sign * amt, category_id: catId, account_id: f.account_id || null, occurred_at: new Date(f.date + 'T12:00:00').toISOString(), description: f.description || null, debt_id: f.debt_id || null };
    if (isNew) {
      await s.insert('transactions', { ...row, source: 'manual' });
      if (manual) await sb.from('accounts').update({ balance: +acc.balance + sign * amt }).eq('id', acc.id);
      if (debt) {
        let body = amt;
        if (debt.kind === 'annuity_loan' && f.effect === 'scheduled') body = Math.max(0, amt - (+debt.balance * +debt.rate_annual / 1200));
        const patch = { balance: Math.max(0, +debt.balance - body) };
        if (f.effect === 'scheduled' && debt.next_payment_date) {
          const x = nextDue(debt, new Date(f.date)) || new Date(debt.next_payment_date);
          const day = +debt.payment_day || x.getDate();
          const ny = x.getFullYear(), nm = x.getMonth() + 1;
          const n = new Date(ny, nm, Math.min(day, new Date(ny, nm + 1, 0).getDate()), 12);
          patch.next_payment_date = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
          if (debt.payments_left) patch.payments_left = debt.payments_left - 1;
        }
        await sb.from('debts').update(patch).eq('id', debt.id);
      }
    } else {
      await sb.from('transactions').update(row).eq('id', tx.id);
    }
    await s.reload(['transactions', 'accounts', 'debts']);
    s.flash('Збережено'); onClose();
  };
  const del = async () => {
    await s.remove('transactions', tx.id);
    if (manual) await sb.from('accounts').update({ balance: +acc.balance - +tx.amount }).eq('id', acc.id);
    await s.reload(['transactions', 'accounts']); s.flash('Видалено (борг не змінено)'); onClose();
  };
  return (
    <Sheet title={isNew ? 'Нова операція' : 'Операція'} onClose={onClose}>
      <div className="seg field" style={{ display: 'flex' }}>{[['expense', 'Витрата'], ['income', 'Дохід']].map(([k, l]) => (
        <button key={k} style={{ flex: 1 }} className={f.kind === k ? 'on' : ''} onClick={() => { set('kind', k); set('category_id', ''); }}>{l}</button>))}</div>
      <div className="field"><input className="input" style={{ fontSize: 22, fontWeight: 700 }} type="number" inputMode="decimal" autoFocus={isNew} placeholder="0 ₴" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></div>
      <div className="field chips" style={{ flexWrap: 'wrap' }}>{cats.map((c) => (
        <button key={c.id} className={`chip ${f.category_id === c.id ? 'on' : ''}`} onClick={() => set('category_id', c.id)}>{c.name}</button>))}</div>
      <div className="grid2">
        <div className="field"><label className="f">Рахунок</label><select className="input" value={f.account_id || ''} onChange={(e) => set('account_id', e.target.value)}>
          {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label className="f">Дата</label><input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></div>
      </div>
      <div className="field"><label className="f">Опис</label><input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
      {isNew && f.kind === 'expense' && (
        <div className="grid2">
          <div className="field"><label className="f">Погашення боргу</label><select className="input" value={f.debt_id} onChange={(e) => set('debt_id', e.target.value)}>
            <option value="">— ні —</option>{s.debts.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          {f.debt_id && <div className="field"><label className="f">Тип</label><select className="input" value={f.effect} onChange={(e) => set('effect', e.target.value)}>
            <option value="scheduled">Плановий платіж</option><option value="prepay">Дострокове в тіло</option></select></div>}
        </div>
      )}
      {manual && isNew && <div className="muted field">Баланс «{acc.name}» зміниться автоматично.</div>}
      <div className="row">{!isNew && <button className="btn danger" onClick={del}><Icon n="trash" size={16} />Видалити</button>}<div className="grow" />
        <button className="btn pri" onClick={save} disabled={!+f.amount}>Зберегти</button></div>
    </Sheet>
  );
}

function Debts() {
  const s = useStore();
  const [edit, setEdit] = useState(null);
  const active = s.debts.filter((d) => d.is_active);
  const monthly = active.reduce((a, d) => a + (+d.monthly_payment || 0), 0);
  return (
    <>
      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="l">Разом</div><div className="v num neg">{uah(active.reduce((a, d) => a + +d.balance, 0))}</div></div>
        <div className="kpi"><div className="l">Платежі / міс</div><div className="v num">{uah(monthly)}</div></div>
      </div>
      {active.map((d) => {
        const nd = nextDue(d, new Date());
        const monthlyInterest = d.kind === 'annuity_loan' ? +d.balance * +d.rate_annual / 1200 : 0;
        return (
          <div key={d.id} className="card" onClick={() => setEdit(d)} style={{ cursor: 'pointer' }}>
            <div className="between"><div><b>{d.name}</b><div className="muted">{d.lender} · {KIND[d.kind]}{+d.rate_annual > 0 ? ` · ${d.rate_annual}%` : d.kind === 'installment' ? ' · 0%' : ''}</div></div>
              <div className="big num" style={{ fontSize: 20 }}>{uah(d.balance)}</div></div>
            {d.kind === 'credit_line' && d.credit_limit && <div className="mt"><Bar value={+d.balance} max={+d.credit_limit} tone="bad" /><div className="muted" style={{ marginTop: 4 }}>використано з {uah(d.credit_limit)}{d.grace_until ? ` · пільговий до ${prettyDate(d.grace_until, false)}` : ''}</div></div>}
            <div className="row wrap mt small" style={{ gap: 12 }}>
              {+d.monthly_payment > 0 && <span>Платіж <b className="num">{money2(d.monthly_payment)} ₴</b></span>}
              {nd && <span>наступний {prettyDate(nd.toISOString().slice(0, 10))}</span>}
              {d.payments_left ? <span>залишилось {d.payments_left} пл.</span> : null}
              {monthlyInterest > 0 && <span className="warn">відсотки ≈ {uah(monthlyInterest)}/міс, у тіло ≈ {uah(+d.monthly_payment - monthlyInterest)}</span>}
            </div>
            {d.own_funds_required && <div className="tag warn mt">Платити власними коштами</div>}
            {d.notes && <div className="muted mt">{d.notes}</div>}
          </div>
        );
      })}
      <button className="btn block" onClick={() => setEdit({})}><Icon n="plus" size={16} />Додати борг</button>
      {s.debts.some((d) => !d.is_active) && <div className="muted mt">Закриті: {s.debts.filter((d) => !d.is_active).map((d) => d.name).join(', ')}</div>}
      {edit && <DebtEditor d={edit.id ? edit : null} onClose={() => setEdit(null)} />}
    </>
  );
}

function DebtEditor({ d, onClose }) {
  const s = useStore();
  const [f, setF] = useState(() => ({ name: '', lender: '', kind: 'installment', balance: '', monthly_payment: '', rate_annual: 0, payment_day: '', next_payment_date: '', payments_left: '', credit_limit: '', grace_until: '', own_funds_required: false, prepay_allowed: true, notes: '', is_active: true, ...(d || {}) }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const num = (k) => (f[k] === '' || f[k] === null ? null : +f[k]);
  const save = async () => {
    const row = { name: f.name, lender: f.lender, kind: f.kind, balance: num('balance') || 0, monthly_payment: num('monthly_payment') || 0, rate_annual: num('rate_annual') || 0,
      payment_day: num('payment_day'), next_payment_date: f.next_payment_date || null, payments_left: num('payments_left'), credit_limit: num('credit_limit'),
      grace_until: f.grace_until || null, own_funds_required: f.own_funds_required, prepay_allowed: f.prepay_allowed, notes: f.notes || null, is_active: f.is_active };
    if (d) await s.update('debts', d.id, row, ['debts']); else await s.insert('debts', row, ['debts']);
    onClose();
  };
  const F = ({ k, l, t = 'number' }) => <div className="field"><label className="f">{l}</label><input className="input" type={t} inputMode={t === 'number' ? 'decimal' : undefined} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></div>;
  return (
    <Sheet title={d ? d.name : 'Новий борг'} onClose={onClose}>
      <div className="grid2">{F({ k: 'name', l: 'Назва', t: 'text' })}{F({ k: 'lender', l: 'Банк', t: 'text' })}</div>
      <div className="field"><label className="f">Тип</label><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="grid2">{F({ k: 'balance', l: f.kind === 'installment' ? 'Залишок до сплати' : f.kind === 'credit_line' ? 'Використано' : 'Залишок тіла' })}{F({ k: 'monthly_payment', l: 'Платіж / міс' })}</div>
      <div className="grid2">{F({ k: 'rate_annual', l: 'Ставка, % річних' })}{F({ k: 'payment_day', l: 'День платежу' })}</div>
      <div className="grid2">{F({ k: 'next_payment_date', l: 'Наступний платіж', t: 'date' })}{F({ k: 'payments_left', l: 'Платежів залишилось' })}</div>
      {f.kind === 'credit_line' && <div className="grid2">{F({ k: 'credit_limit', l: 'Ліміт' })}{F({ k: 'grace_until', l: 'Пільговий до', t: 'date' })}</div>}
      <label className="row field small"><input type="checkbox" checked={f.own_funds_required} onChange={(e) => set('own_funds_required', e.target.checked)} />Платити лише власними коштами</label>
      <label className="row field small"><input type="checkbox" checked={f.prepay_allowed} onChange={(e) => set('prepay_allowed', e.target.checked)} />Гасити достроково, коли є надлишок</label>
      <label className="row field small"><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />Активний</label>
      <div className="field"><label className="f">Нотатки</label><textarea className="input" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="row">{d && <button className="btn danger" onClick={async () => { await s.remove('debts', d.id, ['debts']); onClose(); }}><Icon n="trash" size={16} /></button>}<div className="grow" />
        <button className="btn pri" onClick={save} disabled={!f.name}>Зберегти</button></div>
    </Sheet>
  );
}

function Budget() {
  const s = useStore();
  const ms = useMemo(() => monthStats(s), [s]);
  const cc = commuteCost(s.params);
  const [edit, setEdit] = useState(null);
  const exp = s.categories.filter((c) => c.kind === 'expense');
  return (
    <>
      <div className="grid2" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="l">Дохід місяця</div><div className="v num pos">{uah(ms.income)}</div></div>
        <div className="kpi"><div className="l">Витрати / бюджет</div><div className="v num">{uah(ms.spent)}<span className="muted"> / {uah(ms.budget, { noCur: true })}</span></div></div>
      </div>
      <div className="card"><h3>Категорії <span className="muted act">натисни, щоб змінити бюджет</span></h3>
        {exp.map((c) => {
          const v = ms.byCat[c.id] || 0;
          return (
            <div key={c.id} className="list-row" style={{ display: 'block', cursor: 'pointer' }} onClick={() => setEdit(c)}>
              <div className="between"><span className="row"><span className="dot" style={{ background: c.color }} />{c.name}</span>
                <span className={`num small ${v > +c.monthly_budget ? 'neg' : ''}`}>{uah(v, { noCur: true })} / {uah(c.monthly_budget)}</span></div>
              <div style={{ marginTop: 6 }}><Bar value={v} max={+c.monthly_budget || 1} /></div>
            </div>
          );
        })}
      </div>
      <div className="card"><h3>Дорога на роботу (з параметрів)</h3>
        <div className="small">{cc.km} км/міс · пальне <b>{uah(cc.fuel)}</b> · ТО <b>{uah(cc.service)}</b> · разом <b>{uah(cc.total)}</b></div>
        <div className="muted mt">Дизель {s.params.diesel_price} ₴/л — міняється в Налаштуваннях або командою Claude «дизель 98».</div>
      </div>
      {edit && <Sheet title={edit.name} onClose={() => setEdit(null)}><BudgetForm c={edit} onClose={() => setEdit(null)} /></Sheet>}
    </>
  );
}
function BudgetForm({ c, onClose }) {
  const s = useStore();
  const [v, setV] = useState(c.monthly_budget || '');
  const [mcc, setMcc] = useState((c.mcc_codes || []).join(', '));
  return (
    <>
      <div className="field"><label className="f">Бюджет на місяць, ₴</label><input className="input" type="number" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></div>
      <div className="field"><label className="f">MCC-коди Моно для автокатегорій</label><input className="input" value={mcc} onChange={(e) => setMcc(e.target.value)} /></div>
      <button className="btn pri block" onClick={async () => { await s.update('categories', c.id, { monthly_budget: +v || 0, mcc_codes: mcc.split(/[ ,]+/).filter(Boolean).map(Number) }, ['categories']); onClose(); }}>Зберегти</button>
    </>
  );
}
