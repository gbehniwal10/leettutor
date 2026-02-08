// Whiteboard module — Excalidraw whiteboard integration, mobile panel switcher.

import { state } from './state.js';
import { authHeaders } from './utils.js';
import { initResize } from './panel-resizer.js';

// --- Dependency injection ---
// Functions from other modules needed at runtime.
// Set via configureWhiteboardDeps() before first use.

let _deps = {
    wsSend: null,
    getEditorValue: null,
    addChatMessage: null,
};

export function configureWhiteboardDeps({ wsSend, getEditorValue, addChatMessage }) {
    _deps = { wsSend, getEditorValue, addChatMessage };
}

// --- Module-scoped state ---

let _whiteboardSavedHeight = null;
let _whiteboardSavedPanelWidth = null;
const _WHITEBOARD_MIN_PANEL_WIDTH = 770;
let _whiteboardSaveTimeout = null;
const _WHITEBOARD_SAVE_DEBOUNCE_MS = 3000;

// --- Accessors for cross-module use ---

export function getWhiteboardSaveTimeout() {
    return _whiteboardSaveTimeout;
}

export function clearWhiteboardSaveTimeout() {
    if (_whiteboardSaveTimeout) {
        clearTimeout(_whiteboardSaveTimeout);
        _whiteboardSaveTimeout = null;
    }
}

// --- Public functions ---

export function initWhiteboard() {
    const section = document.getElementById('whiteboard-section');
    const toggleBtn = document.getElementById('whiteboard-toggle-btn');
    const sendBtn = document.getElementById('send-to-tutor-btn');
    const clearBtn = document.getElementById('whiteboard-clear-btn');
    const resizeHandle = document.getElementById('whiteboard-resize');
    if (!section || !toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        if (section.classList.contains('collapsed')) {
            expandWhiteboard();
        } else {
            collapseWhiteboard();
        }
    });

    if (sendBtn) {
        sendBtn.addEventListener('click', sendWhiteboardToTutor);
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (window.excalidrawBridge) {
                window.excalidrawBridge.clear();
            }
        });
    }

    // Vertical resize for whiteboard
    if (resizeHandle) {
        initResize(resizeHandle, 'vertical', {
            getSize: () => section.getBoundingClientRect().height,
            setSize: (val) => { section.style.height = val + 'px'; },
            getDelta: (startPos, e) => e.clientY - startPos,
            min: 100,
            max: () => {
                const rightPanel = document.querySelector('.right-panel');
                return rightPanel ? rightPanel.getBoundingClientRect().height - 80 : 400;
            },
        });
    }

    // Wire up auto-save on whiteboard changes
    const _waitForBridge = setInterval(() => {
        if (window.excalidrawBridge && window.excalidrawBridge.setOnChangeCallback) {
            window.excalidrawBridge.setOnChangeCallback(_onWhiteboardChange);
            clearInterval(_waitForBridge);
        }
    }, 500);
}

export function expandWhiteboard() {
    const section = document.getElementById('whiteboard-section');
    if (!section) return;
    section.classList.remove('collapsed');
    const rightPanel = document.querySelector('.right-panel');
    const height = _whiteboardSavedHeight || (rightPanel ? rightPanel.getBoundingClientRect().height * 0.5 : 300);
    section.style.height = height + 'px';
    // Widen the right panel so Excalidraw gets its desktop toolbar
    if (rightPanel) {
        const currentWidth = rightPanel.getBoundingClientRect().width;
        if (currentWidth < _WHITEBOARD_MIN_PANEL_WIDTH) {
            _whiteboardSavedPanelWidth = currentWidth;
            rightPanel.style.width = _WHITEBOARD_MIN_PANEL_WIDTH + 'px';
        }
    }
    const toggleBtn = document.getElementById('whiteboard-toggle-btn');
    if (toggleBtn) toggleBtn.innerHTML = '&#9660;';
}

export function collapseWhiteboard() {
    const section = document.getElementById('whiteboard-section');
    if (!section) return;
    _whiteboardSavedHeight = section.getBoundingClientRect().height;
    section.classList.add('collapsed');
    section.style.height = '';
    // Restore original right panel width
    if (_whiteboardSavedPanelWidth !== null) {
        const rightPanel = document.querySelector('.right-panel');
        if (rightPanel) rightPanel.style.width = _whiteboardSavedPanelWidth + 'px';
        _whiteboardSavedPanelWidth = null;
    }
    const toggleBtn = document.getElementById('whiteboard-toggle-btn');
    if (toggleBtn) toggleBtn.innerHTML = '&#9650;';
}

