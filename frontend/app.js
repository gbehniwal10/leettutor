// ============================================================
// LeetCode Tutor — Application Orchestrator
// Imports all modules, wires dependencies, and bootstraps the app.
// ============================================================

import { state } from './modules/state.js';
import { FONT_FAMILY_MAP, THEME_TO_MONACO, MODES } from './modules/constants.js';

// --- Core modules ---
import { settingsManager, showSettingsModal, hideSettingsModal, initSettingsControls, applyEditorSettings, registerMonacoThemes, initThemeSystem, shouldReduceMotion } from './modules/settings.js';
import { initWebSocket, wsSend, setMessageHandler, setAuthErrorHandler } from './modules/websocket.js';
import { checkAuth, showLoginModal } from './modules/auth.js';
import { getEditorValue, runCode, submitCode, displayTestResults, configureCodeRunnerDeps } from './modules/code-runner.js';
import { configureChatDeps, handleWebSocketMessage, requestHint, sendMessage, addChatMessage } from './modules/chat.js';
import { configureProblemsDeps, loadProblems, initProblemFilters, selectProblem, showProblemModal, hideProblemModal, toggleProblemPanel, startSession } from './modules/problems.js';

// --- Session management ---
import { configureSessionDeps, resumeSession, clearResumeState, handleSessionResumed, updateModeUI, startTimer, onTimeUpdate } from './modules/session.js';

// --- Feature modules ---
import { configureHistoryDeps, showHistoryModal, hideHistoryModal, loadSessions } from './modules/session-history.js';
import { configureQuizDeps, selectRandomProblem, resetPatternQuiz } from './modules/pattern-quiz.js';
import { initResizeHandles } from './modules/panel-resizer.js';
import { initZenMode, configureZenDeps } from './modules/zen-mode.js';
import { configureTypographyDeps, initTypography } from './modules/typography.js';
import { configureDialogDeps, showConfirmDialog, resetCodeWithConfirm, restartSessionWithConfirm, endSession, initFrictionDialogs } from './modules/friction-dialogs.js';
import { configureInactivityDeps, initInactivityNudges, getDetector } from './modules/inactivity.js';
import { configureAudioDeps, initAmbientSound, initEarcons, connectEarconObserver, disconnectEarconObserver } from './modules/audio.js';
import { configureFeedbackDeps, initMicroFeedback } from './modules/test-feedback.js';
import { initTTS, connectTtsObserver, disconnectTtsObserver } from './modules/tts.js';
import { configureStreakDeps, initStreakSystem } from './modules/streak.js';
import { configureWhiteboardDeps, initWhiteboard, initPanelSwitcher, getWhiteboardSaveTimeout, clearWhiteboardSaveTimeout, sendWhiteboardToTutor } from './modules/whiteboard.js';
import { configureRandomPickerDeps, initRandomPicker } from './modules/random-picker.js';
import { configureSkillTreeDeps, initSkillTree } from './modules/skill-tree.js';

// ============================================================
// Wire dependencies
// ============================================================

configureChatDeps({
    wsSend,
    getEditorValue,
    onSessionStarted: null,       // set below after session module is configured
    onSessionResumed: handleSessionResumed,
    onTimeUpdate,
});

configureSessionDeps({
    wsSend,
    addChatMessage,
    getEditorValue,
    settingsManager,
    connectEarconObserver,
    connectTtsObserver,
    toggleProblemPanel,
    resetPatternQuiz,
});

configureProblemsDeps({
    wsSend,
    addChatMessage,
    showConfirmDialog: null, // set below after dialog module
    endSession,
    resumeSession,
    clearResumeState,
    resetPatternQuiz,
    startTimer,
    connectEarconObserver,
    connectTtsObserver,
    getEditorValue,
    settingsManager,
    getInactivityDetector: getDetector,
    getWhiteboardSaveTimeout,
    setWhiteboardSaveTimeout: clearWhiteboardSaveTimeout,
});

configureHistoryDeps({ resumeSession });
configureQuizDeps({ selectProblem });
configureDialogDeps({
    settingsManager,
    getEditorValue,
    wsSend,
    addChatMessage,
    startSession,
    disconnectEarconObserver,
    disconnectTtsObserver,
});
configureInactivityDeps({ settingsManager, wsSend, addChatMessage, getEditorValue });
configureAudioDeps({ settingsManager });
configureFeedbackDeps({ shouldReduceMotion });
configureTypographyDeps({ settingsManager, applyEditorSettings });
configureWhiteboardDeps({ wsSend, getEditorValue, addChatMessage });
configureStreakDeps({ addChatMessage });
configureZenDeps({ settingsManager, runCode, submitCode, requestHint, sendWhiteboardToTutor });
configureCodeRunnerDeps({ wsSend });
configureRandomPickerDeps({ selectProblem });
configureSkillTreeDeps({ selectProblem, settingsManager });

