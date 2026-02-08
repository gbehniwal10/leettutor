// Inactivity Nudges module — detects idle users and flailing (repeated errors)
// in Learning Mode and sends nudge requests to the tutor via WebSocket.

import { state } from './state.js';
import { eventBus, Events } from './event-bus.js';

// --- Dependency injection ---
// Functions from other modules needed by this module.
// Set via configureInactivityDeps() before first use.

let _deps = {
    settingsManager: null,
    wsSend: null,
    addChatMessage: null,
    getEditorValue: null,
};

export function configureInactivityDeps({ settingsManager, wsSend, addChatMessage, getEditorValue }) {
    _deps = { settingsManager, wsSend, addChatMessage, getEditorValue };
}

// --- Module-scoped state ---

let _inactivityDetector = null;

// --- InactivityDetector class ---

class InactivityDetector {
    constructor(settingsMgr, onInactive, onFlailing) {
        this.settingsMgr = settingsMgr;
        this.onInactive = onInactive;
        this.onFlailing = onFlailing;
        this.lastActivity = Date.now();
        this.lastRealActivity = Date.now(); // only real user actions, never nudge resets
        this.lastNudgeTime = 0;
        this._nudgesSinceActivity = 0; // count nudges between real user actions
        this._maxNudgesBeforeActivity = 3; // stop after 3 nudges with no user response
        this._intervalId = null;
        this._nudgeCooldownMs = 2 * 60 * 1000; // 2-minute cooldown between nudges
        this._abandonThresholdMs = 30 * 60 * 1000; // stop nudging after 30 min of no real activity
        this.suppressed = false; // suppress after problem solved

        // Flailing detection state
        this._recentErrors = []; // { error: string, timestamp: number }
        this._flailingWindowMs = 5 * 60 * 1000; // 5-minute window
        this._flailingThreshold = 3;
    }

    start() {
        if (this._intervalId) return;
        this._intervalId = setInterval(() => this._check(), 30000);
    }

    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    recordActivity() {
        this.lastActivity = Date.now();
        this.lastRealActivity = Date.now();
        this._nudgesSinceActivity = 0;
    }

    recordError(errorMessage) {
        const now = Date.now();
        this._recentErrors.push({ error: errorMessage, timestamp: now });

        // Prune old errors outside the window
        this._recentErrors = this._recentErrors.filter(
            (e) => (now - e.timestamp) < this._flailingWindowMs
        );

        this._checkFlailing();
    }

    cancelPendingNudge() {
        // Reset timer so any upcoming nudge check won't fire
        this.lastActivity = Date.now();
    }

    _isActive() {
        // Only active in Learning Mode with an active, unsolved session
        return state.mode === 'learning' && state.sessionId != null && !this.suppressed;
    }

    _check() {
        if (!this._isActive()) return;

        const threshold = this.settingsMgr.get('inactivityNudgeMinutes');
        if (threshold <= 0) return; // disabled

        const now = Date.now();

        // Stop nudging entirely if user has been gone for 30+ minutes
        if ((now - this.lastRealActivity) >= this._abandonThresholdMs) return;

        // Stop after N nudges with no real user activity in between
        if (this._nudgesSinceActivity >= this._maxNudgesBeforeActivity) return;

        // Enforce cooldown
        if ((now - this.lastNudgeTime) < this._nudgeCooldownMs) return;

        const idleMs = now - this.lastActivity;
        const thresholdMs = threshold * 60 * 1000;

        if (idleMs >= thresholdMs) {
            this.lastNudgeTime = now;
            this.lastActivity = now; // reset so it doesn't fire continuously
            this._nudgesSinceActivity++;
            if (this.onInactive) {
                this.onInactive(Math.round(idleMs / 1000));
            }
        }
    }

    _checkFlailing() {
        if (!this._isActive()) return;

        const now = Date.now();

        // Stop nudging entirely if user has been gone for 30+ minutes
        if ((now - this.lastRealActivity) >= this._abandonThresholdMs) return;

        // Enforce cooldown
        if ((now - this.lastNudgeTime) < this._nudgeCooldownMs) return;

        if (this._recentErrors.length < this._flailingThreshold) return;

        // Check if the last N errors have the same error type
        const recent = this._recentErrors.slice(-this._flailingThreshold);
        const firstError = this._normalizeError(recent[0].error);
        const allSame = recent.every((e) => this._normalizeError(e.error) === firstError);

        if (allSame) {
            this.lastNudgeTime = now;
            this.lastActivity = now;
            // Clear errors after triggering to avoid repeated nudges
            this._recentErrors = [];
            if (this.onFlailing) {
                this.onFlailing(recent.length, recent[recent.length - 1].error);
            }
        }
    }

