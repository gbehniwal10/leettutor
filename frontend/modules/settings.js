// Settings module — SettingsManager, theme system, and settings modal.

import * as monaco from 'monaco-editor';
import { state } from './state.js';
import { DEFAULT_SETTINGS, FONT_FAMILY_MAP, THEME_TO_MONACO } from './constants.js';
import { trapFocus, releaseFocus } from './utils.js';

// --- Settings Manager ---

class SettingsManager {
    constructor(defaults) {
        this._defaults = { ...defaults };
        this._overrides = {};
        this._listeners = {};
        this._anyListeners = new Set();
        this._load();
    }
    _load() {
        try {
            const raw = localStorage.getItem('leettutor_settings');
            if (raw) this._overrides = JSON.parse(raw);
        } catch (e) { this._overrides = {}; }
    }
    _save() {
        try {
            if (Object.keys(this._overrides).length === 0) localStorage.removeItem('leettutor_settings');
            else localStorage.setItem('leettutor_settings', JSON.stringify(this._overrides));
        } catch (e) {}
    }
    get(key) { return key in this._overrides ? this._overrides[key] : this._defaults[key]; }
    set(key, value) {
        const old = this.get(key);
        if (value === this._defaults[key]) delete this._overrides[key];
        else this._overrides[key] = value;
        this._save();
        if (old !== value) this._emit(key, value, old);
    }
    reset(key) {
        const old = this.get(key);
        delete this._overrides[key];
        this._save();
        if (old !== this._defaults[key]) this._emit(key, this._defaults[key], old);
    }
    resetAll() {
        const prev = this.getAll();
        this._overrides = {};
        this._save();
        for (const key of Object.keys(this._defaults)) {
            if (prev[key] !== this._defaults[key]) this._emit(key, this._defaults[key], prev[key]);
        }
    }
    getAll() { return { ...this._defaults, ...this._overrides }; }
    onChange(key, cb) {
        if (!this._listeners[key]) this._listeners[key] = new Set();
        this._listeners[key].add(cb);
    }
    onAnyChange(cb) { this._anyListeners.add(cb); }
    _emit(key, value, old) {
        if (this._listeners[key]) for (const cb of this._listeners[key]) cb(value, old, key);
        for (const cb of this._anyListeners) cb(key, value, old);
    }
}

export const settingsManager = new SettingsManager(DEFAULT_SETTINGS);

// --- Settings Modal ---

export function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    syncSettingsUI();
    trapFocus(modal);
}

export function hideSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
    releaseFocus();
}

function syncSettingsUI() {
    const all = settingsManager.getAll();
    for (const [key, value] of Object.entries(all)) {
        const el = document.getElementById('setting-' + key);
        if (!el) continue;
        if (el.type === 'checkbox') el.checked = value;
        else if (el.type === 'range') { el.value = value; _updateRangeDisplay(key, value); }
        else el.value = value;
    }
}

function _updateRangeDisplay(key, value) {
    const span = document.getElementById('setting-' + key + '-value');
    if (!span) return;
    if (key === 'ambientVolume' || key === 'earconVolume') span.textContent = Math.round(value * 100) + '%';
    else if (key === 'inactivityNudgeMinutes') span.textContent = value == 0 ? 'Off' : value + ' min';
    else if (key === 'uiFontSize') span.textContent = value + 'px';
    else span.textContent = value;
}

// --- Settings Controls Init ---

export function initSettingsControls() {
    document.querySelectorAll('[data-setting]').forEach(el => {
        const key = el.dataset.setting;
        const event = (el.type === 'range') ? 'input' : 'change';
        el.addEventListener(event, () => {
            let value;
            if (el.type === 'checkbox') value = el.checked;
            else if (el.type === 'range') {
                value = el.step && el.step.includes('.') ? parseFloat(el.value) : parseInt(el.value, 10);
                _updateRangeDisplay(key, value);
            } else value = el.value;
            settingsManager.set(key, value);
        });
    });
    settingsManager.onChange('theme', v => document.documentElement.setAttribute('data-theme', v));
    settingsManager.onChange('reducedMotion', v => document.documentElement.setAttribute('data-reduced-motion', v));
    for (const key of ['editorFontSize', 'editorFontFamily', 'editorLineHeight', 'editorLigatures']) {
        settingsManager.onChange(key, () => applyEditorSettings());
    }
}

