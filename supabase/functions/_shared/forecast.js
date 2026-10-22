// Детермінований фінансовий рушій. Без залежностей: використовується і в PWA, і в Edge Functions.
// Усі суми в гривнях. Claude цифр не рахує — бере їх звідси.

export const ym = (d) => {
  const x = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};
export const addMonths = (k, n) => {
  const [y, m] = k.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
export const ymLabel = (k) => { const [y, m] = k.split('-'); return `${MONTHS[+m - 1]} ${y.slice(2)}`; };
const r2 = (x) => Math.round(x * 100) / 100;

export function commuteCost(p) {
  const km = (+p.commute_km_oneway || 0) * 2 * (+p.workdays_month || 0);
  const fuel = (km * (+p.consumption_l100 || 0)) / 100 * (+p.diesel_price || 0);
  const service = km * (+p.maintenance_per_km || 0);
  return { km, fuel: r2(fuel), service: r2(service), total: r2(fuel + service) };
}

export function housingAfterMove(p) {
  const rent = (+p.rent_future_usd || 0) * (+p.usd_rate || 0);
  return r2((rent + (+p.utilities_future || 0)) * (+p.rent_share || 0.5));
}

// Місячні витрати на життя (без боргів). afterMove — після з'їзду.
export function livingCosts(categories, p, afterMove, foodCut = 0) {
  const lines = [];
  for (const c of categories.filter((c) => c.kind === 'expense')) {
    if (c.role === 'commute_fuel' || c.role === 'commute_service') continue;
    if (afterMove && ['housing', 'food', 'leisure'].includes(c.role)) continue;
    let v = +c.monthly_budget || 0;
    lines.push({ name: c.name, role: c.role, amount: v });
  }
  const cc = commuteCost(p);
  lines.push({ name: 'Дорога на роботу (пальне)', role: 'commute_fuel', amount: cc.fuel });
  lines.push({ name: 'Дорога на роботу (ТО)', role: 'commute_service', amount: cc.service });
  if (afterMove) {
    lines.push({ name: 'Оренда + комуналка (твоя частка)', role: 'housing', amount: housingAfterMove(p) });
    lines.push({ name: 'Їжа (твоя частка)', role: 'food', amount: +p.food_after_move || 0 });
    lines.push({ name: 'Дозвілля', role: 'leisure', amount: +p.leisure_after_move || 0 });
  }
  if (foodCut) {
    const foodTotal = lines.filter((l) => l.role === 'food').reduce((s, l) => s + l.amount, 0);
    const cut = Math.min(foodCut, foodTotal);
    lines.push({ name: 'Економія на їжі', role: 'food', amount: -cut });
  }
  return { lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)) };
}

export function streamIncome(s, scenario) {
  const v = scenario === 'pess' ? s.income_pess : scenario === 'opt' ? s.income_opt : s.income_real;
  return (+v || 0) - (+s.monthly_cost || 0);
}

export function cushionTargetUAH(goals, p) {
  const g = (goals || []).filter((g) => g.is_active).sort((a, b) => a.priority - b.priority)[0];
  if (!g) return 0;
  return r2((+g.target_amount) * (g.currency === 'USD' ? +p.usd_rate : 1));
}

// Ліквідні власні гроші зараз (без кредитних коштів).
export function liquidNow(accounts, p) {
  let s = 0;
  for (const a of accounts || []) {
    if (!a.include_in_total) continue;
    const rate = a.currency === 'USD' ? +p.usd_rate : 1;
    if (a.kind === 'credit_card') {
      const own = (+a.balance || 0) - (+a.credit_limit || 0);
      if (own > 0) s += own * rate;
    } else s += (+a.balance || 0) * rate;
  }
  return r2(s);
}

/**
 * Симуляція помісячно.
 * opts: months, scenario ('pess'|'real'|'opt'), extraShifts, foodCut, moveDate, strategy ('cushion_first'|'debt_first'),
 *       convertMonths, feePct, streamOverrides {id: bool}, minBuffer, today
 */
