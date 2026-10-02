import { supabase } from './supabase-config.js';
import { formatPostId, x, toast } from './utils.js';

const allowedEmail = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@iskolarngbayan\.pup\.edu\.ph$/i;
const authPanel = document.getElementById('admin-auth-panel');
const pendingPanel = document.getElementById('admin-pending-panel');
const dashboard = document.getElementById('admin-dashboard');
const authStatus = document.getElementById('admin-auth-status');
let currentUser = null;
let currentUserRole = '';
let accessRequests = [];
let userFeedbackRequests = [];
let claimRequests = [];
let matchRequests = [];
let items = [];
let adminUsers = [];
let demoPreviewActive = false;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = localDateKey(new Date());
const adminViewTitles = {
  overview: 'Dashboard',
  users: 'User management',
  calendar: 'Calendar',
  access: 'Admin access requests',
  feedback: 'User feedback',
  claims: 'Claim follow-ups',
  matches: 'Owner match submissions',
  profile: 'Profile management',
};

const demoQueues = {
  accessRequests: [{
    id: 'demo-access-1',
    email: 'casey.student@example.invalid',
    requested_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  }],
  feedbackRequests: [{
    id: 'demo-feedback-1',
    email: 'alex.student@example.invalid',
    topic: 'website',
    message: 'The item filters are difficult to use on a phone. Keeping them visible while browsing would help.',
    evidence_image: null,
    status: 'pending',
    created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  }],
  claimRequests: [{
    id: 'demo-claim-1',
    post_number: 184,
    item_title: 'Black wireless earbuds case',
    campus: 'A. Mabini Main Campus',
    claimant_email: 'sam.student@example.invalid',
    poster_name: 'Taylor Demo',
    poster_contact: 'demo@example.invalid',
    message: 'I can identify the sticker inside the charging case.',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  }],
  matchRequests: [{
    id: 'demo-match-1',
    post_number: 179,
    item_title: 'Blue student umbrella',
    campus: 'A. Mabini Main Campus',
    likely_owner: 'Jordan Demo',
    contact: 'jordan@example.invalid',
    proof: 'The handle has a small silver repair near the strap.',
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  }],
  adminUsers: [{
    user_id: 'demo-admin',
    email: 'super-admin@example.invalid',
    role: 'super_admin',
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  }, {
    user_id: 'demo-common-admin',
    email: 'common-admin@example.invalid',
    role: 'admin',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  }],
  userMetrics: {
    total_users: 42,
    active_users_30d: 27,
    new_users_30d: 6,
    inactive_users_30d: 11,
    deleted_users: 4,
  },
  items: [
    { id: 'demo-item-1', post_number: 184, title: 'Black wireless earbuds case', type: 'found', status: 'open', campus: 'A. Mabini Main Campus', location: 'Main Library', created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'demo-item-2', post_number: 179, title: 'Blue student umbrella', type: 'lost', status: 'open', campus: 'A. Mabini Main Campus', location: 'Student Center', created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  ],
};

function simulateDemoReview(queueName, id, message) {
  if (!demoPreviewActive) return;
  const queue = demoQueues[queueName];
  const index = queue.findIndex(request => request.id === id);
  if (index < 0) return;

  queue.splice(index, 1);
  toast(`${message} Demo only; nothing was saved.`, 'success');
  void loadAdminDashboard();
}

function showPanel(panel) {
  [authPanel, pendingPanel, dashboard].forEach(section => {
    section.hidden = section !== panel;
  });
}

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function canManageAdminAccess() {
  return currentUserRole === 'super_admin';
}

function updateAdminRoleUI() {
  const roleBadge = document.getElementById('admin-current-role');
  roleBadge.textContent = currentUserRole === 'super_admin' ? 'Super Admin' : currentUserRole === 'admin' ? 'Common Admin' : '';
  roleBadge.classList.toggle('super-admin', currentUserRole === 'super_admin');
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function showAdminView(view) {
  if (!adminViewTitles[view]) return;
  document.querySelectorAll('[data-admin-panel]').forEach(panel => {
    panel.hidden = panel.dataset.adminPanel !== view;
  });
  document.querySelectorAll('[data-admin-view]').forEach(button => {
    const active = button.dataset.adminView === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.getElementById('admin-page-title').textContent = adminViewTitles[view];
  if (view === 'calendar') renderCalendar();
}

function getCalendarEntries() {
  return [
    ...items.map(item => ({ date: item.created_at, title: item.title, kind: 'Item reported', view: 'overview' })),
    ...accessRequests.map(request => ({ date: request.requested_at, title: request.email, kind: 'Admin access requested', view: 'access' })),
    ...userFeedbackRequests.map(request => ({ date: request.created_at, title: request.topic === 'announcement' ? 'Announcement report' : 'Website feedback', kind: 'User feedback', view: 'feedback' })),
    ...claimRequests.map(request => ({ date: request.created_at, title: request.item_title, kind: 'Claim follow-up', view: 'claims' })),
    ...matchRequests.map(request => ({ date: request.created_at, title: request.item_title, kind: 'Owner match', view: 'matches' })),
  ].filter(entry => entry.date);
}

async function signPrivateEvidence(requests, bucket) {
  return Promise.all(requests.map(async request => {
    const path = request.evidence_image;
    if (!path || /^https?:\/\//i.test(path)) return request;
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      return { ...request, evidence_image: error ? '' : data?.signedUrl || '' };
    } catch {
      return { ...request, evidence_image: '' };
    }
  }));
}

function renderOverview(items, access, feedback, claims, matches) {
  const openItems = items.filter(item => (item.status || 'open') !== 'resolved');
  const lostItems = items.filter(item => (item.type || '').toLowerCase() === 'lost');
  const foundItems = items.filter(item => (item.type || '').toLowerCase() === 'found');
  const queueTotal = access.length + feedback.length + claims.length + matches.length;
  document.getElementById('overview-items').textContent = openItems.length;
  document.getElementById('overview-lost').textContent = lostItems.length;
  document.getElementById('overview-found').textContent = foundItems.length;
  document.getElementById('overview-pending').textContent = queueTotal;

  const itemChart = document.getElementById('admin-item-chart');
  const itemMax = Math.max(lostItems.length, foundItems.length, 1);
  itemChart.innerHTML = [
    ['Lost', lostItems.length],
    ['Found', foundItems.length],
  ].map(([label, count]) => `<div class="admin-chart-row"><span>${label}</span><div class="admin-chart-track"><div class="admin-chart-fill" style="--bar-width:${Math.round(count / itemMax * 100)}%"></div></div><strong>${count}</strong></div>`).join('');

  const queueChart = document.getElementById('admin-queue-chart');
  const queues = [['Admin access', access.length], ['User feedback', feedback.length], ['Claim follow-ups', claims.length], ['Owner matches', matches.length]];
  const queueMax = Math.max(...queues.map(([, count]) => count), 1);
  queueChart.innerHTML = queues.map(([label, count]) => `<div class="admin-chart-row"><span>${label}</span><div class="admin-chart-track"><div class="admin-chart-fill" style="--bar-width:${Math.round(count / queueMax * 100)}%"></div></div><strong>${count}</strong></div>`).join('');

  const activity = getCalendarEntries().sort((first, second) => new Date(second.date) - new Date(first.date)).slice(0, 5);
  const activityList = document.getElementById('admin-recent-activity');
  activityList.innerHTML = activity.length ? activity.map(entry => `<button class="admin-activity" type="button" data-admin-view-link="${entry.view}"><span><strong>${x(entry.kind)}</strong><span>${x(entry.title)}</span></span><time>${new Date(entry.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</time></button>`).join('') : '<p class="admin-empty">No recent activity.</p>';
}

function renderAdmins(users) {
  document.getElementById('admin-user-count').textContent = users.length;
  const container = document.getElementById('admin-user-list');
  container.innerHTML = users.length ? users.map(user => `
    <article class="admin-record">
      <div class="admin-record-main"><strong>${x(user.email)}</strong><span>${user.user_id === currentUser?.id ? 'Signed-in administrator' : 'Administrator'}</span></div>
      <div class="admin-role-controls">
        <span class="admin-role-label ${user.role === 'super_admin' ? 'super-admin' : ''}">${user.role === 'super_admin' ? 'Super Admin' : 'Common Admin'}</span>
        ${canManageAdminAccess() && user.user_id !== currentUser?.id ? `
          <select aria-label="Role for ${x(user.email)}" data-admin-role-user="${x(user.user_id)}">
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Common Admin</option>
            <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
          </select>
          <button class="btn btn-danger btn-sm" type="button" data-revoke-admin="${x(user.user_id)}">Revoke access</button>
        ` : ''}
      </div>
    </article>
  `).join('') : '<p class="admin-empty">No administrator accounts found.</p>';
}

async function changeAdminRole(userId, role) {
  if (!canManageAdminAccess() || !['admin', 'super_admin'].includes(role)) return;
  const target = adminUsers.find(user => user.user_id === userId);
  if (!target || target.user_id === currentUser?.id || target.role === role) return;
  if (target.role === 'super_admin' && role !== 'super_admin' && adminUsers.filter(user => user.role === 'super_admin').length < 2) {
    toast('The last Super Admin cannot be demoted.', 'error');
    renderAdmins(adminUsers);
    return;
  }
  if (!window.confirm(`Change ${target.email} to ${role === 'super_admin' ? 'Super Admin' : 'Common Admin'}?`)) {
    renderAdmins(adminUsers);
    return;
  }

  if (!supabase && demoPreviewActive) {
    target.role = role;
    renderAdmins(adminUsers);
    toast('Demo role changed locally; nothing was saved.', 'success');
    return;
  }

  const { error } = await supabase.from('admin_users').update({ role }).eq('user_id', userId);
  if (error) {
    console.error('Admin role update failed:', error);
    toast('Could not change this administrator role.', 'error');
    await loadAdminDashboard();
    return;
  }
  toast('Administrator role updated.', 'success');
  await loadAdminDashboard();
}

async function revokeAdminAccess(userId) {
  if (!canManageAdminAccess()) return;
  const target = adminUsers.find(user => user.user_id === userId);
  if (!target || target.user_id === currentUser?.id) return;
  if (target.role === 'super_admin' && adminUsers.filter(user => user.role === 'super_admin').length < 2) {
    toast('The last Super Admin cannot be removed.', 'error');
    return;
  }
  if (!window.confirm(`Revoke administrator access for ${target.email}? Their Supabase account and reports will not be deleted.`)) return;

  if (!supabase && demoPreviewActive) {
    demoQueues.adminUsers = demoQueues.adminUsers.filter(user => user.user_id !== userId);
    adminUsers = demoQueues.adminUsers;
    renderAdmins(adminUsers);
    toast('Demo admin access revoked locally; nothing was saved.', 'success');
    return;
  }

  const { error } = await supabase.from('admin_users').delete().eq('user_id', userId);
  if (error) {
    console.error('Admin access revocation failed:', error);
    toast('Could not revoke this administrator access.', 'error');
    return;
  }
  toast('Administrator access revoked. The user account and reports were not deleted.', 'success');
  await loadAdminDashboard();
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthLabel = calendarMonth.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  document.getElementById('calendar-month-label').textContent = monthLabel;
  const entries = getCalendarEntries();
  const eventCounts = new Map();
  entries.forEach(entry => {
    const date = new Date(entry.date);
    if (!Number.isNaN(date.getTime())) {
      const key = localDateKey(date);
      eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
    }
  });

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push('<span class="admin-calendar-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = localDateKey(new Date(year, month, day));
    const count = eventCounts.get(key) || 0;
    const classes = ['admin-calendar-day', key === selectedCalendarDate ? 'selected' : '', count ? 'has-events' : ''].filter(Boolean).join(' ');
    cells.push(`<button class="${classes}" type="button" data-calendar-date="${key}" aria-label="${monthLabel} ${day}${count ? `, ${count} submissions` : ''}"><span>${day}</span>${count ? `<i aria-hidden="true">${count}</i>` : ''}</button>`);
  }
  document.getElementById('admin-calendar-grid').innerHTML = cells.join('');

  const selected = new Date(`${selectedCalendarDate}T12:00:00`);
  document.getElementById('calendar-selected-label').textContent = selected.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  const selectedEntries = entries.filter(entry => {
    const date = new Date(entry.date);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === selected.getFullYear() && date.getMonth() === selected.getMonth() && date.getDate() === selected.getDate();
  });
  const eventList = document.getElementById('admin-calendar-events');
  eventList.innerHTML = selectedEntries.length ? selectedEntries.map(entry => `<button class="admin-activity" type="button" data-admin-view-link="${entry.view}"><span><strong>${x(entry.kind)}</strong><span>${x(entry.title)}</span></span><time>${new Date(entry.date).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</time></button>`).join('') : '<p class="admin-empty">No submissions on this date.</p>';
}

function populateProfile(user) {
  document.getElementById('profile-email').value = user?.email || '';
  document.getElementById('profile-display-name').value = user?.user_metadata?.display_name || user?.user_metadata?.full_name || '';
}

function detailImageSource(value) {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  if (/^https?:\/\//i.test(source) || /^blob:/i.test(source)) return source;
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(source) ? source : '';
}

function openRecordDetails(kind, record) {
  const title = document.getElementById('admin-details-title');
  const content = document.getElementById('admin-details-content');
  const labels = {
    access: 'Admin access request details',
    feedback: 'User feedback details',
    claim: 'Claim follow-up details',
    match: 'Owner match details',
    item: 'Item report details',
  };
  title.textContent = labels[kind] || 'Record details';

  const fields = [];
  const images = [];
  Object.entries(record).forEach(([key, value]) => {
    const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
    if (/image|photo|attachment/i.test(key)) {
      const sources = (Array.isArray(value) ? value : [value]).map(detailImageSource).filter(Boolean);
      sources.forEach((source, index) => images.push(`<figure class="admin-detail-image"><img src="${x(source)}" alt="${x(label)}${sources.length > 1 ? ` ${index + 1}` : ''}"><figcaption>${x(label)}${sources.length > 1 ? ` ${index + 1}` : ''}</figcaption></figure>`));
      fields.push([label, value ? (sources.length ? `${sources.length} image${sources.length === 1 ? '' : 's'} attached` : 'Image link unavailable') : 'No image submitted']);
      return;
    }

    let displayValue = value;
    if (value === null || value === undefined || value === '') displayValue = 'Not provided';
    else if (/(^|_)(at|date|time)$/i.test(key) || /At$/.test(key)) {
      const date = new Date(value);
      displayValue = Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-PH');
    } else if (typeof value === 'object') displayValue = JSON.stringify(value, null, 2);
    fields.push([label, String(displayValue)]);
  });

  content.innerHTML = `${images.length ? `<div class="admin-detail-images">${images.join('')}</div>` : ''}<dl class="admin-detail-fields">${fields.map(([label, value]) => `<div><dt>${x(label)}</dt><dd>${x(value)}</dd></div>`).join('')}</dl>`;
  document.getElementById('admin-details-dialog').showModal();
}

function formatAccessRequestRef(id) {
  const requestId = String(id || '');
  if (requestId.startsWith('demo-access-')) {
    return `AR-DEMO-${requestId.slice('demo-access-'.length).padStart(3, '0')}`;
  }
  const compactId = requestId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `AR-${compactId.slice(0, 12) || 'PENDING'}`;
}

function renderAccountMetrics(metrics, isDemo = false) {
  const values = Array.isArray(metrics) ? metrics[0] : metrics;
  const fields = [
    ['admin-users-total', 'total_users'],
    ['admin-users-active', 'active_users_30d'],
    ['admin-users-new', 'new_users_30d'],
    ['admin-users-inactive', 'inactive_users_30d'],
    ['admin-users-deleted', 'deleted_users'],
  ];
  const available = Boolean(values);
  fields.forEach(([elementId, field]) => {
    document.getElementById(elementId).textContent = available ? Number(values[field] || 0).toLocaleString('en-PH') : '—';
  });
  document.getElementById('admin-account-metrics-source').textContent = available
    ? isDemo ? 'Illustrative demo data' : 'Live aggregate'
    : 'Unavailable';
  document.getElementById('admin-account-metrics-note').textContent = available
    ? isDemo
      ? 'Sample values only. Deleted and inactive accounts are separate; demo actions do not persist.'
      : 'Deleted accounts are counted from the start of activity tracking. Inactive accounts are not assumed to be deleted.'
    : 'Apply the admin user activity metrics migration to enable these account totals. Other dashboard data remains available.';
  const chart = document.getElementById('admin-user-chart');
  if (!available) {
    chart.innerHTML = '<p class="admin-empty">Account activity chart is unavailable.</p>';
    return;
  }
  const chartValues = [
    ['Active · 30 days', Number(values.active_users_30d || 0)],
    ['Inactive · 30+ days', Number(values.inactive_users_30d || 0)],
    ['Deleted', Number(values.deleted_users || 0)],
  ];
  const maximum = Math.max(Number(values.total_users || 0), 1);
  chart.innerHTML = chartValues.map(([label, count]) => `<div class="admin-chart-row"><span>${label}</span><div class="admin-chart-track"><div class="admin-chart-fill" style="--bar-width:${Math.min(Math.round(count / maximum * 100), 100)}%"></div></div><strong>${count}</strong></div>`).join('');
}

function renderAccessRequests(requests) {
  const container = document.getElementById('admin-access-list');
  document.getElementById('admin-access-count').textContent = requests.length;
  if (!requests.length) {
    container.innerHTML = '<p class="admin-empty">No pending access requests.</p>';
    return;
  }

  container.innerHTML = requests.map(request => `
    <article class="admin-record">
      <div class="admin-record-main">
        <strong>${x(request.email)}</strong>
        <div class="admin-request-meta">
          <span class="admin-request-ref">Ref ${x(formatAccessRequestRef(request.id))}</span>
          <span>Requested ${new Date(request.requested_at).toLocaleString('en-PH')}</span>
        </div>
      </div>
      <div class="admin-record-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-admin-details="access" data-record-id="${x(request.id)}">Details</button>
        ${canManageAdminAccess() ? `
          <button class="btn btn-primary btn-sm" type="button" data-approve-admin="${x(request.id)}">Approve</button>
          <button class="btn btn-danger btn-sm" type="button" data-reject-admin="${x(request.id)}">Reject</button>
        ` : '<span class="admin-view-note">Read only · Super Admin approval required</span>'}
      </div>
    </article>
  `).join('');
}

function renderClaimRequests(requests) {
  const container = document.getElementById('admin-claim-list');
  document.getElementById('admin-claim-count').textContent = requests.length;
  if (!requests.length) {
    container.innerHTML = '<p class="admin-empty">No pending claim follow-ups.</p>';
    return;
  }

  container.innerHTML = requests.map(request => `
    <article class="admin-record admin-record-stacked">
      <div class="admin-record-main">
        <strong>${formatPostId(request.post_number)} - ${x(request.item_title)}</strong>
        <span>${x(request.campus || 'Campus not specified')}</span>
        <span>Claimant: ${x(request.claimant_email)}</span>
        <span>Poster: ${x(request.poster_name)} · ${x(request.poster_contact)}</span>
        <p>${x(request.message)}</p>
        <span>Submitted ${new Date(request.created_at).toLocaleString('en-PH')}</span>
      </div>
      <div class="admin-record-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-admin-details="claim" data-record-id="${x(request.id)}">Details</button>
        <button class="btn btn-ghost btn-sm" type="button" data-claim-status="contacted" data-claim-id="${x(request.id)}">Mark contacted</button>
        <button class="btn btn-primary btn-sm" type="button" data-claim-status="closed" data-claim-id="${x(request.id)}">Close request</button>
      </div>
    </article>
  `).join('');
}

function renderUserFeedbackRequests(requests, unavailable = false) {
  const container = document.getElementById('admin-feedback-list');
  document.getElementById('admin-feedback-count').textContent = unavailable ? '—' : requests.length;
  if (unavailable) {
    container.innerHTML = '<p class="admin-empty">Feedback reports are unavailable. Apply the user feedback reports migration.</p>';
    return;
  }
  if (!requests.length) {
    container.innerHTML = '<p class="admin-empty">No pending user feedback reports.</p>';
    return;
  }

  container.innerHTML = requests.map(request => `
    <article class="admin-record admin-record-stacked">
      <div class="admin-record-main">
        <strong>${request.topic === 'announcement' ? 'Announcement report' : 'Website / UI-UX feedback'}</strong>
        <span>${x(request.email)} · Submitted ${new Date(request.created_at).toLocaleString('en-PH')}</span>
        <p>${x(request.message)}</p>
        ${request.evidence_image ? '<span>Screenshot attached</span>' : ''}
      </div>
      <div class="admin-record-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-admin-details="feedback" data-record-id="${x(request.id)}">Details</button>
        <button class="btn btn-ghost btn-sm" type="button" data-feedback-status="reviewed" data-feedback-id="${x(request.id)}">Mark reviewed</button>
        <button class="btn btn-primary btn-sm" type="button" data-feedback-status="closed" data-feedback-id="${x(request.id)}">Close report</button>
      </div>
    </article>
  `).join('');
}

function renderOwnerMatchRequests(requests) {
  const container = document.getElementById('admin-match-list');
  document.getElementById('admin-match-count').textContent = requests.length;
  if (!requests.length) {
    container.innerHTML = '<p class="admin-empty">No pending owner match submissions.</p>';
    return;
  }

  container.innerHTML = requests.map(request => `
    <article class="admin-record admin-record-stacked">
      <div class="admin-record-main">
        <strong>${formatPostId(request.post_number)} - ${x(request.item_title)}</strong>
        <span>${x(request.campus || 'Campus not specified')}</span>
        <span>Possible owner: ${x(request.likely_owner)}</span>
        <span>Submitted contact: ${x(request.contact)}</span>
        <p>${x(request.proof)}</p>
        <span>Submitted ${new Date(request.created_at).toLocaleString('en-PH')}</span>
      </div>
      <div class="admin-record-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-admin-details="match" data-record-id="${x(request.id)}">Details</button>
        <button class="btn btn-ghost btn-sm" type="button" data-owner-status="reviewed" data-owner-id="${x(request.id)}">Mark reviewed</button>
        <button class="btn btn-danger btn-sm" type="button" data-owner-status="rejected" data-owner-id="${x(request.id)}">Reject</button>
      </div>
    </article>
  `).join('');
}

function renderItems(items) {
  const container = document.getElementById('admin-item-list');
  document.getElementById('admin-item-count').textContent = items.length;
  if (!items.length) {
    container.innerHTML = '<p class="admin-empty">No item posts found.</p>';
    return;
  }

  container.innerHTML = items.map(item => `
    <article class="admin-record">
      <div class="admin-record-main">
        <strong>${formatPostId(item.post_number)} - ${x(item.title)}</strong>
        <span>${x(item.type || 'item').toUpperCase()} · ${x(item.status || 'open')}</span>
        <span>${x(item.campus || 'Campus not specified')} · ${x(item.location || 'Location not specified')}</span>
      </div>
      <div class="admin-record-actions"><button class="btn btn-ghost btn-sm" type="button" data-admin-details="item" data-record-id="${x(item.id)}">Details</button></div>
    </article>
    `).join('');
}

async function requestAdminAccess(user) {
  const { data: requestStatus, error } = await supabase.rpc('request_admin_access');
  if (error) throw error;
  requestAdminAccess.requestStatus = requestStatus;

    document.getElementById('admin-pending-message').textContent = requestAdminAccess.requestStatus === 'rejected'
    ? `Admin access for ${user.email} was not approved. Contact the system administrator if you believe this is a mistake.`
    : `Admin access for ${user.email} is awaiting approval. You can sign in again after an administrator approves your request.`;
    showPanel(pendingPanel);
}

async function loadAdminDashboard() {
    setStatus(document.getElementById('admin-dashboard-status'), 'Loading review queues...');
    if (!supabase) {
      if (!demoPreviewActive) return;
      updateAdminRoleUI();
      accessRequests = demoQueues.accessRequests;
        userFeedbackRequests = demoQueues.feedbackRequests;
      claimRequests = demoQueues.claimRequests;
      matchRequests = demoQueues.matchRequests;
      items = demoQueues.items;
      adminUsers = demoQueues.adminUsers;
      renderAccessRequests(accessRequests);
        renderUserFeedbackRequests(userFeedbackRequests);
      renderClaimRequests(claimRequests);
      renderOwnerMatchRequests(matchRequests);
      renderItems(items);
      renderAdmins(adminUsers);
      renderOverview(items, accessRequests, userFeedbackRequests, claimRequests, matchRequests);
      renderAccountMetrics(demoQueues.userMetrics, true);
      document.getElementById('nav-access-count').textContent = accessRequests.length;
        document.getElementById('nav-feedback-count').textContent = userFeedbackRequests.length;
      document.getElementById('nav-claim-count').textContent = claimRequests.length;
      document.getElementById('nav-match-count').textContent = matchRequests.length;
      renderCalendar();
      setStatus(document.getElementById('admin-dashboard-status'), 'Demo preview. Changes are simulated in this browser only.');
      return;
    }

    const [accessResult, feedbackResult, claimsResult, matchesResult, itemsResult, adminsResult, userMetricsResult] = await Promise.all([
    supabase.from('admin_access_requests').select('*').eq('status', 'pending').order('requested_at'),
      supabase.from('user_feedback_reports').select('*').eq('status', 'pending').order('created_at'),
    supabase.from('claim_followup_requests').select('*').eq('status', 'pending').order('created_at'),
    supabase.from('owner_match_requests').select('*').eq('status', 'pending').order('created_at'),
    supabase.from('items').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('admin_users').select('user_id,email,created_at,role').order('created_at'),
    supabase.rpc('admin_user_metrics'),
    ]);

    const failure = accessResult.error || claimsResult.error || matchesResult.error || itemsResult.error || adminsResult.error;
    if (failure) throw failure;

  accessRequests = accessResult.data || [];
  claimRequests = await signPrivateEvidence(claimsResult.data || [], 'claim-evidence');
    userFeedbackRequests = feedbackResult.error ? [] : await signPrivateEvidence(feedbackResult.data || [], 'user-feedback-evidence');
  matchRequests = await signPrivateEvidence(matchesResult.data || [], 'claim-evidence');
  items = itemsResult.data || [];
  adminUsers = adminsResult.data || [];
  renderAccessRequests(accessRequests);
    renderUserFeedbackRequests(userFeedbackRequests, Boolean(feedbackResult.error));
  renderClaimRequests(claimRequests);
  renderOwnerMatchRequests(matchRequests);
  renderItems(items);
  renderAdmins(adminUsers);
  updateAdminRoleUI();
  renderOverview(items, accessRequests, userFeedbackRequests, claimRequests, matchRequests);
  renderAccountMetrics(userMetricsResult.error ? null : userMetricsResult.data);
  if (userMetricsResult.error) console.warn('Admin user metrics are unavailable. Apply the user activity metrics migration.');
  document.getElementById('nav-access-count').textContent = accessRequests.length;
    document.getElementById('nav-feedback-count').textContent = feedbackResult.error ? '—' : userFeedbackRequests.length;
    setStatus(document.getElementById('admin-feedback-status'), feedbackResult.error ? 'Apply the user feedback reports migration to enable this queue.' : '');
  document.getElementById('nav-claim-count').textContent = claimRequests.length;
  document.getElementById('nav-match-count').textContent = matchRequests.length;
  renderCalendar();
  setStatus(document.getElementById('admin-dashboard-status'), 'Review queues are up to date.');
}

async function handleSession(session) {
  const user = session?.user;
  if (!user) {
    currentUser = null;
    currentUserRole = '';
    updateAdminRoleUI();
    showPanel(authPanel);
    return;
  }

  if (!allowedEmail.test(user.email || '')) {
    currentUserRole = '';
    updateAdminRoleUI();
    await supabase.auth.signOut();
    setStatus(authStatus, 'Admin access is restricted to PUP institutional email addresses.', true);
    showPanel(authPanel);
    return;
  }

  currentUser = user;
  setStatus(authStatus, 'Checking administrator role...');
  const { data: role, error } = await supabase
    .from('admin_users')
    .select('user_id,role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    setStatus(authStatus, 'Could not verify administrator access. Apply the admin role hierarchy migration and try again.', true);
    showPanel(authPanel);
    return;
  }

  if (!role) {
    currentUserRole = '';
    updateAdminRoleUI();
    try {
      await requestAdminAccess(user);
    } catch (requestError) {
      console.error('Admin access request failed:', requestError);
      setStatus(authStatus, 'Could not submit an access request. Please try again.', true);
      showPanel(authPanel);
    }
    return;
  }

  currentUserRole = role.role;
  updateAdminRoleUI();
  document.getElementById('admin-current-email').textContent = user.email;
  populateProfile(user);
  showPanel(dashboard);
  showAdminView('overview');
  try {
    await loadAdminDashboard();
  } catch (loadError) {
    console.error('Admin dashboard load failed:', loadError);
    setStatus(document.getElementById('admin-dashboard-status'), 'Could not load the admin data. Check the Supabase migrations and permissions.', true);
  }
}

async function sendAuthLink(email, mode) {
  if (!allowedEmail.test(email)) {
    setStatus(authStatus, 'Use a valid @iskolarngbayan.pup.edu.ph address.', true);
    return;
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href,
      shouldCreateUser: mode === 'signup',
    },
  });
  if (error) throw error;

  setStatus(authStatus, mode === 'signup'
    ? 'Verification link sent. After verifying, your admin access request will be submitted for approval.'
    : 'Login link sent. Check your institutional email.');
}

document.getElementById('admin-auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) {
    setStatus(authStatus, 'Supabase is not configured. Admin signup and review require the live Supabase project.', true);
    return;
  }

  const mode = event.submitter?.dataset.authMode || 'login';
  const email = document.getElementById('admin-email').value.trim();
  try {
    await sendAuthLink(email, mode);
  } catch (error) {
    console.error('Admin authentication failed:', error);
    setStatus(authStatus, 'Could not send the login link. Check the email and Supabase Auth settings.', true);
  }
});

document.querySelectorAll('[data-admin-view]').forEach(button => {
  button.addEventListener('click', () => showAdminView(button.dataset.adminView));
});

document.addEventListener('click', event => {
  const detailsButton = event.target.closest('[data-admin-details]');
  if (detailsButton) {
    const records = {
      access: accessRequests,
      feedback: userFeedbackRequests,
      claim: claimRequests,
      match: matchRequests,
      item: items,
    }[detailsButton.dataset.adminDetails];
    const record = records?.find(entry => String(entry.id) === detailsButton.dataset.recordId);
    if (record) openRecordDetails(detailsButton.dataset.adminDetails, record);
    return;
  }
  const viewLink = event.target.closest('[data-admin-view-link]');
  if (viewLink) showAdminView(viewLink.dataset.adminViewLink);
});

document.getElementById('admin-details-close').addEventListener('click', () => {
  document.getElementById('admin-details-dialog').close();
});

document.getElementById('admin-user-list').addEventListener('change', event => {
  const roleSelect = event.target.closest('[data-admin-role-user]');
  if (roleSelect) void changeAdminRole(roleSelect.dataset.adminRoleUser, roleSelect.value);
});

document.getElementById('admin-user-list').addEventListener('click', event => {
  const revokeButton = event.target.closest('[data-revoke-admin]');
  if (revokeButton) void revokeAdminAccess(revokeButton.dataset.revokeAdmin);
});

document.getElementById('calendar-previous').addEventListener('click', () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById('calendar-next').addEventListener('click', () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

document.getElementById('admin-calendar-grid').addEventListener('click', event => {
  const day = event.target.closest('[data-calendar-date]');
  if (!day) return;
  selectedCalendarDate = day.dataset.calendarDate;
  renderCalendar();
});

document.getElementById('admin-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) return;

  const displayName = document.getElementById('profile-display-name').value.trim();
  if (!displayName) {
    setStatus(document.getElementById('admin-profile-status'), 'Enter a display name.', true);
    return;
  }

  try {
    if (supabase) {
      const { data, error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (error) throw error;
      currentUser = data.user;
    } else if (demoPreviewActive) {
      currentUser.user_metadata = { ...currentUser.user_metadata, display_name: displayName };
    }
    populateProfile(currentUser);
    setStatus(document.getElementById('admin-profile-status'), supabase ? 'Profile updated.' : 'Demo profile updated in this browser only.');
  } catch (error) {
    console.error('Admin profile update failed:', error);
    setStatus(document.getElementById('admin-profile-status'), 'Could not update your profile. Please try again.', true);
  }
});

document.querySelectorAll('[data-admin-signout]').forEach(button => {
  button.addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    demoPreviewActive = false;
    document.getElementById('admin-demo-notice').hidden = true;
    currentUser = null;
    currentUserRole = '';
    updateAdminRoleUI();
    accessRequests = [];
    claimRequests = [];
    matchRequests = [];
    items = [];
    adminUsers = [];
    showPanel(authPanel);
  });
});

document.getElementById('admin-refresh')?.addEventListener('click', async () => {
  try {
    await loadAdminDashboard();
  } catch (error) {
    console.error('Admin refresh failed:', error);
    setStatus(document.getElementById('admin-dashboard-status'), 'Refresh failed. Check your connection and try again.', true);
  }
});

document.getElementById('admin-pending-refresh')?.addEventListener('click', async () => {
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    await handleSession(session);
  }
});

