import { CLICK_DEBOUNCE_MS } from './constants.js';

// --- Click debouncing ---
function debounceButton(btn) {
    btn.addEventListener('click', () => {
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, CLICK_DEBOUNCE_MS);
    }, { capture: true });
}

// --- Scroll bookmarking (sessionStorage) ---
function bookmarkScroll(container, key) {
    const saved = sessionStorage.getItem(`scroll-${key}`);
    if (saved) container.scrollTop = parseInt(saved, 10);
    container.addEventListener('scroll', () => {
        sessionStorage.setItem(`scroll-${key}`, container.scrollTop);
    }, { passive: true });
}

export function initFocusMode() {
    const debounceIds = [
        'run-btn', 'submit-btn', 'reset-btn', 'give-up-btn'
    ];
    for (const id of debounceIds) {
        const btn = document.getElementById(id);
        if (btn) debounceButton(btn);
    }

    const problemDesc = document.getElementById('problem-description');
    if (problemDesc) bookmarkScroll(problemDesc, 'problem-desc');
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) bookmarkScroll(chatMessages, 'chat-messages');
}
