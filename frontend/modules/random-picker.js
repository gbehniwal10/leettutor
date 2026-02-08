// Random Picker module — cascading dropdown for picking a random problem
// by difficulty and topic.

import { state } from './state.js';
import { authHeaders } from './utils.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = { selectProblem: null };

export function configureRandomPickerDeps(deps) {
    Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const DIFFICULTIES = ['easy', 'medium', 'hard'];
let _wrapper = null;
let _btn = null;
let _container = null;
let _menu = null;
let _submenu = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTagsForDifficulty(difficulty) {
    const problems = difficulty
        ? state.allProblems.filter(p => p.difficulty === difficulty)
        : state.allProblems;
    const counts = {};
    for (const p of problems) {
        for (const t of p.tags) {
            counts[t] = (counts[t] || 0) + 1;
        }
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({ tag, count }));
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

function closeDropdown() {
    _container.classList.add('hidden');
    _btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onEscape, true);
}

function openDropdown() {
    buildDifficultyMenu();
    _submenu.innerHTML = '';
    _submenu.classList.add('hidden');
    _container.classList.remove('hidden');
    _btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onEscape, true);
}

function onOutsideClick(e) {
    if (!_wrapper.contains(e.target)) closeDropdown();
}

function onEscape(e) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        closeDropdown();
        _btn.focus();
    }
}

// ---------------------------------------------------------------------------
// pickRandom — fetch random problem from API and select it
// ---------------------------------------------------------------------------

async function pickRandom(difficulty, tag) {
    closeDropdown();
    const params = new URLSearchParams();
    if (difficulty) params.set('difficulty', difficulty);
    if (tag) params.set('tag', tag);
    const url = '/api/problems/random' + (params.toString() ? '?' + params : '');
    try {
        const resp = await fetch(url, { headers: authHeaders() });
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
        const data = await resp.json();
        _deps.selectProblem(data.id);
    } catch (err) {
        console.error('Random pick failed:', err);
    }
}

// ---------------------------------------------------------------------------
// Dropdown rendering
// ---------------------------------------------------------------------------

function buildDifficultyMenu() {
    _menu.innerHTML = '';

    const anyItem = document.createElement('button');
    anyItem.className = 'random-picker-item';
    anyItem.textContent = 'Any Difficulty';
    anyItem.addEventListener('mouseenter', () => showSubmenu(null));
    anyItem.addEventListener('click', () => pickRandom(null, null));
    _menu.appendChild(anyItem);

    for (const diff of DIFFICULTIES) {
        const item = document.createElement('button');
        item.className = 'random-picker-item';
        item.dataset.difficulty = diff;
        const label = diff.charAt(0).toUpperCase() + diff.slice(1);
        item.innerHTML = `<span class="random-picker-diff-dot ${diff}"></span>${label}`;
        item.addEventListener('mouseenter', () => showSubmenu(diff));
        item.addEventListener('click', () => pickRandom(diff, null));
        _menu.appendChild(item);
    }
}

function showSubmenu(difficulty) {
    const tags = getTagsForDifficulty(difficulty);
    if (tags.length === 0) {
        _submenu.classList.add('hidden');
        return;
    }
    _submenu.innerHTML = '';

    const anyItem = document.createElement('button');
    anyItem.className = 'random-picker-item';
    anyItem.textContent = 'Any Topic';
    anyItem.addEventListener('click', () => pickRandom(difficulty, null));
    _submenu.appendChild(anyItem);

    for (const { tag, count } of tags) {
        const item = document.createElement('button');
        item.className = 'random-picker-item';
        item.innerHTML = `${tag} <span class="random-picker-count">(${count})</span>`;
        item.addEventListener('click', () => pickRandom(difficulty, tag));
        _submenu.appendChild(item);
    }
    _submenu.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initRandomPicker() {
    _wrapper = document.getElementById('random-picker-wrapper');
    if (!_wrapper) return;

    _btn = document.getElementById('random-btn');

    _menu = document.createElement('div');
    _menu.className = 'random-picker-menu';

    _submenu = document.createElement('div');
    _submenu.className = 'random-picker-submenu hidden';

    _container = document.createElement('div');
    _container.className = 'random-picker-dropdown hidden';
    _container.appendChild(_menu);
    _container.appendChild(_submenu);
    _wrapper.appendChild(_container);

    _btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_container.classList.contains('hidden')) openDropdown();
        else closeDropdown();
    });
}
