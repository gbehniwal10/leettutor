// Problems module — loading, filtering, rendering, selection, and session start.

import { state } from './state.js';
import { MODES } from './constants.js';
import { authHeaders, handleAuthError, trapFocus, releaseFocus, timeAgo } from './utils.js';
import { escapeHtml, renderMarkdown, clearSessionHash } from './utils.js';
import { eventBus, Events } from './event-bus.js';
import { renderCategoryList } from './category-list.js';
import { setSkillTreeCategories } from './skill-tree.js';
import { syncFromBackend } from './progress.js';

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

let savedProblemPanelWidth = 350;
let _selectProblemLoading = false;
let _problemFiltersInitialized = false;
let _placeholderDisposable = null;

/** Skill tree categories from the server. */
let _skillTreeCategories = [];

// ---------------------------------------------------------------------------
// Dependency injection — set via configureProblemsDeps()
// ---------------------------------------------------------------------------

let _deps = {
    wsSend: null,
    addChatMessage: null,
    showConfirmDialog: null,
    endSession: null,
    resumeSession: null,
    clearResumeState: null,
    resetPatternQuiz: null,
    startTimer: null,
    connectEarconObserver: null,
    connectTtsObserver: null,
    getEditorValue: null,
    settingsManager: null,
    getInactivityDetector: null,
    getWhiteboardSaveTimeout: null,
    setWhiteboardSaveTimeout: null,
    updateSolutionBadge: null,
    closeDrawer: null,
    getAutosave: null,
    clearAutosave: null,
};

export function configureProblemsDeps(deps) {
    Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// loadProblems — fetches /api/problems and /api/skill-tree in parallel
// ---------------------------------------------------------------------------

export async function loadProblems() {
    try {
        const [problemsRes, skillTreeRes, reviewRes] = await Promise.all([
            fetch('/api/problems', { headers: authHeaders() }),
            fetch('/api/skill-tree', { headers: authHeaders() }),
            fetch('/api/review-queue', { headers: authHeaders() }).catch(() => null),
        ]);
        if (!problemsRes.ok) throw new Error(`Problems: ${problemsRes.status}`);
        state.allProblems = await problemsRes.json();
        syncFromBackend(state.allProblems);

        if (skillTreeRes.ok) {
            const tree = await skillTreeRes.json();
            _skillTreeCategories = tree.categories || [];
        } else {
            console.warn('Skill tree unavailable, falling back to flat list');
            _skillTreeCategories = [];
        }
        setSkillTreeCategories(_skillTreeCategories);

        // Load review queue for spaced review badges
        if (reviewRes && reviewRes.ok) {
            state.reviewQueue = await reviewRes.json();
        } else {
            state.reviewQueue = null;
        }

        _renderCurrentList();
        initProblemFilters();
        eventBus.on(Events.PROBLEM_SOLVED, ({ problemId }) => {
            const entry = state.allProblems.find(p => p.id === problemId);
            if (entry) entry.status = 'solved';
            // Update badge immediately if this is the current problem
            if (state.currentProblem && state.currentProblem.id === problemId) {
                const badge = document.getElementById('problem-solved-badge');
                if (badge) badge.classList.remove('hidden');
            }
            _renderCurrentList();
            // Refresh review queue in background (topics may have advanced)
            _refreshReviewQueue();
        });
    } catch (error) {
        console.error('Failed to load problems:', error);
        const container = document.getElementById('problem-list');
        if (container) container.innerHTML =
            '<p style="color:var(--accent-red);padding:16px;">Failed to load problems. Please refresh.</p>';
    }
}

// ---------------------------------------------------------------------------
// initProblemFilters — wires up search + difficulty/status tab listeners (once)
// ---------------------------------------------------------------------------

export function initProblemFilters() {
    if (_problemFiltersInitialized) return;
    _problemFiltersInitialized = true;
    document.getElementById('problem-search').addEventListener('input', filterProblems);
    document.querySelectorAll('.difficulty-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.difficulty-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterProblems();
        });
    });
    document.querySelectorAll('.status-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterProblems();
        });
    });
}

// ---------------------------------------------------------------------------
// _refreshReviewQueue — re-fetches /api/review-queue in background
// ---------------------------------------------------------------------------

async function _refreshReviewQueue() {
    try {
        const res = await fetch('/api/review-queue', { headers: authHeaders() });
        if (res.ok) {
            state.reviewQueue = await res.json();
            _renderCurrentList();
        }
    } catch {
        // Non-critical — silently ignore
    }
}

// ---------------------------------------------------------------------------
// filterProblems — applies search + difficulty + status filters
// ---------------------------------------------------------------------------

