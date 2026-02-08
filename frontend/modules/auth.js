// Auth module — login flow and auth-status check.

import { state } from './state.js';
import { trapFocus, releaseFocus } from './utils.js';

/**
 * Check the server's auth status and, if authentication is required and no
 * token is present, present the login modal to the user.
 */
export async function checkAuth() {
    try {
        const resp = await fetch('/api/auth/status');
        const data = await resp.json();
        state.authRequired = data.auth_required;
    } catch (e) {
        console.warn('Failed to check auth status:', e);
        return;
    }
    // Try to restore token from sessionStorage
    const saved = sessionStorage.getItem('leettutor_token');
    if (saved) { state.authToken = saved; }
    if (state.authRequired && !state.authToken) {
        await showLoginModal();
    }
}

/**
 * Display the login modal and return a Promise that resolves once the user
 * has successfully authenticated.
 */
export function showLoginModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('login-modal');
        modal.classList.remove('hidden');
        const btn = document.getElementById('login-btn');
        const input = document.getElementById('login-password');
        const error = document.getElementById('login-error');
        error.textContent = '';
        input.value = '';

        async function doLogin() {
            const password = document.getElementById('login-password').value;
            if (!password) return;
            btn.disabled = true;
            btn.textContent = 'Logging in...';
            try {
                const resp = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });
                if (!resp.ok) {
                    error.textContent = 'Invalid password.';
                    btn.disabled = false;
                    btn.textContent = 'Login';
                    return;
                }
                const data = await resp.json();
                state.authToken = data.token;
                sessionStorage.setItem('leettutor_token', data.token);
                modal.classList.add('hidden');
                releaseFocus();
                resolve();
            } catch (e) {
                error.textContent = 'Connection error.';
                btn.disabled = false;
                btn.textContent = 'Login';
            }
        }

        // Remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', doLogin);

        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
        newInput.value = '';
        newInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
        });

        // Trap focus after cloning (elements are now in DOM)
        trapFocus(modal);
    });
}