document.getElementById('admin-access-list').addEventListener('click', async event => {
  if (!canManageAdminAccess()) return;
  const approveButton = event.target.closest('[data-approve-admin]');
  const rejectButton = event.target.closest('[data-reject-admin]');
  const button = approveButton || rejectButton;
  if (!button) return;
  if (!supabase) {
    simulateDemoReview('accessRequests', button.dataset.approveAdmin || button.dataset.rejectAdmin,
      approveButton ? 'Demo access request approved.' : 'Demo access request rejected.');
    return;
  }
  if (!currentUser) return;

  const request = accessRequests.find(entry => entry.id === button.dataset.approveAdmin || entry.id === button.dataset.rejectAdmin);
  if (!request) return;

  try {
    const { error } = await supabase.rpc('review_admin_access_request', {
      p_request_id: request.id,
      p_approve: Boolean(approveButton),
    });
    if (error) throw error;
    toast(approveButton ? 'Admin access approved.' : 'Admin access request rejected.', 'success');
    await loadAdminDashboard();
  } catch (error) {
    console.error('Admin access review failed:', error);
    toast('Could not update this access request.', 'error');
  }
});

document.getElementById('admin-claim-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-claim-status]');
  if (!button) return;
  if (!supabase) {
    simulateDemoReview('claimRequests', button.dataset.claimId,
      button.dataset.claimStatus === 'contacted' ? 'Demo claim marked as contacted.' : 'Demo claim request closed.');
    return;
  }

  const { error } = await supabase.from('claim_followup_requests').update({
    status: button.dataset.claimStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', button.dataset.claimId);
  if (error) {
    console.error('Claim request update failed:', error);
    toast('Could not update the claim request.', 'error');
    return;
  }

  toast(button.dataset.claimStatus === 'contacted' ? 'Marked as contacted.' : 'Claim request closed.', 'success');
  await loadAdminDashboard();
});

