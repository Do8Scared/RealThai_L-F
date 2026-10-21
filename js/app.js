/**
 * ==============================================================================
 * PUP:IskoFinds - APP.JS FUNCTION INDEX
 * ==============================================================================
 * 1. window.openReport()         - Opens the report item modal overlay.
 * 2. window.closeModal(modalId)  - Closes any modal overlay by its ID.
 * 3. window.goTo(secId)          - Programmatically switches active sections.
 * 4. bindReportButtons()         - Directly binds click handlers to report buttons.
 * 5. initAppNavigation()         - Handles sidebar and mobile tab section routing.
 * 6. initFilterListeners()       - Listens to search inputs, dropdowns, and chips.
 * 7. fetchAndSyncItems()         - Fetches live items feed from Supabase or fallback.
 * 8. window.setFType(type)       - Toggles between 'lost' and 'found' report modes.
 * 9. window.submitReport()       - Validates, uploads image, and posts new report.
 * 10. renderMyReports()          - Renders user's personal reports view.
 * 11. window.openHandoffModal()  - Starts a two-party item handoff confirmation.
 * 12. window.confirmHandoff()    - Confirms the other side of a successful return.
 * 13. window.cancelHandoff()     - Cancels a pending handoff as its initiator.
 * ==============================================================================
 */

import { supabase } from './supabase-config.js';
import { renderAll } from './ui.js';
import { toast, formatPostId, tsDate, x } from './utils.js';
import { createAuthLinkCooldown } from './auth-link-cooldown.js';
import { COMIC_CHAPTERS } from './comic-chapters.js';

const state = {
  items: [],
  handoffs: [],
  comicChapters: COMIC_CHAPTERS,
  activeType: '',
  userEmail: '',
  userId: '',
  storySide: 'light',
  journeyProgress: null,
  isAdmin: false,
  adminStatusReady: false,
};

const JOURNEY_RANKS = [
    { light: 'New Isko', dark: 'New Isko' },
    { light: 'Campus Scout', dark: 'Shadow Scout' },
    { light: 'Item Seeker', dark: 'Night Tracker' },
    { light: 'Return Ally', dark: 'Dark Ally' },
    { light: 'Isko Guardian', dark: 'Shadow Guardian' },
    { light: 'Campus Champion', dark: 'Eclipse Champion' },
    { light: 'PUP Protector', dark: 'Night Protector' },
    { light: 'Isko Legend', dark: 'Shadow Legend' },
    { light: 'PUP Hero', dark: 'Midnight Hero' },
];

const JOURNEY_BADGES = [
    { count: 1, title: 'First Reunion', description: 'Complete your first confirmed handoff.', icon: '🤝' },
    { count: 3, title: 'Campus Helper', description: 'Help reunite three belongings with their people.', icon: '🏅' },
    { count: 5, title: 'Trusted Returner', description: 'Complete five successful handoffs.', icon: '⭐' },
    { count: 8, title: 'Isko Legend', description: 'Unlock eight comic chapters.', icon: '🏆' },
];

function isAllowedInstitutionalEmail(email) {
    return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@iskolarngbayan\.pup\.edu\.ph$/i.test(email);
}

// ==========================================
// GLOBAL UI HELPERS
// ==========================================

window.openReport = () => {
  const modal = document.getElementById('report-overlay');
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
};

window.closeModal = (modalId) => {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => {
    if (!modal.classList.contains('open')) modal.style.display = 'none';
  }, 180);
};

window.goTo = (secId) => {
  const btn = document.querySelector(`[data-sec="${secId}"]`);
  if (btn) btn.click();
};

let currentReportType = 'lost';
window.setFType = (type) => {
    currentReportType = type;
    const btnLost = document.getElementById('t-lost');
    const btnFound = document.getElementById('t-found');
    if (btnLost && btnFound) {
        btnLost.classList.toggle('sel-lost', type === 'lost');
        btnFound.classList.toggle('sel-found', type === 'found');
    }
};


// ==========================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('iskofinds:theme-toggle-locked', (event) => {
        const storySide = event.detail?.storySide === 'dark' ? 'Dark Side' : 'Light Side';
        toast(`Finish every chapter in your chosen ${storySide} storyline to unlock the theme toggle.`, 'error');
    });
    checkAuthGate();
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    window.switchAuthTab('login');

    if (supabase) {
        supabase.auth.onAuthStateChange((_event, session) => {
            const email = session?.user?.email || '';
            state.storySide = session?.user?.user_metadata?.story_side === 'dark' ? 'dark' : 'light';
            if (state.userId !== (session?.user?.id || '')) {
                state.handoffs = [];
                state.journeyProgress = null;
                state.isAdmin = false;
                state.adminStatusReady = false;
            }
            if (isAllowedInstitutionalEmail(email)) {
                state.userId = session.user.id;
                void loadAdminThemeAccess(session.user.id);
                unlockAppShell(email);
                void fetchAndSyncItems();
                void loadAnnouncements();
                void loadMyJourney();
            } else {
                state.userId = '';
                state.handoffs = [];
                window.setThemeToggleLocked(false);
                lockAppShell();
            }
        });
    }

    initAppNavigation();
    bindReportButtons();
    initFilterListeners();
    document.getElementById('handoff-form')?.addEventListener('submit', startHandoff);
    new MutationObserver(() => {
        if (document.getElementById('sec-journey')?.classList.contains('active')) {
            renderMyJourney();
        }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
});

function bindReportButtons() {
  const reportButtons = document.querySelectorAll('[onclick*="openReport()"], [data-open="report"], .nav-item[onclick*="openReport"], .mob-btn[onclick*="openReport"], .btn[onclick*="openReport"]');

  reportButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.openReport?.();
    });
  });
}

function initAppNavigation() {
    const navButtons = document.querySelectorAll('[data-sec], .mob-btn[data-sec], .nav-item[data-sec]');
    
    navButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSec = button.getAttribute('data-sec');
            if (!targetSec) return;

            document.querySelectorAll('[data-sec], .mob-btn, .nav-item').forEach(btn => {
                btn.classList.remove('active');
            });
            document.querySelectorAll(`[data-sec="${targetSec}"]`).forEach(btn => {
                btn.classList.add('active');
            });

            document.querySelectorAll('.section').forEach(sec => {
                sec.style.display = 'none';
                sec.classList.remove('active');
            });

            const targetSection = document.getElementById(`sec-${targetSec}`) || document.getElementById(targetSec);
            if (targetSection) {
                targetSection.style.display = 'block';
                targetSection.classList.add('active');
                
                // Trigger specific tab renders if needed
                if (targetSec === 'my-reports') {
                    renderMyReports(state);
                }
                if (targetSec === 'journey') {
                    void loadMyJourney();
                }
                if (targetSec === 'announcements') {
                    void loadAnnouncements();
                }
            } else {
                console.warn(`Target section element for "${targetSec}" not found in DOM.`);
            }
        });
    });
    document.getElementById('my-announcement-requests')?.addEventListener('submit', handleAnnouncementPaymentSubmit);
}

function initFilterListeners() {
  const searchInput = document.getElementById('lf-search');
  const statusFilter = document.getElementById('status-filter');
  const catFilter = document.getElementById('cat-filter');
  const typeChips = document.querySelectorAll('#type-chips .chip');

  const triggerRender = () => renderAll(state);

  if (searchInput) searchInput.addEventListener('input', triggerRender);
  if (statusFilter) statusFilter.addEventListener('change', triggerRender);
  if (catFilter) catFilter.addEventListener('change', triggerRender);

  typeChips.forEach(chip => {
    chip.addEventListener('click', () => {
      typeChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeType = chip.getAttribute('data-type') || '';
      renderAll(state);
    });
  });
}


