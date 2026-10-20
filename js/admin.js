import { supabase } from './supabase-config.js';
import { formatPostId, x, toast } from './utils.js';
import { createAuthLinkCooldown } from './auth-link-cooldown.js';

const allowedEmail = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@iskolarngbayan\.pup\.edu\.ph$/i;
const authPanel = document.getElementById('admin-auth-panel');
const pendingPanel = document.getElementById('admin-pending-panel');
const dashboard = document.getElementById('admin-dashboard');
const authStatus = document.getElementById('admin-auth-status');
const adminEmailInput = document.getElementById('admin-email');
const loginButton = document.querySelector('[data-auth-mode="login"]');
const signupButton = document.querySelector('[data-auth-mode="signup"]');
let currentUser = null;
let currentUserRole = '';
let accessRequests = [];
let announcementRequests = [];
let announcementPaymentSettings = null;
let comicChapters = [];
let userFeedbackRequests = [];
let claimRequests = [];
let matchRequests = [];
let items = [];
let adminUsers = [];
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = localDateKey(new Date());
const adminViewTitles = {
  overview: 'Dashboard',
  users: 'User management',
  calendar: 'Calendar',
  access: 'Admin access requests',
  comics: 'Comic chapter editor',
  announcements: 'Announcement requests',
  feedback: 'User feedback',
  claims: 'Claim follow-ups',
  matches: 'Owner match submissions',
  profile: 'Profile management',
};

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

const adminLinkCooldown = createAuthLinkCooldown({
  scope: 'pup-auth',
  input: adminEmailInput,
  button: loginButton,
  disabledButtons: [loginButton, signupButton],
  status: authStatus,
  getIdleLabel: () => 'Send login link',
});

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
    ...announcementRequests.map(request => ({ date: request.created_at, title: request.title, kind: 'Announcement request', view: 'announcements' })),
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

async function signAnnouncementReceipts(requests) {
  return Promise.all(requests.map(async request => {
    if (!request.payment_proof_path) return { ...request, payment_proof_url: '' };
    try {
      const { data, error } = await supabase.storage
        .from('announcement-payment-evidence')
        .createSignedUrl(request.payment_proof_path, 300);
      if (error) {
        console.error(`Could not open payment proof for announcement ${request.id}:`, error);
        return { ...request, payment_proof_url: '' };
      }
      return { ...request, payment_proof_url: data?.signedUrl || '' };
    } catch (error) {
      console.error(`Could not create a signed payment proof URL for announcement ${request.id}:`, error);
      return { ...request, payment_proof_url: '' };
    }
  }));
}

function renderOverview(items, access, announcements, feedback, claims, matches) {
  const openItems = items.filter(item => (item.status || 'open') !== 'resolved');
  const lostItems = items.filter(item => (item.type || '').toLowerCase() === 'lost');
  const foundItems = items.filter(item => (item.type || '').toLowerCase() === 'found');
  const queueTotal = access.length + announcements.length + feedback.length + claims.length + matches.length;
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
  const queues = [['Admin access', access.length], ['Announcements', announcements.length], ['User feedback', feedback.length], ['Claim follow-ups', claims.length], ['Owner matches', matches.length]];
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
  const compactId = requestId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `AR-${compactId.slice(0, 12) || 'PENDING'}`;
}

