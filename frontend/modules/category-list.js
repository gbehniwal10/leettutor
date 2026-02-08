// Category list rendering — grouped problem list with lock/unlock state.
// Extracted from problems.js to keep modules under ~250 lines.

import { escapeHtml } from './utils.js';
import { getProgress, isCategoryUnlocked } from './progress.js';

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

/** Collapse state per category ID — true = collapsed. */
const _collapsed = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildProblemMap(problems) {
    const map = {};
    for (const p of problems) map[p.id] = p;
    return map;
}

function _solvedCount(category, progress) {
    let count = 0;
    for (const id of category.problems) {
        if (progress.problems[id]?.solved) count++;
    }
    return count;
}

function _prereqNames(category, allCategories) {
    const names = [];
    for (const pid of category.prerequisites || []) {
        const cat = allCategories.find(c => c.id === pid);
        if (cat) names.push(cat.title);
    }
    return names;
}

function _isDefaultCollapsed(catId, categories) {
    if (catId === '__uncategorized') return false;
    const cat = categories.find(c => c.id === catId);
    if (!cat) return false;
    return !isCategoryUnlocked(cat, getProgress(), categories);
}

function _isCollapsed(catId, categories) {
    return _collapsed[catId] ?? _isDefaultCollapsed(catId, categories);
}

// ---------------------------------------------------------------------------
// Item HTML
// ---------------------------------------------------------------------------

function _renderProblemItemHtml(p, extraClass) {
    const status = p.status || 'unsolved';
    let indicator = '';
    if (status === 'solved') {
        indicator = '<span class="status-indicator status-solved">&#10003;</span>';
    } else if (status === 'attempted') {
        indicator = '<span class="status-indicator status-attempted">&#9679;</span>';
    } else {
        indicator = '<span class="status-indicator status-unsolved"></span>';
    }
    return `
    <div class="problem-item${extraClass}" data-id="${escapeHtml(String(p.id))}">
        ${indicator}
        <span class="title">${escapeHtml(p.title)}</span>
        <span class="difficulty ${escapeHtml(p.difficulty)}">${escapeHtml(p.difficulty)}</span>
        <div class="tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>`;
}

function _renderCategoryHeader(cat, collapsed, unlocked, solved, total, pct) {
    const expandedClass = collapsed ? '' : ' expanded';
    let h = `<div class="category-header${expandedClass}" data-category-id="${escapeHtml(cat.id)}" role="button" tabindex="0" aria-expanded="${!collapsed}">`;
    h += `<span class="chevron">${collapsed ? '&#9654;' : '&#9660;'}</span>`;
    if (!unlocked) {
        h += '<span class="category-lock-icon" aria-label="Locked">&#128274;</span>';
    }
    h += `<span class="category-label">${escapeHtml(cat.title)}</span>`;
    h += `<span class="category-count">${solved}/${total}</span>`;
    h += '<span class="category-progress-bar">';
    h += `<span class="category-progress-fill" style="width:${pct}%"></span>`;
    h += '</span></div>';
    return h;
}

// ---------------------------------------------------------------------------
// Public: renderCategoryList
// ---------------------------------------------------------------------------

/**
 * Render the category-grouped problem list into a container element.
 *
 * @param {HTMLElement} container
 * @param {Object[]} allProblems      - full problem list (state.allProblems)
 * @param {Object[]} filteredProblems - problems remaining after filter
 * @param {Object[]} categories       - skill tree categories
 * @param {Function} onSelectProblem  - callback(problemId)
 * @param {Function} onToggleCategory - callback() to re-run filter + render
 */
export function renderCategoryList(container, allProblems, filteredProblems, categories, onSelectProblem, onToggleCategory) {
    // Flat fallback when no skill tree
    if (!categories || categories.length === 0) {
        container.innerHTML = filteredProblems.map(p => _renderProblemItemHtml(p, '')).join('');
        _attachProblemListeners(container, onSelectProblem);
        return;
    }

    const filteredSet = new Set(filteredProblems.map(p => p.id));
    const problemMap = _buildProblemMap(allProblems);
    const progress = getProgress();

    const categorizedIds = new Set();
    for (const cat of categories) {
        for (const id of cat.problems) categorizedIds.add(id);
    }

    let html = '';

    for (const cat of categories) {
        const catProblems = cat.problems
            .map(id => problemMap[id])
            .filter(p => p && filteredSet.has(p.id));

        if (catProblems.length === 0) continue;

        const unlocked = isCategoryUnlocked(cat, progress, categories);
        const solved = _solvedCount(cat, progress);
        const total = cat.problems.length;
        const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
        const collapsed = _isCollapsed(cat.id, categories);
        const lockedClass = unlocked ? '' : ' category-locked';

        html += `<div class="category-section${lockedClass}" data-category-id="${escapeHtml(cat.id)}">`;
        html += _renderCategoryHeader(cat, collapsed, unlocked, solved, total, pct);

        if (!unlocked) {
            const names = _prereqNames(cat, categories);
            if (names.length > 0) {
                html += `<div class="category-prereq-hint">Solve a problem in ${escapeHtml(names.join(', '))} to unlock</div>`;
            }
        }

        if (!collapsed) {
            html += '<div class="category-problems">';
            for (const p of catProblems) {
                html += _renderProblemItemHtml(p, unlocked ? '' : ' locked');
            }
            html += '</div>';
        }
        html += '</div>';
    }

    // Uncategorized
    const uncategorized = filteredProblems.filter(p => !categorizedIds.has(p.id));
    if (uncategorized.length > 0) {
        const collapsed = _isCollapsed('__uncategorized', categories);
        html += '<div class="category-section" data-category-id="__uncategorized">';
        html += `<div class="category-header${collapsed ? '' : ' expanded'}" data-category-id="__uncategorized" role="button" tabindex="0" aria-expanded="${!collapsed}">`;
        html += `<span class="chevron">${collapsed ? '&#9654;' : '&#9660;'}</span>`;
        html += '<span class="category-label">Other</span>';
        html += `<span class="category-count">${uncategorized.length}</span>`;
        html += '</div>';
        if (!collapsed) {
            html += '<div class="category-problems">';
            for (const p of uncategorized) html += _renderProblemItemHtml(p, '');
            html += '</div>';
        }
        html += '</div>';
    }

    container.innerHTML = html;
    _attachCategoryListeners(container, categories, onToggleCategory);
    _attachProblemListeners(container, onSelectProblem);
}

// ---------------------------------------------------------------------------
// Internal: event wiring
// ---------------------------------------------------------------------------

function _attachCategoryListeners(container, categories, onToggleCategory) {
    container.querySelectorAll('.category-header').forEach(header => {
        function toggle() {
            const catId = header.dataset.categoryId;
            _collapsed[catId] = !_isCollapsed(catId, categories);
            onToggleCategory();
        }
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });
    });
}

function _attachProblemListeners(container, onSelectProblem) {
    container.querySelectorAll('.problem-item:not(.locked)').forEach(item => {
        item.addEventListener('click', () => onSelectProblem(item.dataset.id));
    });
}