export function simulate({ params: p, debts, streams, categories, goals, accounts, opts = {} }) {
  const today = opts.today ? new Date(opts.today) : new Date();
  const curYM = ym(today);
  const o = {
    months: 24, scenario: 'real', extraShifts: 0, foodCut: 0,
    moveDate: p.move_in_date, strategy: p.strategy || 'cushion_first',
    convertMonths: +p.limit_convert_months || 6, feePct: +p.limit_conv_fee_pct || 1.9,
    streamOverrides: {}, minBuffer: 3000, ...opts,
  };
  const moveYM = o.moveDate ? ym(o.moveDate) : null;
  const target = cushionTargetUAH(goals, p);

  // Борги: копії; платежі поточного місяця, що ще попереду, списуємо зі старту.
  let ds = (debts || []).filter((d) => d.is_active).map((d) => ({ ...d, bal: +d.balance }));
  let cash = liquidNow(accounts, p);
  const startNotes = [];
  for (const d of ds) {
    if (d.kind === 'credit_line' || !d.next_payment_date) continue;
    const npd = new Date(d.next_payment_date + 'T12:00:00');
    if (ym(npd) === curYM && npd >= new Date(today.toDateString())) {
      const pay = Math.min(+d.monthly_payment, d.bal);
      if (d.kind === 'annuity_loan') {
        const int = d.bal * (+d.rate_annual) / 1200;
        d.bal = r2(d.bal + int - pay);
      } else d.bal = r2(d.bal - pay);
      cash -= pay;
      startNotes.push(`${d.name}: ${pay.toFixed(2)} до кінця місяця`);
    }
  }
  const startCash = r2(cash);

  const rows = [];
  let interestTotal = 0, feeTotal = 0;
  const warnings = [];
  for (let i = 1; i <= o.months; i++) {
    const k = addMonths(curYM, i);
    const afterMove = moveYM ? k >= moveYM : false;

    let income = 0;
    for (const s of streams || []) {
      const on = o.streamOverrides[s.id] ?? s.in_forecast;
      if (!on || s.status === 'stopped') continue;
      if (s.start_date && ym(s.start_date) > k) continue;
      income += streamIncome(s, o.scenario);
    }
    income += (+o.extraShifts || 0) * (+p.avg_shift_net || 0);

    const living = livingCosts(categories, p, afterMove, +o.foodCut || 0).total;
    const oneTime = k === moveYM
      ? r2((+p.rent_future_usd) * (+p.usd_rate) * (+p.rent_share) * (+p.move_extra_months || 0)) : 0;

    let oblig = 0, interest = 0;
    for (const d of ds) {
      if (d.bal <= 0.005) continue;
      if (d.kind === 'installment') {
        const pay = Math.min(+d.monthly_payment, d.bal); d.bal = r2(d.bal - pay); oblig += pay;
      } else if (d.kind === 'annuity_loan') {
        const int = d.bal * (+d.rate_annual) / 1200;
        const pay = Math.min(+d.monthly_payment, d.bal + int);
        d.bal = r2(d.bal + int - pay); oblig += pay; interest += int;
      } else if (d.kind === 'credit_line') {
        const graceYM = d.grace_until ? ym(d.grace_until) : null;
        if (graceYM && k > graceYM) {
          const int = d.bal * (+d.grace_rate_monthly || 3.1) / 100;
          d.bal = r2(d.bal + int); interest += int;
        }
      }
    }
    interestTotal += interest;
    const free = r2(income - living - oneTime - oblig);
    cash = r2(cash + free);

    const floor = o.strategy === 'cushion_first' ? target : (+o.minBuffer || 0);

    // Пільговий місяць кредитної лінії: гасимо що можемо, решту конвертуємо.
    let converted = 0;
    for (const d of ds.filter((d) => d.kind === 'credit_line' && d.bal > 0.005)) {
      const graceYM = d.grace_until ? ym(d.grace_until) : null;
      if (graceYM && k === graceYM) {
        const avail = Math.max(0, cash - floor);
        const pay = Math.min(avail, d.bal);
        d.bal = r2(d.bal - pay); cash = r2(cash - pay); oblig += pay;
        if (d.bal > 0.005 && o.convertMonths > 0) {
          const fee = r2(d.bal * o.feePct / 100 * o.convertMonths);
          feeTotal += fee;
          converted = d.bal;
          ds.push({
            id: 'conv', name: `Конвертація ліміту (${o.convertMonths} міс)`, kind: 'installment', is_conversion: true,
            bal: r2(d.bal + fee), monthly_payment: r2((d.bal + fee) / o.convertMonths), prepay_allowed: false,
          });
          d.bal = 0;
        }
      }
    }

    // Надлишок понад «підлогу» — дострокове гасіння найдорожчого боргу.
    let prepaid = 0;
    let surplus = r2(cash - floor);
    if (surplus > 0) {
      const order = ds
        .filter((d) => d.bal > 0.005 && (d.kind === 'credit_line' || (d.kind === 'annuity_loan' && d.prepay_allowed !== false)))
        .sort((a, b) => (b.kind === 'credit_line') - (a.kind === 'credit_line') || (+b.rate_annual || 0) - (+a.rate_annual || 0));
      for (const d of order) {
        if (surplus <= 0) break;
        const pay = Math.min(surplus, d.bal);
        d.bal = r2(d.bal - pay); surplus = r2(surplus - pay); cash = r2(cash - pay); prepaid += pay;
      }
    }
    if (cash < 0) warnings.push(`${ymLabel(k)}: дефіцит ${Math.round(-cash)} ₴`);

    const perDebt = {};
    for (const d of ds) perDebt[d.name] = Math.max(0, r2(d.bal));
    rows.push({
      ym: k, label: ymLabel(k), income: r2(income), living, oneTime, oblig: r2(oblig), interest: r2(interest),
      free, prepaid: r2(prepaid), converted, cash: r2(cash),
      totalDebt: r2(ds.reduce((s, d) => s + Math.max(0, d.bal), 0)), perDebt, afterMove,
    });
  }
  const debtFree = rows.find((r) => r.totalDebt <= 1);
  const cushion = rows.find((r) => r.cash >= target);
  const creditLineFree = rows.find((r) => Object.entries(r.perDebt)
    .filter(([n]) => /ліміт/i.test(n)).every(([, v]) => v <= 1));
  return {
    rows, startCash, startNotes, target, warnings,
    interestTotal: r2(interestTotal), feeTotal: r2(feeTotal),
    debtFreeYM: debtFree?.ym || null, cushionYM: cushion?.ym || null, creditLineFreeYM: creditLineFree?.ym || null,
    totalDebtNow: r2((debts || []).filter((d) => d.is_active).reduce((s, d) => s + (+d.balance), 0)),
  };
}