document.getElementById('admin-feedback-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-feedback-status]');
  if (!button) return;
  if (!supabase) {
    simulateDemoReview('feedbackRequests', button.dataset.feedbackId,
      button.dataset.feedbackStatus === 'reviewed' ? 'Demo feedback marked reviewed.' : 'Demo feedback report closed.');
    return;
  }
  if (!currentUser) return;

  const { error } = await supabase.from('user_feedback_reports').update({
    status: button.dataset.feedbackStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', button.dataset.feedbackId);
  if (error) {
    console.error('User feedback review failed:', error);
    toast('Could not update this feedback report.', 'error');
    return;
  }

  toast(button.dataset.feedbackStatus === 'reviewed' ? 'Feedback marked reviewed.' : 'Feedback report closed.', 'success');
  await loadAdminDashboard();
});

document.getElementById('admin-match-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-owner-status]');
  if (!button) return;
  if (!supabase) {
    simulateDemoReview('matchRequests', button.dataset.ownerId,
      button.dataset.ownerStatus === 'reviewed' ? 'Demo owner match marked reviewed.' : 'Demo owner match rejected.');
    return;
  }
  if (!currentUser) return;

  const { error } = await supabase.from('owner_match_requests').update({
    status: button.dataset.ownerStatus,
    reviewed_at: new Date().toISOString(),
    reviewed_by: currentUser.id,
  }).eq('id', button.dataset.ownerId);
  if (error) {
    console.error('Owner match review failed:', error);
    toast('Could not update the owner match submission.', 'error');
    return;
  }

  toast(button.dataset.ownerStatus === 'reviewed' ? 'Owner match marked reviewed.' : 'Owner match rejected.', 'success');
  await loadAdminDashboard();
});

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => { void handleSession(session); }, 0);
  });
} else {
  const previewButton = document.getElementById('admin-demo-preview');
  previewButton.hidden = false;
  previewButton.addEventListener('click', async () => {
    demoPreviewActive = true;
    currentUser = { id: 'demo-admin', email: 'super-admin@example.invalid', user_metadata: { display_name: 'Demo Administrator' } };
    currentUserRole = 'super_admin';
    updateAdminRoleUI();
    document.getElementById('admin-current-email').textContent = 'Demo preview · super-admin@example.invalid';
    populateProfile(currentUser);
    document.getElementById('admin-demo-notice').hidden = false;
    showPanel(dashboard);
    showAdminView('overview');
    await loadAdminDashboard();
  });
  setStatus(authStatus, 'Demo mode has no secure admin roles. Configure Supabase to use this portal.', true);
}