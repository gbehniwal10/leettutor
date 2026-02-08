// Pattern Quiz module — handles pattern identification quiz mode.

import { state } from './state.js';
import { TAG_TO_PATTERN, PATTERN_LIST } from './constants.js';
import { authHeaders, handleAuthError, escapeHtml, renderMarkdown } from './utils.js';

// ---------------------------------------------------------------------------
// Dependency injection — selectProblem lives in the problems module which may
// depend on other modules.  To avoid circular imports we accept it at runtime.
// ---------------------------------------------------------------------------

let _deps = { selectProblem: null };

export function configureQuizDeps({ selectProblem }) {
    _deps.selectProblem = selectProblem;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getCorrectPatterns(problem) {
    if (!problem || !problem.tags) return [];
    const patterns = new Set();
    for (const tag of problem.tags) {
        const mapped = TAG_TO_PATTERN[tag];
        if (mapped) patterns.add(mapped);
    }
    return [...patterns];
}

// ---------------------------------------------------------------------------
// Stats persistence (localStorage)
// ---------------------------------------------------------------------------

function loadPatternStats() {
    try {
        return JSON.parse(localStorage.getItem('patternQuizStats')) || {
            totalAttempts: 0, correct: 0, byPattern: {},
        };
    } catch { return { totalAttempts: 0, correct: 0, byPattern: {} }; }
}

function savePatternStats(stats) {
    localStorage.setItem('patternQuizStats', JSON.stringify(stats));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPatternStats() {
    const stats = loadPatternStats();
    const el = document.getElementById('pattern-stats');
    if (!el) return;
    if (stats.totalAttempts === 0) {
        el.innerHTML = '';
        return;
    }
    const pct = Math.round((stats.correct / stats.totalAttempts) * 100);
    el.innerHTML = `<span class="stat-correct">${stats.correct}</span> / ${stats.totalAttempts} correct (${pct}%)`;
}

export function renderPatternButtons() {
    const container = document.getElementById('pattern-buttons');
    if (!container) return;
    container.innerHTML = PATTERN_LIST.map(p =>
        `<button class="pattern-btn" data-pattern="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    ).join('');

    container.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.addEventListener('click', () => handlePatternGuess(btn.dataset.pattern));
    });
}

// ---------------------------------------------------------------------------
// Guess handling
// ---------------------------------------------------------------------------

export function handlePatternGuess(guessed) {
    if (state.patternQuizAnswered || !state.currentProblem) return;

    const correctPatterns = getCorrectPatterns(state.currentProblem);
    if (correctPatterns.length === 0) {
        // Problem has no mapped pattern — skip and load next
        selectRandomProblem();
        return;
    }
    state.patternQuizAnswered = true;

    const isCorrect = correctPatterns.includes(guessed);
    const primaryCorrect = correctPatterns[0];

    // Update stats
    const stats = loadPatternStats();
    stats.totalAttempts++;
    if (isCorrect) stats.correct++;
    if (!stats.byPattern[primaryCorrect]) stats.byPattern[primaryCorrect] = { attempts: 0, correct: 0 };
    stats.byPattern[primaryCorrect].attempts++;
    if (isCorrect) stats.byPattern[primaryCorrect].correct++;
    savePatternStats(stats);

    // Highlight buttons
    document.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.disabled = true;
        if (correctPatterns.includes(btn.dataset.pattern)) {
            btn.classList.add(btn.dataset.pattern === guessed ? 'correct' : 'reveal');
        } else if (btn.dataset.pattern === guessed) {
            btn.classList.add('wrong');
        }
    });

    // Show feedback
    const feedback = document.getElementById('pattern-feedback');
    feedback.classList.remove('hidden', 'correct', 'wrong');
    if (isCorrect) {
        feedback.classList.add('correct');
        feedback.textContent = `Correct! This is a ${guessed} problem.`;
    } else {
        feedback.classList.add('wrong');
        feedback.textContent = `Not quite. This is a ${primaryCorrect} problem.`;
    }

    // Show next button
    document.getElementById('next-problem-btn').classList.remove('hidden');
    renderPatternStats();

    // Enhanced mode: ask Claude for explanation
    if (state.enhancedMode) {
        fetchPatternExplanation(guessed, primaryCorrect, isCorrect);
    }
}

// ---------------------------------------------------------------------------
// Claude explanation (enhanced mode)
// ---------------------------------------------------------------------------

async function fetchPatternExplanation(guessed, correct, wasCorrect) {
    const explanationEl = document.getElementById('pattern-explanation');
    explanationEl.classList.remove('hidden');
    explanationEl.innerHTML = '<span class="loading">Getting explanation from Claude...</span>';

    try {
        const response = await fetch('/api/pattern-explain', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                problem_id: state.currentProblem.id,
                guessed_pattern: guessed,
                correct_pattern: correct,
                was_correct: wasCorrect,
            }),
        });
        if (await handleAuthError(response)) {
            // retry after re-auth
            const retryResp = await fetch('/api/pattern-explain', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    problem_id: state.currentProblem.id,
                    guessed_pattern: guessed,
                    correct_pattern: correct,
                    was_correct: wasCorrect,
                }),
            });
            const data = await retryResp.json();
            explanationEl.innerHTML = renderMarkdown(data.explanation);
            return;
        }
        if (!response.ok) {
            explanationEl.innerHTML = '<span class="loading">Could not get explanation.</span>';
            return;
        }
        const data = await response.json();
        explanationEl.innerHTML = renderMarkdown(data.explanation);
    } catch (e) {
        explanationEl.innerHTML = '<span class="loading">Could not get explanation.</span>';
    }
}

// ---------------------------------------------------------------------------
// Problem selection & reset
// ---------------------------------------------------------------------------

export function selectRandomProblem() {
    if (!state.allProblems.length) return;
    const idx = Math.floor(Math.random() * state.allProblems.length);
    _deps.selectProblem(state.allProblems[idx].id);
}

export function resetPatternQuiz() {
    state.patternQuizAnswered = false;
    const feedback = document.getElementById('pattern-feedback');
    const explanation = document.getElementById('pattern-explanation');
    const nextBtn = document.getElementById('next-problem-btn');
    if (feedback) { feedback.classList.add('hidden'); feedback.classList.remove('correct', 'wrong'); }
    if (explanation) explanation.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
    renderPatternButtons();
    renderPatternStats();
}
