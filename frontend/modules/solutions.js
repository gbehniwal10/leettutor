// Solutions module — solution drawer, card renderer, diff viewer, label editing.

import * as monaco from 'monaco-editor';
import { state } from './state.js';
import { authHeaders, handleAuthError, escapeHtml } from './utils.js';
import { eventBus, Events } from './event-bus.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = { showConfirmDialog: null, settingsManager: null, wsSend: null };

export function configureSolutionsDeps(deps) {
    Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 3000;
let _drawerOpen = false;
let _solutionCounts = {};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initSolutions() {
    // Listen for solution saved events
    eventBus.on(Events.SOLUTION_SAVED, _onSolutionSaved);

    // Make solved badge clickable to toggle drawer
    const badge = document.getElementById('problem-solved-badge');
    if (badge) {
        badge.style.cursor = 'pointer';
        badge.addEventListener('click', _onBadgeClick);
    }

    // Close drawer on problem change
    eventBus.on(Events.PROBLEM_SOLVED, () => {
        _updateBadgeCount();
    });

    // Approach classification events
    eventBus.on(Events.APPROACH_CLASSIFIED, _onApproachClassified);
    eventBus.on(Events.APPROACH_DUPLICATE, _onApproachDuplicate);
    eventBus.on(Events.SOLUTION_COUNT_UPDATED, _onSolutionCountUpdated);
}

// ---------------------------------------------------------------------------
// Solution counts (for badge)
// ---------------------------------------------------------------------------

export async function loadSolutionCounts() {
    try {
        const res = await fetch('/api/solution-counts', { headers: authHeaders() });
        if (res.ok) _solutionCounts = await res.json();
    } catch (e) {
        // non-critical
    }
}

export function updateSolutionBadge(problemId) {
    const badge = document.getElementById('problem-solved-badge');
    const countSpan = document.getElementById('solution-count');
    if (!badge || !countSpan) return;

    const count = _solutionCounts[problemId] || 0;
    if (count > 0) {
        countSpan.textContent = `(${count})`;
        countSpan.classList.remove('hidden');
    } else {
        countSpan.textContent = '';
        countSpan.classList.add('hidden');
    }
}

async function _updateBadgeCount() {
    if (!state.currentProblem) return;
    await loadSolutionCounts();
    updateSolutionBadge(state.currentProblem.id);
}

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------

function _showSaveToast(data) {
    // Remove any existing toast
    const existing = document.getElementById('solution-save-toast');
    if (existing) existing.remove();

    const count = _solutionCounts[data.problemId] || 1;
    const toast = document.createElement('div');
    toast.id = 'solution-save-toast';
    toast.className = 'solution-save-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = `Solution saved (#${count})`;

    const testResults = document.getElementById('test-results');
    if (testResults) {
        testResults.insertAdjacentElement('afterbegin', toast);
    }

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, TOAST_DURATION_MS);
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

async function _onSolutionSaved(data) {
    // Don't refresh badge count here — the solution's approach is still null
    // at this point (classification is async over WebSocket). The correct count
    // arrives later via solution_count_updated after approach classification.
    _showSaveToast(data);
}

// ---------------------------------------------------------------------------
// Solution drawer
// ---------------------------------------------------------------------------

function _onBadgeClick() {
    if (_drawerOpen) {
        closeDrawer();
    } else {
        openDrawer();
    }
}

async function openDrawer() {
    const drawer = document.getElementById('solution-drawer');
    const backdrop = document.getElementById('solution-backdrop');
    if (!drawer) return;

    _drawerOpen = true;
    if (backdrop) backdrop.classList.add('open');
    drawer.classList.add('open');
    document.addEventListener('keydown', _escHandler, true);

    await _loadDrawerContent();
}

export function closeDrawer() {
    const drawer = document.getElementById('solution-drawer');
    const backdrop = document.getElementById('solution-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.removeEventListener('keydown', _escHandler, true);
    _drawerOpen = false;
}

function _escHandler(e) {
    if (e.key === 'Escape' && _drawerOpen) {
        e.stopImmediatePropagation();
        closeDrawer();
    }
}

async function _loadDrawerContent() {
    const content = document.getElementById('solution-drawer-content');
    if (!content || !state.currentProblem) return;

    content.innerHTML = '<p class="solution-drawer-loading">Loading...</p>';

    try {
        const res = await fetch(
            `/api/solutions/${encodeURIComponent(state.currentProblem.id)}`,
            { headers: authHeaders() }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const solutions = await res.json();

        if (!solutions.length) {
            content.innerHTML = '<p class="solution-drawer-empty">No saved solutions yet.</p>';
            return;
        }

        content.innerHTML = solutions.map(sol => _renderCard(sol)).join('');
        _attachCardHandlers(content);
    } catch (e) {
        content.innerHTML = '<p class="solution-drawer-empty">Failed to load solutions.</p>';
    }
}

function _renderCard(sol) {
    const date = new Date(sol.timestamp).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const runtime = sol.avg_runtime_ms != null ? `${sol.avg_runtime_ms.toFixed(2)}ms` : '';
    const label = sol.label ? escapeHtml(sol.label) : '';
    const complexity = sol.approach_complexity;
    const complexityText = complexity
        ? ` ${escapeHtml(complexity.time || '')}${complexity.space ? ' / ' + escapeHtml(complexity.space) : ''}`
        : '';
    const approachPill = sol.approach
        ? `<span class="approach-pill">${escapeHtml(sol.approach)}<span class="approach-complexity">${complexityText}</span></span>`
        : '';

    return `<div class="solution-card" data-solution-id="${escapeHtml(sol.id)}">
        <div class="solution-card-top">
            ${approachPill}
            <span class="solution-card-runtime">${escapeHtml(runtime)}</span>
            <button class="solution-card-delete" title="Delete solution" aria-label="Delete solution">&times;</button>
        </div>
        <div class="solution-card-meta">
            <span class="solution-card-date">${escapeHtml(date)}</span>
        </div>
        <div class="solution-card-label">
            <input type="text" class="solution-label-input" value="${label}" placeholder="Add label" maxlength="120" aria-label="Solution label">
        </div>
        <button class="solution-card-view btn btn-secondary btn-sm">View Code</button>
    </div>`;
}

function _attachCardHandlers(drawer) {
    if (!state.currentProblem) return;
    const problemId = state.currentProblem.id;

    // View code buttons
    drawer.querySelectorAll('.solution-card-view').forEach(btn => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.solution-card');
            const solId = card.dataset.solutionId;
            await _showDiffViewer(problemId, solId);
        });
    });

    // Delete buttons
    drawer.querySelectorAll('.solution-card-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const card = btn.closest('.solution-card');
            const solId = card.dataset.solutionId;

            const confirmed = _deps.showConfirmDialog
                ? await _deps.showConfirmDialog({
                    title: 'Delete solution?',
                    message: 'This saved solution will be permanently deleted.',
                    confirmLabel: 'Delete',
                    cancelLabel: 'Keep',
                })
                : true;

            if (!confirmed) return;

            try {
                await fetch(`/api/solutions/${encodeURIComponent(problemId)}/${encodeURIComponent(solId)}`, {
                    method: 'DELETE', headers: authHeaders(),
                });
                card.remove();
                await _updateBadgeCount();
                if (!drawer.querySelector('.solution-card')) {
                    drawer.innerHTML = '<p class="solution-drawer-empty">No saved solutions yet.</p>';
                }
            } catch (err) {
                console.error('Failed to delete solution:', err);
            }
        });
    });

    // Label editing (debounced)
    drawer.querySelectorAll('.solution-label-input').forEach(input => {
        let timeout;
        input.addEventListener('input', () => {
            clearTimeout(timeout);
            const card = input.closest('.solution-card');
            const solId = card.dataset.solutionId;
            timeout = setTimeout(async () => {
                try {
                    await fetch(`/api/solutions/${encodeURIComponent(problemId)}/${encodeURIComponent(solId)}`, {
                        method: 'PATCH',
                        headers: authHeaders(),
                        body: JSON.stringify({ label: input.value }),
                    });
                } catch (err) {
                    console.error('Failed to update label:', err);
                }
            }, 500);
        });
    });
}

