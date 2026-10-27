import { useEffect, useState } from 'react';
import { sb } from './lib/supa.js';
import { StoreProvider, useStore } from './lib/store.jsx';
import { uah } from './lib/util.js';
import { Icon, Celebrate } from './ui.jsx';
import Capture from './components/Capture.jsx';
import Memory from './pages/Memory.jsx';
import Today from './pages/Today.jsx';
import Plan from './pages/Plan.jsx';
import Money from './pages/Money.jsx';
import Forecast from './pages/Forecast.jsx';
import Claude from './pages/Claude.jsx';
import Settings from './pages/Settings.jsx';

const LEFT = [['today', 'Сьогодні', 'today'], ['plan', 'План', 'plan']];
const RIGHT = [['money', 'Гроші', 'money'], ['claude', 'Claude', 'claude']];
const PARENT = { forecast: 'money', memory: 'claude', settings: 'today' };
const useHash = () => {
  const get = () => (window.location.hash.replace('#', '').split('?')[0] || 'today');
  const [h, setH] = useState(get);
  useEffect(() => { const f = () => setH(get()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return [h, (x) => { window.location.hash = x; }];
};

function Shell() {
  const s = useStore();
  const [tab, go] = useHash();
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => { if (tab === 'capture') s.openCapture(); }, [tab]); // eslint-disable-line
  // Святкування: закритий борг або досягнута подушка (один раз)
  useEffect(() => {
    if (!s.ready || !s.debts) return;
    let seen = []; try { seen = JSON.parse(localStorage.getItem('seen-ms') || '[]'); } catch { /* */ }
    const first = !localStorage.getItem('seen-ms');
    for (const d of s.debts) {
      const k = 'debt:' + d.id;
      if ((!d.is_active || +d.balance <= 0) && !seen.includes(k)) {
        seen.push(k);
        if (!first) s.celebrate('Борг закрито!', `«${d.name}» — нуль. Мінус ${uah(d.monthly_payment)} щомісяця.`, '🏔');
      }
    }
    try { localStorage.setItem('seen-ms', JSON.stringify(seen)); } catch { /* */ }
  }, [s.ready, s.debts]); // eslint-disable-line
  if (!s.ready || !s.params) return <div className="login"><div className="muted">Завантаження…</div></div>;
  const page = tab === 'capture' ? 'today' : tab;
  const Page = { today: Today, plan: Plan, money: Money, forecast: Forecast, claude: Claude, settings: Settings, memory: Memory }[page] || Today;
  const active = PARENT[page] || page;
  const Btn = ([k, label, icon]) => <button key={k} className={active === k ? 'on' : ''} onClick={() => go(k)}><Icon n={icon} />{label}</button>;
  return (
    <>
      <div className="app"><Page go={go} /></div>
      <nav className="nav"><div className="nav-in v2">
        {LEFT.map(Btn)}
        <button className="mic-btn" onClick={() => s.openCapture()} aria-label="Сказати або записати"><Icon n="mic" /></button>
        {RIGHT.map(Btn)}
      </div></nav>
      {s.capture && <Capture />}
      {s.party && <Celebrate party={s.party} onClose={s.closeParty} />}
      {s.toast && <div className={`toast ${s.toast.kind === 'err' ? 'err' : ''}`}>{s.toast.msg}</div>}
    </>
  );
}

function Login() {
  const [email, setEmail] = useState('bolshakovnestor@gmail.com');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState('in');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const f = mode === 'in' ? sb.auth.signInWithPassword : sb.auth.signUp;
    const { error } = await f.call(sb.auth, { email, password: pw });
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Невірний email або пароль' : error.message);
    else if (mode === 'up') { const r = await sb.auth.signInWithPassword({ email, password: pw }); if (r.error) setErr(r.error.message); }
    setBusy(false);
  };
  return (
    <div className="login"><form className="card" onSubmit={submit}>
      <div className="big" style={{ marginBottom: 4 }}>Планер</div>
      <div className="muted" style={{ marginBottom: 16 }}>{mode === 'in' ? 'Вхід' : 'Перший запуск: придумай пароль (мін. 6 символів)'}</div>
      <div className="field"><label className="f">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
      <div className="field"><label className="f">Пароль</label><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={6} required /></div>
      {err && <div className="neg small" style={{ marginBottom: 10 }}>{err}</div>}
      <button className="btn pri block" disabled={busy}>{mode === 'in' ? 'Увійти' : 'Створити акаунт'}</button>
      <button type="button" className="btn ghost block mt" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'Перший раз? Створити акаунт' : 'Вже є акаунт — увійти'}
      </button>
    </form></div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return null;
  if (!session) return <Login />;
  return <StoreProvider><Shell /></StoreProvider>;
}