// ==========================================
// DATA SYNC & FORM SUBMISSION
// ==========================================

async function fetchAndSyncItems(){
    if (!supabase) {
      state.items = [];
      renderAll(state);
      return;
    }

    try {
      const {data, error} = await supabase.from('items')
        .select('*')
        .order('created_at', {ascending: false});

      if (error) {
        console.error('Error fetching items:', error);
        toast('Error fetching items. Please try again later.', 'error');
        state.items = [];
      } else {
        state.items = data || [];
      }
    } catch (error) {
      console.error('Unexpected item fetch error:', error);
      toast('Unable to load items right now.', 'error');
      state.items = [];
    }
    renderAll(state);
}

window.submitReport = async () => {
    const submitBtn = document.getElementById('submit-btn');

    const title = document.getElementById('f-title')?.value.trim();
    const category = document.getElementById('f-cat')?.value;
    const campus = document.getElementById('f-campus')?.value;
    const location = document.getElementById('f-loc')?.value.trim();
    const description = document.getElementById('f-desc')?.value.trim();
    const reporterName = document.getElementById('f-name')?.value.trim();
    const contact = document.getElementById('f-contact')?.value.trim();
    const department = document.getElementById('f-dept')?.value || '';
    const imageInput = document.getElementById('f-img-file');

    // 1. Validate required text fields first
    if (!title || !category || !campus || !location || !description || !reporterName || !contact) {
        toast('Please fill out all required fields marked with *.', 'error');
        return;
    }

    // 2. Enforce the official institutional email only. Reject all other email formats.
    if (!isAllowedInstitutionalEmail(contact)) {
        toast('Only @iskolarngbayan.pup.edu.ph email addresses are accepted.', 'error');
        return;
    }

    if (!supabase) {
        toast('Backend is not configured.', 'error');
        return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || !isAllowedInstitutionalEmail(user.email || '')) {
        toast('Sign in with your PUP account before submitting a report.', 'error');
        return;
    }
    state.userId = user.id;

    const originalBtnText = submitBtn ? submitBtn.textContent : 'Submit Report';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting report...';
    }

    try {
        let imageUrl = '';
        const file = imageInput && imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;

        if (file) {
            if (!file.type.startsWith('image/')) {
                toast('Please upload a valid image file.', 'error');
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                toast('Image file size must be less than 5MB.', 'error');
                return;
            }

            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('item-images')
                .upload(fileName, file);

            if (uploadError) {
                console.error('Image upload error:', uploadError);
                toast('Failed to upload image.', 'error');
                return;
            }

            const { data: publicUrlData } = supabase.storage
                .from('item-images')
                .getPublicUrl(fileName);

            imageUrl = publicUrlData?.publicUrl || '';
        }

        const { data, error } = await supabase
            .from('items')
            .insert([{
                user_id: user.id,
                title,
                description,
                category,
                campus,
                type: currentReportType,
                location,
                reporterName,
                contact,
                department,
                imageUrl,
                status: 'open',
                created_at: new Date().toISOString(),
                activity: [{
                    id: 'evt_initial',
                    actor: reporterName,
                    type: 'report_created',
                    message: `${reporterName} submitted this ${currentReportType} report.`,
                    timestamp: Date.now(),
                    imageUrl: imageUrl || '',
                }],
            }])
            .select();

        if (error) {
            console.error('Error inserting item:', error);
            toast('Failed to save report to database.', 'error');
            return;
        }

        if (data && data[0]) {
            state.items.unshift(data[0]);
        }

        toast('Item reported successfully!', 'success');
        window.closeModal('report-overlay');

        document.getElementById('f-title').value = '';
        document.getElementById('f-campus').value = '';
        document.getElementById('f-loc').value = '';
        document.getElementById('f-desc').value = '';
        document.getElementById('f-name').value = '';
        document.getElementById('f-contact').value = '';
        document.getElementById('f-dept').value = '';
        if (imageInput) imageInput.value = '';

        renderAll(state);

    } catch (err) {
        console.error('Unexpected error during submission:', err);
        toast('An unexpected error occurred.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }
};


// ==========================================
// MY REPORTS & STATUS MANAGEMENT
// ==========================================

const ANNOUNCEMENT_PAYMENT_BUCKET = 'announcement-payment-evidence';
let announcementExpiryTimeout = null;
let announcementRefreshInterval = null;
let userAnnouncementRequests = [];
let userAnnouncementPaymentSettings = null;

function formatAnnouncementAmount(amount) {
    return `PHP ${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function renderAnnouncementBanner(announcement) {
    const banner = document.getElementById('announcement-banner');
    if (!banner) return;
    clearTimeout(announcementExpiryTimeout);
    if (!announcement?.length) {
        banner.style.display = 'none';
        return;
    }

    banner.innerHTML = `<div class="announcement-tag">Announcement</div>${announcement.map(item => `
      <div class="announcement-copy"><strong>${x(item.approved_title)}</strong> ${x(item.approved_message)}</div>
    `).join('')}`;
    banner.style.display = '';
    const nextExpiry = Math.min(...announcement.map(item => new Date(item.expires_at).getTime()));
    if (Number.isFinite(nextExpiry)) {
        announcementExpiryTimeout = setTimeout(() => { void loadAnnouncements(); }, Math.max(0, nextExpiry - Date.now() + 50));
    }
}

function getAnnouncementStatusLabel(status) {
    return ({
        pending_review: 'Waiting for content review',
        awaiting_payment: 'Approved · payment needed',
        payment_submitted: 'Payment proof submitted · under review',
        published: 'Published',
        rejected: 'Not approved',
    })[status] || 'Status unavailable';
}

function hasActiveAnnouncementRequest(requests) {
    return requests.some(request => ['pending_review', 'awaiting_payment', 'payment_submitted'].includes(request.status));
}

function renderAnnouncementPaymentInstruction(value) {
    const details = value.trim();
    try {
        const url = new URL(details);
        if (url.protocol === 'https:') {
            return `<a class="announcement-payment-link" href="${x(url.href)}" target="_blank" rel="noopener noreferrer">Open secure payment / QR link</a>`;
        }
    } catch {
        return x(details);
    }
    return x(details);
}

function renderAnnouncementRequests(requests, settings) {
    const container = document.getElementById('my-announcement-requests');
    if (!container) return;
    userAnnouncementRequests = requests;
    userAnnouncementPaymentSettings = settings;
    const activeRequest = requests.find(request => ['pending_review', 'awaiting_payment', 'payment_submitted'].includes(request.status));
    const requestForm = document.getElementById('announcement-request-form');
    const submitButton = requestForm?.querySelector('button[type="submit"]');
    const status = document.getElementById('announcement-request-status');
    if (submitButton) {
        submitButton.disabled = Boolean(activeRequest);
        submitButton.textContent = activeRequest ? 'Request in progress' : 'Submit for review';
    }
    if (status && activeRequest) {
        status.textContent = activeRequest.status === 'awaiting_payment'
            ? 'Your approved request is awaiting payment.'
            : activeRequest.status === 'payment_submitted'
                ? 'Your receipt is awaiting verification.'
                : 'Your announcement request is under review.';
    }
    if (!requests.length) {
        container.innerHTML = '<p class="announcement-request-empty">You have not submitted an announcement yet.</p>';
        return;
    }

    const instructions = {
        gcash: settings?.gcash_instructions || '',
        maribank: settings?.maribank_instructions || '',
    };

    container.innerHTML = requests.map(request => {
        const title = request.approved_title || request.title;
        const message = request.approved_message || request.message;
        const availablePaymentMethods = Object.entries(instructions).filter(([, details]) => details.trim());
        const paymentDetails = availablePaymentMethods.map(([method, details]) => `
            <p><b>${method === 'gcash' ? 'GCash' : 'MariBank'}:</b> ${renderAnnouncementPaymentInstruction(details)}</p>
        `).join('');
        const paymentInstructions = request.status === 'awaiting_payment'
            ? `<div class="announcement-payment-details">
                <strong>Payment details</strong>
                ${paymentDetails || '<p>Payment details are not configured yet. Please check back before paying.</p>'}
              </div>`
            : '';
        const paymentForm = request.status === 'awaiting_payment' && availablePaymentMethods.length
            ? `<form class="announcement-payment-form" data-payment-request="${x(request.id)}">
                <label>Upload payment receipt
                  <input name="payment-proof" type="file" accept="image/jpeg,image/png,image/webp" required />
                </label>
                <label>Paid using
                  <select name="payment-method" required>
                    <option value="">Choose payment method</option>
                    ${availablePaymentMethods.map(([method]) => `<option value="${x(method)}">${method === 'gcash' ? 'GCash' : 'MariBank'}</option>`).join('')}
                  </select>
                </label>
                <button class="btn btn-primary btn-sm" type="submit">Send receipt for verification</button>
              </form>`
            : '';
        const shownHours = request.duration_hours || request.requested_duration_hours;
        const shownAmount = request.amount_due || shownHours * 10;
        const durationAndPrice = shownHours
            ? `<p class="announcement-request-price">${shownHours} hour${shownHours === 1 ? '' : 's'} · ${formatAnnouncementAmount(shownAmount)}</p>`
            : '';
        const expiry = request.status === 'published' && request.expires_at
            ? `<p>Shown until ${x(new Date(request.expires_at).toLocaleString('en-PH'))}</p>`
            : '';
        const note = request.admin_note ? `<p class="announcement-admin-note"><strong>Admin note:</strong> ${x(request.admin_note)}</p>` : '';
        const displayStatus = request.status === 'published' && new Date(request.expires_at).getTime() <= Date.now()
            ? 'expired'
            : request.status;

        return `<article class="announcement-request-card">
          <div class="announcement-request-card-head">
            <span class="announcement-request-status announcement-request-status--${x(request.status)}">${x(displayStatus === 'expired' ? 'Expired' : getAnnouncementStatusLabel(displayStatus))}</span>
            <time>${x(new Date(request.created_at).toLocaleString('en-PH'))}</time>
          </div>
          <h3>${x(title)}</h3>
          <p class="announcement-request-copy">${x(message)}</p>
          ${durationAndPrice}${note}${paymentInstructions}${paymentForm}${expiry}
        </article>`;
    }).join('');
}

async function loadAnnouncements() {
    if (!supabase || !state.userId) return;

    const [activeResult, requestsResult, settingsResult] = await Promise.all([
        supabase.from('active_announcements')
            .select('approved_title,approved_message,published_at,expires_at')
            .order('published_at', { ascending: false }),
        supabase.from('announcement_requests')
            .select('*')
            .eq('user_id', state.userId)
            .order('created_at', { ascending: false }),
        supabase.from('announcement_payment_settings')
            .select('gcash_instructions,maribank_instructions')
            .eq('id', 'default')
            .maybeSingle(),
    ]);

    const failure = activeResult.error || requestsResult.error || settingsResult.error;
    if (failure) {
        console.error('Announcement data could not be loaded:', failure);
        const status = document.getElementById('announcement-request-status');
        if (status) status.textContent = 'Announcement services are unavailable. The admin may need to apply the announcement migration.';
        if (document.getElementById('sec-announcements')?.classList.contains('active')) {
            toast('Could not load announcements. Please refresh and try again.', 'error');
        }
        return;
    }

    const activeAnnouncements = activeResult.data || [];
    const requests = requestsResult.data || [];
    const settings = settingsResult.data || null;
    renderAnnouncementBanner(activeAnnouncements);
    renderAnnouncementRequests(requests, settings);
}

async function refreshActiveAnnouncements() {
    if (!supabase || !state.userId) return;
    const { data, error } = await supabase.from('active_announcements')
        .select('approved_title,approved_message,published_at,expires_at')
        .order('published_at', { ascending: false });
    if (error) {
        console.error('Active announcements could not be refreshed:', error);
        return;
    }
    renderAnnouncementBanner(data || []);
}

window.submitAnnouncementRequest = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const status = document.getElementById('announcement-request-status');
    if (submitButton.disabled) return;
    if (!supabase || !state.userId) {
        toast('Sign in again before submitting an announcement.', 'error');
        return;
    }
    if (hasActiveAnnouncementRequest(userAnnouncementRequests)) {
        if (status) status.textContent = 'You already have an announcement request in progress.';
        return;
    }

    const title = document.getElementById('announcement-request-title')?.value.trim() || '';
    const message = document.getElementById('announcement-request-message')?.value.trim() || '';
    const durationHours = Number(document.getElementById('announcement-request-duration')?.value);
    if (!title || title.length > 100 || !message || message.length > 500 || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 5) {
        if (status) status.textContent = 'Enter a valid headline and announcement text, and choose a duration from 1 to 5 hours.';
        return;
    }

    submitButton.disabled = true;
    if (status) status.textContent = 'Submitting for review...';

    try {
        const { data, error } = await supabase.from('announcement_requests').insert({
            user_id: state.userId,
            email: state.userEmail,
            title,
            message,
            requested_duration_hours: durationHours,
        }).select('*').single();
        if (error) throw error;
        form.reset();
        userAnnouncementRequests = [data, ...userAnnouncementRequests];
        renderAnnouncementRequests(userAnnouncementRequests, userAnnouncementPaymentSettings);
        if (status) status.textContent = 'Your request was submitted and added below. It is waiting for admin review.';
        toast('Announcement submitted for review.', 'success');
    } catch (error) {
        console.error('Announcement request submission failed:', error);
        const message = typeof error?.message === 'string' ? error.message : String(error);
        const errorCode = error?.code ? ` (${error.code})` : '';
        if (status) {
            status.textContent = `Could not submit your announcement${errorCode}: ${message.slice(0, 220)}`;
        }
    } finally {
        submitButton.disabled = hasActiveAnnouncementRequest(userAnnouncementRequests);
    }
};

async function handleAnnouncementPaymentSubmit(event) {
    const form = event.target.closest('form[data-payment-request]');
    if (!form) return;
    event.preventDefault();
    if (!supabase || !state.userId) {
        toast('Sign in again before submitting payment proof.', 'error');
        return;
    }

    const file = form.elements.namedItem('payment-proof')?.files?.[0] || null;
    const method = form.elements.namedItem('payment-method')?.value || '';
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        toast('Upload a JPEG, PNG, or WebP receipt no larger than 5 MB.', 'error');
        return;
    }
    if (!['gcash', 'maribank'].includes(method)) {
        toast('Choose GCash or MariBank as the payment method.', 'error');
        return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const extension = file.type.split('/')[1];
    const proofPath = `${state.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(ANNOUNCEMENT_PAYMENT_BUCKET).upload(proofPath, file, {
        contentType: file.type,
        upsert: false,
    });
    if (uploadError) {
        button.disabled = false;
        console.error('Announcement payment receipt upload failed:', uploadError);
        toast('Could not upload the receipt. Please try again.', 'error');
        return;
    }

    const { error } = await supabase.rpc('submit_announcement_payment', {
        p_request_id: form.dataset.paymentRequest,
        p_payment_method: method,
        p_proof_path: proofPath,
    });
    if (error) {
        const { error: cleanupError } = await supabase.storage.from(ANNOUNCEMENT_PAYMENT_BUCKET).remove([proofPath]);
        if (cleanupError) console.error('Could not remove an unused announcement receipt:', cleanupError);
        button.disabled = false;
        console.error('Announcement payment submission failed:', error);
        toast('Could not submit payment proof. Please refresh and try again.', 'error');
        return;
    }

    toast('Payment proof sent to admin for verification.', 'success');
    await loadAnnouncements();
}

function renderMyReports(state) {
    const grid = document.getElementById('my-reports-grid');
    if (!grid) return;

    const myItems = state.userId
        ? state.items.filter(item => item.user_id === state.userId)
        : [];

    if (myItems.length === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No reports found.</p>`;
        return;
    }

    grid.innerHTML = myItems.map(item => `
        <div class="item-card" style="border-left: 4px solid ${item.status === 'open' ? 'var(--maroon)' : 'var(--success)'};">
            ${item.imageUrl ? `<img src="${x(item.imageUrl)}" alt="${x(item.title)}" style="width:100%; height:160px; object-fit:cover; border-radius:4px 4px 0 0;">` : ''}
            <div style="padding: 12px;">
                <span class="badge ${x(item.type)}">${item.type ? x(item.type.toUpperCase()) : 'LOST'}</span>
                <h3 style="margin: 8px 0 4px 0; font-size: 16px;">${x(item.title)}</h3>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">Post ID: ${formatPostId(item.post_number)}</p>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">${x(item.campus || 'Campus not specified')}</p>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">📍 ${x(item.location)}</p>
                <p style="font-size: 13px; margin-bottom: 12px;">Status: <strong>${x(item.status)}</strong></p>
                
                <div style="display: flex; gap: 8px;">
                    ${item.status === 'open' && item.user_id === state.userId ? `
                        <button class="btn btn-sm btn-primary" onclick="window.openHandoffModal('${x(item.id)}')">Confirm handoff</button>
                    ` : item.status === 'claimed' ? `
                        <span class="journey-inline-status">Handoff awaiting confirmation</span>
                    ` : item.status === 'resolved' ? `
                        <span class="journey-inline-status">Handoff confirmed</span>
                    ` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

let selectedFeedbackTopic = '';

window.openFeedbackSheet = () => {
    selectedFeedbackTopic = '';
    document.querySelectorAll('input[name="feedback-topic"]').forEach(input => { input.checked = false; });
    document.getElementById('feedback-topic-step')?.classList.remove('hidden');
    document.getElementById('feedback-message-step')?.classList.add('hidden');
    document.getElementById('feedback-message').value = '';
    document.getElementById('feedback-item-field')?.classList.add('hidden');
    document.getElementById('feedback-item-evidence-field')?.classList.add('hidden');
    document.getElementById('feedback-report-evidence-field')?.classList.add('hidden');
    document.getElementById('feedback-item-evidence').value = '';
    document.getElementById('feedback-report-evidence').value = '';
    const modal = document.getElementById('feedback-overlay');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('open'));
};

window.continueFeedback = () => {
    selectedFeedbackTopic = document.querySelector('input[name="feedback-topic"]:checked')?.value || '';
    if (!selectedFeedbackTopic) {
        toast('Choose what your feedback is about first.', 'error');
        return;
    }

    const prompts = {
        website: 'What is not working, or what should we improve?',
        item: 'When did you contact the poster, and what happened?',
        announcement: 'What information in the announcement is incorrect or out of date?',
    };
    document.getElementById('feedback-message-prompt').textContent = prompts[selectedFeedbackTopic];
    document.getElementById('feedback-message-label').textContent = selectedFeedbackTopic === 'website' ? 'Suggestion or problem details' : selectedFeedbackTopic === 'item' ? 'Contact attempts and details' : 'What needs attention?';
    const submitButton = document.getElementById('feedback-submit-btn');
    submitButton.textContent = selectedFeedbackTopic === 'item' ? 'Request admin follow-up' : selectedFeedbackTopic === 'announcement' ? 'Report announcement' : 'Send feedback';
    const itemField = document.getElementById('feedback-item-field');
    if (selectedFeedbackTopic === 'item') {
        const itemSelect = document.getElementById('feedback-item-select');
        itemSelect.replaceChildren(...state.items.map(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${formatPostId(item.post_number)} - ${item.title}`;
            return option;
        }));
        itemField.classList.remove('hidden');
        document.getElementById('feedback-item-evidence-field').classList.remove('hidden');
        document.getElementById('feedback-report-evidence-field').classList.add('hidden');
        document.getElementById('feedback-report-evidence').value = '';
        if (!state.items.length) {
            toast('There are no item reports to give feedback on yet.', 'error');
            return;
        }
    } else {
        itemField.classList.add('hidden');
        document.getElementById('feedback-item-evidence-field').classList.add('hidden');
        document.getElementById('feedback-item-evidence').value = '';
        document.getElementById('feedback-report-evidence-field').classList.remove('hidden');
    }
    document.getElementById('feedback-topic-step').classList.add('hidden');
    document.getElementById('feedback-message-step').classList.remove('hidden');
};

window.backToFeedbackTopics = () => {
    document.getElementById('feedback-topic-step').classList.remove('hidden');
    document.getElementById('feedback-message-step').classList.add('hidden');
};

function validateFeedbackImage(file) {
    if (!file) return true;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
        toast('Choose a JPEG, PNG, WebP, or GIF image.', 'error');
        return false;
    }
    if (file.size > 5 * 1024 * 1024) {
        toast('Evidence image must be 5 MB or smaller.', 'error');
        return false;
    }
    return true;
}

async function uploadFeedbackImage(bucket, userId, file) {
    const extension = file.type.split('/')[1].replace('jpeg', 'jpg');
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
        contentType: file.type,
        upsert: false,
    });
    if (error) throw error;
    return path;
}

async function discardFeedbackImage(bucket, path) {
    if (!path || !supabase) return;
    try {
        await supabase.storage.from(bucket).remove([path]);
    } catch {
        // The request failure remains the important user-facing error.
    }
}

window.submitFeedback = async (event) => {
    event.preventDefault();
    const message = document.getElementById('feedback-message')?.value.trim();
    if (!message || !selectedFeedbackTopic) return;

    const actor = state.userEmail || 'User';
    const feedback = {
        id: `feedback_${Date.now()}`,
        actor,
        type: 'feedback',
        topic: selectedFeedbackTopic,
        message,
        timestamp: Date.now(),
    };

    if (selectedFeedbackTopic === 'item') {
        const itemId = document.getElementById('feedback-item-select')?.value;
        const item = state.items.find(entry => entry.id === itemId);
        if (!item) return;
        const evidenceInput = document.getElementById('feedback-item-evidence');
        const evidenceFile = evidenceInput?.files?.[0] || null;
        if (!validateFeedbackImage(evidenceFile)) return;

        if (supabase) {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError || !user) {
                toast('Sign in again before requesting admin follow-up.', 'error');
                return;
            }
            let evidencePath = null;
            if (evidenceFile) {
                try {
                    evidencePath = await uploadFeedbackImage('claim-evidence', user.id, evidenceFile);
                } catch (uploadError) {
                    console.error('Claim evidence upload failed:', uploadError);
                    toast('Could not upload the evidence image. Try again later.', 'error');
                    return;
                }
            }
            const { error } = await supabase.from('claim_followup_requests').insert({
                user_id: user.id,
                item_id: String(item.id),
                post_number: Number(item.post_number) || null,
                item_title: item.title,
                campus: item.campus || null,
                claimant_email: user.email,
                poster_name: item.reporterName || 'Unknown',
                poster_contact: item.contact || 'Not provided',
                message,
                evidence_image: evidencePath,
            });
            if (error) {
                await discardFeedbackImage('claim-evidence', evidencePath);
                console.error('Claim follow-up submission failed:', error);
                toast('Could not send the follow-up request. Try again later.', 'error');
                return;
            }
        } else {
            toast('Backend is not configured.', 'error');
            return;
        }
    } else {
        const evidenceInput = document.getElementById('feedback-report-evidence');
        const evidenceFile = evidenceInput?.files?.[0] || null;
        if (!validateFeedbackImage(evidenceFile)) return;

        if (supabase) {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError || !user) {
                toast('Sign in again before submitting feedback.', 'error');
                return;
            }

            let evidencePath = null;
            if (evidenceFile) {
                try {
                    evidencePath = await uploadFeedbackImage('user-feedback-evidence', user.id, evidenceFile);
                } catch (uploadError) {
                    console.error('Feedback screenshot upload failed:', uploadError);
                    toast('Could not upload the screenshot. Try again later.', 'error');
                    return;
                }
            }

            const { error } = await supabase.from('user_feedback_reports').insert({
                user_id: user.id,
                email: user.email,
                topic: selectedFeedbackTopic,
                message,
                evidence_image: evidencePath,
            });
            if (error) {
                await discardFeedbackImage('user-feedback-evidence', evidencePath);
                console.error('User feedback submission failed:', error);
                toast('Could not submit feedback. Try again later.', 'error');
                return;
            }
        } else {
            toast('Backend is not configured.', 'error');
            return;
        }
    }

    toast(selectedFeedbackTopic === 'item' ? 'Claim follow-up request recorded.' : 'Thank you. Your feedback has been submitted.', 'success');
    document.getElementById('feedback-message').value = '';
    document.getElementById('feedback-item-evidence').value = '';
    document.getElementById('feedback-report-evidence').value = '';
    window.closeModal('feedback-overlay');
    renderAll(state);
};

window.openHandoffModal = (itemId) => {
   const item = state.items.find(record => record.id === itemId);
   const modal = document.getElementById('handoff-overlay');
   const hiddenItemId = document.getElementById('handoff-item-id');
   const partnerEmail = document.getElementById('handoff-partner-email');
   if (!item || item.user_id !== state.userId || item.status !== 'open' || !modal || !hiddenItemId) {
       toast('Only the author of an open report can start its handoff.', 'error');
       return;
   }

   hiddenItemId.value = itemId;
   if (partnerEmail) partnerEmail.value = '';
   modal.style.display = 'flex';
   requestAnimationFrame(() => modal.classList.add('open'));
};

async function startHandoff(event) {
   event.preventDefault();
   const itemId = document.getElementById('handoff-item-id')?.value;
   const partnerEmail = document.getElementById('handoff-partner-email')?.value.trim();
   const submitButton = document.getElementById('handoff-submit');
   const item = state.items.find(record => record.id === itemId);

   if (!supabase) {
       toast('Backend is not configured.', 'error');
       return;
   }
   if (!item || item.user_id !== state.userId || item.status !== 'open') {
       toast('This report is no longer available to start a handoff.', 'error');
       return;
   }
   if (!partnerEmail || !isAllowedInstitutionalEmail(partnerEmail)) {
       toast('Enter the other participant’s PUP institutional email.', 'error');
       return;
   }

   if (submitButton) {
       submitButton.disabled = true;
       submitButton.textContent = 'Starting…';
   }
   try {
       const { error } = await supabase.rpc('start_handoff_confirmation', {
           p_item_id: itemId,
           p_partner_email: partnerEmail,
       });
       if (error) {
           console.error('Handoff start failed:', error);
           toast(error.message || 'Could not start this handoff.', 'error');
           return;
       }

       toast('Handoff started. The other participant must confirm to complete it.', 'success');
       window.closeModal('handoff-overlay');
       await fetchAndSyncItems();
       await loadMyJourney();
       renderMyReports(state);
   } catch (error) {
       console.error('Unexpected handoff start failure:', error);
       toast('Could not start this handoff. Please try again.', 'error');
   } finally {
       if (submitButton) {
           submitButton.disabled = false;
           submitButton.textContent = 'Start handoff';
       }
   }
}

async function loadMyJourney() {
   const transactionList = document.getElementById('journey-transactions');
   if (!transactionList) return;
   if (!supabase || !state.userId) {
      state.handoffs = [];
      state.comicChapters = COMIC_CHAPTERS;
      renderMyJourney();
       transactionList.innerHTML = '<p class="journey-empty">Sign in to view your journey.</p>';
       return;
   }

   transactionList.innerHTML = '<p class="journey-empty">Loading handoff activity…</p>';
   const requestedUserId = state.userId;
   try {
       const [chapterResult, handoffResult] = await Promise.all([
           supabase.from('comic_chapters')
               .select('chapter_number,story_side,title,description,cover_path,page_paths')
               .eq('is_archived', false)
               .order('story_side')
               .order('chapter_number'),
           supabase
           .from('handoff_transactions')
           .select('id, item_id, initiator_id, partner_id, status, created_at, completed_at')
           .order('created_at', { ascending: false }),
       ]);
       if (chapterResult.error) {
           console.warn('Comic chapters could not be loaded; using the built-in chapter list:', chapterResult.error);
           state.comicChapters = COMIC_CHAPTERS;
       } else {
           state.comicChapters = (chapterResult.data || []).map(chapter => ({
               number: chapter.chapter_number,
               side: chapter.story_side,
               title: chapter.title,
               description: chapter.description || '',
               cover: chapter.cover_path ? `./${chapter.cover_path}` : '',
               pages: (chapter.page_paths || []).map(path => `./${path}`),
           }));
       }
       if (handoffResult.error) {
           if (state.userId !== requestedUserId) return;
           console.error('Handoff history load failed:', handoffResult.error);
           transactionList.innerHTML = '<p class="journey-empty journey-error">Could not load handoff activity. Please try again later.</p>';
           toast('Could not load your reward progress.', 'error');
           return;
       }

       if (state.userId !== requestedUserId) return;
       const handoffs = handoffResult.data || [];
       const completedCount = handoffs.filter(transaction => transaction.status === 'completed').length;
       if (state.journeyProgress?.userId === requestedUserId
           && completedCount < state.journeyProgress.completedCount) return;
       state.handoffs = handoffs;
       renderMyJourney();
       notifyJourneyProgress(requestedUserId);
   } catch (error) {
       if (state.userId !== requestedUserId) return;
       console.error('Unexpected handoff history load failure:', error);
       transactionList.innerHTML = '<p class="journey-empty journey-error">Could not load handoff activity. Please try again later.</p>';
       toast('Could not load your reward progress.', 'error');
   }
}

async function loadAdminThemeAccess(userId) {
   if (!supabase) return;
   try {
       const { data, error } = await supabase.rpc('is_admin');
       if (error) throw error;
       if (state.userId !== userId) return;
       state.isAdmin = data === true;
       state.adminStatusReady = true;
       renderMyJourney();
   } catch (error) {
       if (state.userId !== userId) return;
       console.error('Could not verify administrator status for theme access:', error);
       state.isAdmin = false;
       state.adminStatusReady = true;
       renderMyJourney();
   }
}

function notifyJourneyProgress(userId) {
   const completedCount = state.handoffs.filter(transaction => transaction.status === 'completed').length;
   const chapters = state.comicChapters
       .filter(chapter => chapter.side === state.storySide)
       .sort((a, b) => a.number - b.number);
   const nextChapter = chapters.find(chapter => chapter.number > completedCount);
   const firstSideComplete = chapters.length > 0 && !nextChapter;
   const previousProgress = state.journeyProgress;
   state.journeyProgress = {
       userId,
       completedCount,
       firstSideComplete,
   };

   if (!previousProgress || previousProgress.userId !== userId || completedCount <= previousProgress.completedCount) return;

   const unlockedChapters = chapters.filter(chapter =>
       chapter.number > previousProgress.completedCount && chapter.number <= completedCount
   );
   const earnedBadges = JOURNEY_BADGES.filter(badge =>
       previousProgress.completedCount < badge.count && completedCount >= badge.count
   );
   const messages = [];

   if (unlockedChapters.length) {
       messages.push(`Chapter${unlockedChapters.length === 1 ? '' : 's'} unlocked: ${unlockedChapters.map(chapter => chapter.title).join(', ')}.`);
   }
   if (earnedBadges.length) {
       messages.push(`Achievement${earnedBadges.length === 1 ? '' : 's'} earned: ${earnedBadges.map(badge => badge.title).join(', ')}.`);
   }
   if (!previousProgress.firstSideComplete && firstSideComplete) {
       const otherSide = state.storySide === 'light' ? 'dark' : 'light';
       messages.push(`Congratulations! You completed the ${getStorySideLabel(state.storySide)} storyline. The ${getStorySideLabel(otherSide)} storyline and appearance toggle are now unlocked.`);
   }

   if (messages.length) {
       toast(`Congratulations! ${messages.join(' ')}`, 'success');
   }
}

function renderMyJourney() {
   const completedCount = state.handoffs.filter(transaction => transaction.status === 'completed').length;
   const rankIndex = Math.min(completedCount, JOURNEY_RANKS.length - 1);
   const firstSideChapters = state.comicChapters
       .filter(chapter => chapter.side === state.storySide)
       .sort((a, b) => a.number - b.number);
   const nextChapter = firstSideChapters.find(chapter => chapter.number > completedCount);
   const rank = document.getElementById('journey-rank');
   const reunionCount = document.getElementById('journey-reunion-count');
   const chapterCount = document.getElementById('journey-chapter-count');
   const nextRank = document.getElementById('journey-next-rank');

   const rankLabel = JOURNEY_RANKS[rankIndex][state.storySide];
   if (rank) {
       rank.textContent = completedCount >= JOURNEY_RANKS.length - 1
           ? `${rankLabel} · Rank ${completedCount}`
           : rankLabel;
   }
   if (reunionCount) reunionCount.textContent = completedCount;
   const firstSideUnlocked = firstSideChapters.filter(chapter => chapter.number <= completedCount).length;
   const otherSide = state.storySide === 'light' ? 'dark' : 'light';
   const otherSideChapters = state.comicChapters.filter(chapter => chapter.side === otherSide);
   const firstSideComplete = firstSideChapters.length > 0 && !nextChapter;
   if (state.adminStatusReady) {
       window.setThemeToggleLocked(!state.isAdmin && !firstSideComplete, state.storySide);
   }
   const unlockedChapterCount = firstSideUnlocked + (firstSideComplete ? otherSideChapters.length : 0);
   if (chapterCount) chapterCount.textContent = unlockedChapterCount;
   if (nextRank) {
       if (!firstSideChapters.length) {
           nextRank.textContent = `The ${getStorySideLabel(state.storySide)} storyline has no chapters published yet.`;
       } else if (nextChapter) {
           nextRank.textContent = `Confirm successful handoffs to unlock ${nextChapter.title}. The other storyline opens after all ${firstSideChapters.length} chapters on your chosen side are unlocked.`;
       } else if (otherSideChapters.length) {
           nextRank.textContent = `The ${getStorySideLabel(otherSide)} storyline is now unlocked. Explore both sides freely.`;
       } else {
           nextRank.textContent = `You have unlocked every chapter on the ${getStorySideLabel(state.storySide)}. The other storyline will appear here when its chapters are published.`;
       }
   }

   renderJourneyBadges(completedCount);
   renderJourneyChapters(completedCount, firstSideComplete);
   renderJourneyTransactions();
}

function getStorySideLabel(side) {
   return side === 'dark' ? 'Dark Side' : 'Light Side';
}

function renderJourneyBadges(completedCount) {
   const container = document.getElementById('journey-badges');
   if (!container) return;
   container.innerHTML = JOURNEY_BADGES.map(badge => {
       const earned = completedCount >= badge.count;
       return `
           <article class="journey-badge${earned ? ' is-earned' : ' is-locked'}">
               <span class="journey-badge-icon" aria-hidden="true">${badge.icon}</span>
               <div>
                   <h3>${x(badge.title)}</h3>
                   <p>${x(badge.description)}</p>
                   <span class="journey-badge-state">${earned ? 'Earned' : `${badge.count} confirmed handoff${badge.count === 1 ? '' : 's'} required`}</span>
               </div>
           </article>`;
   }).join('');
}

function renderJourneyChapters(completedCount, firstSideComplete) {
   const container = document.getElementById('journey-chapters');
   if (!container) return;
   const firstSide = state.storySide;
   const secondSide = firstSide === 'light' ? 'dark' : 'light';
   const firstSideChapters = state.comicChapters
       .filter(chapter => chapter.side === firstSide)
       .sort((a, b) => a.number - b.number);
   const secondSideChapters = state.comicChapters
       .filter(chapter => chapter.side === secondSide)
       .sort((a, b) => a.number - b.number);
   const renderStoryline = (side, chapters, unlocked) => {
       const heading = `<h3 class="journey-storyline-heading">${getStorySideLabel(side)} Storyline${side === firstSide ? ' · Your first side' : ''}</h3>`;
       if (!chapters.length) {
           const message = side === firstSide
               ? 'No chapters have been published for this storyline yet.'
               : unlocked
                   ? 'No chapters have been published for this storyline yet.'
                   : `Unlock all chapters in the ${getStorySideLabel(firstSide)} storyline to open this side.`;
           return `${heading}<p class="journey-storyline-note">${message}</p>`;
       }
       return heading + chapters.map(chapter => {
       const chapterUnlocked = unlocked && (side !== firstSide || chapter.number <= completedCount);
       const cover = chapterUnlocked && chapter.cover
           ? `<img class="journey-chapter-cover" src="${x(chapter.cover)}" alt="${x(chapter.title)} cover" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="journey-chapter-placeholder" hidden>Artwork will appear here when provided by the design team.</span>`
           : '';
       const placeholder = chapterUnlocked && !chapter.cover
           ? '<span class="journey-chapter-placeholder">Artwork will appear here when provided by the design team.</span>'
           : '';
       const pages = chapterUnlocked && chapter.pages.length
           ? `<div class="journey-chapter-pages">${chapter.pages.map((page, index) => `
               <img src="${x(page)}" alt="${x(chapter.title)} page ${index + 1}" loading="lazy" onerror="this.hidden=true">
             `).join('')}</div>`
           : '';
       const lockCopy = side === firstSide
           ? `Unlock after handoff ${chapter.number}`
           : `Unlock after finishing the ${getStorySideLabel(firstSide)} storyline`;
       return `
           <article class="journey-chapter${chapterUnlocked ? ' is-unlocked' : ' is-locked'}">
               <div class="journey-chapter-art">
                   ${cover}
                   ${placeholder}
                   ${chapterUnlocked ? '' : '<span class="journey-lock-icon" aria-hidden="true">🔒</span>'}
               </div>
               <div class="journey-chapter-info">
                   <span class="journey-chapter-kicker">${chapterUnlocked ? 'Unlocked' : lockCopy}</span>
                   <h3>${x(chapter.title)}</h3>
                   ${chapterUnlocked && chapter.description ? `<p>${x(chapter.description)}</p>` : ''}
                   ${chapterUnlocked ? pages : `<p>${side === firstSide ? 'Complete confirmed handoffs to unlock this chapter.' : `Finish all chapters on the ${getStorySideLabel(firstSide)} to open this storyline.`}</p>`}
               </div>
           </article>`;
       }).join('');
   };
   container.innerHTML = renderStoryline(firstSide, firstSideChapters, true)
       + renderStoryline(secondSide, secondSideChapters, firstSideComplete);
}

function renderJourneyTransactions() {
   const container = document.getElementById('journey-transactions');
   if (!container) return;
   if (!state.handoffs.length) {
       container.innerHTML = '<p class="journey-empty">No handoffs yet. Start one from an open report in My Reports after returning an item.</p>';
       return;
   }

   container.innerHTML = state.handoffs.map(transaction => {
       const item = state.items.find(record => record.id === transaction.item_id);
       const title = item?.title || 'Lost-and-found report';
       const isInitiator = transaction.initiator_id === state.userId;
       const status = transaction.status;
       let message = status === 'completed'
           ? `Both participants confirmed on ${tsDate(transaction.completed_at, true)}.`
           : status === 'cancelled'
               ? 'This handoff was cancelled.'
               : isInitiator
                   ? 'You confirmed. Waiting for the other participant.'
                   : 'Confirm only if the item has been returned to its owner.';
       const actions = status === 'pending'
           ? isInitiator
               ? `<button class="btn btn-sm btn-ghost" type="button" onclick="window.cancelHandoff('${x(transaction.id)}')">Cancel handoff</button>`
               : `<button class="btn btn-sm btn-primary" type="button" onclick="window.confirmHandoff('${x(transaction.id)}')">Confirm return</button>`
           : '';
       return `
           <article class="journey-transaction">
               <div class="journey-transaction-copy">
                   <div class="journey-transaction-title">${x(title)} <span class="journey-transaction-status journey-status-${x(status)}">${x(status)}</span></div>
                   <p>${x(message)}</p>
               </div>
               ${actions}
           </article>`;
   }).join('');
}

window.confirmHandoff = async (transactionId) => {
   if (!supabase) {
       toast('Backend is not configured.', 'error');
       return;
   }
   try {
       const { data, error } = await supabase.rpc('confirm_handoff_confirmation', {
           p_transaction_id: transactionId,
       });
       if (error) {
           console.error('Handoff confirmation failed:', error);
           toast(error.message || 'Could not confirm this handoff.', 'error');
           return;
       }
       if (data === 'completed') {
           toast('Return confirmed! Your comic chapter and rank progress have been updated.', 'success');
       } else {
           toast('Your confirmation was recorded.', 'success');
       }
       await fetchAndSyncItems();
       await loadMyJourney();
       renderMyReports(state);
   } catch (error) {
       console.error('Unexpected handoff confirmation failure:', error);
       toast('Could not confirm this handoff. Please try again.', 'error');
   }
};

window.cancelHandoff = async (transactionId) => {
   if (!supabase) {
       toast('Backend is not configured.', 'error');
       return;
   }
   try {
       const { error } = await supabase.rpc('cancel_handoff_confirmation', {
           p_transaction_id: transactionId,
       });
       if (error) {
           console.error('Handoff cancellation failed:', error);
           toast(error.message || 'Could not cancel this handoff.', 'error');
           return;
       }
       toast('Handoff cancelled.', 'success');
       await fetchAndSyncItems();
       await loadMyJourney();
       renderMyReports(state);
   } catch (error) {
       console.error('Unexpected handoff cancellation failure:', error);
       toast('Could not cancel this handoff. Please try again.', 'error');
   }
};


// ==========================================
// CLAIM VERIFICATION WORKFLOW
// ==========================================

window.openDetail = (itemId, cardImageUrl = '') => {
    const item = state.items.find(i => i.id === itemId);
    const modal = document.getElementById('detail-overlay');
    const body = document.getElementById('det-body');
    const title = document.getElementById('det-title');
    if (!modal || !body || !title || !item) return;

    const imageUrl = cardImageUrl || item.imageUrl || '';
    title.textContent = item.title;
    body.innerHTML = `
      ${imageUrl ? `<img class="detail-photo" src="${x(imageUrl)}" alt="Photo of ${x(item.title)}" />` : ''}
      <div class="detail-grid">
        <div class="detail-field">
          <div class="detail-label">Post ID</div>
          <div class="detail-val">${formatPostId(item.post_number)}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Type</div>
          <div class="detail-val">${item.type === 'lost' ? 'Lost' : 'Found'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Status</div>
          <div class="detail-val">${x(item.status)}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Category</div>
          <div class="detail-val">${x(item.category || 'Other')}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Campus</div>
          <div class="detail-val">${x(item.campus || 'Not specified')}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Location</div>
          <div class="detail-val">${x(item.location || 'Not specified')}</div>
        </div>
      </div>

      <div class="detail-label">Description</div>
      <div class="detail-val" style="margin-bottom:16px;">${x(item.description || 'No description provided.')}</div>

      <div class="detail-grid">
        <div class="detail-field">
          <div class="detail-label">Reporter</div>
          <div class="detail-val">${x(item.reporterName || 'Unknown')}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Contact</div>
          <div class="detail-val">${x(item.contact || 'Not shared')}</div>
        </div>
      </div>

      <div class="status-control">
        <span>🔎</span>
        <div style="flex:1;">
          <strong style="display:block;">Owner identification</strong>
          <small style="color:var(--ink-3);">If you know the owner, send a match request to admins for review.</small>
        </div>
      </div>

      <div style="margin: 18px 0 12px;">
        <div class="detail-label">Activity</div>
        <div style="display:flex;flex-direction:column;gap:8px; margin-top:8px;">
          ${(item.activity || []).slice(0, 6).map(entry => `
            <div style="background:var(--surface); border:1px solid var(--border-lt); border-radius:10px; padding:10px 12px; font-size:12.5px; color:var(--ink-2);">
              <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:4px;">
                <strong>${x(entry.actor)}</strong>
                <span style="color:var(--ink-3);">${new Date(entry.timestamp).toLocaleDateString('en-PH')}</span>
              </div>
              <div>${x(entry.message)}</div>
            </div>
          `).join('') || '<div style="font-size:12.5px; color:var(--ink-3);">No activity yet.</div>'}
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" onclick="window.closeModal('detail-overlay')">Close</button>
        <button class="btn btn-primary" onclick="window.openOwnerMatchModal('${x(item.id)}')">I know the owner</button>
      </div>
    `;

    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('open'));
};

window.openOwnerMatchModal = (itemId) => {
    const modal = document.getElementById('owner-match-overlay');
    const hiddenIdInput = document.getElementById('owner-match-item-id');
    if (!modal || !hiddenIdInput) return;

    hiddenIdInput.value = itemId;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('open'));
    window.closeModal('detail-overlay');
};

window.submitOwnerMatch = async (e) => {
    e.preventDefault();

    const itemId = document.getElementById('owner-match-item-id')?.value;
    const likelyOwner = document.getElementById('owner-match-name')?.value.trim();
    const proof = document.getElementById('owner-match-proof')?.value.trim();
    const contact = document.getElementById('owner-match-contact')?.value.trim();
    const imageInput = document.getElementById('owner-match-image');
    const item = state.items.find(i => i.id === itemId);

    if (!itemId || !likelyOwner || !proof || !contact) {
        toast('Please complete all fields before sending to admin.', 'error');
        return;
    }

    if (!supabase) {
        toast('Backend is not configured.', 'error');
        return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        toast('Sign in again before sending an owner match.', 'error');
        return;
    }

    let evidenceImage = '';
    const file = imageInput && imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;

    if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
            toast('Choose a JPEG, PNG, WebP, or GIF image as evidence.', 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            toast('Evidence image must be under 5MB.', 'error');
            return;
        }

        const fileExt = file.type.split('/')[1].replace('jpeg', 'jpg');
        const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('claim-evidence').upload(fileName, file, {
            contentType: file.type,
            upsert: false,
        });
        if (uploadError) {
            console.error('Evidence upload failed:', uploadError);
            toast('Failed to upload evidence image.', 'error');
            return;
        }
        evidenceImage = fileName;
    }

    const { error } = await supabase.from('owner_match_requests').insert({
        user_id: user.id,
        item_id: String(itemId),
        post_number: Number(item?.post_number) || null,
        item_title: item?.title || 'Item',
        campus: item?.campus || null,
        likely_owner: likelyOwner,
        proof,
        contact,
        evidence_image: evidenceImage || null,
    });

    if (error) {
        if (evidenceImage) await supabase.storage.from('claim-evidence').remove([evidenceImage]);
        console.error('Owner match submission failed:', error);
        toast('Could not send the owner match to admin review.', 'error');
        return;
    }

    toast('Sent to admin review. No announcement will be published before verification.', 'success');
    document.getElementById('owner-match-name').value = '';
    document.getElementById('owner-match-proof').value = '';
    document.getElementById('owner-match-contact').value = '';
    if (imageInput) imageInput.value = '';
    window.closeModal('owner-match-overlay');
    renderAll(state);
};

// ==========================================
// AUTH GATE & SESSION ROUTING
// ==========================================

let authMode = 'login';
let authSubmitAnimationTimeout;
const authEmailInput = document.getElementById('gate-email');
const authSubmitButton = document.getElementById('auth-submit-btn');
const authStatus = document.getElementById('auth-status');
const authLinkCooldown = createAuthLinkCooldown({
    scope: 'pup-auth',
    input: authEmailInput,
    button: authSubmitButton,
    status: authStatus,
    getIdleLabel: () => authMode === 'login' ? 'Send sign-in link' : 'Create account & send link',
});

window.switchAuthTab = (mode) => {
    if (mode !== 'login' && mode !== 'signup') return;
    const modeChanged = authMode !== mode;
    authMode = mode;

    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    const submitButton = document.getElementById('auth-submit-btn');
    const label = document.getElementById('auth-label-text');

    loginTab?.classList.toggle('active', mode === 'login');
    signupTab?.classList.toggle('active', mode === 'signup');
    loginTab?.setAttribute('aria-pressed', String(mode === 'login'));
    signupTab?.setAttribute('aria-pressed', String(mode === 'signup'));
    document.getElementById('auth-story-choice')?.classList.toggle('hidden', mode !== 'signup');
    if (submitButton) {
        const submitLabel = submitButton.querySelector('.auth-submit-label');
        if (submitLabel) {
            submitLabel.textContent = mode === 'login' ? 'Send sign-in link' : 'Create account & send link';
        } else {
            submitButton.textContent = mode === 'login' ? 'Send sign-in link' : 'Create account & send link';
        }
        if (modeChanged) {
            submitButton.classList.remove('is-changing');
            void submitButton.offsetWidth;
            submitButton.classList.add('is-changing');
            clearTimeout(authSubmitAnimationTimeout);
            authSubmitAnimationTimeout = setTimeout(() => {
                submitButton.classList.remove('is-changing');
            }, 1300);
        }
    }
    if (label) label.textContent = mode === 'login' ? 'Institutional email' : 'Institutional email for your account';
    authLinkCooldown.refresh(authEmailInput?.value || '');
};

async function checkAuthGate() {
    if (!supabase) {
        lockAppShell();
        return;
    }

    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        const email = session?.user?.email || '';
        if (!error && isAllowedInstitutionalEmail(email)) {
            if (state.userId !== session.user.id) {
                state.journeyProgress = null;
                state.handoffs = [];
            }
            state.userId = session.user.id;
            state.storySide = session.user.user_metadata?.story_side === 'dark' ? 'dark' : 'light';
            void loadAdminThemeAccess(session.user.id);
            unlockAppShell(email);
            void fetchAndSyncItems();
            void loadAnnouncements();
            void loadMyJourney();
        } else {
            state.userId = '';
            lockAppShell();
            if (session) await supabase.auth.signOut();
        }
    } catch (error) {
        console.error('Unable to restore authentication session:', error);
        lockAppShell();
    }
}

function unlockAppShell(email) {
    state.userEmail = email;
    const gate = document.getElementById('auth-gate');
    const shell = document.getElementById('app-shell');
    if (gate) gate.style.display = 'none';
    if (shell) shell.style.display = '';
    if (!announcementRefreshInterval) {
        announcementRefreshInterval = window.setInterval(() => { void refreshActiveAnnouncements(); }, 60_000);
    }
}

function lockAppShell() {
    state.userEmail = '';
    state.userId = '';
    state.journeyProgress = null;
    state.handoffs = [];
    state.isAdmin = false;
    state.adminStatusReady = false;
    window.setThemeToggleLocked(false);
    renderAnnouncementBanner(null);
    clearInterval(announcementRefreshInterval);
    announcementRefreshInterval = null;
    const gate = document.getElementById('auth-gate');
    const shell = document.getElementById('app-shell');
    if (gate) gate.style.display = 'flex';
    if (shell) shell.style.display = 'none';
}

window.handleGateLogin = async () => {
    const email = authEmailInput?.value.trim() || '';
    const selectedStorySide = document.querySelector('input[name="story-side"]:checked')?.value;
    if (authMode === 'signup' && selectedStorySide !== 'light' && selectedStorySide !== 'dark') {
        authStatus.textContent = 'Choose which storyline you want to begin with.';
        authStatus.classList.add('error');
        return;
    }

    if (!isAllowedInstitutionalEmail(email)) {
        authStatus.textContent = 'Enter a valid @iskolarngbayan.pup.edu.ph address.';
        authStatus.classList.add('error');
        toast('Access restricted to valid @iskolarngbayan.pup.edu.ph emails only.', 'error');
        return;
    }

    if (authLinkCooldown.isCoolingDown(email)) {
        authLinkCooldown.refresh(email);
        return;
    }

    if (!supabase) {
        authStatus.textContent = 'Backend is not configured.';
        authStatus.classList.add('error');
        toast('Backend is not configured.', 'error');
        return;
    }

    authLinkCooldown.setPending(true);
    try {
        const redirectUrl = window.location.origin + window.location.pathname;
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: redirectUrl,
                shouldCreateUser: authMode === 'signup',
                ...(authMode === 'signup' ? { data: { story_side: selectedStorySide } } : {}),
            }
        });

        if (error) {
            console.error('Supabase auth error:', error);
            toast('Failed to send verification link. Try again.', 'error');
            return;
        }

        authLinkCooldown.start(
            email,
            authMode === 'signup'
                ? `Account setup requested for ${email}. Your ${getStorySideLabel(selectedStorySide)} storyline will open first. Check your inbox and spam folder.`
                : `Sign-in email requested for ${email}. Check your inbox and spam folder.`
        );
        toast('Sign-in email requested. Check your inbox and spam folder.', 'success');
    } catch (error) {
        console.error('Unexpected auth error:', error);
        authStatus.textContent = 'Could not request a sign-in email. Please try again shortly.';
        authStatus.classList.add('error');
        toast('An unexpected authentication error occurred.', 'error');
    } finally {
        authLinkCooldown.setPending(false);
    }
};

async function handleLogout() {
    if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) {
            toast('Could not sign out. Please try again.', 'error');
            return;
        }
    }

    lockAppShell();
    state.items = [];
    renderAll(state);
    toast('You have been signed out.', 'success');
};