// ---------------------------------------------------------------------------
// Diff viewer overlay
// ---------------------------------------------------------------------------

async function _showDiffViewer(problemId, solutionId) {
    const overlay = document.getElementById('solution-viewer-overlay');
    if (!overlay) return;

    try {
        const res = await fetch(
            `/api/solutions/${encodeURIComponent(problemId)}/${encodeURIComponent(solutionId)}`,
            { headers: authHeaders() }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const sol = await res.json();

        const currentCode = (state.editorReady && state.editor) ? state.editor.getValue() : '';
        const date = new Date(sol.timestamp).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        const label = sol.label ? ` - ${escapeHtml(sol.label)}` : '';

        overlay.innerHTML = `
            <div class="solution-viewer">
                <div class="solution-viewer-header">
                    <h3>Saved Solution (${escapeHtml(date)}${label})</h3>
                    <button class="solution-viewer-close" title="Close" aria-label="Close viewer">&times;</button>
                    <button class="solution-viewer-load btn btn-secondary btn-sm" title="Load into editor">Load into Editor</button>
                </div>
                <div class="solution-viewer-code" id="solution-viewer-editor"></div>
            </div>`;

        overlay.classList.remove('hidden');

        // Create read-only Monaco editor for the saved solution
        const container = document.getElementById('solution-viewer-editor');
        const viewerEditor = monaco.editor.create(container, {
            value: sol.code,
            language: 'python',
            theme: state.editor ? state.editor.getRawOptions().theme : 'vs-dark',
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            automaticLayout: true,
            fontSize: 14,
        });

        // Store reference for cleanup
        overlay._viewerEditor = viewerEditor;

        // Close button
        overlay.querySelector('.solution-viewer-close').addEventListener('click', () => {
            _closeDiffViewer();
        });

        // Load into editor button
        overlay.querySelector('.solution-viewer-load').addEventListener('click', () => {
            if (state.editorReady && state.editor) {
                state.editor.setValue(sol.code);
            }
            _closeDiffViewer();
        });

        // Close on Escape
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                _closeDiffViewer();
                document.removeEventListener('keydown', onKey, true);
            }
        };
        document.addEventListener('keydown', onKey, true);
        overlay._escHandler = onKey;

    } catch (e) {
        console.error('Failed to load solution for viewer:', e);
    }
}

