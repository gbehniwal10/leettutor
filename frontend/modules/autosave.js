// Autosave module — debounced localStorage backup of editor code.
// Protects against browser/server crashes by periodically saving editor state.

import { state } from './state.js';
import { eventBus, Events } from './event-bus.js';
import { WS_MESSAGE_TYPES } from './constants.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const STORAGE_KEY_PREFIX = 'leettutor_autosave_';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {
    getEditorValue: null,
    wsSend: null,
};

export function configureAutosaveDeps(deps) {
    Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

let _debounceTimer = null;
let _changeDisposable = null;
let _heartbeatInterval = null;
let _lastSentCode = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the autosave entry for a problem, or null if none exists.
 * Returns { code, sessionId, timestamp } or null.
 */
export function getAutosave(problemId) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + problemId);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/**
 * Clear the autosave entry for a problem.
 */
export function clearAutosave(problemId) {
    try {
        localStorage.removeItem(STORAGE_KEY_PREFIX + problemId);
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _saveNow() {
    if (!state.sessionId || !state.currentProblem || !_deps.getEditorValue) return;
    const code = _deps.getEditorValue();
    if (!code) return;

    const entry = {
        code,
        sessionId: state.sessionId,
        timestamp: Date.now(),
    };

    try {
        localStorage.setItem(
            STORAGE_KEY_PREFIX + state.currentProblem.id,
            JSON.stringify(entry),
        );
    } catch (e) { /* quota exceeded or private mode — ignore */ }
}

function _scheduleSave() {
    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        _saveNow();
    }, AUTOSAVE_DEBOUNCE_MS);
}

function _heartbeat() {
    if (!state.sessionId || !state.currentProblem || !_deps.getEditorValue || !_deps.wsSend) return;
    const code = _deps.getEditorValue();
    if (!code || code === _lastSentCode) return;
    _lastSentCode = code;
    _deps.wsSend({ type: WS_MESSAGE_TYPES.SAVE_STATE, code });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Call once after Monaco editor is ready. Subscribes to editor changes and
 * event-bus events.
 */
export function initAutosave() {
    // Listen for editor content changes (debounced save).
    // The editor may not be ready at init time, so we poll briefly.
    const attachListener = () => {
        if (state.editor && state.editorReady) {
            if (_changeDisposable) _changeDisposable.dispose();
            _changeDisposable = state.editor.onDidChangeModelContent(() => {
                _scheduleSave();
            });
        } else {
            setTimeout(attachListener, 500);
        }
    };
    attachListener();

    // Clear autosave when a problem is solved (all tests pass on submit).
    eventBus.on(Events.SOLUTION_SAVED, () => {
        if (state.currentProblem) {
            clearAutosave(state.currentProblem.id);
        }
    });

    // Heartbeat: send editor code to backend every 30s if it changed.
    _heartbeatInterval = setInterval(_heartbeat, HEARTBEAT_INTERVAL_MS);
}
