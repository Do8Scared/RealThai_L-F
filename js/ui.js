import { tsDate, EMOJI_MAP, formatPostId, x } from './utils.js';

export function renderAll(state) {
  renderStats(state.items);
  renderItems(state);
  renderRecent(state.items);
  renderAnnouncement(state);
}

export function renderStats(items) {
  const open = items.filter(i => i.status === 'open').length;
  const res = items.filter(i => i.status === 'resolved').length;
  const lost = items.filter(i => i.type === 'lost' && i.status === 'open').length;
  const fnd = items.filter(i => i.type === 'found' && i.status === 'open').length;
  const setCount = (id, count) => {
    const element = document.getElementById(id);
    const value = element?.querySelector('[data-stat-count]') || element;
    if (value) value.textContent = count;
  };

  setCount('hs-open', open);
  setCount('hs-res', res);
  setCount('hs-lost', lost);
  setCount('hs-found', fnd);
  setCount('ht-open', open);
  setCount('ht-resolved', res);
  setCount('lf-total', items.length);
  setCount('lf-lost', lost);
  setCount('lf-found', fnd);
  setCount('lf-resolved', res);
  
  const sbBadge = document.getElementById('sb-badge');
  if (sbBadge) sbBadge.textContent = open;
}

// Advanced multi-parameter search filter engine
export function getFilteredItems(state) {
  const queryText = (document.getElementById('lf-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('status-filter')?.value || '';
  const catFilter = document.getElementById('cat-filter')?.value || '';

  return state.items.filter(item => {
    if (state.activeType && item.type !== state.activeType) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (catFilter && item.category !== catFilter) return false;

    if (queryText) {
      const searchableString = `${item.title} ${item.description} ${item.campus || ''} ${item.location} ${item.category} ${item.reporterName}`.toLowerCase();
      const matchesQuery = queryText.split(' ').every(keyword => searchableString.includes(keyword));
      if (!matchesQuery) return false;
    }
    return true;
  });
}

export function renderItems(state) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;

  const list = getFilteredItems(state);
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔍</div>
        <h3>Nothing found</h3>
        <p>Adjust your search filters or report a new item.</p>
      </div>`;
    return;
  }
  grid.innerHTML = list.map(cardHTML).join('');
}

export function renderRecent(items) {
  const box = document.getElementById('recent-list');
  if (!box) return;

  const recent = [...items].slice(0, 6);
  if (!recent.length) {
    box.innerHTML = `<div style="padding:16px;text-align:center;font-size:13px;color:var(--ink-3)">No activity yet</div>`;
    return;
  }

  box.innerHTML = recent.map(i => `
    <div class="recent-item" onclick="openDetail('${i.id}')">
      <span class="recent-emoji">${EMOJI_MAP[i.category] || '📦'}</span>
      <div class="recent-info">
        <div class="recent-title">${x(i.title)}</div>
        <div class="recent-meta">${i.status === 'resolved' ? '✅ Resolved · ' : i.status === 'claimed' ? '🟡 Claimed · ' : ''}${i.type === 'lost' ? '🔴 Lost' : '🟢 Found'} report · ${x(i.campus || 'Campus not specified')} · ${x(i.location)}</div>
      </div>
      <span class="status-tag status-${i.status}" style="position:static;padding:3px 8px;font-size:10px">${i.status}</span>
    </div>`).join('');
}

export function renderAnnouncement(state) {
  const banner = document.getElementById('announcement-banner');
  if (!banner) return;

  const announcement = state.activeAnnouncement || {
    title: 'Lost and Found Week',
    text: 'Claim your items at the Student Center from 9:00 AM to 4:00 PM this Friday.',
    reports: []
  };

  banner.innerHTML = `
    <div class="announcement-tag">Announcement</div>
    <div class="announcement-copy">
      <strong>${x(announcement.title)}:</strong> ${x(announcement.text)}
    </div>
  `;
}

export function renderAdminQueue(state) {
  const box = document.getElementById('admin-queue');
  if (!box) return;

  if (!state.adminQueue || !state.adminQueue.length) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = state.adminQueue.map(req => `
    <div class="admin-queue-item">
      <div style="display:flex; gap:12px; align-items:flex-start; flex:1;">
        ${req.evidenceImage ? `<img src="${x(req.evidenceImage)}" alt="Evidence" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" />` : `<div style="width:72px;height:72px;border-radius:8px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;">📷</div>`}
        <div>
          <div class="admin-queue-title">${x(req.itemTitle)}</div>
          <div class="admin-queue-body">Post ID: ${formatPostId(req.postNumber)}</div>
          <div class="admin-queue-body">${x(req.campus || 'Campus not specified')}</div>
          <div class="admin-queue-body">Likely owner: <strong>${x(req.likelyOwner)}</strong></div>
          <div class="admin-queue-body">${x(req.proof)}</div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="publishAnnouncement('${req.id}')">Publish</button>
    </div>
  `).join('');
}

function cardHTML(i) {
  const em = EMOJI_MAP[i.category] || '📦';
  const dt = tsDate(i.created_at || i.createdAt);
  return `
    <div class="item-card" onclick="openDetail('${i.id}', this.querySelector('.card-thumb img')?.src || '')">
      <div class="card-thumb">
        ${i.imageUrl ? `<img src="${x(i.imageUrl)}" onerror="this.style.display='none'"/>` : ''}
        <span class="card-thumb-emoji">${em}</span>
        <span class="type-tag type-${i.type}">${i.type === 'lost' ? '🔴 Lost' : '🟢 Found'}</span>
        <span class="status-tag status-${i.status}">${i.status}</span>
      </div>
      <div class="card-body">
        <div class="card-cat">${x(i.category)}</div>
        <div class="card-title">${x(i.title)}</div>
        <div class="card-desc">${x(i.description)}</div>
        <div class="card-meta">
          <div class="meta-line"><span>#</span>${formatPostId(i.post_number)}</div>
          <div class="meta-line"><span>🏫</span>${x(i.campus || 'Campus not specified')}</div>
          <div class="meta-line"><span>📍</span>${x(i.location)}</div>
          <div class="meta-line"><span>👤</span>${x(i.reporterName)}</div>
          <div class="meta-line"><span>📅</span>${dt}</div>
        </div>
      </div>
      <div class="card-foot">
        <span class="card-reporter">${x(i.contact)}</span>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openDetail('${i.id}', this.closest('.item-card').querySelector('.card-thumb img')?.src || '')">Details</button>
      </div>
    </div>`;
}