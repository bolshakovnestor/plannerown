export const uah = (n, opts = {}) => {
  const v = Number(n) || 0;
  const s = Math.round(Math.abs(v)).toLocaleString('uk-UA').replace(/ |,/g, ' ');
  return `${v < 0 && !opts.abs ? '−' : opts.sign && v > 0 ? '+' : ''}${s}${opts.noCur ? '' : ' ₴'}`;
};
export const money2 = (n) => Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dstr(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

const DOW = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
export const MONTHS_NOM = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
export const prettyDate = (s, withDow = true) => {
  if (!s) return '';
  const d = new Date(s.slice(0, 10) + 'T12:00:00');
  const t = todayStr();
  const diff = daysBetween(t, s.slice(0, 10));
  const rel = diff === 0 ? 'сьогодні' : diff === 1 ? 'завтра' : diff === -1 ? 'вчора' : null;
  return rel || `${withDow ? DOW[d.getDay()] + ', ' : ''}${d.getDate()} ${MON[d.getMonth()]}`;
};
export const dowShort = (d) => DOW[d.getDay()];

export function nextRecurrence(date, rec) {
  if (!rec || !date) return null;
  const d = new Date(date + 'T12:00:00');
  if (rec === 'daily') d.setDate(d.getDate() + 1);
  else if (rec.startsWith('weekly')) {
    const days = (rec.split(':')[1] || '').split(',').map(Number).filter(Boolean);
    if (!days.length) d.setDate(d.getDate() + 7);
    else { do { d.setDate(d.getDate() + 1); } while (!days.includes(((d.getDay() + 6) % 7) + 1)); }
  } else if (rec.startsWith('monthly')) {
    const day = Number(rec.split(':')[1]) || d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  } else return null;
  return dstr(d);
}

export const recurrenceLabel = (r) => {
  if (!r) return '';
  if (r === 'daily') return 'щодня';
  if (r.startsWith('weekly')) {
    const n = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
    const d = (r.split(':')[1] || '').split(',').filter(Boolean).map((x) => n[+x]);
    return d.length ? `щотижня: ${d.join(', ')}` : 'щотижня';
  }
  if (r.startsWith('monthly')) return `щомісяця${r.split(':')[1] ? `, ${r.split(':')[1]}-го` : ''}`;
  return r;
};

export function habitDueToday(h, date = new Date()) {
  const s = h.schedule || 'daily';
  if (s === 'daily') return true;
  if (s.startsWith('weekly')) {
    const days = (s.split(':')[1] || '').split(',').map(Number).filter(Boolean);
    const dw = ((date.getDay() + 6) % 7) + 1;
    return !days.length || days.includes(dw);
  }
  return true; // monthly — показуємо, доки не відмічено в цьому місяці
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function toCSV(rows) {
  if (!rows?.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
