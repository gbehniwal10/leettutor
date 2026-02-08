// Friction Dialogs module — confirmation dialogs for destructive actions.

import { state } from './state.js';
import { clearSessionHash } from './utils.js';

// --- Dependency injection ---

let settingsManager = null;
let getEditorValue = null;
let wsSend = null;
let addChatMessage = null;
let startSession = null;
let disconnectEarconObserver = null;
let disconnectTtsObserver = null;

export function configureDialogDeps(deps) {
    settingsManager = deps.settingsManager;
    getEditorValue = deps.getEditorValue;
    wsSend = deps.wsSend;
    addChatMessage = deps.addChatMessage;
    startSession = deps.startSession;
    disconnectEarconObserver = deps.disconnectEarconObserver;
    disconnectTtsObserver = deps.disconnectTtsObserver;
}

// --- Confirm dialog ---

export function showConfirmDialog({ title, message, detail, confirmLabel, cancelLabel }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-dialog-overlay');
        const titleEl = document.getElementById('confirm-dialog-title');
        const messageEl = document.getElementById('confirm-dialog-message');
        const detailEl = document.getElementById('confirm-dialog-detail');
        const confirmBtn = document.getElementById('confirm-dialog-confirm');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        const triggerEl = document.activeElement;

        titleEl.textContent = title || 'Are you sure?';
        messageEl.textContent = message || '';
        detailEl.textContent = detail || '';
        detailEl.style.display = detail ? 'block' : 'none';
        confirmBtn.textContent = confirmLabel || 'Confirm';
        cancelBtn.textContent = cancelLabel || 'Cancel';

        overlay.classList.remove('hidden');
        cancelBtn.focus();

        function cleanup(result) {
            overlay.classList.add('hidden');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey, true);
            overlay.removeEventListener('click', onOverlay);
            try { if (triggerEl) triggerEl.focus(); } catch (e) { /* element may be gone */ }
            resolve(result);
        }

        function onConfirm() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onKey(e) {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                cleanup(false);
            } else if (e.key === 'Tab') {
                // Trap focus within dialog
                const focusable = [cancelBtn, confirmBtn];
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
        function onOverlay(e) {
            if (e.target === overlay) cleanup(false);
        }

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', onOverlay);
    });
}

// --- Reset code ---

function resetCode() {
    if (!state.currentProblem || !state.editorReady || !state.editor) return;
    state.editor.setValue(state.currentProblem.starter_code);
}

export async function resetCodeWithConfirm() {
    if (!state.currentProblem || !state.editorReady || !state.editor) return;

    if (!settingsManager.get('confirmDestructive')) {
        resetCode();
        return;
    }

    const code = getEditorValue();
    const lineCount = code.split('\n').filter(l => l.trim().length > 0).length;

    const confirmed = await showConfirmDialog({
        title: 'Reset to starter code?',
        message: 'You\'ve written ' + lineCount + ' lines. Reset to starter code?',
        detail: 'Maybe save your approach in the chat first \u2014 describe what you\'ve tried so far.',
        confirmLabel: 'Reset',
        cancelLabel: 'Keep Coding',
    });

    if (confirmed) {
        resetCode();
    }
}

// --- End session ---

export function endSession() {
    if (!state.sessionId) return;
    wsSend({ type: 'end_session' });
    state.sessionId = null;
    clearSessionHash();
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
    if (state.timeSyncInterval) { clearInterval(state.timeSyncInterval); state.timeSyncInterval = null; }
    document.getElementById('timer').classList.add('hidden');
    // Disconnect MutationObservers (Ticket 47)
    disconnectEarconObserver();
    disconnectTtsObserver();
    addChatMessage('system', 'Session ended.');
}

export async function endSessionWithConfirm() {
    if (!state.sessionId) return;

    if (!settingsManager.get('confirmDestructive')) {
        endSession();
        return;
    }

    const problemTitle = state.currentProblem ? state.currentProblem.title : 'this problem';

    const confirmed = await showConfirmDialog({
        title: 'End this session?',
        message: 'End your session on "' + problemTitle + '"? Your progress will be saved.',
        detail: 'You can resume this session later from the history.',
        confirmLabel: 'End Session',
        cancelLabel: 'Keep Going',
    });

    if (confirmed) {
        endSession();
    }
}

// --- Restart session ---

async function restartSession() {
    if (!state.currentProblem) return;
    const oldSessionId = state.sessionId;

    // End the current session
    endSession();

    // Delete the old session file so it doesn't clutter history
    if (oldSessionId) {
        try {
            await fetch('/api/sessions/' + oldSessionId, { method: 'DELETE' });
        } catch (e) { /* best-effort */ }
    }

    // Clear test results
    const resultsEl = document.getElementById('test-results');
    if (resultsEl) resultsEl.innerHTML = '';

    // Reset code to starter
    resetCode();

    // Start a fresh session on the same problem
    startSession();
}

export async function restartSessionWithConfirm() {
    if (!state.sessionId) return;

    if (!settingsManager.get('confirmDestructive')) {
        await restartSession();
        return;
    }

    const problemTitle = state.currentProblem ? state.currentProblem.title : 'this problem';

    const confirmed = await showConfirmDialog({
        title: 'Restart from scratch?',
        message: 'Restart "' + problemTitle + '"? This will erase your code, chat, and session history for this attempt.',
        confirmLabel: 'Restart',
        cancelLabel: 'Keep Going',
    });

    if (confirmed) {
        await restartSession();
    }
}

// --- Init ---

export function initFrictionDialogs() {
    // beforeunload when session is active
    window.addEventListener('beforeunload', (e) => {
        if (state.sessionId && settingsManager.get('confirmDestructive')) {
            e.preventDefault();
            e.returnValue = 'You have an active coding session. Leave anyway?';
            return e.returnValue;
        }
    });
}