function filterProblems() {
    const search = (document.getElementById('problem-search').value || '').toLowerCase();
    const difficulty = document.querySelector('.difficulty-tab.active')?.dataset.difficulty || 'all';
    const statusFilter = document.querySelector('.status-tab.active')?.dataset.status || 'all';
    const filtered = state.allProblems.filter(p => {
        if (difficulty !== 'all' && p.difficulty !== difficulty) return false;
        if (statusFilter !== 'all' && (p.status || 'unsolved') !== statusFilter) return false;
        if (search && !p.title.toLowerCase().includes(search) &&
            !p.tags.some(t => t.includes(search))) return false;
        return true;
    });
    const container = document.getElementById('problem-list');
    renderCategoryList(container, state.allProblems, filtered, _skillTreeCategories, selectProblem, _renderCurrentList);
}

function _renderCurrentList() {
    filterProblems();
}

// ---------------------------------------------------------------------------
// showResumeDialog — internal helper for selectProblem
// ---------------------------------------------------------------------------

function showResumeDialog(prevSession) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('resume-dialog');
        const textEl = document.getElementById('resume-dialog-text');
        const modeEl = document.getElementById('resume-dialog-mode');
        const resumeBtn = document.getElementById('resume-dialog-resume');
        const freshBtn = document.getElementById('resume-dialog-fresh');
        const triggerEl = document.activeElement;

        textEl.innerHTML = `You have a previous session from <strong>${timeAgo(prevSession.started_at)}</strong>`;
        if (prevSession.mode !== state.mode) {
            modeEl.textContent = `Previous session was in ${prevSession.mode} mode`;
            modeEl.classList.remove('hidden');
        } else {
            modeEl.classList.add('hidden');
        }

        dialog.classList.remove('hidden');
        resumeBtn.focus();

        function cleanup(result) {
            dialog.classList.add('hidden');
            resumeBtn.removeEventListener('click', onResume);
            freshBtn.removeEventListener('click', onFresh);
            document.removeEventListener('keydown', onKey, true);
            try { if (triggerEl) triggerEl.focus(); } catch (e) { /* element may be gone */ }
            resolve(result);
        }
        function onResume() { cleanup('resume'); }
        function onFresh() { cleanup('fresh'); }
        function onKey(e) {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                cleanup('cancel');
            } else if (e.key === 'Tab') {
                const focusable = [resumeBtn, freshBtn];
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        resumeBtn.addEventListener('click', onResume);
        freshBtn.addEventListener('click', onFresh);
        document.addEventListener('keydown', onKey, true);
    });
}

// ---------------------------------------------------------------------------
// selectProblem — fetches problem detail, checks for resumable session, starts
// ---------------------------------------------------------------------------

export async function selectProblem(problemId) {
    if (_selectProblemLoading) return;
    _selectProblemLoading = true;

    const currentSolved = state.currentProblem &&
        state.allProblems.find(p => p.id === state.currentProblem.id)?.status === 'solved';

    if (state.sessionId && !currentSolved && _deps.settingsManager.get('confirmDestructive')) {
        const problemTitle = state.currentProblem ? state.currentProblem.title : 'this problem';
        const confirmed = await _deps.showConfirmDialog({
            title: 'Switch problems?',
            message: 'End your session on "' + problemTitle + '" and switch to a new problem?',
            detail: 'Your progress will be saved. You can resume later from history.',
            confirmLabel: 'Switch',
            cancelLabel: 'Keep Going',
        });
        if (!confirmed) { _selectProblemLoading = false; return; }
        _deps.endSession();
    }

    try {
        const response = await fetch(`/api/problems/${problemId}`);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        state.currentProblem = await response.json();
    } catch (error) {
        console.error('Failed to fetch problem:', error);
        _selectProblemLoading = false;
        return;
    }

    if (state.mode !== MODES.PATTERN_QUIZ) {
        try {
            const res = await fetch(
                `/api/sessions/latest-resumable?problem_id=${encodeURIComponent(problemId)}`,
                { headers: authHeaders() },
            );
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const prevSession = await res.json();
            if (prevSession && prevSession.session_id) {
                const choice = await showResumeDialog(prevSession);
                if (choice === 'resume') {
                    hideProblemModal();
                    _deps.resumeSession(prevSession.session_id);
                    _selectProblemLoading = false;
                    return;
                }
                if (choice === 'cancel') { _selectProblemLoading = false; return; }
            }
        } catch (err) {
            console.warn('Failed to check for resumable session:', err);
        }
    }

    _applyProblemToUI();
    _selectProblemLoading = false;
}