function _closeDiffViewer() {
    const overlay = document.getElementById('solution-viewer-overlay');
    if (!overlay) return;
    if (overlay._viewerEditor) {
        overlay._viewerEditor.dispose();
        overlay._viewerEditor = null;
    }
    if (overlay._escHandler) {
        document.removeEventListener('keydown', overlay._escHandler, true);
        overlay._escHandler = null;
    }
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
}

// ---------------------------------------------------------------------------
// History modal integration — Solutions tab
// ---------------------------------------------------------------------------

export async function loadSolutionsTab() {
    const container = document.getElementById('session-list');
    if (!container) return;

    container.innerHTML = '<p class="solution-drawer-loading">Loading solutions...</p>';

    try {
        const countsRes = await fetch('/api/solution-counts', { headers: authHeaders() });
        if (!countsRes.ok) throw new Error(`${countsRes.status}`);
        const counts = await countsRes.json();

        const problemIds = Object.keys(counts).sort();
        if (!problemIds.length) {
            container.innerHTML = '<p style="color:var(--text-secondary);padding:16px;">No saved solutions yet.</p>';
            return;
        }

        let html = '';
        for (const pid of problemIds) {
            const prob = state.allProblems.find(p => p.id === pid);
            const title = prob ? prob.title : pid;
            const difficulty = prob ? prob.difficulty : '';
            html += `<div class="solution-group">
                <div class="solution-group-header" data-problem-id="${escapeHtml(pid)}">
                    <span class="solution-group-title">${escapeHtml(title)}</span>
                    <span class="difficulty ${escapeHtml(difficulty)}">${escapeHtml(difficulty)}</span>
                    <span class="solution-group-count">${counts[pid]} solution${counts[pid] > 1 ? 's' : ''}</span>
                </div>
                <div class="solution-group-body hidden" data-problem-id="${escapeHtml(pid)}"></div>
            </div>`;
        }
        container.innerHTML = html;

        // Collapse/expand group headers
        container.querySelectorAll('.solution-group-header').forEach(header => {
            header.addEventListener('click', async () => {
                const pid = header.dataset.problemId;
                const body = container.querySelector(`.solution-group-body[data-problem-id="${pid}"]`);
                if (!body) return;
                if (body.classList.contains('hidden')) {
                    body.classList.remove('hidden');
                    await _loadGroupSolutions(body, pid);
                } else {
                    body.classList.add('hidden');
                }
            });
        });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--accent-red);padding:16px;">Failed to load solutions.</p>';
    }
}

