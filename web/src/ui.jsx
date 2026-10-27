import { useEffect } from 'react';

const P = {
  today: 'M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  plan: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM8 14l2 2 4-4',
  money: 'M3 7h18v12H3zM3 11h18M7 15h3',
  chart: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  claude: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5L20 7',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  x: 'M18 6L6 18M6 6l12 12',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z',
  left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  mic: 'M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3',
  brain: 'M9 3a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 2V3zM15 3a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-6 2',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z',
};
export const Icon = ({ n, size }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={size ? { width: size, height: size } : null}>
    <path d={P[n]} />
  </svg>
);

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between"><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Закрити"><Icon n="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Bar = ({ value, max, tone }) => {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const t = tone || (pct > 100 ? 'bad' : pct > 85 ? 'warn' : '');
  return <div className={`bar ${t}`}><i style={{ width: `${pct}%` }} /></div>;
};

// Мінімальний markdown: заголовки, жирний, списки.
export function Md({ text }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  const out = []; let list = null;
  for (const raw of (text || '').split('\n')) {
    const l = raw.trimEnd();
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) { list = list || []; list.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    const h = l.match(/^(#{1,3})\s+(.*)/);
    if (h) out.push(`<h3>${inline(h[2])}</h3>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return <div dangerouslySetInnerHTML={{ __html: out.join('') }} />;
}

export function Ring({ pct, size = 54, stroke = 6, color = '#fff', track = 'rgba(255,255,255,.25)', children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: 'stroke-dashoffset .6s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{children}</div>
    </div>
  );
}

export function Celebrate({ party, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4500); return () => clearTimeout(t); }, [party, onClose]);
  const colors = ['#4338ca', '#059669', '#f59e0b', '#db2777', '#0ea5e9'];
  return (
    <div className="celebrate" onClick={onClose}>
      {Array.from({ length: 36 }, (_, i) => (
        <i key={i} className="confetti" style={{ left: `${(i * 37) % 100}%`, background: colors[i % 5], animationDelay: `${(i % 9) * 0.12}s` }} />))}
      <div className="box"><div className="emoji">{party.emoji}</div><h2 style={{ margin: '8px 0 6px' }}>{party.title}</h2><div className="muted" style={{ fontSize: 15 }}>{party.text}</div></div>
    </div>
  );
}