    _normalizeError(errorStr) {
        // Extract the error type (e.g., "IndexError", "TypeError") for comparison
        if (!errorStr) return 'unknown';
        const match = errorStr.match(/^(\w+Error)/);
        if (match) return match[1];
        // Fallback: first 60 chars
        return errorStr.substring(0, 60);
    }
}

// --- Nudge handlers ---

function _handleInactivityNudge(idleSeconds) {
    const editorValue = _deps.getEditorValue();
    const codeLength = editorValue ? editorValue.split('\n').length : 0;
    _deps.wsSend({
        type: 'nudge_request',
        trigger: 'inactivity',
        context: {
            idle_seconds: idleSeconds,
            current_code_length: codeLength,
            current_code: editorValue || null,
        }
    });
}

function _handleFlailingNudge(consecutiveErrors, lastError) {
    const editorValue = _deps.getEditorValue();
    const codeLength = editorValue ? editorValue.split('\n').length : 0;
    _deps.wsSend({
        type: 'nudge_request',
        trigger: 'flailing',
        context: {
            consecutive_errors: consecutiveErrors,
            last_error: lastError,
            current_code_length: codeLength,
            current_code: editorValue || null,
        }
    });
}

function _nudgeRecordRunError(results) {
    // Called after test results are displayed to track errors for flailing detection
    if (!_inactivityDetector) return;
    if (!results || !results.results) return;

    for (let i = 0; i < results.results.length; i++) {
        const r = results.results[i];
        if (!r.passed && r.error) {
            _inactivityDetector.recordError(r.error);
            return; // Record only the first error per run
        }
    }
}

// --- Activity tracking wiring ---

function _wireEditorActivityTracking() {
    // Poll until Monaco editor is ready, then attach the listener
    const checkInterval = setInterval(function() {
        if (state.editorReady && state.editor && _inactivityDetector) {
            state.editor.onDidChangeModelContent(function() {
                _inactivityDetector.recordActivity();
            });
            clearInterval(checkInterval);
        }
    }, 500);
}

function _wireMouseActivityTracking() {
    const appContainer = document.body;
    let _mouseMoveTimeout = null;
    appContainer.addEventListener('mousemove', function() {
        if (_mouseMoveTimeout) return;
        _mouseMoveTimeout = setTimeout(function() {
            _mouseMoveTimeout = null;
        }, 2000); // debounce: only record every 2 seconds
        if (_inactivityDetector) {
            _inactivityDetector.recordActivity();
        }
    });
}

function _wireChatSendActivityTracking() {
    // Observe the chat input for user sends
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && _inactivityDetector) {
                _inactivityDetector.recordActivity();
                _inactivityDetector.cancelPendingNudge();
            }
        });
    }
    // Also track the send button
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', function() {
            if (_inactivityDetector) {
                _inactivityDetector.recordActivity();
                _inactivityDetector.cancelPendingNudge();
            }
        });
    }
}

// --- Event bus hooks (replaces monkey-patching) ---

function _hookRunCodeForFlailing() {
    // Listen to event bus for test results instead of monkey-patching displayTestResults
    eventBus.on(Events.TEST_RESULTS_DISPLAYED, (results, isSubmit) => {
        _nudgeRecordRunError(results);
    });
}

function _hookWebSocketForNudgeMessages() {
    // Listen to event bus for WebSocket messages instead of monkey-patching handleWebSocketMessage
    eventBus.on(Events.WS_MESSAGE, (data) => {
        if (data.type === 'assistant_message' && data.nudge) {
            _markLastMessageAsNudge();
        }
    });
}

function _markLastMessageAsNudge() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const messages = container.querySelectorAll('.chat-message.assistant');
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg.classList.contains('nudge-message')) {
        lastMsg.classList.add('nudge-message');
        // Prepend a nudge indicator
        const indicator = document.createElement('span');
        indicator.className = 'nudge-indicator';
        indicator.textContent = 'Nudge: ';
        indicator.setAttribute('aria-label', 'Proactive nudge from tutor');
        lastMsg.insertBefore(indicator, lastMsg.firstChild);
    }
}

// --- Initialization ---

export function getDetector() {
    return _inactivityDetector;
}

export function initInactivityNudges() {
    _inactivityDetector = new InactivityDetector(
        _deps.settingsManager,
        _handleInactivityNudge,
        _handleFlailingNudge
    );
    _inactivityDetector.start();

    _wireEditorActivityTracking();
    _wireMouseActivityTracking();
    _wireChatSendActivityTracking();
    _hookRunCodeForFlailing();
    _hookWebSocketForNudgeMessages();
}