// --- Editor Settings ---

export function applyEditorSettings() {
    if (!state.editorReady || !state.editor) return;
    const s = settingsManager.getAll();
    state.editor.updateOptions({
        fontSize: s.editorFontSize,
        fontFamily: FONT_FAMILY_MAP[s.editorFontFamily] || FONT_FAMILY_MAP['default'],
        lineHeight: Math.round(s.editorFontSize * s.editorLineHeight),
        fontLigatures: s.editorLigatures,
    });
}

// --- Theme System ---

export function registerMonacoThemes() {
    // Dark theme (refined)
    monaco.editor.defineTheme('leetcode-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword', fontStyle: 'bold' },
        ],
        colors: {
            'editor.background': '#1e1e1e',
            'editor.foreground': '#d4d4d4',
        }
    });

    // Sepia theme (light, warm tones for dyslexia)
    monaco.editor.defineTheme('leetcode-sepia', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'keyword', foreground: '859900', fontStyle: 'bold' },
            { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
            { token: 'string', foreground: '2aa198' },
            { token: 'number', foreground: 'd33682' },
            { token: 'type', foreground: 'b58900' },
            { token: 'identifier', foreground: '586e75' },
            { token: 'delimiter', foreground: '586e75' },
        ],
        colors: {
            'editor.background': '#fdf6e3',
            'editor.foreground': '#1e1e1e',
            'editor.lineHighlightBackground': '#f5eed6',
            'editor.selectionBackground': '#eee8c8',
            'editorCursor.foreground': '#586e75',
            'editorLineNumber.foreground': '#93a1a1',
        }
    });

    // Low-Distraction / Muted theme (dark, desaturated syntax colors)
    monaco.editor.defineTheme('leetcode-muted', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword', foreground: 'a0a0a0', fontStyle: 'bold' },
            { token: 'comment', foreground: '666666', fontStyle: 'italic' },
            { token: 'string', foreground: '8fbc8f' },
            { token: 'number', foreground: 'cdcd8c' },
            { token: 'type', foreground: 'a0a0a0' },
            { token: 'identifier', foreground: 'c0c0c0' },
            { token: 'delimiter', foreground: '808080' },
        ],
        colors: {
            'editor.background': '#2b2b2b',
            'editor.foreground': '#c0c0c0',
            'editor.lineHighlightBackground': '#313131',
            'editor.selectionBackground': '#383838',
            'editorCursor.foreground': '#808080',
            'editorLineNumber.foreground': '#606060',
        }
    });
}

export function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    const monacoTheme = THEME_TO_MONACO[themeName] || 'leetcode-dark';
    monaco.editor.setTheme(monacoTheme);
}

function applyReducedMotion(value) {
    if (value === 'system') {
        document.documentElement.removeAttribute('data-reduced-motion');
    } else {
        document.documentElement.setAttribute('data-reduced-motion', value);
    }
}

function detectOSThemePreference() {
    // Only apply OS preference if user has never explicitly set a theme
    var raw = localStorage.getItem('leettutor_settings');
    if (raw) {
        try {
            var saved = JSON.parse(raw);
            if (saved.theme) return; // User has an explicit preference
        } catch (e) { /* ignore */ }
    }
    // No saved theme preference -- detect OS preference
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        settingsManager.set('theme', 'sepia');
    }
}

export function initThemeSystem() {
    // Register onChange listeners for theme and reduced motion
    settingsManager.onChange('theme', applyTheme);
    settingsManager.onChange('reducedMotion', applyReducedMotion);

    // Apply current settings immediately
    applyTheme(settingsManager.get('theme'));
    applyReducedMotion(settingsManager.get('reducedMotion'));

    // Detect OS theme preference on first load
    detectOSThemePreference();
}

// --- Reduced Motion Helper ---

export function shouldReduceMotion() {
    const pref = settingsManager.get('reducedMotion');
    if (pref === 'on') return true;
    if (pref === 'off') return false;
    // 'system' — defer to OS preference
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
