// Skill Tree module — React Flow island bridge and view toggle wiring.
// Follows the same pattern as whiteboard.js for polling the bridge.

import { eventBus, Events } from './event-bus.js';
import { getProgress } from './progress.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {
    selectProblem: null,
    settingsManager: null,
};

export function configureSkillTreeDeps(deps) {
    Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

let _bridgeReady = false;
let _categories = [];
let _pollTimer = null;

// ---------------------------------------------------------------------------
// Bridge helpers
// ---------------------------------------------------------------------------

function _pushProgress() {
    if (!_bridgeReady || !window.skillTreeBridge) return;
    window.skillTreeBridge.updateProgress(getProgress());
}

function _pushTheme() {
    if (!_bridgeReady || !window.skillTreeBridge) return;
    const theme = _deps.settingsManager ? _deps.settingsManager.get('theme') : 'dark';
    window.skillTreeBridge.setTheme(theme);
}

function _pushCategories() {
    if (!_bridgeReady || !window.skillTreeBridge) return;
    window.skillTreeBridge.setCategories(_categories);
}

// ---------------------------------------------------------------------------
// View toggle — List | Tree
// ---------------------------------------------------------------------------

function _showTreeView() {
    const root = document.getElementById('skill-tree-root');
    const list = document.getElementById('problem-list');
    const filters = document.querySelector('.problem-filters');
    if (root) root.classList.remove('hidden');
    if (list) list.classList.add('hidden');
    if (filters) filters.classList.add('hidden');
    // Push latest data to the bridge
    _pushProgress();
    _pushCategories();
}

function _showListView() {
    const root = document.getElementById('skill-tree-root');
    const list = document.getElementById('problem-list');
    const filters = document.querySelector('.problem-filters');
    if (root) root.classList.add('hidden');
    if (list) list.classList.remove('hidden');
    if (filters) filters.classList.remove('hidden');
}

function _initViewToggle() {
    const treeBtns = document.querySelectorAll('.view-toggle-btn');
    // Enable the Tree button (ticket 57 left it disabled)
    treeBtns.forEach(btn => {
        if (btn.dataset.view === 'tree') {
            btn.disabled = false;
            btn.title = '';
        }
    });

    treeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            treeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (btn.dataset.view === 'tree') {
                _showTreeView();
            } else {
                _showListView();
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Public: initSkillTree
// ---------------------------------------------------------------------------

export function initSkillTree() {
    _initViewToggle();

    // Poll for bridge readiness (same pattern as whiteboard.js)
    _pollTimer = setInterval(() => {
        if (window.skillTreeBridge) {
            _bridgeReady = true;
            clearInterval(_pollTimer);
            _pollTimer = null;

            // Register the problem select callback
            window.skillTreeBridge.setOnProblemSelect((problemId) => {
                if (_deps.selectProblem) {
                    _deps.selectProblem(problemId);
                }
            });

            // Push initial data
            _pushCategories();
            _pushProgress();
            _pushTheme();
        }
    }, 500);

    // React to progress changes
    eventBus.on(Events.PROBLEM_SOLVED, _pushProgress);

    // React to theme changes
    if (_deps.settingsManager) {
        _deps.settingsManager.onChange('theme', _pushTheme);
    }
}

/**
 * Set the skill tree categories (called from problems.js after fetching).
 * @param {Object[]} categories
 */
export function setSkillTreeCategories(categories) {
    _categories = categories || [];
    _pushCategories();
}