// Наступна дата платежу: минулі дати вважаються сплаченими й зсуваються на місяць.
export function nextDue(d, today = new Date()) {
  if (!d.next_payment_date) return null;
  let x = new Date(d.next_payment_date + 'T12:00:00');
  const t0 = new Date(new Date(today).toDateString());
  const day = +d.payment_day || x.getDate();
  while (x < t0) {
    const y = x.getFullYear(), m = x.getMonth() + 1;
    const dim = new Date(y, m + 1, 0).getDate();
    x = new Date(y, m, Math.min(day, dim), 12);
  }
  return x;
}

// Як розподілити надходження зараз.
export function allocateIncome(amount, { params: p, debts, categories, goals, accounts, today }) {
  const now = today ? new Date(today) : new Date();
  const horizon = new Date(now); horizon.setDate(horizon.getDate() + 16);
  let left = +amount;
  const plan = [];
  const due = (debts || [])
    .filter((d) => d.is_active && d.next_payment_date && d.kind !== 'credit_line')
    .map((d) => ({ d, date: nextDue(d, now) }))
    .filter((x) => x.date && x.date <= horizon)
    .sort((a, b) => a.date - b.date);
  for (const { d, date } of due) {
    const pay = Math.min(left, +d.monthly_payment);
    if (pay <= 0) break;
    plan.push({ label: `${d.name} — до ${date.toLocaleDateString('uk-UA')}`, amount: r2(pay), kind: 'obligation' });
    left = r2(left - pay);
  }
  const living = livingCosts(categories, p, false).lines
    .filter((l) => ['food', 'commute_fuel', 'commute_service'].includes(l.role))
    .reduce((s, l) => s + l.amount, 0) / 2;
  const liv = Math.min(left, r2(living));
  if (liv > 0) { plan.push({ label: 'Життя на ~2 тижні (їжа, дорога)', amount: liv, kind: 'living' }); left = r2(left - liv); }

  const target = cushionTargetUAH(goals, p);
  const have = liquidNow(accounts, p);
  const cl = (debts || []).find((d) => d.is_active && d.kind === 'credit_line' && +d.balance > 0);
  const strategy = p.strategy || 'cushion_first';
  const toCushion = () => {
    const need = Math.max(0, target - have);
    const v = Math.min(left, need);
    if (v > 0) { plan.push({ label: 'Подушка на з\'їзд', amount: r2(v), kind: 'cushion' }); left = r2(left - v); }
  };
  const toDebt = () => {
    if (cl && left > 0) {
      const v = Math.min(left, +cl.balance);
      plan.push({ label: `${cl.name} (найдорожчий після пільгового)`, amount: r2(v), kind: 'debt' }); left = r2(left - v);
    }
    const an = (debts || []).find((d) => d.is_active && d.kind === 'annuity_loan' && d.prepay_allowed !== false);
    if (an && left > 0) { plan.push({ label: `${an.name} — дострокове в тіло`, amount: r2(left), kind: 'debt' }); left = 0; }
  };
  if (strategy === 'cushion_first') { toCushion(); toDebt(); } else { toDebt(); toCushion(); }
  if (left > 0) plan.push({ label: 'Залишок', amount: r2(left), kind: 'rest' });
  return plan;
}
