// Code Runner module — executes user code against test cases and displays results.

import { state } from './state.js';
import { authHeaders, escapeHtml, handleAuthError } from './utils.js';
import { eventBus, Events } from './event-bus.js';
import { WS_MESSAGE_TYPES } from './constants.js';
import { markSolved, markAttempted } from './progress.js';

// Dependency injection (same pattern as chat.js, session.js, etc.)
let _deps = { wsSend: null };
export function configureCodeRunnerDeps({ wsSend }) {
    if (wsSend !== undefined) _deps.wsSend = wsSend;
}

// Module-scoped busy guards (prevent double-clicks / keyboard shortcuts during execution)
let _runCodeBusy = false;
let _submitCodeBusy = false;

// ---------------------------------------------------------------------------
// getEditorValue
// ---------------------------------------------------------------------------

export function getEditorValue() {
    return (state.editorReady && state.editor) ? state.editor.getValue() : '';
}

// ---------------------------------------------------------------------------
// runCode — POST /api/run (visible tests only)
// ---------------------------------------------------------------------------

export async function runCode() {
    if (!state.currentProblem) return;
    if (_runCodeBusy) return;
    _runCodeBusy = true;

    const btn = document.getElementById('run-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';
    const code = getEditorValue();

    try {
        let response = await fetch('/api/run', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ code, problem_id: state.currentProblem.id })
        });
        if (await handleAuthError(response)) {
            response = await fetch('/api/run', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ code, problem_id: state.currentProblem.id })
            });
        }
        if (!response.ok) {
            const errText = await response.text().catch(() => 'Unknown error');
            document.getElementById('test-results').innerHTML =
                `<div class="result-banner wrong-answer"><span class="banner-text">Error ${response.status}</span><span class="banner-info">${escapeHtml(errText)}</span></div>`;
            return;
        }
        const results = await response.json();
        displayTestResults(results, false);
    } catch (error) {
        document.getElementById('test-results').innerHTML =
            '<div class="result-banner wrong-answer"><span class="banner-text">Error</span><span class="banner-info">Failed to run code. Check your connection.</span></div>';
    } finally {
        _runCodeBusy = false;
        btn.disabled = false;
        btn.innerHTML = '&#9654; Run';
    }
}

// ---------------------------------------------------------------------------
// submitCode — POST /api/submit (all tests including hidden)
// ---------------------------------------------------------------------------

export async function submitCode() {
    if (!state.currentProblem) return;
    if (_submitCodeBusy) return;
    _submitCodeBusy = true;

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    const code = getEditorValue();

    try {
        const submitBody = {
            code,
            problem_id: state.currentProblem.id,
            mode: state.mode || '',
            session_id: state.sessionId || '',
        };
        let response = await fetch('/api/submit', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify(submitBody)
        });
        if (await handleAuthError(response)) {
            response = await fetch('/api/submit', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify(submitBody)
            });
        }
        if (!response.ok) {
            const errText = await response.text().catch(() => 'Unknown error');
            document.getElementById('test-results').innerHTML =
                `<div class="result-banner wrong-answer"><span class="banner-text">Error ${response.status}</span><span class="banner-info">${escapeHtml(errText)}</span></div>`;
            return;
        }
        const results = await response.json();
        displayTestResults(results, true);

        // Track progress on every submit (markSolved also increments attempts)
        const problemId = state.currentProblem.id;
        if (results.failed === 0) {
            markSolved(problemId);
            // Emit solution-saved event for toast/badge update
            if (results.saved_solution_id) {
                eventBus.emit(Events.SOLUTION_SAVED, {
                    problemId,
                    solutionId: results.saved_solution_id,
                    results,
                });
            }
        } else {
            markAttempted(problemId);
        }
    } catch (error) {
        document.getElementById('test-results').innerHTML =
            '<div class="result-banner wrong-answer"><span class="banner-text">Error</span><span class="banner-info">Failed to submit code. Check your connection.</span></div>';
    } finally {
        _submitCodeBusy = false;
        btn.disabled = false;
        btn.textContent = 'Submit';
    }
}

