// Chat module — message sending, receiving, and rendering.
// Handles WebSocket message dispatch for chat-related events.

import { state } from './state.js';
import { WS_MESSAGE_TYPES } from './constants.js';
import { renderMarkdown, escapeHtml, setSessionHash, clearSessionHash } from './utils.js';
import { eventBus, Events } from './event-bus.js';

// --- Dependency injection ---
// Functions from other modules that handleWebSocketMessage needs to call.
// Set via configureChatDeps() before first use.

let _deps = {
    wsSend: null,
    getEditorValue: null,
    onSessionStarted: null,
    onSessionResumed: null,
    onTimeUpdate: null,
};

export function configureChatDeps({ wsSend, getEditorValue, onSessionStarted, onSessionResumed, onTimeUpdate }) {
    _deps = { wsSend, getEditorValue, onSessionStarted, onSessionResumed, onTimeUpdate };
}

// --- Module-scoped state ---

let _streamId = 0;

// --- Public functions ---

export function requestHint() {
    if (!state.currentProblem) return;
    _deps.wsSend({ type: WS_MESSAGE_TYPES.REQUEST_HINT, code: _deps.getEditorValue() });
}

export function sendMessage() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    addChatMessage('user', content);
    _deps.wsSend({ type: WS_MESSAGE_TYPES.MESSAGE, content, code: _deps.getEditorValue() });
    input.value = '';
}

export function handleWebSocketMessage(data) {
    switch (data.type) {
        case WS_MESSAGE_TYPES.SESSION_STARTED:
            state.sessionId = data.session_id;
            if (state.mode !== 'pattern-quiz') {
                setSessionHash(data.session_id);
            }
            if (_deps.onSessionStarted) _deps.onSessionStarted(data);
            break;
        case WS_MESSAGE_TYPES.SESSION_RESUMED:
            if (_deps.onSessionResumed) _deps.onSessionResumed(data);
            break;
        case WS_MESSAGE_TYPES.ASSISTANT_MESSAGE:
            finalizeAssistantMessage(data.content);
            break;
        case WS_MESSAGE_TYPES.ASSISTANT_CHUNK:
            appendToLastAssistantMessage(data.content);
            break;
        case 'review_phase_started':
            state.inReview = true;
            if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
            if (state.timeSyncInterval) { clearInterval(state.timeSyncInterval); state.timeSyncInterval = null; }
            addChatMessage('system', 'Entering review phase.');
            break;
        case WS_MESSAGE_TYPES.ERROR:
            if (state.resuming) {
                // Clear resume UI state on error so the user can start fresh
                state.resuming = false;
                if (state.resumeTimeoutId) {
                    clearTimeout(state.resumeTimeoutId);
                    state.resumeTimeoutId = null;
                }
                clearSessionHash();
            }
            addChatMessage('system', 'Error: ' + data.content);
            break;
    }
}

export function finalizeAssistantMessage(content) {
    const container = document.getElementById('chat-messages');
    const lastMessage = container.querySelector('.chat-message.assistant:last-child');
    if (lastMessage && lastMessage.dataset.streaming === 'true') {
        lastMessage.dataset.streaming = 'false';
        lastMessage.innerHTML = renderMarkdown(content);
        container.scrollTop = container.scrollHeight;
        _streamId++;
        return;
    }
    addChatMessage('assistant', content);
}

export function addChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const message = document.createElement('div');
    message.className = `chat-message ${role}`;
    message.innerHTML = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
}

export function appendToLastAssistantMessage(content) {
    const container = document.getElementById('chat-messages');
    const lastMessage = container.querySelector('.chat-message.assistant:last-child');
    if (lastMessage && lastMessage.dataset.streaming === 'true' && lastMessage.dataset.streamId === String(_streamId)) {
        lastMessage.dataset.content = (lastMessage.dataset.content || '') + content;
        lastMessage.innerHTML = renderMarkdown(lastMessage.dataset.content);
    } else {
        _streamId++;
        const message = document.createElement('div');
        message.className = 'chat-message assistant';
        message.dataset.streaming = 'true';
        message.dataset.streamId = _streamId;
        message.dataset.content = content;
        message.innerHTML = renderMarkdown(content);
        container.appendChild(message);
    }
    container.scrollTop = container.scrollHeight;
}