async function _loadGroupSolutions(body, problemId) {
    body.innerHTML = '<p class="solution-drawer-loading">Loading...</p>';
    try {
        const res = await fetch(`/api/solutions/${encodeURIComponent(problemId)}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`${res.status}`);
        const solutions = await res.json();

        if (!solutions.length) {
            body.innerHTML = '<p class="solution-drawer-empty">No solutions.</p>';
            return;
        }

        body.innerHTML = solutions.map(sol => _renderCard(sol)).join('');

        // Attach view handlers (no delete/edit in history view for simplicity)
        body.querySelectorAll('.solution-card-view').forEach(btn => {
            btn.addEventListener('click', async () => {
                const card = btn.closest('.solution-card');
                const solId = card.dataset.solutionId;
                await _showDiffViewer(problemId, solId);
            });
        });
    } catch (e) {
        body.innerHTML = '<p class="solution-drawer-empty">Failed to load.</p>';
    }
}

// ---------------------------------------------------------------------------
// Approach classification event handlers
// ---------------------------------------------------------------------------

async function _onApproachClassified(data) {
    // Update the approach pill on the card in the drawer if open
    const card = document.querySelector(`.solution-card[data-solution-id="${data.solution_id}"]`);
    if (card && data.approach) {
        const top = card.querySelector('.solution-card-top');
        if (top && !top.querySelector('.approach-pill')) {
            const pill = document.createElement('span');
            pill.className = 'approach-pill';
            const c = data.approach_complexity;
            const cText = c ? ` ${c.time || ''}${c.space ? ' / ' + c.space : ''}` : '';
            pill.innerHTML = `${escapeHtml(data.approach)}<span class="approach-complexity">${escapeHtml(cText)}</span>`;
            top.prepend(pill);
        }
    }
    // Now that the approach is set, the count from the backend will be correct
    await _updateBadgeCount();
}

function _onApproachDuplicate(data) {
    _showDuplicateDialog(data);
}

function _onSolutionCountUpdated(data) {
    if (data.problem_id && data.count != null) {
        _solutionCounts[data.problem_id] = data.count;
        if (state.currentProblem && state.currentProblem.id === data.problem_id) {
            updateSolutionBadge(data.problem_id);
        }
    }
}

// ---------------------------------------------------------------------------
// Duplicate resolution dialog
// ---------------------------------------------------------------------------

function _showDuplicateDialog(data) {
    // Remove any existing dialog
    const existing = document.getElementById('approach-dup-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'approach-dup-dialog';
    overlay.className = 'approach-dup-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Duplicate approach detected');

    const existingRt = data.existing_runtime_ms != null ? `${data.existing_runtime_ms.toFixed(2)}ms` : 'N/A';
    const newRt = data.new_runtime_ms != null ? `${data.new_runtime_ms.toFixed(2)}ms` : 'N/A';

    overlay.innerHTML = `
        <div class="approach-dup-dialog">
            <h3 class="approach-dup-title">Duplicate Approach</h3>
            <p class="approach-dup-desc">You already have a <span class="approach-pill">${escapeHtml(data.approach)}</span> solution saved.</p>
            <div class="approach-dup-compare">
                <div class="approach-dup-col">
                    <strong>Existing</strong>
                    <span class="approach-dup-runtime">${escapeHtml(existingRt)}</span>
                </div>
                <div class="approach-dup-col">
                    <strong>New</strong>
                    <span class="approach-dup-runtime">${escapeHtml(newRt)}</span>
                </div>
            </div>
            <div class="approach-dup-actions">
                <button class="btn btn-primary btn-sm" data-action="replace">Replace Old</button>
                <button class="btn btn-secondary btn-sm" data-action="keep_both">Keep Both</button>
                <button class="btn btn-secondary btn-sm" data-action="discard_new">Discard New</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            let keepId, discardId;

            if (action === 'replace') {
                keepId = data.new_solution_id;
                discardId = data.existing_solution_id;
            } else if (action === 'discard_new') {
                keepId = data.existing_solution_id;
                discardId = data.new_solution_id;
            } else {
                // keep_both
                keepId = null;
                discardId = null;
            }

            if (_deps.wsSend) {
                _deps.wsSend({
                    type: 'approach_resolve',
                    problem_id: state.currentProblem ? state.currentProblem.id : '',
                    keep_id: keepId,
                    discard_id: discardId,
                    action,
                });
            }

            overlay.remove();
        });
    });

    // Close on Escape
    const onKey = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', onKey, true);
        }
    };
    document.addEventListener('keydown', onKey, true);
}
