// WebSocket connection management — connect, reconnect, send.
// Handlers for incoming messages and auth errors are injected via
// setMessageHandler / setAuthErrorHandler to avoid circular imports.

import { state } from './state.js';
import { WS_MESSAGE_TYPES, WS_MAX_BACKOFF_MS } from './constants.js';
import { getSessionFromHash } from './utils.js';

// --- Reconnect state ---
let _wsReconnectAttempts = 0;
let _reconnectTimeoutId = null;
let _reconnectInFlight = false;

// --- Pluggable callbacks (set by app.js during bootstrap) ---
let _messageHandler = null;
let _authErrorHandler = null;

/**
 * Register a callback invoked for every parsed WebSocket message.
 * Signature: fn(data: object) => void
 */
export function setMessageHandler(fn) {
    _messageHandler = fn;
}

/**
 * Register a callback invoked when the server closes the socket with
 * code 4001 (auth rejection).  The callback should show a login modal
 * and resolve once the user has re-authenticated.
 * Signature: fn() => Promise<void>
 */
export function setAuthErrorHandler(fn) {
    _authErrorHandler = fn;
}

// --- Connection ---

export function initWebSocket() {
    // Prevent multiple simultaneous reconnect attempts
    if (_reconnectInFlight) return;
    _reconnectInFlight = true;

    // Clear any pending reconnect timeout since we are connecting now
    if (_reconnectTimeoutId !== null) {
        clearTimeout(_reconnectTimeoutId);
        _reconnectTimeoutId = null;
    }

    // Close any existing connection before creating a new one
    if (state.ws) {
        try { state.ws.close(); } catch (e) { /* ignore */ }
        state.ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);

    state.ws.onopen = () => {
        // Send auth token as first message
        state.ws.send(JSON.stringify({ type: WS_MESSAGE_TYPES.AUTH, token: state.authToken || '' }));
        state.wsReady = true;
        _reconnectInFlight = false;
        _wsReconnectAttempts = 0;

        const banner = document.getElementById('ws-status');
        if (banner) banner.classList.add('hidden');

        // Attempt to resume session from URL hash.
        const hashSession = getSessionFromHash();
        if (hashSession && !state.sessionId && !state.resuming) {
            import('./session.js').then(({ resumeSession }) => {
                resumeSession(hashSession);
            });
        }
    };

    state.ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
            return;
        }
        if (_messageHandler) {
            _messageHandler(data);
        }
    };

    state.ws.onclose = async (event) => {
        state.wsReady = false;
        _reconnectInFlight = false;

        // Clear any in-progress resume
        if (state.resuming) {
            state.resuming = false;
            if (state.resumeTimeoutId !== null) {
                clearTimeout(state.resumeTimeoutId);
                state.resumeTimeoutId = null;
            }
        }

        const banner = document.getElementById('ws-status');
        if (banner) banner.classList.remove('hidden');

        // Auth rejection — do not reconnect, prompt for login
        if (event.code === 4001) {
            state.authToken = null;
            sessionStorage.removeItem('leettutor_token');
            if (_authErrorHandler) {
                await _authErrorHandler();
            }
            initWebSocket();
            return;
        }

        // Clear any already-pending reconnect timeout to prevent stacking
        if (_reconnectTimeoutId !== null) {
            clearTimeout(_reconnectTimeoutId);
            _reconnectTimeoutId = null;
        }

        // Exponential backoff with jitter
        const baseDelay = Math.min(WS_MAX_BACKOFF_MS, 1000 * Math.pow(2, _wsReconnectAttempts));
        const jitter = Math.random() * baseDelay * 0.5;
        const delay = baseDelay + jitter;
        _wsReconnectAttempts++;
        _reconnectTimeoutId = setTimeout(initWebSocket, delay);
    };

    state.ws.onerror = () => {};
}

// --- Send ---

export function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
        return true;
    }
    console.warn('WebSocket not connected, message dropped:', obj.type);
    showConnectionNotification('Connection lost, reconnecting...');
    return false;
}

// --- UI notification ---

export function showConnectionNotification(message) {
    let notification = document.getElementById('ws-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'ws-notification';
        notification.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#e74c3c;color:#fff;padding:8px 20px;border-radius:6px;z-index:1100;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:opacity 0.3s;';
        document.body.appendChild(notification);
    }
    notification.textContent = message;
    notification.style.opacity = '1';
    notification.style.display = 'block';
    clearTimeout(notification._hideTimer);
    notification._hideTimer = setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => { notification.style.display = 'none'; }, 300);
    }, 5000);
}
