// Session management — timer, resume, mode switching.
// These functions cross-cut multiple modules and need access to wsSend, chat, etc.

import { state } from './state.js';
import { MODES, WS_MESSAGE_TYPES, INTERVIEW_DURATION_SECS } from './constants.js';
import { renderMarkdown, setSessionHash, clearSessionHash } from './utils.js';

// --- Dependency injection ---
let _deps = {
    wsSend: null,
    addChatMessage: null,
    getEditorValue: null,
    settingsManager: null,
    connectEarconObserver: null,
    connectTtsObserver: null,
    toggleProblemPanel: null,
    resetPatternQuiz: null,
};
let _placeholderDisposable = null;

export function configureSessionDeps(deps) {
    Object.assign(_deps, deps);
}

// --- Timer ---

function updateTimerDisplay() {
    const minutes = Math.floor(state.timeRemaining / 60);
    const seconds = state.timeRemaining % 60;
    document.getElementById('timer-display').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const timer = document.getElementById('timer');
    timer.classList.remove('warning', 'danger');
    if (state.timeRemaining <= 300) timer.classList.add('danger');
    else if (state.timeRemaining <= 600) timer.classList.add('warning');
}

function handleTimeUp() {
    _deps.addChatMessage('system', "Time's up! Moving to review phase.");
    _deps.wsSend({ type: WS_MESSAGE_TYPES.TIME_UP, code: _deps.getEditorValue() });
}

export function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
    state.timeRemaining = INTERVIEW_DURATION_SECS;
    state.inReview = false;
    document.getElementById('timer').classList.remove('hidden');
    updateTimerDisplay();
    state.timerInterval = setInterval(() => {
        state.timeRemaining--;
        updateTimerDisplay();
        if (state.timeRemaining <= 0) {
            clearInterval(state.timerInterval);
            clearInterval(state.timeSyncInterval);
            handleTimeUp();
        }
    }, 1000);
    state.timeSyncInterval = setInterval(() => {
        _deps.wsSend({ type: WS_MESSAGE_TYPES.TIME_UPDATE, time_remaining: state.timeRemaining });
    }, 30000);
}

export function startTimerFromRemaining(seconds) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
    state.timeRemaining = seconds;
    state.inReview = false;
    document.getElementById('timer').classList.remove('hidden');
    updateTimerDisplay();
    state.timerInterval = setInterval(() => {
        state.timeRemaining--;
        updateTimerDisplay();
        if (state.timeRemaining <= 0) {
            clearInterval(state.timerInterval);
            clearInterval(state.timeSyncInterval);
            handleTimeUp();
        }
    }, 1000);
    state.timeSyncInterval = setInterval(() => {
        _deps.wsSend({ type: WS_MESSAGE_TYPES.TIME_UPDATE, time_remaining: state.timeRemaining });
    }, 30000);
}

// --- Resume ---

export function clearResumeState() {
    state.resuming = false;
    if (state.resumeTimeoutId !== null) {
        clearTimeout(state.resumeTimeoutId);
        state.resumeTimeoutId = null;
    }
}

export function resumeSession(sessionId) {
    if (state.resuming) return;
    state.resuming = true;
    _deps.addChatMessage('system', 'Resuming session...');
    _deps.wsSend({ type: WS_MESSAGE_TYPES.RESUME_SESSION, session_id: sessionId });
    if (_deps.settingsManager.get('earcons')) {
        _deps.connectEarconObserver();
    }
    _deps.connectTtsObserver();
    if (state.resumeTimeoutId !== null) clearTimeout(state.resumeTimeoutId);
    state.resumeTimeoutId = setTimeout(() => {
        if (state.resuming) {
            state.resuming = false;
            state.resumeTimeoutId = null;
            _deps.addChatMessage('system', 'Resume timed out. You can start a new session.');
        }
    }, 10000);
}

