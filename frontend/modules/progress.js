// Progress tracking module — pure data, no DOM manipulation.
// Tracks which problems the user has solved, persisted to localStorage.

import { eventBus, Events } from './event-bus.js';

const STORAGE_KEY = 'leettutor_progress';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt data */ }
    return { problems: {} };
}

function _save(progress) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) { /* ignore quota errors */ }
}

function _today() {
    return new Date().toISOString().split('T')[0];
}

function _ensureEntry(progress, problemId) {
    if (!progress.problems[problemId]) {
        progress.problems[problemId] = { solved: false, attempts: 0, lastAttempt: null };
    }
    return progress.problems[problemId];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the full progress object from localStorage.
 * Shape: { problems: { [id]: { solved, attempts, lastAttempt } } }
 */
export function getProgress() {
    return _load();
}

/**
 * Mark a problem as solved. Increments attempts and updates lastAttempt.
 */
export function markSolved(problemId) {
    const progress = _load();
    const entry = _ensureEntry(progress, problemId);
    entry.solved = true;
    entry.attempts++;
    entry.lastAttempt = _today();
    _save(progress);
    eventBus.emit(Events.PROBLEM_SOLVED, { problemId });
}

/**
 * Record an attempt (pass or fail). Increments attempts and updates lastAttempt.
 * Creates the entry if it doesn't exist (solved defaults to false).
 */
export function markAttempted(problemId) {
    const progress = _load();
    const entry = _ensureEntry(progress, problemId);
    entry.attempts++;
    entry.lastAttempt = _today();
    _save(progress);
}

/**
 * Determine the status of a category based on solve/attempt counts.
 * Does NOT check prerequisites — use isCategoryUnlocked for that.
 *
 * @param {Object} category  - { id, problems: [problemId, ...], prerequisites: [...] }
 * @param {Object} progress  - the progress object from getProgress()
 * @returns {"completed"|"in-progress"|"unlocked"}
 */
export function getCategoryStatus(category, progress) {
    const ids = category.problems || [];
    if (ids.length === 0) return 'unlocked';

    let solvedCount = 0;
    let attemptedCount = 0;

    for (const id of ids) {
        const entry = progress.problems[id];
        if (entry) {
            if (entry.solved) solvedCount++;
            if (entry.attempts > 0) attemptedCount++;
        }
    }

    if (solvedCount === ids.length) return 'completed';
    if (solvedCount > 0 || attemptedCount > 0) return 'in-progress';
    return 'unlocked';
}

/**
 * Check whether a category's prerequisites are all met.
 * A prerequisite is met when at least one problem in that prerequisite
 * category has been solved. Categories with no prerequisites are always unlocked.
 *
 * @param {Object} category       - { id, problems: [...], prerequisites: [categoryId, ...] }
 * @param {Object} progress       - the progress object from getProgress()
 * @param {Object[]} allCategories - array of all category objects
 * @returns {boolean}
 */
export function isCategoryUnlocked(category, progress, allCategories) {
    const prereqs = category.prerequisites || [];
    if (prereqs.length === 0) return true;

    const categoryMap = {};
    for (const cat of allCategories) {
        categoryMap[cat.id] = cat;
    }

    for (const prereqId of prereqs) {
        const prereqCat = categoryMap[prereqId];
        if (!prereqCat) continue; // unknown prerequisite — skip

        const ids = prereqCat.problems || [];
        const hasSolved = ids.some(id => progress.problems[id]?.solved);
        if (!hasSolved) return false;
    }

    return true;
}
