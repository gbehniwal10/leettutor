// Shared utility functions used across multiple modules.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { state } from './state.js';

// --- HTML/Markdown ---

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function renderMarkdown(text) {
    try {
        const html = marked.parse(text);
        return DOMPurify.sanitize(html);
    } catch (e) { console.warn('renderMarkdown failed:', e); }
    return escapeHtml(text);
}

// --- Auth ---

export function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.authToken) {
        headers['Authorization'] = 'Bearer ' + state.authToken;
    }
    return headers;
}

export async function handleAuthError(response) {
    if (response.status === 401 && state.authRequired) {
        state.authToken = null;
        sessionStorage.removeItem('leettutor_token');
        // Dynamic import to avoid circular dependency
        const { showLoginModal } = await import('./auth.js');
        await showLoginModal();
        return true;
    }
    return false;
}

// --- Focus Trap ---

const _focusTrapState = {
    activeModal: null,
    triggerElement: null,
    keyHandler: null,
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(modalElement, triggerElement) {
    if (_focusTrapState.activeModal) {
        releaseFocus(false);
    }

    _focusTrapState.activeModal = modalElement;
    _focusTrapState.triggerElement = triggerElement || document.activeElement;

    function keyHandler(e) {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter(el => el.offsetParent !== null);
        if (focusable.length === 0) {
            e.preventDefault();
            return;
        }
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

    _focusTrapState.keyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler, true);

    requestAnimationFrame(() => {
        const focusable = Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter(el => el.offsetParent !== null);
        if (focusable.length > 0) {
            focusable[0].focus();
        } else {
            modalElement.setAttribute('tabindex', '-1');
            modalElement.focus();
        }
    });
}

export function releaseFocus(restoreFocus) {
    if (restoreFocus === undefined) restoreFocus = true;
    if (_focusTrapState.keyHandler) {
        document.removeEventListener('keydown', _focusTrapState.keyHandler, true);
        _focusTrapState.keyHandler = null;
    }
    if (restoreFocus && _focusTrapState.triggerElement) {
        try { _focusTrapState.triggerElement.focus(); } catch (e) { /* element may be gone */ }
    }
    _focusTrapState.activeModal = null;
    _focusTrapState.triggerElement = null;
}

// --- URL Hash Helpers ---

export function setSessionHash(sessionId) {
    if (sessionId) {
        history.replaceState(null, '', '#session=' + sessionId);
    }
}

export function clearSessionHash() {
    history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function getSessionFromHash() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#session=')) {
        return hash.slice('#session='.length);
    }
    return null;
}

// --- Time formatting ---

export function timeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}