export async function sendWhiteboardToTutor() {
    if (!window.excalidrawBridge) {
        _deps.addChatMessage('system', 'Whiteboard is not loaded yet.');
        return;
    }
    const count = window.excalidrawBridge.getElementCount();
    if (count === 0) {
        _deps.addChatMessage('system', 'Whiteboard is empty. Draw something first.');
        return;
    }
    if (!state.sessionId) {
        _deps.addChatMessage('system', 'Start a session first before sending a drawing.');
        return;
    }

    const sendBtn = document.getElementById('send-to-tutor-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

    try {
        const blob = await window.excalidrawBridge.exportToPng();
        if (!blob) {
            _deps.addChatMessage('system', 'Failed to export whiteboard.');
            return;
        }

        const formData = new FormData();
        formData.append('image', blob, 'whiteboard.png');
        formData.append('session_id', state.sessionId);

        const headers = {};
        if (state.authToken) {
            headers['Authorization'] = 'Bearer ' + state.authToken;
        }

        const resp = await fetch('/api/whiteboard-image', {
            method: 'POST',
            headers,
            body: formData,
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            _deps.addChatMessage('system', 'Failed to upload drawing: ' + (err.detail || resp.statusText));
            return;
        }

        // Tell the tutor to look at the drawing
        _deps.addChatMessage('user', '[Sent a whiteboard drawing]');
        _deps.wsSend({
            type: 'message',
            content: 'I just saved a whiteboard drawing to ./whiteboard.png — please read and analyze it. Describe what you see and help me with my approach.',
            code: _deps.getEditorValue(),
        });
    } catch (e) {
        console.error('sendWhiteboardToTutor error:', e);
        _deps.addChatMessage('system', 'Error sending drawing: ' + e.message);
    } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to Tutor'; }
    }
}

// --- Whiteboard state persistence ---

function _onWhiteboardChange() {
    if (!state.sessionId) return;
    if (_whiteboardSaveTimeout) clearTimeout(_whiteboardSaveTimeout);
    _whiteboardSaveTimeout = setTimeout(_saveWhiteboardState, _WHITEBOARD_SAVE_DEBOUNCE_MS);
}

async function _saveWhiteboardState() {
    if (!state.sessionId || !window.excalidrawBridge) return;
    const stateData = window.excalidrawBridge.getState();
    try {
        const headers = { 'Content-Type': 'application/json', ...authHeaders() };
        const resp = await fetch(`/api/sessions/${state.sessionId}/whiteboard-state`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ whiteboard_state: stateData }),
        });
        if (!resp.ok) {
            console.warn('Failed to save whiteboard state:', resp.status);
        }
    } catch (e) {
        console.warn('Failed to save whiteboard state:', e);
    }
}

// ============================================================
// Mobile / Responsive Panel Switcher
// ============================================================

export function initPanelSwitcher() {
    const switcher = document.getElementById('panel-switcher');
    const main = document.querySelector('.main');
    if (!switcher || !main) return;

    // Set initial active panel
    main.setAttribute('data-active-panel', 'problem');

    const buttons = switcher.querySelectorAll('.panel-switcher-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.dataset.panel;
            if (!panel) return;

            // Update active button
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Set active panel on main
            main.setAttribute('data-active-panel', panel);

            // Trigger Monaco editor resize if switching to editor
            if (panel === 'editor' && state.editorReady && state.editor) {
                // Delay slightly so DOM has updated display
                requestAnimationFrame(() => {
                    state.editor.layout();
                });
            }
        });
    });

    // When a problem is selected, auto-switch to editor on mobile
    _patchProblemSelectForMobile(main, buttons);
}

function _patchProblemSelectForMobile(mainEl, switcherButtons) {
    // Watch for problem title changes to auto-switch to editor on mobile
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const titleEl = document.getElementById('problem-title');
    if (!titleEl) return;
    const observer = new MutationObserver(() => {
        // When the problem title text changes (problem loaded), switch to editor on mobile
        if (mediaQuery.matches && titleEl.textContent !== 'Select a Problem') {
            switchToPanel('editor', mainEl, switcherButtons);
        }
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

export function switchToPanel(panelName, mainEl, switcherButtons) {
    if (!mainEl) mainEl = document.querySelector('.main');
    if (!switcherButtons) switcherButtons = document.querySelectorAll('.panel-switcher-btn');
    mainEl.setAttribute('data-active-panel', panelName);
    switcherButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.panel === panelName);
    });
    if (panelName === 'editor' && state.editorReady && state.editor) {
        requestAnimationFrame(() => { state.editor.layout(); });
    }
}