// Wire up showConfirmDialog into problems deps (imported above with friction-dialogs)
configureProblemsDeps({ showConfirmDialog });

// Wire WebSocket message handler
setMessageHandler(handleWebSocketMessage);
setAuthErrorHandler(showLoginModal);

// ============================================================
// Monaco Editor initialization
// ============================================================

function initMonacoEditor() {
    // Monaco uses AMD require() loaded via <script> tag
    // eslint-disable-next-line no-undef
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

    // eslint-disable-next-line no-undef
    require(['vs/editor/editor.main'], function () {
        registerMonacoThemes();
        const s = settingsManager.getAll();
        const initialMonacoTheme = THEME_TO_MONACO[s.theme] || 'leetcode-dark';
        // eslint-disable-next-line no-undef
        state.editor = monaco.editor.create(document.getElementById('editor'), {
            value: '# Select a problem to begin',
            language: 'python',
            theme: initialMonacoTheme,
            fontSize: s.editorFontSize,
            fontFamily: FONT_FAMILY_MAP[s.editorFontFamily] || FONT_FAMILY_MAP['default'],
            lineHeight: Math.round(s.editorFontSize * s.editorLineHeight),
            fontLigatures: s.editorLigatures,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
        });
        state.editorReady = true;
        applyEditorSettings();
        console.log('Monaco editor ready');
    });
}

// ============================================================
// Event listeners
// ============================================================

function initEventListeners() {
    document.getElementById('mode-select').addEventListener('change', (e) => { state.mode = e.target.value; updateModeUI(); });
    document.getElementById('new-problem-btn').addEventListener('click', showProblemModal);
    document.getElementById('close-modal').addEventListener('click', hideProblemModal);
    document.getElementById('problem-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hideProblemModal();
    });
    document.getElementById('toggle-problem').addEventListener('click', toggleProblemPanel);
    document.getElementById('expand-problem').addEventListener('click', toggleProblemPanel);
    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('submit-btn').addEventListener('click', submitCode);
    document.getElementById('reset-btn').addEventListener('click', () => resetCodeWithConfirm());
    document.getElementById('restart-btn').addEventListener('click', () => restartSessionWithConfirm());
    document.getElementById('hint-btn').addEventListener('click', requestHint);
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('history-btn').addEventListener('click', showHistoryModal);
    document.getElementById('close-history').addEventListener('click', hideHistoryModal);
    document.getElementById('history-back').addEventListener('click', loadSessions);
    document.getElementById('enhanced-mode-checkbox').addEventListener('change', (e) => {
        state.enhancedMode = e.target.checked;
    });
    document.getElementById('next-problem-btn').addEventListener('click', selectRandomProblem);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Settings panel
    document.getElementById('settings-btn').addEventListener('click', showSettingsModal);
    document.getElementById('close-settings').addEventListener('click', hideSettingsModal);
    document.getElementById('settings-reset-all').addEventListener('click', () => {
        settingsManager.resetAll();
    });
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hideSettingsModal();
    });
    document.querySelectorAll('.settings-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const expanded = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', String(!expanded));
            header.nextElementSibling.classList.toggle('collapsed', expanded);
        });
    });
    initSettingsControls();

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const problemModal = document.getElementById('problem-modal');
            const historyModal = document.getElementById('history-modal');
            const settingsModal = document.getElementById('settings-modal');
            if (problemModal && !problemModal.classList.contains('hidden')) hideProblemModal();
            else if (historyModal && !historyModal.classList.contains('hidden')) hideHistoryModal();
            else if (settingsModal && !settingsModal.classList.contains('hidden')) hideSettingsModal();
            return;
        }
        if (document.activeElement === document.getElementById('chat-input')) return;
        if (e.ctrlKey && e.shiftKey && e.key === 'Enter') { e.preventDefault(); submitCode(); }
        else if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runCode(); }
        else if (e.ctrlKey && e.key === 'h') { e.preventDefault(); requestHint(); }
    });
}

// ============================================================
// Bootstrap
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    initMonacoEditor();
    initWebSocket();
    initEventListeners();
    loadProblems();

    // Feature module initialization
    initThemeSystem();
    initResizeHandles();
    initZenMode();
    initTypography();
    initFrictionDialogs();
    initInactivityNudges();
    initAmbientSound();
    initEarcons();
    initMicroFeedback();
    initTTS();
    initStreakSystem();
    initWhiteboard();
    initPanelSwitcher();
    initRandomPicker();
    initSkillTree();
});
