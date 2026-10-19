// ── UTILS & HELPERS ───────────────────────────────────────

export const EMOJI_MAP = {
  'Electronics':'💻', 'Clothing & Accessories':'👕', 'ID / Cards':'🪪',
  'Bag / Backpack':'🎒', 'Books / Notes':'📚', 'Keys':'🔑',
  'Glasses':'👓', 'Jewelry':'💍', 'Money / Wallet':'💰',
  'Documents':'📄', 'Other':'📦'
};


export function formatPostId(postNumber) {
  const number = Number(postNumber);
  return Number.isSafeInteger(number) && number > 0
    ? `LF-${String(number).padStart(6, '0')}`
    : 'ID pending';
}

// XSS-safe escape helper
export function x(t) { 
  const d = document.createElement('div'); 
  d.textContent = t || ''; 
  return d.innerHTML; 
}

// Get input value safely
export function v(id) { 
  return (document.getElementById(id)?.value || '').trim(); 
}

// Format timestamp, ISO string, or Date object
export function tsDate(ts, long = false) {
  if (!ts) return '';
  let d;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    d = ts.toDate();
  } else if (typeof ts === 'object' && typeof ts.seconds === 'number') {
    d = new Date(ts.seconds * 1000);
  } else {
    d = new Date(ts);
  }
  if (Number.isNaN(d.getTime())) return '';
  if (long) return d.toLocaleString('en-PH', { month:'long', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
}

// Toast notification helper
let tt;
export function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(tt);
  tt = setTimeout(() => el.classList.remove('show'), 3200);
}