function _applyProblemToUI() {
    document.getElementById('problem-title').textContent = state.currentProblem.title;
    document.getElementById('problem-difficulty').textContent = state.currentProblem.difficulty;
    document.getElementById('problem-difficulty').className = `difficulty ${state.currentProblem.difficulty}`;
    const solvedBadge = document.getElementById('problem-solved-badge');
    const probEntry = state.allProblems.find(p => p.id === state.currentProblem.id);
    if (probEntry && probEntry.status === 'solved') solvedBadge.classList.remove('hidden');
    else solvedBadge.classList.add('hidden');

    // Close solution drawer from previous problem, update badge count
    if (_deps.closeDrawer) _deps.closeDrawer();
    if (_deps.updateSolutionBadge) _deps.updateSolutionBadge(state.currentProblem.id);
    document.getElementById('problem-description').innerHTML = renderMarkdown(state.currentProblem.description);

    const panel = document.getElementById('problem-panel');
    if (panel.classList.contains('collapsed')) toggleProblemPanel();

    if (state.editorReady && state.editor) {
        state.editor.setValue(state.currentProblem.starter_code);

        // Restore from localStorage autosave if available and meaningful
        if (_deps.getAutosave) {
            const saved = _deps.getAutosave(state.currentProblem.id);
            if (saved && saved.code && saved.code !== state.currentProblem.starter_code) {
                state.editor.setValue(saved.code);
            }
        }

        if (_placeholderDisposable) { _placeholderDisposable.dispose(); _placeholderDisposable = null; }
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
    hideProblemModal();

    const inactivityDetector = _deps.getInactivityDetector ? _deps.getInactivityDetector() : null;
    if (inactivityDetector) inactivityDetector.suppressed = false;
    if (state.mode === MODES.PATTERN_QUIZ) {
        clearSessionHash();
        _deps.resetPatternQuiz();
    } else {
        startSession();
    }
}

// ---------------------------------------------------------------------------
// showProblemModal / hideProblemModal
// ---------------------------------------------------------------------------

export function showProblemModal() {
    const modal = document.getElementById('problem-modal');
    const backdrop = document.getElementById('problem-backdrop');
    modal.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    const search = document.getElementById('problem-search');
    if (search) search.value = '';
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    const allDiff = document.querySelector('.filter-tab[data-difficulty="all"]');
    if (allDiff) allDiff.classList.add('active');
    const allStatus = document.querySelector('.status-tab[data-status="all"]');
    if (allStatus) allStatus.classList.add('active');
    _renderCurrentList();
    trapFocus(modal);
}

export function hideProblemModal() {
    const modal = document.getElementById('problem-modal');
    const backdrop = document.getElementById('problem-backdrop');
    modal.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    releaseFocus();
}

// ---------------------------------------------------------------------------
// toggleProblemPanel
// ---------------------------------------------------------------------------

export function toggleProblemPanel() {
    const panel = document.getElementById('problem-panel');
    const expandBtn = document.getElementById('expand-problem');
    const toggleBtn = document.getElementById('toggle-problem');
    const resizeHandle = document.getElementById('problem-panel-resize');
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        panel.style.width = savedProblemPanelWidth + 'px';
        expandBtn.style.display = 'none';
        resizeHandle.style.display = '';
        if (toggleBtn) { toggleBtn.title = 'Collapse problem panel'; toggleBtn.setAttribute('aria-label', 'Collapse problem panel'); }
    } else {
        savedProblemPanelWidth = panel.getBoundingClientRect().width || 350;
        panel.classList.add('collapsed');
        panel.style.width = '0';
        expandBtn.style.display = 'block';
        resizeHandle.style.display = 'none';
        if (toggleBtn) { toggleBtn.title = 'Expand problem panel'; toggleBtn.setAttribute('aria-label', 'Expand problem panel'); }
    }
}

// ---------------------------------------------------------------------------
// startSession — sends start_session over WS, kicks off timer for interview
// ---------------------------------------------------------------------------

export function startSession() {
    _deps.clearResumeState();
    const wbTimeout = _deps.getWhiteboardSaveTimeout ? _deps.getWhiteboardSaveTimeout() : null;
    if (wbTimeout) {
        clearTimeout(wbTimeout);
        if (_deps.setWhiteboardSaveTimeout) _deps.setWhiteboardSaveTimeout(null);
    }
    if (window.excalidrawBridge) window.excalidrawBridge.clear();
    if (!_deps.wsSend({ type: 'start_session', problem_id: state.currentProblem.id, mode: state.mode })) {
        _deps.addChatMessage('system', 'WebSocket not connected. Trying to reconnect...');
        return;
    }
    document.getElementById('chat-messages').innerHTML = '';
    _deps.addChatMessage('system', `Starting ${state.mode} session...`);
    eventBus.emit(Events.TUTOR_THINKING);
    if (state.mode === MODES.INTERVIEW) _deps.startTimer();
    if (_deps.settingsManager.get('earcons')) _deps.connectEarconObserver();
    _deps.connectTtsObserver();
}
