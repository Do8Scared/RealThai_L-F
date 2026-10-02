// ── UTILS & HELPERS ───────────────────────────────────────

export const EMOJI_MAP = {
  'Electronics':'💻', 'Clothing & Accessories':'👕', 'ID / Cards':'🪪',
  'Bag / Backpack':'🎒', 'Books / Notes':'📚', 'Keys':'🔑',
  'Glasses':'👓', 'Jewelry':'💍', 'Money / Wallet':'💰',
  'Documents':'📄', 'Other':'📦'
};

export const DEMO_ITEMS = [
  { 
    id: 'd1', post_number: 1, type: 'lost', title: 'Blue Samsung Galaxy A54',
    description: 'Black case with PUP sticker on back.',
    category: 'Electronics', campus: 'A. Mabini Main Campus (Sta. Mesa, Manila)', location: 'Main Library, 3rd Floor',
    reporterName: 'Maria Santos', contact: 'maria@pup.edu.ph',
    department: 'College of Computer and Information Sciences (CCIS)',
    status: 'open', imageUrl: '', createdAt: { seconds: Date.now()/1000 - 3600 } 
  }
];

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

// Format Firestore or object timestamp
export function tsDate(ts, long = false) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date((ts.seconds || Date.now()/1000) * 1000);
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