function renderAccountMetrics(metrics) {
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
    ? 'Live aggregate'
    : 'Unavailable';
  document.getElementById('admin-account-metrics-note').textContent = available
    ? 'Deleted accounts are counted from the start of activity tracking. Inactive accounts are not assumed to be deleted.'
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

function renderAnnouncementRequests(requests, unavailable = false) {
  const container = document.getElementById('admin-announcement-list');
  document.getElementById('admin-announcement-count').textContent = unavailable ? '—' : requests.length;
  if (unavailable) {
    container.innerHTML = '<p class="admin-empty">Announcement requests are unavailable. Apply the paid announcements migration.</p>';
    return;
  }
  if (!requests.length) {
    container.innerHTML = '<p class="admin-empty">No announcement requests are waiting for review or payment verification.</p>';
    return;
  }

  container.innerHTML = requests.map(request => {
    const submittedOn = new Date(request.created_at).toLocaleString('en-PH');
    if (request.status === 'pending_review') {
      return `<article class="admin-record admin-record-stacked admin-announcement-record">
        <div class="admin-record-main">
          <strong>Content review · ${x(request.email)}</strong>
          <span>Submitted ${x(submittedOn)}</span>
          <p class="admin-announcement-submitted-copy"><b>Submitted headline:</b> ${x(request.title)}<br><b>Submitted text:</b> ${x(request.message)}</p>
        </div>
        <div class="admin-announcement-review-fields">
          <label>Approved headline<input type="text" maxlength="100" data-announcement-title="${x(request.id)}" value="${x(request.title)}" /></label>
          <label>Approved announcement text<textarea rows="3" maxlength="500" data-announcement-message="${x(request.id)}">${x(request.message)}</textarea></label>
          <p>Requested duration: <strong>${x(request.requested_duration_hours)} hour${request.requested_duration_hours === 1 ? '' : 's'} · PHP ${x(request.requested_duration_hours * 10)}</strong></p>
          <label>Note for user (required when rejecting)<textarea rows="2" data-announcement-note="${x(request.id)}" placeholder="Explain edits or why the announcement cannot be approved."></textarea></label>
          <div class="admin-record-actions">
            <button class="btn btn-primary btn-sm" type="button" data-announcement-action="approve-text" data-announcement-id="${x(request.id)}">Approve text &amp; request payment</button>
            <button class="btn btn-danger btn-sm" type="button" data-announcement-action="reject-text" data-announcement-id="${x(request.id)}">Reject text</button>
          </div>
        </div>
      </article>`;
    }

    if (request.status === 'payment_submitted') {
      return `<article class="admin-record admin-record-stacked admin-announcement-record">
        <div class="admin-record-main">
          <strong>Payment verification · ${x(request.email)}</strong>
          <span>${x(request.payment_method === 'gcash' ? 'GCash' : 'MariBank')} · ${x(request.duration_hours)} hour${request.duration_hours === 1 ? '' : 's'} · PHP ${x(request.amount_due)}</span>
          <h3>${x(request.approved_title)}</h3>
          <p>${x(request.approved_message)}</p>
          ${request.payment_proof_url ? `<a class="admin-announcement-proof" href="${x(request.payment_proof_url)}" target="_blank" rel="noopener noreferrer">View uploaded receipt</a>` : '<span class="admin-view-note">Receipt could not be opened. Refresh before verifying.</span>'}
          <span>Submitted ${x(submittedOn)}</span>
        </div>
        <label>Note if requesting new proof<textarea rows="2" data-announcement-note="${x(request.id)}" placeholder="Explain why the receipt could not be verified."></textarea></label>
        <div class="admin-record-actions">
          <button class="btn btn-primary btn-sm" type="button" data-announcement-action="verify-payment" data-announcement-id="${x(request.id)}" ${request.payment_proof_url ? '' : 'disabled'}>Verify payment &amp; publish</button>
          <button class="btn btn-danger btn-sm" type="button" data-announcement-action="reject-payment" data-announcement-id="${x(request.id)}">Request new receipt</button>
        </div>
      </article>`;
    }

    return `<article class="admin-record admin-record-stacked admin-announcement-record">
      <div class="admin-record-main">
        <strong>Awaiting user payment · ${x(request.email)}</strong>
        <span>${x(request.duration_hours)} hour${request.duration_hours === 1 ? '' : 's'} · PHP ${x(request.amount_due)}</span>
        <h3>${x(request.approved_title)}</h3>
        <p>${x(request.approved_message)}</p>
      </div>
    </article>`;
  }).join('');
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

const comicPageMaxCount = 50;
const comicPathPattern = /^assets\/comics\/[A-Za-z0-9._/-]+$/;
const comicImageExtensionPattern = /\.(?:jpe?g|png|webp|gif|avif)$/i;

function getComicArtworkUrl(path) {
  return path ? `./${path}` : '';
}

function isValidComicPath(path) {
  return comicPathPattern.test(path)
    && comicImageExtensionPattern.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}

function parseComicPagePaths(value) {
  return value.split('\n').map(path => path.trim()).filter(Boolean);
}

function validateComicPaths(coverPath, pagePaths) {
  if (coverPath && !isValidComicPath(coverPath)) {
    return 'Cover path must be an image file inside assets/comics/.';
  }
  if (pagePaths.length > comicPageMaxCount) {
    return `Enter no more than ${comicPageMaxCount} page paths.`;
  }
  if (pagePaths.some(path => !isValidComicPath(path))) {
    return 'Each page path must be an image file inside assets/comics/.';
  }
  return '';
}

function renderComicChapters(chapters, unavailable = false) {
  const container = document.getElementById('admin-comic-chapter-list');
  document.getElementById('admin-comic-count').textContent = unavailable ? '—' : chapters.length;
  if (unavailable) {
    container.innerHTML = '<p class="admin-empty">Comic chapters are unavailable. Apply the comic chapter editor migration.</p>';
    return;
  }
  if (!chapters.length) {
    container.innerHTML = '<p class="admin-empty">No comic chapters. Create one above to get started.</p>';
    return;
  }

  container.innerHTML = chapters.map(chapter => {
    const coverUrl = getComicArtworkUrl(chapter.cover_path);
    const pageUrls = (chapter.page_paths || []).map(getComicArtworkUrl);
    return `<article class="admin-section admin-comic-chapter${chapter.is_archived ? ' is-archived' : ''}">
      <div class="admin-comic-chapter-header">
        <div><span class="admin-comic-chapter-number">Chapter ${chapter.chapter_number}</span><span class="admin-comic-chapter-state">${chapter.is_archived ? 'Archived' : 'Active'}</span></div>
        <div class="admin-comic-preview">
          ${coverUrl ? `<a href="${x(coverUrl)}" target="_blank" rel="noopener noreferrer"><img src="${x(coverUrl)}" alt="${x(chapter.title)} cover" loading="lazy"></a>` : '<span class="admin-comic-no-cover">No cover</span>'}
          ${pageUrls.slice(0, 5).map((url, index) => `<a href="${x(url)}" target="_blank" rel="noopener noreferrer"><img src="${x(url)}" alt="${x(chapter.title)} page ${index + 1}" loading="lazy"></a>`).join('')}
          ${pageUrls.length > 5 ? `<span class="admin-comic-more-pages">+${pageUrls.length - 5}</span>` : ''}
        </div>
      </div>
      <form class="admin-comic-form admin-comic-edit-form" data-comic-id="${x(chapter.id)}">
        <label>Chapter title<input name="title" type="text" maxlength="120" value="${x(chapter.title)}" required /></label>
        <label>Story description <span class="admin-optional">(optional)</span><textarea name="description" rows="2" maxlength="1000">${x(chapter.description || '')}</textarea></label>
        <label>Cover image path <span class="admin-optional">(optional)</span><input name="cover-path" type="text" value="${x(chapter.cover_path || '')}" placeholder="assets/comics/chapter-01/cover.webp" /></label>
        <label>Page image paths <span class="admin-optional">(one local path per line, in reading order)</span><textarea name="page-paths" rows="4">${x((chapter.page_paths || []).join('\n'))}</textarea></label>
        <div class="admin-comic-form-actions">
          <p class="admin-status" role="status" aria-live="polite"></p>
          <div class="admin-record-actions">
            <button class="btn btn-primary btn-sm" type="submit">Save chapter</button>
            <button class="${chapter.is_archived ? 'btn btn-ghost' : 'btn btn-danger'} btn-sm" type="button" data-comic-archive="${x(chapter.id)}" data-archive-state="${chapter.is_archived ? 'true' : 'false'}">${chapter.is_archived ? 'Restore chapter' : 'Archive chapter'}</button>
          </div>
        </div>
      </form>
    </article>`;
  }).join('');
}

async function createComicChapter(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('comic-chapter-create-status');
  const button = form.querySelector('button[type="submit"]');
  const title = form.elements.namedItem('title').value.trim();
  const description = form.elements.namedItem('description').value.trim();
  const coverPath = form.elements.namedItem('cover-path').value.trim();
  const pagePaths = parseComicPagePaths(form.elements.namedItem('page-paths').value);
  const pathError = validateComicPaths(coverPath, pagePaths);
  if (!title || title.length > 120 || description.length > 1000 || pathError) {
    setStatus(status, pathError || 'Enter a chapter title and a description no longer than 1,000 characters.', true);
    return;
  }

  button.disabled = true;
  setStatus(status, 'Creating chapter...');
  const chapterId = crypto.randomUUID();
  let chapterSaved = false;
  try {
    const { data: latestSlots, error: slotsError } = await supabase.from('comic_chapter_slots')
      .select('chapter_number')
      .order('chapter_number', { ascending: false })
      .limit(1);
    if (slotsError) throw slotsError;
    const chapterNumber = Number(latestSlots?.[0]?.chapter_number || 0) + 1;
    const { error } = await supabase.from('comic_chapters').insert({
      id: chapterId,
      chapter_number: chapterNumber,
      title,
      description,
      cover_path: coverPath || null,
      page_paths: pagePaths,
      created_by: currentUser.id,
      updated_by: currentUser.id,
    });
    if (error) throw error;
    chapterSaved = true;
    form.reset();
    setStatus(status, `Chapter ${chapterNumber} created.`);
    toast(`Chapter ${chapterNumber} created.`, 'success');
    try {
      await loadAdminDashboard();
    } catch (refreshError) {
      console.error('Comic chapter was created but the editor could not refresh:', refreshError);
      setStatus(status, `Chapter ${chapterNumber} was created. Refresh the admin portal to see it.`);
    }
  } catch (error) {
    console.error('Comic chapter creation failed:', error);
    setStatus(status, chapterSaved
      ? 'The chapter was saved, but its editor could not refresh. Refresh the admin portal.'
      : 'Could not create the chapter. Check your admin access and connection.', true);
  } finally {
    button.disabled = false;
  }
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
      setStatus(document.getElementById('admin-dashboard-status'), 'Backend is not configured.', true);
      return;
    }

    const [accessResult, announcementResult, settingsResult, comicResult, feedbackResult, claimsResult, matchesResult, itemsResult, adminsResult, userMetricsResult] = await Promise.all([
    supabase.from('admin_access_requests').select('*').eq('status', 'pending').order('requested_at'),
    supabase.from('announcement_requests').select('*').in('status', ['pending_review', 'awaiting_payment', 'payment_submitted']).order('created_at'),
    supabase.from('announcement_payment_settings').select('*').eq('id', 'default').maybeSingle(),
    supabase.from('comic_chapters').select('*').order('chapter_number'),
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
  announcementRequests = announcementResult.error ? [] : announcementResult.data || [];
  announcementPaymentSettings = settingsResult.data || null;
  comicChapters = comicResult.error ? [] : comicResult.data || [];
  const signedAnnouncementRequests = announcementResult.error ? [] : await signAnnouncementReceipts(announcementRequests);
  if (!settingsResult.error) {
    document.getElementById('announcement-gcash-instructions').value = settingsResult.data?.gcash_instructions || '';
    document.getElementById('announcement-maribank-instructions').value = settingsResult.data?.maribank_instructions || '';
  }
  claimRequests = await signPrivateEvidence(claimsResult.data || [], 'claim-evidence');
    userFeedbackRequests = feedbackResult.error ? [] : await signPrivateEvidence(feedbackResult.data || [], 'user-feedback-evidence');
  matchRequests = await signPrivateEvidence(matchesResult.data || [], 'claim-evidence');
  items = itemsResult.data || [];
  adminUsers = adminsResult.data || [];
  renderAccessRequests(accessRequests);
  renderComicChapters(comicChapters, Boolean(comicResult.error));
  renderAnnouncementRequests(signedAnnouncementRequests, Boolean(announcementResult.error));
    renderUserFeedbackRequests(userFeedbackRequests, Boolean(feedbackResult.error));
  renderClaimRequests(claimRequests);
  renderOwnerMatchRequests(matchRequests);
  renderItems(items);
  renderAdmins(adminUsers);
  updateAdminRoleUI();
  renderOverview(items, accessRequests, announcementRequests, userFeedbackRequests, claimRequests, matchRequests);
  renderAccountMetrics(userMetricsResult.error ? null : userMetricsResult.data);
  if (userMetricsResult.error) console.warn('Admin user metrics are unavailable. Apply the user activity metrics migration.');
  document.getElementById('nav-access-count').textContent = accessRequests.length;
  document.getElementById('nav-announcement-count').textContent = announcementResult.error ? '—' : announcementRequests.length;
  setStatus(document.getElementById('admin-announcement-status'), announcementResult.error || settingsResult.error ? 'Apply the paid announcements migration to enable this workflow.' : '');
  setStatus(document.getElementById('admin-comic-status'), comicResult.error ? 'Apply the comic chapter editor migration to enable this editor.' : '');
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

  if (adminLinkCooldown.isCoolingDown(email)) {
    adminLinkCooldown.refresh(email);
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

  adminLinkCooldown.start(
    email,
    mode === 'signup'
      ? `Verification email requested for ${email}. Check your inbox and spam folder. After verification, your admin request awaits approval.`
      : `Login email requested for ${email}. Check your inbox and spam folder before requesting another.`
  );
}

document.getElementById('admin-auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase) {
    setStatus(authStatus, 'Supabase is not configured. Admin signup and review require the live Supabase project.', true);
    return;
  }

  const mode = event.submitter?.dataset.authMode || 'login';
  const email = document.getElementById('admin-email').value.trim();
  adminLinkCooldown.setPending(true);
  try {
    await sendAuthLink(email, mode);
  } catch (error) {
    console.error('Admin authentication failed:', error);
    setStatus(authStatus, `Could not send the login link: ${error?.message || 'Unknown Supabase Auth error.'}`, true);
  } finally {
    adminLinkCooldown.setPending(false);
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

document.getElementById('comic-chapter-create-form').addEventListener('submit', createComicChapter);

document.getElementById('admin-comic-chapter-list').addEventListener('submit', async event => {
  const form = event.target.closest('.admin-comic-edit-form');
  if (!form || !currentUser || !supabase) return;
  event.preventDefault();

  const chapter = comicChapters.find(entry => entry.id === form.dataset.comicId);
  if (!chapter) return;
  const status = form.querySelector('[role="status"]');
  const button = form.querySelector('button[type="submit"]');
  const title = form.elements.namedItem('title').value.trim();
  const description = form.elements.namedItem('description').value.trim();
  const coverPath = form.elements.namedItem('cover-path').value.trim();
  const pagePaths = parseComicPagePaths(form.elements.namedItem('page-paths').value);
  const pathError = validateComicPaths(coverPath, pagePaths);

  if (!title || title.length > 120 || description.length > 1000 || pathError) {
    setStatus(status, pathError || 'Enter a chapter title and a description no longer than 1,000 characters.', true);
    return;
  }

  button.disabled = true;
  setStatus(status, 'Saving chapter...');
  let chapterSaved = false;
  try {
    const { data, error } = await supabase.from('comic_chapters').update({
      title,
      description,
      cover_path: coverPath || null,
      page_paths: pagePaths,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString(),
    }).eq('id', chapter.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Chapter was not found or admin access was denied.');
    chapterSaved = true;
    toast(`Chapter ${chapter.chapter_number} updated.`, 'success');
    try {
      await loadAdminDashboard();
    } catch (refreshError) {
      console.error('Comic chapter was updated but the editor could not refresh:', refreshError);
      setStatus(status, `Chapter ${chapter.chapter_number} was updated. Refresh the admin portal to see it.`);
    }
  } catch (error) {
    console.error('Comic chapter update failed:', error);
    setStatus(status, chapterSaved
      ? `Chapter ${chapter.chapter_number} was saved. Refresh the admin portal to see the latest data.`
      : 'Could not save this chapter. Check your admin access and connection.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('admin-comic-chapter-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-comic-archive]');
  if (!button || !currentUser || !supabase) return;
  const chapter = comicChapters.find(entry => entry.id === button.dataset.comicArchive);
  if (!chapter) return;

  const willArchive = button.dataset.archiveState !== 'true';
  const prompt = willArchive
    ? `Archive Chapter ${chapter.chapter_number}? It will be hidden from My Journey, but its number and user progress will be preserved.`
    : `Restore Chapter ${chapter.chapter_number} to My Journey?`;
  if (!window.confirm(prompt)) return;

  button.disabled = true;
  let updated = false;
  try {
    const { error } = await supabase.from('comic_chapters').update({
      is_archived: willArchive,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString(),
    }).eq('id', chapter.id);
    if (error) throw error;
    updated = true;
    toast(willArchive ? 'Chapter archived; its number and progress are preserved.' : 'Chapter restored.', 'success');
    try {
      await loadAdminDashboard();
    } catch (refreshError) {
      console.error('Comic chapter archive state was changed but the editor could not refresh:', refreshError);
      toast('Chapter state changed. Refresh the admin portal to see the update.', 'error');
    }
  } catch (error) {
    console.error('Comic chapter archive update failed:', error);
    toast(updated ? 'Chapter state changed. Refresh the admin portal to see the update.' : 'Could not update this chapter. Refresh and try again.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('announcement-payment-settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser || !supabase) return;

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('announcement-payment-settings-status');
  button.disabled = true;
  setStatus(status, 'Saving payment details...');
  try {
    const { data, error } = await supabase.from('announcement_payment_settings').update({
      gcash_instructions: document.getElementById('announcement-gcash-instructions').value.trim(),
      maribank_instructions: document.getElementById('announcement-maribank-instructions').value.trim(),
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id,
    }).eq('id', 'default').select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Payment settings row is unavailable.');
    announcementPaymentSettings = {
      gcash_instructions: document.getElementById('announcement-gcash-instructions').value.trim(),
      maribank_instructions: document.getElementById('announcement-maribank-instructions').value.trim(),
    };
    setStatus(status, 'Payment details saved.');
    toast('Announcement payment details saved.', 'success');
  } catch (error) {
    console.error('Announcement payment details could not be saved:', error);
    setStatus(status, 'Could not save payment details. Check your connection and admin access.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('admin-announcement-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-announcement-action]');
  if (!button || !currentUser || !supabase) return;

  const requestId = button.dataset.announcementId;
  const request = announcementRequests.find(entry => entry.id === requestId);
  if (!request) return;

  const container = document.getElementById('admin-announcement-list');
  const action = button.dataset.announcementAction;
  button.disabled = true;

  try {
    if (action === 'approve-text' || action === 'reject-text') {
      const note = Array.from(container.querySelectorAll('[data-announcement-note]'))
        .find(field => field.dataset.announcementNote === requestId)?.value.trim() || '';
      const approvedTitle = Array.from(container.querySelectorAll('[data-announcement-title]'))
        .find(field => field.dataset.announcementTitle === requestId)?.value.trim() || '';
      const approvedMessage = Array.from(container.querySelectorAll('[data-announcement-message]'))
        .find(field => field.dataset.announcementMessage === requestId)?.value.trim() || '';
      const hours = Number(request.requested_duration_hours);
      const approve = action === 'approve-text';
      if (!approve && note.length < 3) {
        toast('Add a short explanation before rejecting the announcement.', 'error');
        return;
      }
      if (approve && !announcementPaymentSettings?.gcash_instructions?.trim() && !announcementPaymentSettings?.maribank_instructions?.trim()) {
        toast('Configure at least one payment method before approving announcement text.', 'error');
        return;
      }
      if (approve && (!approvedTitle || approvedTitle.length > 100 || !approvedMessage || approvedMessage.length > 500 || !Number.isInteger(hours) || hours < 1 || hours > 5)) {
        toast('Enter valid approved text and verify the requested duration is from 1 to 5 hours.', 'error');
        return;
      }

      const { error } = await supabase.rpc('review_announcement_request', {
        p_request_id: requestId,
        p_approve: approve,
        p_approved_title: approve ? approvedTitle : null,
        p_approved_message: approve ? approvedMessage : null,
        p_duration_hours: approve ? hours : null,
        p_note: note || null,
      });
      if (error) throw error;
      toast(approve ? 'Text approved. The user can now pay.' : 'Announcement text rejected.', 'success');
    } else if (action === 'verify-payment') {
      if (!request.payment_proof_path || !request.payment_method) {
        toast('A payment receipt and method are required before verification.', 'error');
        return;
      }
      const { error } = await supabase.rpc('verify_announcement_payment', { p_request_id: requestId });
      if (error) throw error;
      toast('Payment verified and announcement published.', 'success');
    } else if (action === 'reject-payment') {
      const note = Array.from(container.querySelectorAll('[data-announcement-note]'))
        .find(field => field.dataset.announcementNote === requestId)?.value.trim() || '';
      if (note.length < 3) {
        toast('Explain why the user needs to submit a new receipt.', 'error');
        return;
      }
      const { error } = await supabase.rpc('reject_announcement_payment', {
        p_request_id: requestId,
        p_note: note,
      });
      if (error) throw error;
      if (request.payment_proof_path) {
        const { error: removeError } = await supabase.storage.from('announcement-payment-evidence').remove([request.payment_proof_path]);
        if (removeError) console.error('Rejected announcement receipt could not be removed:', removeError);
      }
      toast('Receipt returned for resubmission.', 'success');
    } else {
      return;
    }
    await loadAdminDashboard();
  } catch (error) {
    console.error('Announcement review action failed:', error);
    toast('Could not update this announcement request. Refresh and try again.', 'error');
  } finally {
    button.disabled = false;
  }
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
    if (!supabase) {
      setStatus(document.getElementById('admin-profile-status'), 'Backend is not configured.', true);
      return;
    }
    const { data, error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
    if (error) throw error;
    currentUser = data.user;
    populateProfile(currentUser);
    setStatus(document.getElementById('admin-profile-status'), 'Profile updated.');
  } catch (error) {
    console.error('Admin profile update failed:', error);
    setStatus(document.getElementById('admin-profile-status'), 'Could not update your profile. Please try again.', true);
  }
});

document.querySelectorAll('[data-admin-signout]').forEach(button => {
  button.addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    currentUserRole = '';
    updateAdminRoleUI();
    accessRequests = [];
    announcementRequests = [];
    comicChapters = [];
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
  if (!button || !currentUser || !supabase) return;

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
  if (!button || !supabase) return;

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
  if (!button || !currentUser || !supabase) return;

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
  if (!button || !currentUser || !supabase) return;

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
  setStatus(authStatus, 'Supabase is not configured. Check js/supabase-config.js.', true);
}