// ---------------------------------------------------------------------------
// displayTestResults — renders test result HTML into #test-results
// ---------------------------------------------------------------------------

export function displayTestResults(results, isSubmit) {
    const container = document.getElementById('test-results');
    const total = results.passed + results.failed;
    const allPassed = results.failed === 0;
    const totalRuntime = results.results.reduce((s, r) => s + (r.runtime_ms || 0), 0);

    // Determine banner type
    let bannerClass, bannerText;
    if (allPassed) {
        bannerClass = 'accepted';
        bannerText = 'Accepted';
    } else {
        const hasTimeout = results.results.some(r => r.error && r.error.includes('Time Limit Exceeded'));
        const hasRuntimeError = results.results.some(r => r.error && !r.error.includes('Time Limit Exceeded') && r.actual === null);
        if (hasTimeout) { bannerClass = 'wrong-answer'; bannerText = 'Time Limit Exceeded'; }
        else if (hasRuntimeError) { bannerClass = 'wrong-answer'; bannerText = 'Runtime Error'; }
        else { bannerClass = 'wrong-answer'; bannerText = 'Wrong Answer'; }
    }

    // Build banner
    const bannerHtml = `<div class="result-banner ${bannerClass}">
        <span class="banner-text">${bannerText}</span>
        <span class="banner-info">${results.passed}/${total} testcases passed | ${totalRuntime.toFixed(1)} ms</span>
    </div>`;

    // Build tabs
    const tabsHtml = `<div class="test-tabs">${results.results.map((r, i) => {
        const cls = r.passed ? 'passed' : 'failed';
        return `<button class="tab ${cls}${i === 0 ? ' active' : ''}" data-index="${i}">Case ${r.test_num}</button>`;
    }).join('')}</div>`;

    // Build detail panels
    const panelsHtml = results.results.map((r, i) => {
        const inputStr = Object.entries(r.input).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n');
        const outputStr = r.error ? r.error : JSON.stringify(r.actual);
        const expectedStr = JSON.stringify(r.expected);
        const stdoutRow = r.stdout ? `<div class="detail-row"><label>Stdout</label><pre>${escapeHtml(r.stdout)}</pre></div>` : '';
        return `<div class="test-detail${i === 0 ? '' : ' hidden'}" data-index="${i}">
            <div class="detail-row"><label>Input</label><pre>${escapeHtml(inputStr)}</pre></div>
            <div class="detail-row"><label>Output</label><pre>${escapeHtml(outputStr)}</pre></div>
            <div class="detail-row"><label>Expected</label><pre>${escapeHtml(expectedStr)}</pre></div>
            ${stdoutRow}
        </div>`;
    }).join('');

    container.innerHTML = bannerHtml + tabsHtml + panelsHtml;

    // Tab click handlers
    container.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            container.querySelectorAll('.test-detail').forEach(p => p.classList.add('hidden'));
            container.querySelector(`.test-detail[data-index="${tab.dataset.index}"]`).classList.remove('hidden');
        });
    });

    // Notify other modules that results have been rendered
    eventBus.emit(Events.TEST_RESULTS_DISPLAYED, results, isSubmit);

    // Send results to backend so the tutor agent can access them
    if (_deps.wsSend && state.sessionId) {
        const wsMsg = {
            type: WS_MESSAGE_TYPES.TEST_RESULTS_UPDATE,
            test_results: results,
            code: getEditorValue(),
            is_submit: isSubmit,
        };
        if (results.saved_solution_id) {
            wsMsg.saved_solution_id = results.saved_solution_id;
        }
        _deps.wsSend(wsMsg);

        // Show typing indicator while the tutor prepares its response
        if (isSubmit && results.failed === 0) {
            eventBus.emit(Events.TUTOR_THINKING);
        }
    }
}