export async function handleSessionResumed(data) {
    clearResumeState();
    state.sessionId = data.session_id;
    state.mode = data.mode;
    state.inReview = false;
    setSessionHash(data.session_id);

    const modeSelect = document.getElementById('mode-select');
    if (modeSelect) modeSelect.value = data.mode;
    updateModeUI();

    if (!state.currentProblem || state.currentProblem.id !== data.problem_id) {
        try {
            const response = await fetch(`/api/problems/${data.problem_id}`);
            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            state.currentProblem = await response.json();
        } catch (e) {
            console.error('Failed to load problem for resumed session:', e);
            _deps.addChatMessage('system', 'Failed to load problem data.');
            return;
        }
    }

    document.getElementById('problem-title').textContent = state.currentProblem.title;
    document.getElementById('problem-difficulty').textContent = state.currentProblem.difficulty;
    document.getElementById('problem-difficulty').className = `difficulty ${state.currentProblem.difficulty}`;
    const solvedBadge = document.getElementById('problem-solved-badge');
    const probEntry = state.allProblems.find(p => p.id === state.currentProblem.id);
    if (probEntry && probEntry.status === 'solved') solvedBadge.classList.remove('hidden');
    else solvedBadge.classList.add('hidden');
    document.getElementById('problem-description').innerHTML = renderMarkdown(state.currentProblem.description);
    const panel = document.getElementById('problem-panel');
    if (panel.classList.contains('collapsed')) _deps.toggleProblemPanel();

    if (_placeholderDisposable) { _placeholderDisposable.dispose(); _placeholderDisposable = null; }
    if (data.last_editor_code && state.editorReady && state.editor) {
        state.editor.setValue(data.last_editor_code);
    } else if (state.editorReady && state.editor) {
        state.editor.setValue(state.currentProblem.starter_code);
        // Remove placeholder on first click into the editor
        if (state.editor.getValue().includes('# Your code here')) {
            _placeholderDisposable = state.editor.onDidFocusEditorText(() => {
                const val = state.editor.getValue();
                const cleaned = val.replace('    # Your code here\n    pass\n', '    \n');
                if (cleaned !== val) {
                    state.editor.setValue(cleaned);
                    const lines = cleaned.split('\n');
                    const idx = lines.findIndex(l => l === '    ');
                    if (idx >= 0) state.editor.setPosition({ lineNumber: idx + 1, column: 5 });
                }
                if (_placeholderDisposable) { _placeholderDisposable.dispose(); _placeholderDisposable = null; }
            });
        }
    }

    document.getElementById('test-results').innerHTML = '';

    const chatContainer = document.getElementById('chat-messages');
    chatContainer.innerHTML = '';
    _deps.addChatMessage('system', `Resumed session for "${state.currentProblem.title}" (${data.mode} mode)`);
    const history = data.chat_history || [];
    for (const msg of history) {
        const role = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system';
        _deps.addChatMessage(role, msg.content);
    }

    if (data.mode === MODES.INTERVIEW) {
        if (data.interview_phase === 'review') {
            state.inReview = true;
            document.getElementById('timer').classList.add('hidden');
            _deps.addChatMessage('system', 'Review phase.');
        } else if (data.time_remaining && data.time_remaining > 0) {
            startTimerFromRemaining(data.time_remaining);
        } else {
            startTimer();
        }
    }

    if (data.whiteboard_state && window.excalidrawBridge && window.excalidrawBridge.restoreState) {
        window.excalidrawBridge.restoreState(data.whiteboard_state);
    } else if (window.excalidrawBridge && window.excalidrawBridge.clear) {
        window.excalidrawBridge.clear();
    }
}

// --- Mode UI ---

export function updateModeUI() {
    const isQuiz = state.mode === MODES.PATTERN_QUIZ;
    const editorSection = document.querySelector('.editor-section');
    const actions = document.querySelector('.actions');
    const resultsResize = document.getElementById('results-resize');
    const testResults = document.getElementById('test-results');
    const rightPanel = document.querySelector('.right-panel');
    const chatResize = document.getElementById('chat-panel-resize');
    const quizPanel = document.getElementById('pattern-quiz-panel');
    const enhancedToggle = document.getElementById('enhanced-toggle');

    if (isQuiz) {
        if (editorSection) editorSection.classList.add('hidden');
        if (actions) actions.classList.add('hidden');
        if (resultsResize) resultsResize.classList.add('hidden');
        if (testResults) testResults.classList.add('hidden');
        if (rightPanel) rightPanel.classList.add('hidden');
        if (chatResize) chatResize.classList.add('hidden');
        if (quizPanel) quizPanel.classList.remove('hidden');
        if (enhancedToggle) enhancedToggle.classList.remove('hidden');
        document.getElementById('timer').classList.add('hidden');
        if (state.timerInterval) clearInterval(state.timerInterval);
        if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
        _deps.resetPatternQuiz();
    } else {
        if (editorSection) editorSection.classList.remove('hidden');
        if (actions) actions.classList.remove('hidden');
        if (resultsResize) resultsResize.classList.remove('hidden');
        if (testResults) testResults.classList.remove('hidden');
        if (rightPanel) rightPanel.classList.remove('hidden');
        if (chatResize) chatResize.classList.remove('hidden');
        if (quizPanel) quizPanel.classList.add('hidden');
        if (enhancedToggle) enhancedToggle.classList.add('hidden');
        if (state.mode === MODES.LEARNING) {
            document.getElementById('timer').classList.add('hidden');
            if (state.timerInterval) clearInterval(state.timerInterval);
            if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
        }
    }
}

// --- Time update handler (for chat module) ---

export function onTimeUpdate(data) {
    if (data.time_remaining !== undefined) {
        state.timeRemaining = data.time_remaining;
        updateTimerDisplay();
    }
}
