// ============================================================
// Zen / Focus Mode
// ============================================================

import { state } from './state.js';

let _zenSavedPanelWidths = null;
let _wbZenSavedState = null;

// Dependency injection for cross-module references
let _deps = {
    settingsManager: null,
    runCode: null,
    submitCode: null,
    requestHint: null,
    sendWhiteboardToTutor: null,
};

function configureZenDeps({ settingsManager, runCode, submitCode, requestHint, sendWhiteboardToTutor }) {
    if (settingsManager !== undefined) _deps.settingsManager = settingsManager;
    if (runCode !== undefined) _deps.runCode = runCode;
    if (submitCode !== undefined) _deps.submitCode = submitCode;
    if (requestHint !== undefined) _deps.requestHint = requestHint;
    if (sendWhiteboardToTutor !== undefined) _deps.sendWhiteboardToTutor = sendWhiteboardToTutor;
}

function shouldReduceMotion() {
    const setting = _deps.settingsManager.get('reducedMotion');
    if (setting === 'on') return true;
    if (setting === 'off') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function toggleZenMode() {
    const current = _deps.settingsManager.get('zenMode');
    _deps.settingsManager.set('zenMode', !current);
}

function applyZenMode(enabled) {
    const body = document.body;
    const zenBar = document.getElementById('zen-status-bar');

    if (enabled) {
        // Save panel widths before entering zen mode
        const problemPanel = document.getElementById('problem-panel');
        const rightPanel = document.querySelector('.right-panel');
        _zenSavedPanelWidths = {
            problem: problemPanel ? problemPanel.getBoundingClientRect().width : 350,
            chat: rightPanel ? rightPanel.getBoundingClientRect().width : 350,
        };

        if (shouldReduceMotion()) {
            body.classList.add('zen-mode', 'zen-no-transition');
        } else {
            body.classList.remove('zen-no-transition');
            body.classList.add('zen-mode');
        }

        // Update zen status bar content
        updateZenStatusBar();
        if (zenBar) zenBar.classList.remove('hidden');
    } else {
        body.classList.remove('zen-mode', 'zen-no-transition');
        if (zenBar) zenBar.classList.add('hidden');

        // Restore panel widths; reset test-results to CSS defaults
        if (_zenSavedPanelWidths) {
            const problemPanel = document.getElementById('problem-panel');
            const rightPanel = document.querySelector('.right-panel');
            if (problemPanel) problemPanel.style.width = _zenSavedPanelWidths.problem + 'px';
            if (rightPanel) rightPanel.style.width = _zenSavedPanelWidths.chat + 'px';
            _zenSavedPanelWidths = null;
        }
        const testResults = document.getElementById('test-results');
        if (testResults) {
            testResults.style.height = '';
            testResults.style.maxHeight = '';
        }
    }
}

function updateZenStatusBar() {
    const titleEl = document.getElementById('zen-problem-title');
    const timerEl = document.getElementById('zen-timer-display');
    if (titleEl) {
        titleEl.textContent = state.currentProblem ? state.currentProblem.title : 'No problem selected';
    }
    if (timerEl) {
        if (state.mode === 'interview' && state.timeRemaining > 0) {
            const minutes = Math.floor(state.timeRemaining / 60);
            const seconds = state.timeRemaining % 60;
            timerEl.textContent = minutes + ':' + seconds.toString().padStart(2, '0');
            timerEl.parentElement.classList.remove('hidden');
        } else {
            timerEl.parentElement.classList.add('hidden');
        }
    }
}

// --- Whiteboard Zen Mode ---

function toggleWhiteboardZen() {
    const isActive = document.body.classList.contains('zen-whiteboard');
    applyWhiteboardZen(!isActive);
}

function applyWhiteboardZen(enabled) {
    const body = document.body;
    const zenBar = document.getElementById('zen-status-bar');
    const wbSection = document.getElementById('whiteboard-section');

    if (enabled) {
        // Exit editor zen if active
        if (_deps.settingsManager.get('zenMode')) {
            _deps.settingsManager.set('zenMode', false);
        }

        // Save state
        const problemPanel = document.getElementById('problem-panel');
        const rightPanel = document.querySelector('.right-panel');
        _wbZenSavedState = {
            problemWidth: problemPanel ? problemPanel.getBoundingClientRect().width : 350,
            chatWidth: rightPanel ? rightPanel.getBoundingClientRect().width : 350,
            whiteboardCollapsed: wbSection ? wbSection.classList.contains('collapsed') : true,
            whiteboardHeight: wbSection ? wbSection.style.height : '',
        };

        // Expand whiteboard if collapsed
        if (wbSection && wbSection.classList.contains('collapsed')) {
            wbSection.classList.remove('collapsed');
        }
        if (wbSection) wbSection.style.height = '';

        if (shouldReduceMotion()) {
            body.classList.add('zen-whiteboard', 'zen-no-transition');
        } else {
            body.classList.remove('zen-no-transition');
            body.classList.add('zen-whiteboard');
        }

        // Show zen bar with whiteboard actions
        updateZenStatusBar();
        if (zenBar) zenBar.classList.remove('hidden');
    } else {
        body.classList.remove('zen-whiteboard', 'zen-no-transition');
        if (zenBar) zenBar.classList.add('hidden');

        // Restore state
        if (_wbZenSavedState) {
            const problemPanel = document.getElementById('problem-panel');
            const rightPanel = document.querySelector('.right-panel');
            if (problemPanel) problemPanel.style.width = _wbZenSavedState.problemWidth + 'px';
            if (rightPanel) rightPanel.style.width = _wbZenSavedState.chatWidth + 'px';
            if (wbSection) {
                if (_wbZenSavedState.whiteboardCollapsed) {
                    wbSection.classList.add('collapsed');
                    wbSection.style.height = '';
                } else if (_wbZenSavedState.whiteboardHeight) {
                    wbSection.style.height = _wbZenSavedState.whiteboardHeight;
                }
            }
            _wbZenSavedState = null;
        }
    }
}

function initZenMode() {
    const zenToggleBtn = document.getElementById('zen-toggle-btn');

    // Wire onChange to apply zen mode and sync button state
    _deps.settingsManager.onChange('zenMode', (enabled) => {
        // Exit whiteboard zen if entering editor zen
        if (enabled && document.body.classList.contains('zen-whiteboard')) {
            applyWhiteboardZen(false);
        }
        applyZenMode(enabled);
        if (zenToggleBtn) zenToggleBtn.classList.toggle('active', enabled);
    });

    // Apply on load if already enabled
    if (_deps.settingsManager.get('zenMode')) {
        applyZenMode(true);
        if (zenToggleBtn) zenToggleBtn.classList.add('active');
    }

    // Wire the actions-bar zen toggle button
    if (zenToggleBtn) zenToggleBtn.addEventListener('click', toggleZenMode);

    // Wire zen status bar buttons — editor
    const zenRunBtn = document.getElementById('zen-run-btn');
    const zenSubmitBtn = document.getElementById('zen-submit-btn');
    const zenHintBtn = document.getElementById('zen-hint-btn');
    const zenExitBtn = document.getElementById('zen-exit-btn');

    if (zenRunBtn) zenRunBtn.addEventListener('click', _deps.runCode);
    if (zenSubmitBtn) zenSubmitBtn.addEventListener('click', _deps.submitCode);
    if (zenHintBtn) zenHintBtn.addEventListener('click', _deps.requestHint);
    if (zenExitBtn) zenExitBtn.addEventListener('click', () => _deps.settingsManager.set('zenMode', false));

    // Wire zen status bar buttons — whiteboard
    const zenWbSendBtn = document.getElementById('zen-wb-send-btn');
    const zenWbClearBtn = document.getElementById('zen-wb-clear-btn');
    const zenWbExitBtn = document.getElementById('zen-wb-exit-btn');

    if (zenWbSendBtn) zenWbSendBtn.addEventListener('click', () => {
        if (_deps.sendWhiteboardToTutor) _deps.sendWhiteboardToTutor();
    });
    if (zenWbClearBtn) zenWbClearBtn.addEventListener('click', () => {
        if (window.excalidrawBridge) window.excalidrawBridge.clear();
    });
    if (zenWbExitBtn) zenWbExitBtn.addEventListener('click', () => applyWhiteboardZen(false));

    // Wire whiteboard toolbar zen button
    const wbZenBtn = document.getElementById('whiteboard-zen-btn');
    if (wbZenBtn) wbZenBtn.addEventListener('click', toggleWhiteboardZen);

    // Keyboard shortcut: Ctrl+Shift+Z / Cmd+Shift+Z — editor zen
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            toggleZenMode();
        }
        // Ctrl+Shift+W / Cmd+Shift+W — whiteboard zen
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            toggleWhiteboardZen();
        }
    });
}

export {
    shouldReduceMotion,
    toggleZenMode,
    applyZenMode,
    toggleWhiteboardZen,
    applyWhiteboardZen,
    updateZenStatusBar,
    initZenMode,
    configureZenDeps,
};
