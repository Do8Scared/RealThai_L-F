/**
 * ==============================================================================
 * PUP AKADEMIA - APP.JS FUNCTION INDEX
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
 * 11. window.updateItemStatus()  - Toggles item status (open/resolved).
 * 12. window.openClaimModal()    - Opens the item claim verification modal.
 * 13. window.submitClaim()       - Validates and submits user item claims.
 * ==============================================================================
 */

import { supabase } from './supabase-config.js';
import { subscribeToItems } from './items.js';
import { renderAll } from './ui.js';
import { toast, DEMO_ITEMS, formatPostId, x } from './utils.js';

const state = {
  items: [],
  activeType: '',
  userEmail: '',
    userId: '',
  adminQueue: [],
  activeAnnouncement: null,
  announcementReports: [],
    feedbackReports: [],
    claimFollowupRequests: [],
};

function addActivity(itemId, activity) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;

  item.activity = item.activity || [];
  item.activity.unshift({
    id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    actor: activity.actor || 'System',
    type: activity.type || 'update',
    message: activity.message || '',
    timestamp: Date.now(),
    imageUrl: activity.imageUrl || '',
  });
}

function addAnnouncementReport(report) {
  state.announcementReports = state.announcementReports || [];
  state.announcementReports.unshift({
    id: `ann_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    ...report,
    timestamp: Date.now(),
  });
}

const AUTH_SESSION_KEY = 'iskofinds.demo-session';

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
    const setupDialog = document.getElementById('fb-dialog');
    if (supabase || localStorage.getItem(AUTH_SESSION_KEY)) {
        setupDialog.style.display = 'none';
    } else {
        setupDialog.style.display = 'flex';
    }
  checkAuthGate();
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
    window.switchAuthTab('login');

    if (supabase) {
        supabase.auth.onAuthStateChange((_event, session) => {
            const email = session?.user?.email || '';
            if (isAllowedInstitutionalEmail(email)) {
                state.userId = session.user.id;
                unlockAppShell(email);
                void fetchAndSyncItems();
            } else {
                state.userId = '';
                lockAppShell();
            }
        });
    }

  initAppNavigation();
  bindReportButtons();
  initFilterListeners();
  fetchAndSyncItems();
});

window.startDemo = () => {
    if (supabase) return;
    const demoEmail = 'demo@iskolarngbayan.pup.edu.ph';
    localStorage.setItem(AUTH_SESSION_KEY, demoEmail);
    state.userEmail = demoEmail;
    state.userId = 'demo-user';
    state.items = DEMO_ITEMS;
    document.getElementById('fb-dialog').style.display = 'none';
    unlockAppShell(demoEmail);
    renderAll(state);
    toast('Demo mode is active. This session is not verified.', 'success');
};

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

            console.log(`Switching to section: ${targetSec}`);

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
            } else {
                console.warn(`Target section element for "${targetSec}" not found in DOM.`);
            }
        });
    });
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
      state.items = DEMO_ITEMS;
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

    let authenticatedUser = null;
    if (supabase) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user || !isAllowedInstitutionalEmail(user.email || '')) {
            toast('Sign in with your PUP account before submitting a report.', 'error');
            return;
        }
        authenticatedUser = user;
        state.userId = user.id;
    }

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

            if (supabase) {
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
            } else {
                imageUrl = URL.createObjectURL(file);
            }
        }

        const nextDemoPostNumber = Math.max(0, ...state.items.map(item => Number(item.post_number) || 0)) + 1;
        const newReport = {
            id: 'd' + Date.now(),
            user_id: state.userId || 'demo-user',
            post_number: nextDemoPostNumber,
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
            createdAt: { seconds: Math.floor(Date.now() / 1000) },
            activity: [{
                id: 'evt_initial',
                actor: reporterName,
                type: 'report_created',
                message: `${reporterName} submitted this ${currentReportType} report.`,
                timestamp: Date.now(),
                imageUrl: imageUrl || '',
            }],
        };

        if (supabase) {
            const itemActivity = [{
                id: 'evt_initial',
                actor: reporterName,
                type: 'report_created',
                message: `${reporterName} submitted this ${currentReportType} report.`,
                timestamp: Date.now(),
                imageUrl: imageUrl || '',
            }];

            const { data, error } = await supabase
                .from('items')
                .insert([{
                    user_id: authenticatedUser.id,
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
        } else {
            state.items.unshift(newReport);
            toast('Demo mode: report saved locally.', 'success');
        }

        toast(supabase ? 'Item reported successfully!' : 'Demo report saved successfully!', 'success');
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

function renderMyReports(state) {
    const grid = document.getElementById('my-reports-grid');
    if (!grid) return;

    const myItems = supabase
        ? state.items.filter(item => item.user_id === state.userId)
        : state.items;

    if (myItems.length === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No reports found.</p>`;
        return;
    }

    grid.innerHTML = myItems.map(item => `
        <div class="item-card" style="border-left: 4px solid ${item.status === 'open' ? 'var(--maroon)' : 'var(--success)'};">
            ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.title}" style="width:100%; height:160px; object-fit:cover; border-radius:4px 4px 0 0;">` : ''}
            <div style="padding: 12px;">
                <span class="badge ${item.type}">${item.type ? item.type.toUpperCase() : 'LOST'}</span>
                <h3 style="margin: 8px 0 4px 0; font-size: 16px;">${item.title}</h3>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">Post ID: ${formatPostId(item.post_number)}</p>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">${x(item.campus || 'Campus not specified')}</p>
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">📍 ${x(item.location)}</p>
                <p style="font-size: 13px; margin-bottom: 12px;">Status: <strong>${item.status}</strong></p>
                
                <div style="display: flex; gap: 8px;">
                    ${item.status === 'open' ? `
                        <button class="btn btn-sm btn-primary" onclick="window.updateItemStatus('${item.id}', 'resolved')">Mark Resolved</button>
                    ` : `
                        <button class="btn btn-sm btn-ghost" onclick="window.updateItemStatus('${item.id}', 'open')">Reopen</button>
                    `}
                </div>
            </div>
        </div>
    `).join('');
}

window.publishAnnouncement = (requestId) => {
    const request = state.adminQueue.find(r => r.id === requestId);
    if (!request) return;

    state.activeAnnouncement = {
        title: 'Owner identified',
        text: `${request.likelyOwner} has been flagged as the likely owner of “${request.itemTitle}.” Contact the reporter for confirmation and update the claim.`,
        reports: state.announcementReports || [],
    };

    state.adminQueue = state.adminQueue.filter(r => r.id !== requestId);
    addAnnouncementReport({
        type: 'announcement_published',
        actor: 'Admin',
        message: `Published announcement for ${request.itemTitle}.`,
    });
    toast('Announcement published to the home banner.', 'success');
    renderAll(state);
};

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
            state.claimFollowupRequests.unshift({
                ...feedback,
                type: 'claim_followup',
                itemId: item.id,
                itemTitle: item.title,
                postNumber: item.post_number,
                campus: item.campus || '',
                posterName: item.reporterName || 'Unknown',
                posterContact: item.contact || '',
                evidence_image: evidenceFile ? URL.createObjectURL(evidenceFile) : null,
                status: 'pending',
            });
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
            const localReport = {
                ...feedback,
                email: state.userEmail,
                evidence_image: evidenceFile ? URL.createObjectURL(evidenceFile) : null,
                status: 'pending',
            };
            if (selectedFeedbackTopic === 'announcement') {
                addAnnouncementReport({ ...localReport, type: 'announcement_report' });
            } else {
                state.feedbackReports.unshift(localReport);
            }
        }
    }

    toast(selectedFeedbackTopic === 'item' ? 'Claim follow-up request recorded.' : 'Thank you. Your feedback has been submitted.', 'success');
    document.getElementById('feedback-message').value = '';
    document.getElementById('feedback-item-evidence').value = '';
    document.getElementById('feedback-report-evidence').value = '';
    window.closeModal('feedback-overlay');
    renderAll(state);
};

window.updateItemStatus = async (itemId, newStatus) => {
    const item = state.items.find(i => i.id === itemId);
    if (!supabase) {
        toast('Demo mode: status update simulated locally.', 'success');
        if (item) {
            item.status = newStatus;
            addActivity(itemId, {
                actor: 'Admin',
                type: 'status_changed',
                message: `Status changed to ${newStatus}.`,
            });
        }
        renderAll(state);
        renderMyReports(state);
        return;
    }

    const { error } = await supabase
        .from('items')
        .update({ status: newStatus })
        .eq('id', itemId);

    if (error) {
        console.error('Error updating status:', error);
        toast('Failed to update status.', 'error');
        return;
    }

    toast(`Item marked as ${newStatus}!`, 'success');
    
    const itemIndex = state.items.findIndex(i => i.id === itemId);
    if (itemIndex > -1) {
        state.items[itemIndex].status = newStatus;
        addActivity(itemId, {
            actor: 'Admin',
            type: 'status_changed',
            message: `Status changed to ${newStatus}.`,
        });
        renderAll(state);
        renderMyReports(state);
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
          <div class="detail-val">${item.status}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Category</div>
          <div class="detail-val">${item.category || 'Other'}</div>
        </div>
                <div class="detail-field">
                    <div class="detail-label">Campus</div>
                    <div class="detail-val">${x(item.campus || 'Not specified')}</div>
                </div>
        <div class="detail-field">
          <div class="detail-label">Location</div>
          <div class="detail-val">${item.location || 'Not specified'}</div>
        </div>
      </div>

      <div class="detail-label">Description</div>
      <div class="detail-val" style="margin-bottom:16px;">${item.description || 'No description provided.'}</div>

      <div class="detail-grid">
        <div class="detail-field">
          <div class="detail-label">Reporter</div>
          <div class="detail-val">${item.reporterName || 'Unknown'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Contact</div>
          <div class="detail-val">${item.contact || 'Not shared'}</div>
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
                <strong>${entry.actor}</strong>
                <span style="color:var(--ink-3);">${new Date(entry.timestamp).toLocaleDateString('en-PH')}</span>
              </div>
              <div>${entry.message}</div>
            </div>
          `).join('') || '<div style="font-size:12.5px; color:var(--ink-3);">No activity yet.</div>'}
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" onclick="window.closeModal('detail-overlay')">Close</button>
        <button class="btn btn-primary" onclick="window.openOwnerMatchModal('${item.id}')">I know the owner</button>
      </div>
    `;

    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('open'));
};

window.openClaimModal = (itemId) => {
    const modal = document.getElementById('claim-modal-overlay');
    const hiddenIdInput = document.getElementById('claim-item-id');
    if (!modal || !hiddenIdInput) return;

    hiddenIdInput.value = itemId;
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

    let user = null;
    if (supabase) {
        const { data: { user: authenticatedUser }, error: userError } = await supabase.auth.getUser();
        if (userError || !authenticatedUser) {
            toast('Sign in again before sending an owner match.', 'error');
            return;
        }
        user = authenticatedUser;
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

        if (supabase) {
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
        } else {
            evidenceImage = URL.createObjectURL(file);
        }
    }

    const request = {
        id: 'match-' + Date.now(),
        itemId,
        itemTitle: item?.title || 'Item',
        postNumber: item?.post_number,
        campus: item?.campus || '',
        likelyOwner,
        proof,
        contact,
        evidenceImage,
        createdAt: Date.now()
    };

    if (supabase) {
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
    } else {
        state.adminQueue.unshift(request);
    }

    toast('Sent to admin review. No announcement will be published before verification.', 'success');
    document.getElementById('owner-match-name').value = '';
    document.getElementById('owner-match-proof').value = '';
    document.getElementById('owner-match-contact').value = '';
    if (imageInput) imageInput.value = '';
    window.closeModal('owner-match-overlay');
    renderAll(state);
};

window.submitClaim = async (e) => {
    e.preventDefault();

    const itemId = document.getElementById('claim-item-id')?.value;
    const claimantName = document.getElementById('c-name')?.value.trim();
    const contact = document.getElementById('c-contact')?.value.trim();
    const proofDescription = document.getElementById('c-proof')?.value.trim();

    if (!claimantName || !contact || !proofDescription) {
        toast('Please fill out all required fields.', 'error');
        return;
    }

    if (!isAllowedInstitutionalEmail(contact)) {
        toast('Only @iskolarngbayan.pup.edu.ph email addresses are accepted.', 'error');
        return;
    }

    if (itemId) {
        addActivity(itemId, {
            actor: claimantName,
            type: 'claim_submitted',
            message: `Claim submitted by ${claimantName}. Proof: ${proofDescription}`,
        });
    }

    toast('Claim submitted successfully! The founder will review your proof.', 'success');
    window.closeModal('claim-modal-overlay');

    document.getElementById('c-name').value = '';
    document.getElementById('c-contact').value = '';
    document.getElementById('c-proof').value = '';
  }
  // ==========================================
// AUTH GATE & SESSION ROUTING
// ==========================================

let authMode = 'login';

window.switchAuthTab = (mode) => {
    if (mode !== 'login' && mode !== 'signup') return;
    authMode = mode;

    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    const submitButton = document.getElementById('auth-submit-btn');
    const label = document.getElementById('auth-label-text');

    loginTab?.classList.toggle('btn-primary', mode === 'login');
    loginTab?.classList.toggle('btn-ghost', mode !== 'login');
    signupTab?.classList.toggle('btn-primary', mode === 'signup');
    signupTab?.classList.toggle('btn-ghost', mode !== 'signup');
    if (loginTab) {
        loginTab.style.background = mode === 'login' ? 'var(--maroon)' : '';
        loginTab.style.color = mode === 'login' ? '#fff' : '';
    }
    if (signupTab) {
        signupTab.style.background = mode === 'signup' ? 'var(--maroon)' : '';
        signupTab.style.color = mode === 'signup' ? '#fff' : '';
    }
    if (submitButton) submitButton.textContent = mode === 'login' ? 'Send Login Magic Link' : 'Create Account';
    if (label) label.textContent = mode === 'login' ? 'Institutional Email *' : 'Institutional Email for your account *';
};

async function checkAuthGate() {
    if (!supabase) {
        const savedEmail = localStorage.getItem(AUTH_SESSION_KEY) || '';
        if (isAllowedInstitutionalEmail(savedEmail)) {
            unlockAppShell(savedEmail);
        } else {
            localStorage.removeItem(AUTH_SESSION_KEY);
            lockAppShell();
        }
        return;
    }

    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        const email = session?.user?.email || '';
        if (!error && isAllowedInstitutionalEmail(email)) {
            state.userId = session.user.id;
            unlockAppShell(email);
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
}

function lockAppShell() {
    state.userEmail = '';
    state.userId = '';
    const gate = document.getElementById('auth-gate');
    const shell = document.getElementById('app-shell');
    if (gate) gate.style.display = 'flex';
    if (shell) shell.style.display = 'none';
}

window.handleGateLogin = async () => {
    const email = document.getElementById('gate-email')?.value.trim() || '';
    if (!isAllowedInstitutionalEmail(email)) {
        toast('Access restricted to valid @iskolarngbayan.pup.edu.ph emails only.', 'error');
        return;
    }

    if (!supabase) {
        localStorage.setItem(AUTH_SESSION_KEY, email);
        unlockAppShell(email);
        state.userId = 'demo-user';
        toast('Demo mode: Access granted. This session is not verified.', 'success');
        return;
    }

    try {
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: window.location.origin,
                shouldCreateUser: authMode === 'signup'
            }
        });

        if (error) {
            console.error('Supabase auth error:', error);
            toast('Failed to send verification link. Try again.', 'error');
            return;
        }

        toast('Magic link sent. Verify your email to continue.', 'success');
    } catch (error) {
        console.error('Unexpected auth error:', error);
        toast('An unexpected authentication error occurred.', 'error');
    }
};

async function handleLogout() {
    if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) {
            toast('Could not sign out. Please try again.', 'error');
            return;
        }
    } else {
        localStorage.removeItem(AUTH_SESSION_KEY);
    }

    lockAppShell();
    state.items = [];
    renderAll(state);
    toast('You have been signed out.', 'success');
};