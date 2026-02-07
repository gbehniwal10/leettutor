// --- Settings Manager ---

const DEFAULT_SETTINGS = {
    theme: "dark",
    editorFontSize: 14,
    editorFontFamily: "default",
    editorLineHeight: 1.5,
    editorLigatures: false,
    zenMode: false,
    inactivityNudgeMinutes: 2,
    ambientSound: "off",
    ambientVolume: 0.3,
    earcons: false,
    earconVolume: 0.3,
    reducedMotion: "system",
    confirmDestructive: true,
    uiFontSize: 14,
};

const FONT_FAMILY_MAP = {
    "default": "'Consolas', 'Courier New', monospace",
    "jetbrains-mono": "'JetBrains Mono', 'Consolas', monospace",
    "fira-code": "'Fira Code', 'Consolas', monospace",
    "comic-mono": "'Comic Mono', 'Comic Sans MS', monospace",
};

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

const settingsManager = new SettingsManager(DEFAULT_SETTINGS);

// --- Modal Focus Trap (Ticket 44) ---

const _focusTrapState = {
    activeModal: null,
    triggerElement: null,
    keyHandler: null,
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(modalElement, triggerElement) {
    // Release any existing trap first
    if (_focusTrapState.activeModal) {
        releaseFocus(false);
    }

    _focusTrapState.activeModal = modalElement;
    _focusTrapState.triggerElement = triggerElement || document.activeElement;

    function keyHandler(e) {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter(el => el.offsetParent !== null);
        if (focusable.length === 0) {
            e.preventDefault();
            return;
        }
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

    _focusTrapState.keyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler, true);

    // Move focus into modal: first focusable element, or the modal itself
    requestAnimationFrame(() => {
        const focusable = Array.from(modalElement.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter(el => el.offsetParent !== null);
        if (focusable.length > 0) {
            focusable[0].focus();
        } else {
            modalElement.setAttribute('tabindex', '-1');
            modalElement.focus();
        }
    });
}

function releaseFocus(restoreFocus) {
    if (restoreFocus === undefined) restoreFocus = true;
    if (_focusTrapState.keyHandler) {
        document.removeEventListener('keydown', _focusTrapState.keyHandler, true);
        _focusTrapState.keyHandler = null;
    }
    if (restoreFocus && _focusTrapState.triggerElement) {
        try { _focusTrapState.triggerElement.focus(); } catch (e) { /* element may be gone */ }
    }
    _focusTrapState.activeModal = null;
    _focusTrapState.triggerElement = null;
}

function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    syncSettingsUI();
    trapFocus(modal);
}

function hideSettingsModal() {
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

function initSettingsControls() {
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

function applyEditorSettings() {
    if (!state.editorReady || !state.editor) return;
    const s = settingsManager.getAll();
    state.editor.updateOptions({
        fontSize: s.editorFontSize,
        fontFamily: FONT_FAMILY_MAP[s.editorFontFamily] || FONT_FAMILY_MAP["default"],
        lineHeight: Math.round(s.editorFontSize * s.editorLineHeight),
        fontLigatures: s.editorLigatures,
    });
}

// --- Theme System (Ticket 23) ---

const THEME_TO_MONACO = {
    'dark': 'leetcode-dark',
    'sepia': 'leetcode-sepia',
    'low-distraction': 'leetcode-muted',
};

function registerMonacoThemes() {
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

function applyTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    if (typeof monaco !== 'undefined' && monaco.editor) {
        var monacoTheme = THEME_TO_MONACO[themeName] || 'leetcode-dark';
        monaco.editor.setTheme(monacoTheme);
    }
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
    // No saved theme preference — detect OS preference
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        settingsManager.set('theme', 'sepia');
    }
}

function initThemeSystem() {
    // Register onChange listeners for theme and reduced motion
    settingsManager.onChange('theme', applyTheme);
    settingsManager.onChange('reducedMotion', applyReducedMotion);

    // Apply current settings immediately
    applyTheme(settingsManager.get('theme'));
    applyReducedMotion(settingsManager.get('reducedMotion'));

    // Detect OS theme preference on first load
    detectOSThemePreference();
}

// --- Pattern Quiz Data ---

const TAG_TO_PATTERN = {
    "two-pointers": "Two Pointers",
    "two-pointer": "Two Pointers",
    "sliding-window": "Sliding Window",
    "binary-search": "Binary Search",
    "stack": "Stack",
    "monotonic-stack": "Stack",
    "monotonic-queue": "Stack",
    "heap-(priority-queue)": "Heap / Priority Queue",
    "linked-list": "Linked List",
    "tree": "Trees",
    "binary-tree": "Trees",
    "binary-search-tree": "Trees",
    "graph": "Graphs (BFS/DFS)",
    "depth-first-search": "Graphs (BFS/DFS)",
    "breadth-first-search": "Graphs (BFS/DFS)",
    "topological-sort": "Graphs (BFS/DFS)",
    "shortest-path": "Graphs (BFS/DFS)",
    "minimum-spanning-tree": "Graphs (BFS/DFS)",
    "dynamic-programming": "Dynamic Programming",
    "memoization": "Dynamic Programming",
    "backtracking": "Backtracking",
    "greedy": "Greedy",
    "trie": "Trie",
    "union-find": "Union Find",
    "math": "Math / Bit Manipulation",
    "bit-manipulation": "Math / Bit Manipulation",
    "prefix-sum": "Sliding Window",
    "divide-and-conquer": "Binary Search",
    "hash-map": "Arrays & Hashing",
    "hash-table": "Arrays & Hashing",
    "hash-function": "Arrays & Hashing",
};

const PATTERN_LIST = [
    "Arrays & Hashing", "Two Pointers", "Sliding Window", "Binary Search",
    "Stack", "Heap / Priority Queue", "Linked List", "Trees",
    "Graphs (BFS/DFS)", "Dynamic Programming", "Backtracking", "Greedy",
    "Trie", "Union Find", "Math / Bit Manipulation",
];

const state = {
    mode: 'learning',
    currentProblem: null,
    sessionId: null,
    editor: null,
    editorReady: false,
    ws: null,
    wsReady: false,
    timerInterval: null,
    timeSyncInterval: null,
    timeRemaining: 45 * 60,
    inReview: false,
    allProblems: [],
    authToken: null,
    authRequired: false,
    patternQuizAnswered: false,
    enhancedMode: false,
    resuming: false,
    resumeTimeoutId: null,
};

// --- URL Hash Helpers ---

function setSessionHash(sessionId) {
    if (sessionId) {
        history.replaceState(null, '', '#session=' + sessionId);
    }
}

function clearSessionHash() {
    history.replaceState(null, '', window.location.pathname + window.location.search);
}

function getSessionFromHash() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#session=')) {
        return hash.slice('#session='.length);
    }
    return null;
}

document.addEventListener('DOMContentLoaded', async () => {
    // Check if auth is required before initializing
    await checkAuth();
    initMonacoEditor();
    initWebSocket();
    initEventListeners();
    loadProblems();
});

async function checkAuth() {
    try {
        const resp = await fetch('/api/auth/status');
        const data = await resp.json();
        state.authRequired = data.auth_required;
    } catch (e) {
        console.warn('Failed to check auth status:', e);
        return;
    }
    // Try to restore token from sessionStorage
    const saved = sessionStorage.getItem('leettutor_token');
    if (saved) { state.authToken = saved; }
    if (state.authRequired && !state.authToken) {
        await showLoginModal();
    }
}

function showLoginModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('login-modal');
        modal.classList.remove('hidden');
        const btn = document.getElementById('login-btn');
        const input = document.getElementById('login-password');
        const error = document.getElementById('login-error');
        error.textContent = '';
        input.value = '';

        async function doLogin() {
            const password = document.getElementById('login-password').value;
            if (!password) return;
            btn.disabled = true;
            btn.textContent = 'Logging in...';
            try {
                const resp = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                });
                if (!resp.ok) {
                    error.textContent = 'Invalid password.';
                    btn.disabled = false;
                    btn.textContent = 'Login';
                    return;
                }
                const data = await resp.json();
                state.authToken = data.token;
                sessionStorage.setItem('leettutor_token', data.token);
                modal.classList.add('hidden');
                releaseFocus();
                resolve();
            } catch (e) {
                error.textContent = 'Connection error.';
                btn.disabled = false;
                btn.textContent = 'Login';
            }
        }

        // Remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', doLogin);

        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
        newInput.value = '';
        newInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
        });

        // Trap focus after cloning (elements are now in DOM)
        trapFocus(modal);
    });
}

function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.authToken) {
        headers['Authorization'] = 'Bearer ' + state.authToken;
    }
    return headers;
}

async function handleAuthError(response) {
    if (response.status === 401 && state.authRequired) {
        state.authToken = null;
        sessionStorage.removeItem('leettutor_token');
        await showLoginModal();
        return true; // caller should retry
    }
    return false;
}

function renderMarkdown(text) {
    try {
        if (typeof marked !== 'undefined' && marked.parse) {
            const html = marked.parse(text);
            if (typeof DOMPurify !== 'undefined') {
                return DOMPurify.sanitize(html);
            }
            console.warn('DOMPurify not loaded — stripping all HTML tags as safe fallback');
            const tmp = document.createElement('div');
            tmp.textContent = html;
            return tmp.innerHTML;
        }
    } catch (e) { console.warn('renderMarkdown failed:', e); }
    return escapeHtml(text);
}

function initMonacoEditor() {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

    require(['vs/editor/editor.main'], function () {
        // Register all three Monaco themes
        registerMonacoThemes();

        const s = settingsManager.getAll();
        const initialMonacoTheme = THEME_TO_MONACO[s.theme] || 'leetcode-dark';
        state.editor = monaco.editor.create(document.getElementById('editor'), {
            value: '# Select a problem to begin',
            language: 'python',
            theme: initialMonacoTheme,
            fontSize: s.editorFontSize,
            fontFamily: FONT_FAMILY_MAP[s.editorFontFamily] || FONT_FAMILY_MAP["default"],
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

let _wsReconnectAttempts = 0;
const _WS_MAX_BACKOFF_MS = 30000;
let _reconnectTimeoutId = null;
let _reconnectInFlight = false;

function initWebSocket() {
    // Prevent multiple simultaneous reconnect attempts
    if (_reconnectInFlight) return;
    _reconnectInFlight = true;
    // Clear any pending reconnect timeout since we are connecting now
    if (_reconnectTimeoutId !== null) {
        clearTimeout(_reconnectTimeoutId);
        _reconnectTimeoutId = null;
    }

    // Close any existing connection before creating a new one
    if (state.ws) {
        try { state.ws.close(); } catch (e) { /* ignore */ }
        state.ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);

    state.ws.onopen = () => {
        // Send auth token as first message
        state.ws.send(JSON.stringify({ type: 'auth', token: state.authToken || '' }));
        state.wsReady = true;
        _reconnectInFlight = false;
        _wsReconnectAttempts = 0;
        const banner = document.getElementById('ws-status');
        if (banner) banner.classList.add('hidden');

        // Attempt to resume session from URL hash
        const hashSession = getSessionFromHash();
        if (hashSession && !state.sessionId && !state.resuming) {
            resumeSession(hashSession);
        }
    };
    state.ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
            return;
        }
        handleWebSocketMessage(data);
    };
    state.ws.onclose = async (event) => {
        state.wsReady = false;
        _reconnectInFlight = false;
        if (state.resuming) clearResumeState();
        const banner = document.getElementById('ws-status');
        if (banner) banner.classList.remove('hidden');
        // Auth rejection — do not reconnect, prompt for login
        if (event.code === 4001) {
            state.authToken = null;
            sessionStorage.removeItem('leettutor_token');
            await showLoginModal();
            initWebSocket();
            return;
        }
        // Clear any already-pending reconnect timeout to prevent stacking
        if (_reconnectTimeoutId !== null) {
            clearTimeout(_reconnectTimeoutId);
            _reconnectTimeoutId = null;
        }
        // Exponential backoff with jitter
        const baseDelay = Math.min(_WS_MAX_BACKOFF_MS, 1000 * Math.pow(2, _wsReconnectAttempts));
        const jitter = Math.random() * baseDelay * 0.5;
        const delay = baseDelay + jitter;
        _wsReconnectAttempts++;
        _reconnectTimeoutId = setTimeout(initWebSocket, delay);
    };
    state.ws.onerror = () => {};
}

function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
        return true;
    }
    console.warn('WebSocket not connected, message dropped:', obj.type);
    // Requirement 2: Visible notification when messages fail to send
    showConnectionNotification('Connection lost, reconnecting...');
    return false;
}

function showConnectionNotification(message) {
    let notification = document.getElementById('ws-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'ws-notification';
        notification.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#e74c3c;color:#fff;padding:8px 20px;border-radius:6px;z-index:1100;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:opacity 0.3s;';
        document.body.appendChild(notification);
    }
    notification.textContent = message;
    notification.style.opacity = '1';
    notification.style.display = 'block';
    clearTimeout(notification._hideTimer);
    notification._hideTimer = setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => { notification.style.display = 'none'; }, 300);
    }, 5000);
}

function initEventListeners() {
    document.getElementById('mode-select').addEventListener('change', (e) => { state.mode = e.target.value; updateModeUI(); });
    document.getElementById('new-problem-btn').addEventListener('click', showProblemModal);
    document.getElementById('close-modal').addEventListener('click', hideProblemModal);
    document.getElementById('toggle-problem').addEventListener('click', toggleProblemDescription);
    document.getElementById('expand-problem').addEventListener('click', toggleProblemPanel);
    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('submit-btn').addEventListener('click', submitCode);
    document.getElementById('reset-btn').addEventListener('click', () => resetCodeWithConfirm());
    document.getElementById('restart-btn').addEventListener('click', () => restartSessionWithConfirm());
    document.getElementById('hint-btn').addEventListener('click', requestHint);
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('history-btn').addEventListener('click', showHistoryModal);
    document.getElementById('close-history').addEventListener('click', hideHistoryModal);
    document.getElementById('history-back').addEventListener('click', showSessionList);
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
        syncSettingsUI();
    });
    // Close settings when clicking overlay background
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) hideSettingsModal();
    });
    // Collapsible section headers
    document.querySelectorAll('.settings-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const expanded = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', String(!expanded));
            header.nextElementSibling.classList.toggle('collapsed', expanded);
        });
    });
    // Wire up all settings controls
    initSettingsControls();

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape closes the currently open modal
        if (e.key === 'Escape') {
            const problemModal = document.getElementById('problem-modal');
            const historyModal = document.getElementById('history-modal');
            const settingsModal = document.getElementById('settings-modal');
            if (problemModal && !problemModal.classList.contains('hidden')) {
                hideProblemModal();
            } else if (historyModal && !historyModal.classList.contains('hidden')) {
                hideHistoryModal();
            } else if (settingsModal && !settingsModal.classList.contains('hidden')) {
                hideSettingsModal();
            }
            return;
        }
        // Don't fire shortcuts when typing in chat
        if (document.activeElement === document.getElementById('chat-input')) return;
        if (e.ctrlKey && e.shiftKey && e.key === 'Enter') { e.preventDefault(); submitCode(); }
        else if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runCode(); }
        else if (e.ctrlKey && e.key === 'h') { e.preventDefault(); requestHint(); }
    });
}

async function loadProblems() {
    try {
        const response = await fetch('/api/problems', { headers: authHeaders() });
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        state.allProblems = await response.json();
        renderProblemList(state.allProblems);
        initProblemFilters();
    } catch (error) {
        console.error('Failed to load problems:', error);
        const container = document.getElementById('problem-list');
        if (container) container.innerHTML = '<p style="color:var(--accent-red);padding:16px;">Failed to load problems. Please refresh.</p>';
    }
}

let _problemFiltersInitialized = false;

function initProblemFilters() {
    // Requirement 5: Prevent duplicate listener registration
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

function filterProblems() {
    const search = (document.getElementById('problem-search').value || '').toLowerCase();
    const difficulty = document.querySelector('.difficulty-tab.active')?.dataset.difficulty || 'all';
    const statusFilter = document.querySelector('.status-tab.active')?.dataset.status || 'all';
    const filtered = state.allProblems.filter(p => {
        if (difficulty !== 'all' && p.difficulty !== difficulty) return false;
        if (statusFilter !== 'all' && (p.status || 'unsolved') !== statusFilter) return false;
        if (search && !p.title.toLowerCase().includes(search) && !p.tags.some(t => t.includes(search))) return false;
        return true;
    });
    renderProblemList(filtered);
}

function renderProblemList(problems) {
    const container = document.getElementById('problem-list');
    container.innerHTML = problems.map(p => {
        const status = p.status || 'unsolved';
        let indicator = '';
        if (status === 'solved') indicator = '<span class="status-indicator status-solved">&#10003;</span>';
        else if (status === 'attempted') indicator = '<span class="status-indicator status-attempted">&#9679;</span>';
        else indicator = '<span class="status-indicator status-unsolved"></span>';
        return `
        <div class="problem-item" data-id="${escapeHtml(String(p.id))}">
            ${indicator}
            <span class="title">${escapeHtml(p.title)}</span>
            <span class="difficulty ${escapeHtml(p.difficulty)}">${escapeHtml(p.difficulty)}</span>
            <div class="tags">${p.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.problem-item').forEach(item => {
        item.addEventListener('click', () => selectProblem(item.dataset.id));
    });
}

function timeAgo(isoString) {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

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
                // Trap focus within dialog
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

let _selectProblemLoading = false;

async function selectProblem(problemId) {
    // Requirement 3: Guard against concurrent calls
    if (_selectProblemLoading) return;
    _selectProblemLoading = true;

    // Confirm ending active session before switching problems
    if (state.sessionId && settingsManager.get('confirmDestructive')) {
        const problemTitle = state.currentProblem ? state.currentProblem.title : 'this problem';
        const confirmed = await showConfirmDialog({
            title: 'Switch problems?',
            message: 'End your session on "' + problemTitle + '" and switch to a new problem?',
            detail: 'Your progress will be saved. You can resume later from history.',
            confirmLabel: 'Switch',
            cancelLabel: 'Keep Going',
        });
        if (!confirmed) {
            _selectProblemLoading = false;
            return;
        }
        endSession();
    }

    try {
        const response = await fetch(`/api/problems/${problemId}`);
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        state.currentProblem = await response.json();
    } catch (error) {
        console.error('Failed to fetch problem:', error);
        _selectProblemLoading = false;
        return;
    }

    // Check for a previous resumable session (skip for pattern-quiz)
    if (state.mode !== 'pattern-quiz') {
        try {
            const res = await fetch(`/api/sessions/latest-resumable?problem_id=${encodeURIComponent(problemId)}`, { headers: authHeaders() });
            if (!res.ok) {
                throw new Error(`Server returned ${res.status}`);
            }
            const prevSession = await res.json();
            if (prevSession && prevSession.session_id) {
                const choice = await showResumeDialog(prevSession);
                if (choice === 'resume') {
                    hideProblemModal();
                    resumeSession(prevSession.session_id);
                    _selectProblemLoading = false;
                    return;
                }
                if (choice === 'cancel') {
                    _selectProblemLoading = false;
                    return;
                }
                // 'fresh' falls through to normal flow
            }
        } catch (err) {
            console.warn('Failed to check for resumable session:', err);
        }
    }

    // Update UI — each step independent so one failure doesn't block the rest
    document.getElementById('problem-title').textContent = state.currentProblem.title;
    document.getElementById('problem-difficulty').textContent = state.currentProblem.difficulty;
    document.getElementById('problem-difficulty').className = `difficulty ${state.currentProblem.difficulty}`;
    const solvedBadge = document.getElementById('problem-solved-badge');
    const probEntry = state.allProblems.find(p => p.id === state.currentProblem.id);
    if (probEntry && probEntry.status === 'solved') solvedBadge.classList.remove('hidden');
    else solvedBadge.classList.add('hidden');
    document.getElementById('problem-description').innerHTML = renderMarkdown(state.currentProblem.description);

    // Ensure problem panel is expanded
    const panel = document.getElementById('problem-panel');
    if (panel.classList.contains('collapsed')) toggleProblemPanel();

    if (state.editorReady && state.editor) {
        state.editor.setValue(state.currentProblem.starter_code);
    }

    document.getElementById('test-results').innerHTML = '';
    hideProblemModal();

    if (_inactivityDetector) _inactivityDetector.suppressed = false;
    if (state.mode === 'pattern-quiz') {
        clearSessionHash();
        resetPatternQuiz();
    } else {
        startSession();
    }
    _selectProblemLoading = false;
}

function showProblemModal() {
    const modal = document.getElementById('problem-modal');
    modal.classList.remove('hidden');
    const search = document.getElementById('problem-search');
    if (search) { search.value = ''; }
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('.filter-tab[data-difficulty="all"]');
    if (allTab) allTab.classList.add('active');
    renderProblemList(state.allProblems);
    trapFocus(modal);
}
function hideProblemModal() {
    document.getElementById('problem-modal').classList.add('hidden');
    releaseFocus();
}
let savedProblemPanelWidth = 350;

function toggleProblemPanel() {
    const panel = document.getElementById('problem-panel');
    const expandBtn = document.getElementById('expand-problem');
    const toggleBtn = document.getElementById('toggle-problem');
    const resizeHandle = document.getElementById('problem-panel-resize');
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        panel.style.width = savedProblemPanelWidth + 'px';
        expandBtn.style.display = 'none';
        resizeHandle.style.display = '';
        if (toggleBtn) {
            toggleBtn.title = 'Collapse problem panel';
            toggleBtn.setAttribute('aria-label', 'Collapse problem panel');
        }
    } else {
        savedProblemPanelWidth = panel.getBoundingClientRect().width || 350;
        panel.classList.add('collapsed');
        panel.style.width = '0';
        expandBtn.style.display = 'block';
        resizeHandle.style.display = 'none';
        if (toggleBtn) {
            toggleBtn.title = 'Expand problem panel';
            toggleBtn.setAttribute('aria-label', 'Expand problem panel');
        }
    }
}

function toggleProblemDescription() {
    toggleProblemPanel();
}

function startSession() {
    clearResumeState();
    // Clear whiteboard for new session
    if (_whiteboardSaveTimeout) { clearTimeout(_whiteboardSaveTimeout); _whiteboardSaveTimeout = null; }
    if (window.excalidrawBridge) window.excalidrawBridge.clear();
    if (!wsSend({ type: 'start_session', problem_id: state.currentProblem.id, mode: state.mode })) {
        addChatMessage('system', 'WebSocket not connected. Trying to reconnect...');
        return;
    }
    document.getElementById('chat-messages').innerHTML = '';
    addChatMessage('system', `Starting ${state.mode} session for "${state.currentProblem.title}"`);
    if (state.mode === 'interview') startTimer();
    // Reconnect MutationObservers for new session (Ticket 47)
    if (settingsManager.get('earcons')) {
        connectEarconObserver();
    }
    connectTtsObserver();
}

function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
    state.timeRemaining = 45 * 60;
    state.inReview = false;
    document.getElementById('timer').classList.remove('hidden');
    updateTimerDisplay();
    state.timerInterval = setInterval(() => {
        state.timeRemaining--;
        updateTimerDisplay();
        if (state.timeRemaining <= 0) { clearInterval(state.timerInterval); clearInterval(state.timeSyncInterval); handleTimeUp(); }
    }, 1000);
    // Sync time to backend every 30 seconds
    state.timeSyncInterval = setInterval(() => {
        wsSend({ type: 'time_update', time_remaining: state.timeRemaining });
    }, 30000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(state.timeRemaining / 60);
    const seconds = state.timeRemaining % 60;
    document.getElementById('timer-display').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const timer = document.getElementById('timer');
    timer.classList.remove('warning', 'danger');
    if (state.timeRemaining <= 300) timer.classList.add('danger');
    else if (state.timeRemaining <= 600) timer.classList.add('warning');
}

function handleTimeUp() {
    addChatMessage('system', "Time's up! Moving to review phase.");
    wsSend({ type: 'time_up', code: getEditorValue() });
}

function startTimerFromRemaining(seconds) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
    state.timeRemaining = seconds;
    state.inReview = false;
    document.getElementById('timer').classList.remove('hidden');
    updateTimerDisplay();
    state.timerInterval = setInterval(() => {
        state.timeRemaining--;
        updateTimerDisplay();
        if (state.timeRemaining <= 0) { clearInterval(state.timerInterval); clearInterval(state.timeSyncInterval); handleTimeUp(); }
    }, 1000);
    state.timeSyncInterval = setInterval(() => {
        wsSend({ type: 'time_update', time_remaining: state.timeRemaining });
    }, 30000);
}

function resumeSession(sessionId) {
    if (state.resuming) return;
    state.resuming = true;
    addChatMessage('system', 'Resuming session...');
    wsSend({ type: 'resume_session', session_id: sessionId });
    // Reconnect MutationObservers for resumed session (Ticket 47)
    if (settingsManager.get('earcons')) {
        connectEarconObserver();
    }
    connectTtsObserver();
    // Timeout: if no resume confirmation within 10s, reset the flag
    if (state.resumeTimeoutId !== null) clearTimeout(state.resumeTimeoutId);
    state.resumeTimeoutId = setTimeout(() => {
        if (state.resuming) {
            state.resuming = false;
            state.resumeTimeoutId = null;
            addChatMessage('system', 'Resume timed out. You can start a new session.');
        }
    }, 10000);
}

function clearResumeState() {
    state.resuming = false;
    if (state.resumeTimeoutId !== null) {
        clearTimeout(state.resumeTimeoutId);
        state.resumeTimeoutId = null;
    }
}

async function handleSessionResumed(data) {
    clearResumeState();
    state.sessionId = data.session_id;
    state.mode = data.mode;
    state.inReview = false;
    setSessionHash(data.session_id);

    // Update mode selector
    const modeSelect = document.getElementById('mode-select');
    if (modeSelect) modeSelect.value = data.mode;
    updateModeUI();

    // Load problem data (skip fetch if already loaded by selectProblem)
    if (!state.currentProblem || state.currentProblem.id !== data.problem_id) {
        try {
            const response = await fetch(`/api/problems/${data.problem_id}`);
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            state.currentProblem = await response.json();
        } catch (e) {
            console.error('Failed to load problem for resumed session:', e);
            addChatMessage('system', 'Failed to load problem data.');
            return;
        }
    }

    // Update problem UI
    document.getElementById('problem-title').textContent = state.currentProblem.title;
    document.getElementById('problem-difficulty').textContent = state.currentProblem.difficulty;
    document.getElementById('problem-difficulty').className = `difficulty ${state.currentProblem.difficulty}`;
    const solvedBadgeR = document.getElementById('problem-solved-badge');
    const probEntryR = state.allProblems.find(p => p.id === state.currentProblem.id);
    if (probEntryR && probEntryR.status === 'solved') solvedBadgeR.classList.remove('hidden');
    else solvedBadgeR.classList.add('hidden');
    document.getElementById('problem-description').innerHTML = renderMarkdown(state.currentProblem.description);
    const panel = document.getElementById('problem-panel');
    if (panel.classList.contains('collapsed')) toggleProblemPanel();

    // Restore editor code
    if (data.last_editor_code && state.editorReady && state.editor) {
        state.editor.setValue(data.last_editor_code);
    } else if (state.editorReady && state.editor) {
        state.editor.setValue(state.currentProblem.starter_code);
    }

    document.getElementById('test-results').innerHTML = '';

    // Restore chat history
    const chatContainer = document.getElementById('chat-messages');
    chatContainer.innerHTML = '';

    addChatMessage('system', `Resumed session for "${state.currentProblem.title}" (${data.mode} mode)`);
    const history = data.chat_history || [];
    for (const msg of history) {
        const role = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system';
        addChatMessage(role, msg.content);
    }

    // Handle interview timer restoration
    if (data.mode === 'interview') {
        if (data.interview_phase === 'review') {
            state.inReview = true;
            document.getElementById('timer').classList.add('hidden');
            addChatMessage('system', 'Review phase.');
        } else if (data.time_remaining && data.time_remaining > 0) {
            startTimerFromRemaining(data.time_remaining);
        } else {
            startTimer();
        }
    }

    // Restore whiteboard state
    if (data.whiteboard_state && window.excalidrawBridge && window.excalidrawBridge.restoreState) {
        window.excalidrawBridge.restoreState(data.whiteboard_state);
    } else if (window.excalidrawBridge && window.excalidrawBridge.clear) {
        window.excalidrawBridge.clear();
    }
}

function updateModeUI() {
    const isQuiz = state.mode === 'pattern-quiz';
    const editorSection = document.querySelector('.editor-section');
    const actions = document.querySelector('.actions');
    const resultsResize = document.getElementById('results-resize');
    const testResults = document.getElementById('test-results');
    const rightPanel = document.querySelector('.right-panel');
    const chatResize = document.getElementById('chat-panel-resize');
    const quizPanel = document.getElementById('pattern-quiz-panel');
    const enhancedToggle = document.getElementById('enhanced-toggle');

    if (isQuiz) {
        // Hide coding UI
        if (editorSection) editorSection.classList.add('hidden');
        if (actions) actions.classList.add('hidden');
        if (resultsResize) resultsResize.classList.add('hidden');
        if (testResults) testResults.classList.add('hidden');
        if (rightPanel) rightPanel.classList.add('hidden');
        if (chatResize) chatResize.classList.add('hidden');
        // Show quiz UI
        if (quizPanel) quizPanel.classList.remove('hidden');
        if (enhancedToggle) enhancedToggle.classList.remove('hidden');
        document.getElementById('timer').classList.add('hidden');
        if (state.timerInterval) clearInterval(state.timerInterval);
        if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
        resetPatternQuiz();
    } else {
        // Show coding UI
        if (editorSection) editorSection.classList.remove('hidden');
        if (actions) actions.classList.remove('hidden');
        if (resultsResize) resultsResize.classList.remove('hidden');
        if (testResults) testResults.classList.remove('hidden');
        if (rightPanel) rightPanel.classList.remove('hidden');
        if (chatResize) chatResize.classList.remove('hidden');
        // Hide quiz UI
        if (quizPanel) quizPanel.classList.add('hidden');
        if (enhancedToggle) enhancedToggle.classList.add('hidden');

        if (state.mode === 'learning') {
            document.getElementById('timer').classList.add('hidden');
            if (state.timerInterval) clearInterval(state.timerInterval);
            if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
        }
    }
}

function getEditorValue() {
    return (state.editorReady && state.editor) ? state.editor.getValue() : '';
}

let _runCodeBusy = false;

async function runCode() {
    if (!state.currentProblem) return;
    // Requirement 4: Function-level guard to block keyboard shortcuts during execution
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
            document.getElementById('test-results').innerHTML = `<div class="result-banner wrong-answer"><span class="banner-text">Error ${response.status}</span><span class="banner-info">${escapeHtml(errText)}</span></div>`;
            return;
        }
        const results = await response.json();
        displayTestResults(results);
    } catch (error) {
        document.getElementById('test-results').innerHTML = '<div class="result-banner wrong-answer"><span class="banner-text">Error</span><span class="banner-info">Failed to run code. Check your connection.</span></div>';
    } finally {
        _runCodeBusy = false;
        btn.disabled = false;
        btn.innerHTML = '&#9654; Run';
    }
}

let _submitCodeBusy = false;

async function submitCode() {
    if (!state.currentProblem) return;
    // Requirement 4: Function-level guard to block keyboard shortcuts during execution
    if (_submitCodeBusy) return;
    _submitCodeBusy = true;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    const code = getEditorValue();
    try {
        let response = await fetch('/api/submit', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ code, problem_id: state.currentProblem.id })
        });
        if (await handleAuthError(response)) {
            response = await fetch('/api/submit', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ code, problem_id: state.currentProblem.id })
            });
        }
        if (!response.ok) {
            const errText = await response.text().catch(() => 'Unknown error');
            document.getElementById('test-results').innerHTML = `<div class="result-banner wrong-answer"><span class="banner-text">Error ${response.status}</span><span class="banner-info">${escapeHtml(errText)}</span></div>`;
            return;
        }
        const results = await response.json();
        window._isSubmitRun = true;
        displayTestResults(results);
        window._isSubmitRun = false;
        if (results.failed === 0) {
            addChatMessage('system', 'All tests passed! Great job!');
            // Optimistically update problem status in local state
            if (state.currentProblem) {
                const prob = state.allProblems.find(p => p.id === state.currentProblem.id);
                if (prob) prob.status = 'solved';
            }
            document.getElementById('problem-solved-badge').classList.remove('hidden');
            if (_inactivityDetector) _inactivityDetector.suppressed = true;
            if (state.mode === 'interview' && !state.inReview) {
                wsSend({ type: 'time_up', code });
            }
        }
    } catch (error) {
        window._isSubmitRun = false;
        document.getElementById('test-results').innerHTML = '<div class="result-banner wrong-answer"><span class="banner-text">Error</span><span class="banner-info">Failed to submit code. Check your connection.</span></div>';
    } finally {
        _submitCodeBusy = false;
        btn.disabled = false;
        btn.textContent = 'Submit';
    }
}

function displayTestResults(results) {
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
}

function requestHint() {
    if (!state.currentProblem) return;
    wsSend({ type: 'request_hint', code: getEditorValue() });
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    addChatMessage('user', content);
    wsSend({ type: 'message', content, code: getEditorValue() });
    input.value = '';
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'session_started':
            state.sessionId = data.session_id;
            if (state.mode !== 'pattern-quiz') {
                setSessionHash(data.session_id);
            }
            break;
        case 'session_resumed':
            handleSessionResumed(data);
            break;
        case 'assistant_message': finalizeAssistantMessage(data.content); break;
        case 'assistant_chunk': appendToLastAssistantMessage(data.content); break;
        case 'review_phase_started':
            state.inReview = true;
            if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
            if (state.timeSyncInterval) { clearInterval(state.timeSyncInterval); state.timeSyncInterval = null; }
            addChatMessage('system', 'Entering review phase.');
            break;
        case 'error':
            if (state.resuming) {
                clearResumeState();
                clearSessionHash();
            }
            addChatMessage('system', 'Error: ' + data.content);
            break;
    }
}

let _streamId = 0;

function finalizeAssistantMessage(content) {
    const container = document.getElementById('chat-messages');
    const lastMessage = container.querySelector('.chat-message.assistant:last-child');
    if (lastMessage && lastMessage.dataset.streaming === 'true') {
        lastMessage.dataset.streaming = 'false';
        lastMessage.innerHTML = renderMarkdown(content);
        container.scrollTop = container.scrollHeight;
        _streamId++;
        return;
    }
    addChatMessage('assistant', content);
}

function addChatMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const message = document.createElement('div');
    message.className = `chat-message ${role}`;
    message.innerHTML = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
}

function appendToLastAssistantMessage(content) {
    const container = document.getElementById('chat-messages');
    const lastMessage = container.querySelector('.chat-message.assistant:last-child');
    if (lastMessage && lastMessage.dataset.streaming === 'true' && lastMessage.dataset.streamId === String(_streamId)) {
        lastMessage.dataset.content = (lastMessage.dataset.content || '') + content;
        lastMessage.innerHTML = renderMarkdown(lastMessage.dataset.content);
    } else {
        _streamId++;
        const message = document.createElement('div');
        message.className = 'chat-message assistant';
        message.dataset.streaming = 'true';
        message.dataset.streamId = _streamId;
        message.dataset.content = content;
        message.innerHTML = renderMarkdown(content);
        container.appendChild(message);
    }
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Session History ---

function showHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.classList.remove('hidden');
    loadSessions();
    trapFocus(modal);
}

function hideHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
    releaseFocus();
}

async function loadSessions() {
    const container = document.getElementById('session-list');
    const detail = document.getElementById('session-detail');
    detail.classList.add('hidden');
    container.classList.remove('hidden');
    document.getElementById('history-back').classList.add('hidden');
    document.getElementById('history-title').textContent = 'Session History';

    try {
        let response = await fetch('/api/sessions', { headers: authHeaders() });
        if (await handleAuthError(response)) {
            response = await fetch('/api/sessions', { headers: authHeaders() });
        }
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        const sessions = await response.json();
        if (!sessions.length) {
            container.innerHTML = '<p style="color:var(--text-secondary);padding:16px;">No sessions yet.</p>';
            return;
        }
        container.innerHTML = sessions.map(s => {
            const date = new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const dur = s.duration_seconds != null ? (s.duration_seconds < 60 ? '<1m' : `${Math.round(s.duration_seconds / 60)}m`) : 'in progress';
            return `<div class="session-item" data-id="${escapeHtml(String(s.session_id))}">
                <span class="title">${escapeHtml(String(s.problem_id))}</span>
                <span class="difficulty ${s.mode === 'interview' ? 'medium' : 'easy'}">${escapeHtml(s.mode)}</span>
                <span class="session-date">${escapeHtml(date)}</span>
                <span class="session-duration">${escapeHtml(dur)}</span>
                <button class="session-delete" title="Delete session" aria-label="Delete session">\u00d7</button>
            </div>`;
        }).join('');
        container.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('session-delete')) return;
                viewSession(item.dataset.id);
            });
        });
        container.querySelectorAll('.session-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = btn.closest('.session-item');
                const sid = item.dataset.id;
                try {
                    await fetch(`/api/sessions/${sid}`, { method: 'DELETE', headers: authHeaders() });
                    item.remove();
                    if (!container.querySelector('.session-item')) {
                        container.innerHTML = '<p style="color:var(--text-secondary);padding:16px;">No sessions yet.</p>';
                    }
                } catch (err) {
                    console.error('Failed to delete session:', err);
                }
            });
        });
    } catch (error) {
        container.innerHTML = '<p style="color:var(--accent-red);padding:16px;">Failed to load sessions.</p>';
    }
}

async function viewSession(sessionId) {
    const container = document.getElementById('session-list');
    const detail = document.getElementById('session-detail');
    container.classList.add('hidden');
    detail.classList.remove('hidden');
    document.getElementById('history-back').classList.remove('hidden');

    try {
        let response = await fetch(`/api/sessions/${sessionId}`, { headers: authHeaders() });
        if (await handleAuthError(response)) {
            response = await fetch(`/api/sessions/${sessionId}`, { headers: authHeaders() });
        }
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }
        const session = await response.json();
        document.getElementById('history-title').textContent = session.problem_id + ' \u2014 ' + session.mode;
        const messages = (session.chat_history || []).map(m => {
            const cls = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system';
            const content = cls === 'assistant' ? renderMarkdown(m.content) : escapeHtml(m.content);
            return `<div class="chat-message ${cls}">${content}</div>`;
        }).join('');
        const resumeBtn = session.mode !== 'pattern-quiz'
            ? `<button id="resume-session-btn" class="btn btn-primary" data-session-id="${escapeHtml(String(sessionId))}">Resume Session</button>`
            : '';
        const meta = `<div class="session-meta">
            <span>Hints: ${session.hints_requested || 0}</span>
            <span>Duration: ${session.duration_seconds ? Math.round(session.duration_seconds / 60) + 'm' : 'N/A'}</span>
            ${resumeBtn}
        </div>`;
        detail.innerHTML = meta + '<div class="session-transcript">' + (messages || '<p style="color:var(--text-secondary)">No messages.</p>') + '</div>';

        // Attach resume button handler
        const btn = document.getElementById('resume-session-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                hideHistoryModal();
                resumeSession(btn.dataset.sessionId);
            });
        }
    } catch (error) {
        detail.innerHTML = '<p style="color:var(--accent-red);padding:16px;">Failed to load session.</p>';
    }
}

function showSessionList() {
    loadSessions();
}

// --- Pattern Quiz Mode ---

function getCorrectPatterns(problem) {
    if (!problem || !problem.tags) return [];
    const patterns = new Set();
    for (const tag of problem.tags) {
        const mapped = TAG_TO_PATTERN[tag];
        if (mapped) patterns.add(mapped);
    }
    return [...patterns];
}

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

function renderPatternStats() {
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

function renderPatternButtons() {
    const container = document.getElementById('pattern-buttons');
    if (!container) return;
    container.innerHTML = PATTERN_LIST.map(p =>
        `<button class="pattern-btn" data-pattern="${escapeHtml(p)}">${escapeHtml(p)}</button>`
    ).join('');

    container.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.addEventListener('click', () => handlePatternGuess(btn.dataset.pattern));
    });
}

function handlePatternGuess(guessed) {
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

function selectRandomProblem() {
    if (!state.allProblems.length) return;
    const idx = Math.floor(Math.random() * state.allProblems.length);
    selectProblem(state.allProblems[idx].id);
}

function resetPatternQuiz() {
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

// --- Resizable panels ---

function initResizeHandles() {
    const problemPanelHandle = document.getElementById('problem-panel-resize');
    const chatPanelHandle = document.getElementById('chat-panel-resize');
    const resultsHandle = document.getElementById('results-resize');

    // Horizontal: problem-panel width (drag right = bigger)
    initResize(problemPanelHandle, 'horizontal', {
        getSize: () => document.getElementById('problem-panel').getBoundingClientRect().width,
        setSize: (val) => { document.getElementById('problem-panel').style.width = val + 'px'; },
        getDelta: (startPos, e) => e.clientX - startPos,
        min: 200,
        max: () => window.innerWidth * 0.5,
    });

    // Horizontal: right-panel (chat) width (drag left = bigger)
    initResize(chatPanelHandle, 'horizontal', {
        getSize: () => document.querySelector('.right-panel').getBoundingClientRect().width,
        setSize: (val) => { document.querySelector('.right-panel').style.width = val + 'px'; },
        getDelta: (startPos, e) => startPos - e.clientX,
        min: 200,
        max: () => window.innerWidth * 0.5,
    });

    // Vertical: test-results height (drag upward = bigger)
    initResize(resultsHandle, 'vertical', {
        getSize: () => document.getElementById('test-results').getBoundingClientRect().height,
        setSize: (val) => {
            const el = document.getElementById('test-results');
            el.style.height = val + 'px';
            el.style.maxHeight = 'none';
        },
        getDelta: (startPos, e) => startPos - e.clientY,
        min: 0,
        max: () => document.querySelector('.center-panel').getBoundingClientRect().height * 0.5,
    });
}

function initResize(handle, direction, opts) {
    let startPos, startSize;
    const cursorClass = direction === 'horizontal' ? 'resizing-h' : 'resizing-v';

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startPos = direction === 'horizontal' ? e.clientX : e.clientY;
        startSize = opts.getSize();
        handle.classList.add('active');
        document.body.classList.add(cursorClass);

        const onMove = (e) => {
            const delta = opts.getDelta(startPos, e);
            const maxVal = typeof opts.max === 'function' ? opts.max() : opts.max;
            const newSize = Math.min(maxVal, Math.max(opts.min, startSize + delta));
            opts.setSize(newSize);
        };

        const onUp = () => {
            handle.classList.remove('active');
            document.body.classList.remove(cursorClass);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

document.addEventListener('DOMContentLoaded', initResizeHandles);

// ============================================================
// Ticket 22: Zen / Focus Mode
// ============================================================

let _zenSavedPanelWidths = null;

function shouldReduceMotion() {
    const setting = settingsManager.get('reducedMotion');
    if (setting === 'on') return true;
    if (setting === 'off') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function toggleZenMode() {
    const current = settingsManager.get('zenMode');
    settingsManager.set('zenMode', !current);
}

function applyZenMode(enabled) {
    const body = document.body;
    const zenBar = document.getElementById('zen-status-bar');

    if (enabled) {
        // Save panel widths before entering zen mode
        const problemPanel = document.getElementById('problem-panel');
        const rightPanel = document.querySelector('.right-panel');
        _zenSavedPanelWidths = {
            problem: problemPanel ? problemPanel.getBoundingClientRect().width : 350,
            chat: rightPanel ? rightPanel.getBoundingClientRect().width : 350,
        };

        if (shouldReduceMotion()) {
            body.classList.add('zen-mode', 'zen-no-transition');
        } else {
            body.classList.remove('zen-no-transition');
            body.classList.add('zen-mode');
        }

        // Update zen status bar content
        updateZenStatusBar();
        if (zenBar) zenBar.classList.remove('hidden');
    } else {
        body.classList.remove('zen-mode', 'zen-no-transition');
        if (zenBar) zenBar.classList.add('hidden');

        // Restore panel widths
        if (_zenSavedPanelWidths) {
            const problemPanel = document.getElementById('problem-panel');
            const rightPanel = document.querySelector('.right-panel');
            if (problemPanel) problemPanel.style.width = _zenSavedPanelWidths.problem + 'px';
            if (rightPanel) rightPanel.style.width = _zenSavedPanelWidths.chat + 'px';
            _zenSavedPanelWidths = null;
        }
    }
}

function updateZenStatusBar() {
    const titleEl = document.getElementById('zen-problem-title');
    const timerEl = document.getElementById('zen-timer-display');
    if (titleEl) {
        titleEl.textContent = state.currentProblem ? state.currentProblem.title : 'No problem selected';
    }
    if (timerEl) {
        if (state.mode === 'interview' && state.timeRemaining > 0) {
            const minutes = Math.floor(state.timeRemaining / 60);
            const seconds = state.timeRemaining % 60;
            timerEl.textContent = minutes + ':' + seconds.toString().padStart(2, '0');
            timerEl.parentElement.classList.remove('hidden');
        } else {
            timerEl.parentElement.classList.add('hidden');
        }
    }
}

function initZenMode() {
    const zenToggleBtn = document.getElementById('zen-toggle-btn');

    // Wire onChange to apply zen mode and sync button state
    settingsManager.onChange('zenMode', (enabled) => {
        applyZenMode(enabled);
        if (zenToggleBtn) zenToggleBtn.classList.toggle('active', enabled);
    });

    // Apply on load if already enabled
    if (settingsManager.get('zenMode')) {
        applyZenMode(true);
        if (zenToggleBtn) zenToggleBtn.classList.add('active');
    }

    // Wire the actions-bar zen toggle button
    if (zenToggleBtn) zenToggleBtn.addEventListener('click', toggleZenMode);

    // Wire zen status bar buttons
    const zenRunBtn = document.getElementById('zen-run-btn');
    const zenSubmitBtn = document.getElementById('zen-submit-btn');
    const zenHintBtn = document.getElementById('zen-hint-btn');
    const zenExitBtn = document.getElementById('zen-exit-btn');

    if (zenRunBtn) zenRunBtn.addEventListener('click', runCode);
    if (zenSubmitBtn) zenSubmitBtn.addEventListener('click', submitCode);
    if (zenHintBtn) zenHintBtn.addEventListener('click', requestHint);
    if (zenExitBtn) zenExitBtn.addEventListener('click', () => settingsManager.set('zenMode', false));

    // Keyboard shortcut: Ctrl+Shift+Z / Cmd+Shift+Z
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
            // Don't intercept if typing in input/textarea
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            toggleZenMode();
        }
    });
}

// ============================================================
// Ticket 24: Typography Controls (Font Loading + UI Font Size)
// ============================================================

const _loadedFonts = new Set();

const GOOGLE_FONT_URLS = {
    "jetbrains-mono": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap",
    "fira-code": "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap",
    "comic-mono": "https://fonts.googleapis.com/css2?family=Comic+Mono&display=swap",
};

function loadGoogleFont(fontKey) {
    if (fontKey === 'default' || _loadedFonts.has(fontKey)) return;
    const url = GOOGLE_FONT_URLS[fontKey];
    if (!url) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.fontKey = fontKey;
    document.head.appendChild(link);
    _loadedFonts.add(fontKey);
}

function applyUiFontSize(size) {
    document.documentElement.style.setProperty('--ui-font-size', size + 'px');
}

function initTypography() {
    // Load the currently selected font on startup
    const currentFont = settingsManager.get('editorFontFamily');
    if (currentFont !== 'default') {
        loadGoogleFont(currentFont);
    }

    // Wire font family change to load the font
    settingsManager.onChange('editorFontFamily', (fontKey) => {
        loadGoogleFont(fontKey);
        applyEditorSettings();
    });

    // Wire uiFontSize to CSS variable
    settingsManager.onChange('uiFontSize', (size) => {
        applyUiFontSize(size);
    });

    // Apply initial uiFontSize
    applyUiFontSize(settingsManager.get('uiFontSize'));

    // Keyboard shortcuts: Ctrl+Plus / Ctrl+Minus for quick font size
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        // Don't fire when typing in input/textarea, but allow when Monaco editor is focused
        const active = document.activeElement;
        const tag = active ? active.tagName : '';
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && !active.closest('#editor')) return;

        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            const current = settingsManager.get('editorFontSize');
            const newSize = Math.min(24, current + 1);
            settingsManager.set('editorFontSize', newSize);
            showFontSizeToast(newSize);
        } else if (e.key === '-') {
            e.preventDefault();
            const current = settingsManager.get('editorFontSize');
            const newSize = Math.max(12, current - 1);
            settingsManager.set('editorFontSize', newSize);
            showFontSizeToast(newSize);
        }
    });
}

function showFontSizeToast(size) {
    let toast = document.getElementById('font-size-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'font-size-toast';
        toast.className = 'font-size-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = 'Font size: ' + size + 'px';
    toast.classList.remove('hidden');
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('visible');
        toast.classList.add('hidden');
    }, 1500);
}

// ============================================================
// Ticket 29: Friction on Destructive Actions
// ============================================================

function showConfirmDialog({ title, message, detail, confirmLabel, cancelLabel }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-dialog-overlay');
        const titleEl = document.getElementById('confirm-dialog-title');
        const messageEl = document.getElementById('confirm-dialog-message');
        const detailEl = document.getElementById('confirm-dialog-detail');
        const confirmBtn = document.getElementById('confirm-dialog-confirm');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        const triggerEl = document.activeElement;

        titleEl.textContent = title || 'Are you sure?';
        messageEl.textContent = message || '';
        detailEl.textContent = detail || '';
        detailEl.style.display = detail ? 'block' : 'none';
        confirmBtn.textContent = confirmLabel || 'Confirm';
        cancelBtn.textContent = cancelLabel || 'Cancel';

        overlay.classList.remove('hidden');
        cancelBtn.focus();

        function cleanup(result) {
            overlay.classList.add('hidden');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey, true);
            overlay.removeEventListener('click', onOverlay);
            try { if (triggerEl) triggerEl.focus(); } catch (e) { /* element may be gone */ }
            resolve(result);
        }

        function onConfirm() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onKey(e) {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                cleanup(false);
            } else if (e.key === 'Tab') {
                // Trap focus within dialog
                const focusable = [cancelBtn, confirmBtn];
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
        function onOverlay(e) {
            if (e.target === overlay) cleanup(false);
        }

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', onOverlay);
    });
}

function resetCode() {
    if (!state.currentProblem || !state.editorReady || !state.editor) return;
    state.editor.setValue(state.currentProblem.starter_code);
}

async function resetCodeWithConfirm() {
    if (!state.currentProblem || !state.editorReady || !state.editor) return;

    if (!settingsManager.get('confirmDestructive')) {
        resetCode();
        return;
    }

    const code = getEditorValue();
    const lineCount = code.split('\n').filter(l => l.trim().length > 0).length;

    const confirmed = await showConfirmDialog({
        title: 'Reset to starter code?',
        message: 'You\'ve written ' + lineCount + ' lines. Reset to starter code?',
        detail: 'Maybe save your approach in the chat first \u2014 describe what you\'ve tried so far.',
        confirmLabel: 'Reset',
        cancelLabel: 'Keep Coding',
    });

    if (confirmed) {
        resetCode();
    }
}

function endSession() {
    if (!state.sessionId) return;
    wsSend({ type: 'end_session' });
    state.sessionId = null;
    clearSessionHash();
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
    if (state.timeSyncInterval) { clearInterval(state.timeSyncInterval); state.timeSyncInterval = null; }
    document.getElementById('timer').classList.add('hidden');
    // Disconnect MutationObservers (Ticket 47)
    disconnectEarconObserver();
    disconnectTtsObserver();
    addChatMessage('system', 'Session ended.');
}

async function endSessionWithConfirm() {
    if (!state.sessionId) return;

    if (!settingsManager.get('confirmDestructive')) {
        endSession();
        return;
    }

    const problemTitle = state.currentProblem ? state.currentProblem.title : 'this problem';

    const confirmed = await showConfirmDialog({
        title: 'End this session?',
        message: 'End your session on "' + problemTitle + '"? Your progress will be saved.',
        detail: 'You can resume this session later from the history.',
        confirmLabel: 'End Session',
        cancelLabel: 'Keep Going',
    });

    if (confirmed) {
        endSession();
    }
}

async function restartSession() {
    if (!state.currentProblem) return;
    const oldSessionId = state.sessionId;

    // End the current session
    endSession();

    // Delete the old session file so it doesn't clutter history
    if (oldSessionId) {
        try {
            await fetch('/api/sessions/' + oldSessionId, { method: 'DELETE' });
        } catch (e) { /* best-effort */ }
    }

    // Clear test results
    const resultsEl = document.getElementById('test-results');
    if (resultsEl) resultsEl.innerHTML = '';

    // Reset code to starter
    resetCode();

    // Start a fresh session on the same problem
    startSession();
}

async function restartSessionWithConfirm() {
    if (!state.sessionId) return;

    if (!settingsManager.get('confirmDestructive')) {
        await restartSession();
        return;
    }

    const problemTitle = state.currentProblem ? state.currentProblem.title : 'this problem';

    const confirmed = await showConfirmDialog({
        title: 'Restart from scratch?',
        message: 'Restart "' + problemTitle + '"? This will erase your code, chat, and session history for this attempt.',
        confirmLabel: 'Restart',
        cancelLabel: 'Keep Going',
    });

    if (confirmed) {
        await restartSession();
    }
}

function initFrictionDialogs() {
    // beforeunload when session is active
    window.addEventListener('beforeunload', (e) => {
        if (state.sessionId && settingsManager.get('confirmDestructive')) {
            e.preventDefault();
            e.returnValue = 'You have an active coding session. Leave anyway?';
            return e.returnValue;
        }
    });
}

// ============================================================
// Initialize all new features at DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initThemeSystem();
    initZenMode();
    initTypography();
    initFrictionDialogs();
});

// ============================================================
// Ticket 26: Inactivity Nudges in Learning Mode
// ============================================================

class InactivityDetector {
    constructor(settingsMgr, onInactive, onFlailing) {
        this.settingsMgr = settingsMgr;
        this.onInactive = onInactive;
        this.onFlailing = onFlailing;
        this.lastActivity = Date.now();
        this.lastRealActivity = Date.now(); // only real user actions, never nudge resets
        this.lastNudgeTime = 0;
        this._nudgesSinceActivity = 0; // count nudges between real user actions
        this._maxNudgesBeforeActivity = 3; // stop after 3 nudges with no user response
        this._intervalId = null;
        this._nudgeCooldownMs = 2 * 60 * 1000; // 2-minute cooldown between nudges
        this._abandonThresholdMs = 30 * 60 * 1000; // stop nudging after 30 min of no real activity
        this.suppressed = false; // suppress after problem solved

        // Flailing detection state
        this._recentErrors = []; // { error: string, timestamp: number }
        this._flailingWindowMs = 5 * 60 * 1000; // 5-minute window
        this._flailingThreshold = 3;
    }

    start() {
        if (this._intervalId) return;
        this._intervalId = setInterval(() => this._check(), 30000);
    }

    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    recordActivity() {
        this.lastActivity = Date.now();
        this.lastRealActivity = Date.now();
        this._nudgesSinceActivity = 0;
    }

    recordError(errorMessage) {
        var now = Date.now();
        this._recentErrors.push({ error: errorMessage, timestamp: now });

        // Prune old errors outside the window
        this._recentErrors = this._recentErrors.filter(
            function(e) { return (now - e.timestamp) < this._flailingWindowMs; }.bind(this)
        );

        this._checkFlailing();
    }

    cancelPendingNudge() {
        // Reset timer so any upcoming nudge check won't fire
        this.lastActivity = Date.now();
    }

    _isActive() {
        // Only active in Learning Mode with an active, unsolved session
        return state.mode === 'learning' && state.sessionId != null && !this.suppressed;
    }

    _check() {
        if (!this._isActive()) return;

        var threshold = this.settingsMgr.get('inactivityNudgeMinutes');
        if (threshold <= 0) return; // disabled

        var now = Date.now();

        // Stop nudging entirely if user has been gone for 30+ minutes
        if ((now - this.lastRealActivity) >= this._abandonThresholdMs) return;

        // Stop after N nudges with no real user activity in between
        if (this._nudgesSinceActivity >= this._maxNudgesBeforeActivity) return;

        // Enforce cooldown
        if ((now - this.lastNudgeTime) < this._nudgeCooldownMs) return;

        var idleMs = now - this.lastActivity;
        var thresholdMs = threshold * 60 * 1000;

        if (idleMs >= thresholdMs) {
            this.lastNudgeTime = now;
            this.lastActivity = now; // reset so it doesn't fire continuously
            this._nudgesSinceActivity++;
            if (this.onInactive) {
                this.onInactive(Math.round(idleMs / 1000));
            }
        }
    }

    _checkFlailing() {
        if (!this._isActive()) return;

        var now = Date.now();

        // Stop nudging entirely if user has been gone for 30+ minutes
        if ((now - this.lastRealActivity) >= this._abandonThresholdMs) return;

        // Enforce cooldown
        if ((now - this.lastNudgeTime) < this._nudgeCooldownMs) return;

        if (this._recentErrors.length < this._flailingThreshold) return;

        // Check if the last N errors have the same error type
        var recent = this._recentErrors.slice(-this._flailingThreshold);
        var firstError = this._normalizeError(recent[0].error);
        var allSame = recent.every(function(e) {
            return this._normalizeError(e.error) === firstError;
        }.bind(this));

        if (allSame) {
            this.lastNudgeTime = now;
            this.lastActivity = now;
            // Clear errors after triggering to avoid repeated nudges
            this._recentErrors = [];
            if (this.onFlailing) {
                this.onFlailing(recent.length, recent[recent.length - 1].error);
            }
        }
    }

    _normalizeError(errorStr) {
        // Extract the error type (e.g., "IndexError", "TypeError") for comparison
        if (!errorStr) return 'unknown';
        var match = errorStr.match(/^(\w+Error)/);
        if (match) return match[1];
        // Fallback: first 60 chars
        return errorStr.substring(0, 60);
    }
}

var _inactivityDetector = null;

function _handleInactivityNudge(idleSeconds) {
    var codeLength = 0;
    if (state.editorReady && state.editor) {
        codeLength = state.editor.getValue().split('\n').length;
    }
    wsSend({
        type: 'nudge_request',
        trigger: 'inactivity',
        context: {
            idle_seconds: idleSeconds,
            current_code_length: codeLength,
            current_code: (state.editorReady && state.editor) ? state.editor.getValue() : null,
        }
    });
}

function _handleFlailingNudge(consecutiveErrors, lastError) {
    var codeLength = 0;
    if (state.editorReady && state.editor) {
        codeLength = state.editor.getValue().split('\n').length;
    }
    wsSend({
        type: 'nudge_request',
        trigger: 'flailing',
        context: {
            consecutive_errors: consecutiveErrors,
            last_error: lastError,
            current_code_length: codeLength,
            current_code: (state.editorReady && state.editor) ? state.editor.getValue() : null,
        }
    });
}

function _nudgeRecordRunError(results) {
    // Called after displayTestResults to track errors for flailing detection
    if (!_inactivityDetector) return;
    if (!results || !results.results) return;

    for (var i = 0; i < results.results.length; i++) {
        var r = results.results[i];
        if (!r.passed && r.error) {
            _inactivityDetector.recordError(r.error);
            return; // Record only the first error per run
        }
    }
}

function _wireEditorActivityTracking() {
    // Poll until Monaco editor is ready, then attach the listener
    var checkInterval = setInterval(function() {
        if (state.editorReady && state.editor && _inactivityDetector) {
            state.editor.onDidChangeModelContent(function() {
                _inactivityDetector.recordActivity();
            });
            clearInterval(checkInterval);
        }
    }, 500);
}

function _wireMouseActivityTracking() {
    var appContainer = document.body;
    var _mouseMoveTimeout = null;
    appContainer.addEventListener('mousemove', function() {
        if (_mouseMoveTimeout) return;
        _mouseMoveTimeout = setTimeout(function() {
            _mouseMoveTimeout = null;
        }, 2000); // debounce: only record every 2 seconds
        if (_inactivityDetector) {
            _inactivityDetector.recordActivity();
        }
    });
}

function _wireChatSendActivityTracking() {
    // Observe the chat-messages container for new user messages
    var chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && _inactivityDetector) {
                _inactivityDetector.recordActivity();
                _inactivityDetector.cancelPendingNudge();
            }
        });
    }
    // Also track the send button
    var sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', function() {
            if (_inactivityDetector) {
                _inactivityDetector.recordActivity();
                _inactivityDetector.cancelPendingNudge();
            }
        });
    }
}

function _hookRunCodeForFlailing() {
    // Monkey-patch displayTestResults to also track errors
    var _origDisplayTestResults = window.displayTestResults;
    if (_origDisplayTestResults && !_origDisplayTestResults._nudgePatched) {
        window.displayTestResults = function(results) {
            _origDisplayTestResults(results);
            _nudgeRecordRunError(results);
        };
        window.displayTestResults._nudgePatched = true;
    }
}

function _hookWebSocketForNudgeMessages() {
    // Monkey-patch handleWebSocketMessage to mark nudge messages
    var _origHandleWS = window.handleWebSocketMessage;
    if (_origHandleWS && !_origHandleWS._nudgePatched) {
        window.handleWebSocketMessage = function(data) {
            _origHandleWS(data);
            // After the original handler processes assistant_message, check if it's a nudge
            if (data.type === 'assistant_message' && data.nudge) {
                _markLastMessageAsNudge();
            }
        };
        window.handleWebSocketMessage._nudgePatched = true;
    }
}

function _markLastMessageAsNudge() {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var messages = container.querySelectorAll('.chat-message.assistant');
    if (messages.length === 0) return;
    var lastMsg = messages[messages.length - 1];
    if (!lastMsg.classList.contains('nudge-message')) {
        lastMsg.classList.add('nudge-message');
        // Prepend a nudge indicator
        var indicator = document.createElement('span');
        indicator.className = 'nudge-indicator';
        indicator.textContent = 'Nudge: ';
        indicator.setAttribute('aria-label', 'Proactive nudge from tutor');
        lastMsg.insertBefore(indicator, lastMsg.firstChild);
    }
}

function initInactivityNudges() {
    _inactivityDetector = new InactivityDetector(
        settingsManager,
        _handleInactivityNudge,
        _handleFlailingNudge
    );
    _inactivityDetector.start();

    _wireEditorActivityTracking();
    _wireMouseActivityTracking();
    _wireChatSendActivityTracking();
    _hookRunCodeForFlailing();
    _hookWebSocketForNudgeMessages();
}

document.addEventListener('DOMContentLoaded', function() {
    initInactivityNudges();
});

// ============================================================
// Ticket 30: Ambient Sound Generator (Brown Noise / Pink Noise)
// Ticket 33: Earcons (Subtle Audio Feedback)
// ============================================================

// --- Shared AudioContext Manager (singleton) ---

class AudioContextManager {
    static _ctx = null;
    static _resumeListenerAdded = false;

    static get() {
        if (!this._ctx) {
            this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Handle autoplay policy: resume on user gesture if suspended
        if (this._ctx.state === 'suspended' && !this._resumeListenerAdded) {
            this._resumeListenerAdded = true;
            var self = this;
            var resumeAudio = function() {
                if (self._ctx && self._ctx.state === 'suspended') {
                    self._ctx.resume();
                }
            };
            document.addEventListener('click', resumeAudio, { once: true });
            document.addEventListener('keydown', resumeAudio, { once: true });
        }
        return this._ctx;
    }
}

// --- Ambient Sound Generator ---

class AmbientSoundGenerator {
    constructor() {
        this._gainNode = null;
        this._sourceNode = null;
        this._active = false;
        this._currentType = null;
    }

    start(type, volume) {
        var ctx = AudioContextManager.get();
        this.stop();

        var bufferSize = 4096;
        this._sourceNode = ctx.createScriptProcessor(bufferSize, 1, 1);
        this._gainNode = ctx.createGain();

        // Start at zero gain and ramp up to avoid click/pop
        this._gainNode.gain.setValueAtTime(0, ctx.currentTime);
        this._gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);

        if (type === 'brown-noise') {
            var lastOut = 0;
            this._sourceNode.onaudioprocess = function(e) {
                var output = e.outputBuffer.getChannelData(0);
                for (var i = 0; i < bufferSize; i++) {
                    var white = Math.random() * 2 - 1;
                    output[i] = (lastOut + (0.02 * white)) / 1.02;
                    lastOut = output[i];
                    output[i] *= 3.5;
                }
            };
        } else if (type === 'pink-noise') {
            var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            this._sourceNode.onaudioprocess = function(e) {
                var output = e.outputBuffer.getChannelData(0);
                for (var i = 0; i < bufferSize; i++) {
                    var white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.96900 * b2 + white * 0.1538520;
                    b3 = 0.86650 * b3 + white * 0.3104856;
                    b4 = 0.55000 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.0168980;
                    output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                    output[i] *= 0.11;
                    b6 = white * 0.115926;
                }
            };
        }

        this._sourceNode.connect(this._gainNode);
        this._gainNode.connect(ctx.destination);
        this._active = true;
        this._currentType = type;
    }

    setVolume(v) {
        if (this._gainNode) {
            var ctx = AudioContextManager.get();
            this._gainNode.gain.cancelScheduledValues(ctx.currentTime);
            this._gainNode.gain.setValueAtTime(this._gainNode.gain.value, ctx.currentTime);
            this._gainNode.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.05);
        }
    }

    stop() {
        if (this._sourceNode && this._gainNode) {
            try {
                var ctx = AudioContextManager.get();
                // Ramp down to avoid click/pop
                this._gainNode.gain.cancelScheduledValues(ctx.currentTime);
                this._gainNode.gain.setValueAtTime(this._gainNode.gain.value, ctx.currentTime);
                this._gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
                // Disconnect after ramp completes
                var src = this._sourceNode;
                var gain = this._gainNode;
                setTimeout(function() {
                    try { src.disconnect(); } catch (e) { /* ignore */ }
                    try { gain.disconnect(); } catch (e) { /* ignore */ }
                }, 80);
            } catch (e) {
                try { this._sourceNode.disconnect(); } catch (ex) { /* ignore */ }
                try { this._gainNode.disconnect(); } catch (ex) { /* ignore */ }
            }
        }
        this._sourceNode = null;
        this._gainNode = null;
        this._active = false;
        this._currentType = null;
    }

    isActive() {
        return this._active;
    }
}

// --- Earcon Player ---

class EarconPlayer {
    constructor() {
        this._enabled = false;
        this._masterGain = 0.15;
    }

    setEnabled(on) {
        this._enabled = !!on;
    }

    setVolume(value) {
        this._masterGain = Math.max(0.001, value * 0.5);
    }

    _playTone(startFreq, endFreq, durationMs, waveType) {
        if (!this._enabled) return;
        var ctx = AudioContextManager.get();
        if (ctx.state === 'suspended') return;

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = waveType || 'sine';
        var dur = durationMs / 1000;

        osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
        if (startFreq !== endFreq) {
            osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + dur);
        }

        gain.gain.setValueAtTime(this._masterGain, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + dur);
    }

    _playChord(frequencies, durationMs) {
        if (!this._enabled) return;
        for (var i = 0; i < frequencies.length; i++) {
            this._playTone(frequencies[i], frequencies[i], durationMs, 'sine');
        }
    }

    _playNoiseClick(highPass, durationMs) {
        if (!this._enabled) return;
        var ctx = AudioContextManager.get();
        if (ctx.state === 'suspended') return;

        var dur = durationMs / 1000;
        var bufferSize = Math.ceil(ctx.sampleRate * dur);
        var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        var source = ctx.createBufferSource();
        source.buffer = buffer;

        var filter = ctx.createBiquadFilter();
        filter.type = highPass ? 'highpass' : 'bandpass';
        filter.frequency.value = highPass ? 4000 : 2000;
        filter.Q.value = 1;

        var gain = ctx.createGain();
        gain.gain.setValueAtTime(this._masterGain * 0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start(ctx.currentTime);
        source.stop(ctx.currentTime + dur);
    }

    // Public earcon methods
    testPassed()  { this._playTone(523, 659, 150, 'sine'); }   // C5 -> E5 rising chime
    testFailed()  { this._playTone(100, 80, 200, 'sine'); }     // Low thud
    allPassed()   { this._playChord([262, 330, 392], 400); }    // C4-E4-G4 major chord
    errorOnRun()  { this._playTone(330, 262, 200, 'sine'); }    // E4 -> C4 descending
    braceOpen()   { this._playNoiseClick(true, 50); }           // Soft high click
    braceClose()  { this._playNoiseClick(false, 50); }          // Slightly lower click
}

// --- Ambient Sound Init ---

function initAmbientSound() {
    var generator = new AmbientSoundGenerator();
    var _userHasInteracted = false;
    var _pendingStart = null;

    function onUserGesture() {
        _userHasInteracted = true;
        document.removeEventListener('click', onUserGesture);
        document.removeEventListener('keydown', onUserGesture);
        if (_pendingStart) {
            generator.start(_pendingStart.type, _pendingStart.volume);
            _pendingStart = null;
        }
    }
    document.addEventListener('click', onUserGesture);
    document.addEventListener('keydown', onUserGesture);

    function handleSoundChange(type) {
        var volume = settingsManager.get('ambientVolume');
        if (type === 'off') {
            generator.stop();
            _pendingStart = null;
        } else if (_userHasInteracted) {
            generator.start(type, volume);
            _pendingStart = null;
        } else {
            _pendingStart = { type: type, volume: volume };
        }
    }

    function handleVolumeChange(volume) {
        if (generator.isActive()) {
            generator.setVolume(volume);
        }
        if (_pendingStart) {
            _pendingStart.volume = volume;
        }
    }

    settingsManager.onChange('ambientSound', handleSoundChange);
    settingsManager.onChange('ambientVolume', handleVolumeChange);

    // Apply saved preference on load (will queue until user gesture)
    var savedType = settingsManager.get('ambientSound');
    if (savedType && savedType !== 'off') {
        handleSoundChange(savedType);
    }
}

// --- Earcons Init ---

var _earconObserverRef = null;
var _earconObserverTarget = null;
var _earconObserverOptions = { childList: true, subtree: false };

function initEarcons() {
    var player = new EarconPlayer();

    // Wire to settings toggle
    player.setEnabled(settingsManager.get('earcons'));
    settingsManager.onChange('earcons', function(enabled) {
        player.setEnabled(enabled);
        if (enabled) {
            connectEarconObserver();
        } else {
            disconnectEarconObserver();
        }
    });

    // Wire volume slider
    player.setVolume(settingsManager.get('earconVolume'));
    settingsManager.onChange('earconVolume', function(vol) {
        player.setVolume(vol);
    });

    // --- Wire to test results via MutationObserver on #test-results ---
    // Watches for micro-feedback DOM rendered by renderMicroFeedback().
    var testResultsContainer = document.getElementById('test-results');
    if (testResultsContainer) {
        _earconObserverTarget = testResultsContainer;
        _earconObserverRef = new MutationObserver(function() {
            if (!player._enabled) return;

            // Micro-feedback uses .mf-summary and .mf-test-row
            var summary = testResultsContainer.querySelector('.mf-summary');
            if (!summary) return;

            var testRows = testResultsContainer.querySelectorAll('.mf-test-row');
            if (testRows.length === 0) return;

            // Check if all errors (every test has .mf-test-icon.fail with error output)
            var allErrors = true;
            var allPass = summary.classList.contains('all-pass');
            testRows.forEach(function(row) {
                var icon = row.querySelector('.mf-test-icon');
                if (icon && icon.classList.contains('pass')) allErrors = false;
            });

            if (allErrors && !allPass) {
                player.errorOnRun();
            } else if (allPass) {
                player.allPassed();
            } else {
                // Mixed results: play individual sounds with staggered timing
                var delay = 0;
                var firstFailPlayed = false;
                testRows.forEach(function(row) {
                    var icon = row.querySelector('.mf-test-icon');
                    var passed = icon && icon.classList.contains('pass');
                    setTimeout(function() {
                        if (passed) {
                            player.testPassed();
                        } else if (!firstFailPlayed) {
                            firstFailPlayed = true;
                            player.testFailed();
                        }
                    }, delay);
                    delay += 100;
                });
            }
        });

        // Only connect if earcons are currently enabled
        if (settingsManager.get('earcons')) {
            _earconObserverRef.observe(testResultsContainer, _earconObserverOptions);
        }
    }

    // --- Wire to Monaco editor for brace typing ---
    function wireBraceEarcons() {
        if (!state.editor) {
            setTimeout(wireBraceEarcons, 500);
            return;
        }
        state.editor.onDidChangeModelContent(function(e) {
            if (!player._enabled) return;
            for (var i = 0; i < e.changes.length; i++) {
                var change = e.changes[i];
                // Only trigger on direct typing (short inserts), not paste/undo
                if (change.text.length > 2) continue;
                if (change.text.indexOf('{') !== -1) {
                    player.braceOpen();
                } else if (change.text.indexOf('}') !== -1) {
                    player.braceClose();
                }
            }
        });
    }
    wireBraceEarcons();
}

function disconnectEarconObserver() {
    if (_earconObserverRef) {
        _earconObserverRef.disconnect();
    }
}

function connectEarconObserver() {
    if (_earconObserverRef && _earconObserverTarget) {
        // disconnect first to avoid double-observing
        _earconObserverRef.disconnect();
        _earconObserverRef.observe(_earconObserverTarget, _earconObserverOptions);
    }
}

// --- Initialize audio features ---

document.addEventListener('DOMContentLoaded', function() {
    initAmbientSound();
    initEarcons();
});

// ============================================================
// Ticket 27: Micro-Feedback on Code Submission
// ============================================================

var _microFeedbackState = {
    lastPassCount: null,
    lastTotal: null,
};

function renderMicroFeedback(results, isSubmit) {
    var container = document.getElementById('test-results');
    if (!container || !results || !results.results) return;

    var total = results.passed + results.failed;
    var allPassed = results.failed === 0;
    var testResults = results.results;

    // Improvement detection
    var improvementMsg = '';
    if (_microFeedbackState.lastPassCount !== null && _microFeedbackState.lastTotal === total) {
        if (results.passed > _microFeedbackState.lastPassCount) {
            improvementMsg = 'Progress! You went from ' + _microFeedbackState.lastPassCount + ' to ' + results.passed + ' passing tests.';
        }
    }
    _microFeedbackState.lastPassCount = results.passed;
    _microFeedbackState.lastTotal = total;

    // Build HTML
    var html = '<div class="mf-container">';

    // Progress bar
    html += '<div class="mf-progress-wrapper">';
    html += '<div class="mf-progress-bar" id="mf-progress-bar">';
    for (var i = 0; i < testResults.length; i++) {
        html += '<div class="mf-progress-segment" data-idx="' + i + '"></div>';
    }
    html += '</div></div>';

    // Summary
    if (allPassed) {
        html += '<div class="mf-summary all-pass">&#10003; All tests passed! Great work. (' + results.passed + '/' + total + ')</div>';
    } else {
        html += '<div class="mf-summary partial">Almost there \u2014 ' + results.passed + '/' + total + ' tests passing</div>';
    }

    // Improvement message
    if (improvementMsg) {
        html += '<div class="mf-improvement">' + escapeHtml(improvementMsg) + '</div>';
    }

    // Per-test rows
    for (var j = 0; j < testResults.length; j++) {
        var r = testResults[j];
        var passed = r.passed;
        var expanded = !passed;
        var iconClass = passed ? 'pass' : 'fail';
        var icon = passed ? '&#10003;' : '&#10007;';

        var inputStr = '';
        if (r.input) {
            inputStr = Object.entries(r.input).map(function(kv) { return kv[0] + ' = ' + JSON.stringify(kv[1]); }).join(', ');
        }
        var shortLabel = 'Test ' + r.test_num + (inputStr ? ': ' + inputStr : '');

        html += '<div class="mf-test-row">';
        html += '<div class="mf-test-header" data-test-idx="' + j + '">';
        html += '<span class="mf-test-icon ' + iconClass + '">' + icon + '</span>';
        html += '<span class="mf-test-label">' + escapeHtml(shortLabel) + '</span>';
        html += '<span class="mf-test-chevron' + (expanded ? ' expanded' : '') + '">&#9654;</span>';
        html += '</div>';

        var detailHtml = '<div class="mf-test-detail' + (expanded ? ' expanded' : '') + '" data-test-detail="' + j + '">';
        if (r.input) {
            var inStr = Object.entries(r.input).map(function(kv) { return kv[0] + ' = ' + JSON.stringify(kv[1]); }).join('\n');
            detailHtml += '<div class="detail-row"><label>Input</label><pre>' + escapeHtml(inStr) + '</pre></div>';
        }
        var outputStr = r.error ? r.error : JSON.stringify(r.actual);
        detailHtml += '<div class="detail-row"><label>Output</label><pre>' + escapeHtml(outputStr) + '</pre></div>';
        detailHtml += '<div class="detail-row"><label>Expected</label><pre>' + escapeHtml(JSON.stringify(r.expected)) + '</pre></div>';
        if (r.stdout) {
            detailHtml += '<div class="detail-row"><label>Stdout</label><pre>' + escapeHtml(r.stdout) + '</pre></div>';
        }
        detailHtml += '</div>';

        html += detailHtml;
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Wire toggle handlers for per-test rows
    container.querySelectorAll('.mf-test-header').forEach(function(header) {
        header.addEventListener('click', function() {
            var idx = header.dataset.testIdx;
            var detail = container.querySelector('[data-test-detail="' + idx + '"]');
            var chevron = header.querySelector('.mf-test-chevron');
            if (detail) {
                detail.classList.toggle('expanded');
            }
            if (chevron) {
                chevron.classList.toggle('expanded');
            }
        });
    });

    // Animate progress bar segments sequentially
    _animateProgressSegments(container, testResults, allPassed);
}

function _animateProgressSegments(container, testResults, allPassed) {
    var segments = container.querySelectorAll('.mf-progress-segment');
    var progressBar = container.querySelector('#mf-progress-bar');
    var reduceMotion = shouldReduceMotion();
    var delay = reduceMotion ? 0 : 120;

    testResults.forEach(function(r, i) {
        setTimeout(function() {
            if (segments[i]) {
                segments[i].classList.add(r.passed ? 'filled-pass' : 'filled-fail');
            }

            // After last segment
            if (i === testResults.length - 1) {
                if (allPassed) {
                    if (!reduceMotion && progressBar) {
                        progressBar.classList.add('all-pass-glow');
                        setTimeout(function() { progressBar.classList.remove('all-pass-glow'); }, 1500);
                    }
                    // Confetti celebration
                    if (!reduceMotion) {
                        _launchConfetti();
                    }
                } else {
                    // Gentle shake on failure
                    if (!reduceMotion && progressBar) {
                        progressBar.classList.add('mf-shake');
                        setTimeout(function() { progressBar.classList.remove('mf-shake'); }, 300);
                    }
                }
            }
        }, i * delay);
    });
}

function _launchConfetti() {
    var colors = ['#4ec9b0', '#569cd6', '#dcdcaa', '#f48771', '#c586c0', '#d7ba7d', '#ce9178'];
    var particleCount = 18;

    for (var i = 0; i < particleCount; i++) {
        var particle = document.createElement('div');
        particle.className = 'confetti-particle';
        particle.style.left = (Math.random() * 80 + 10) + 'vw';
        particle.style.top = '-10px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.animationDuration = (1.0 + Math.random() * 1.0) + 's';
        particle.style.animationDelay = (Math.random() * 0.5) + 's';
        var size = 6 + Math.random() * 6;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        if (Math.random() > 0.5) {
            particle.style.borderRadius = '50%';
        }
        document.body.appendChild(particle);

        // Clean up after animation
        (function(p) {
            setTimeout(function() {
                if (p.parentNode) p.parentNode.removeChild(p);
            }, 2500);
        })(particle);
    }
}

function initMicroFeedback() {
    // Hook into the test result rendering by monkey-patching displayTestResults
    var _origDisplay = window.displayTestResults;
    if (_origDisplay && !_origDisplay._microFeedbackPatched) {
        window.displayTestResults = function(results) {
            // Call original first (for compatibility with other patches)
            _origDisplay(results);
            // Then replace with our micro-feedback rendering
            renderMicroFeedback(results, false);
        };
        window.displayTestResults._microFeedbackPatched = true;
    }
}

// ============================================================
// Ticket 28: TTS Read Aloud (Text-to-Speech)
// ============================================================

class TTSReader {
    constructor() {
        this._sentences = [];
        this._currentIndex = -1;
        this._state = 'idle'; // idle, playing, paused
        this._rate = 1.0;
        this._descriptionEl = null;
        this._sentenceSpans = [];
        this._onStateChange = null;
    }

    get state() { return this._state; }

    setRate(rate) {
        this._rate = rate;
        // If currently playing, restart current sentence with new rate
        if (this._state === 'playing') {
            var idx = this._currentIndex;
            speechSynthesis.cancel();
            this._currentIndex = idx;
            this._state = 'playing';
            this._speakCurrent();
        }
    }

    splitSentences(text) {
        // Split text into sentences, handling common abbreviations and edge cases
        // Replace code blocks with a placeholder to skip them
        var cleaned = text.replace(/```[\s\S]*?```/g, ' ');
        cleaned = cleaned.replace(/`[^`]+`/g, ' ');

        // Split on sentence boundaries
        var sentences = [];
        var parts = cleaned.split(/(?<=[.!?])\s+/);

        for (var i = 0; i < parts.length; i++) {
            var s = parts[i].trim();
            if (s.length < 2) continue;
            if (s.length > 0) {
                sentences.push(s);
            }
        }
        return sentences;
    }

    prepare(descriptionEl) {
        this.stop();
        this._descriptionEl = descriptionEl;
        if (!descriptionEl) return;

        // Extract text from description only (stop before Examples/Constraints)
        var fullText = '';
        var children = descriptionEl.children;
        for (var ci = 0; ci < children.length; ci++) {
            var child = children[ci];
            var childText = child.textContent.trim();
            // Stop at Examples or Constraints sections
            if (/^(Example|Constraints)\s*\d*\s*:?$/i.test(childText)) break;
            var tag = child.tagName.toLowerCase();
            if (tag === 'pre' || tag === 'code') continue;
            // Walk text nodes within this element, skipping inline code
            var walker = document.createTreeWalker(
                child,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        var parent = node.parentElement;
                        if (!parent) return NodeFilter.FILTER_ACCEPT;
                        var ptag = parent.tagName.toLowerCase();
                        if (ptag === 'pre' || ptag === 'code') return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            var node;
            while ((node = walker.nextNode())) {
                fullText += node.nodeValue + ' ';
            }
        }

        this._sentences = this.splitSentences(fullText);
    }

    play() {
        if (!window.speechSynthesis) return;

        if (this._state === 'paused') {
            speechSynthesis.resume();
            this._state = 'playing';
            this._notifyStateChange();
            return;
        }

        if (this._state === 'playing') return;
        if (this._sentences.length === 0) return;

        this._state = 'playing';
        this._currentIndex = 0;
        this._notifyStateChange();
        this._speakCurrent();
    }

    pause() {
        if (this._state !== 'playing') return;
        speechSynthesis.pause();
        this._state = 'paused';
        this._notifyStateChange();
    }

    stop() {
        if (window.speechSynthesis) {
            speechSynthesis.cancel();
        }
        this._state = 'idle';
        this._currentIndex = -1;
        this._clearHighlight();
        this._notifyStateChange();
    }

    _speakCurrent() {
        if (this._currentIndex >= this._sentences.length) {
            this.stop();
            return;
        }

        var self = this;
        var text = this._sentences[this._currentIndex];
        var utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this._rate;
        utterance.voice = this._getPreferredVoice();

        utterance.onstart = function() {
            self._highlightSentence(self._currentIndex);
        };

        utterance.onend = function() {
            if (self._state !== 'playing') return;
            self._currentIndex++;
            if (self._currentIndex < self._sentences.length) {
                self._speakCurrent();
            } else {
                self.stop();
            }
        };

        utterance.onerror = function(e) {
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            console.warn('TTS error:', e.error);
            self.stop();
        };

        speechSynthesis.speak(utterance);
    }

    _getPreferredVoice() {
        var voices = speechSynthesis.getVoices();
        if (voices.length === 0) return null;

        var lang = navigator.language || 'en-US';
        var langPrefix = lang.split('-')[0];

        // Try to find a natural/premium voice
        var neural = voices.find(function(v) {
            return v.lang.startsWith(langPrefix) && (v.name.includes('Natural') || v.name.includes('Premium') || v.name.includes('Enhanced'));
        });
        if (neural) return neural;

        // Locale matched
        var localMatch = voices.find(function(v) {
            return v.lang.startsWith(langPrefix);
        });
        if (localMatch) return localMatch;

        return voices[0];
    }

    _highlightSentence(idx) {
        this._clearHighlight();
        if (!this._descriptionEl || idx < 0 || idx >= this._sentences.length) return;

        var sentence = this._sentences[idx];
        var descEl = this._descriptionEl;

        // Find text nodes containing parts of this sentence
        var firstWords = sentence.substring(0, Math.min(40, sentence.length));
        var searchStr = firstWords.substring(0, 20);
        var walker = document.createTreeWalker(descEl, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.includes(searchStr)) {
                var parent = node.parentElement;
                if (parent && parent.tagName.toLowerCase() !== 'pre' && parent.tagName.toLowerCase() !== 'code') {
                    parent.classList.add('tts-active');
                    parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                break;
            }
        }
    }

    _clearHighlight() {
        if (!this._descriptionEl) return;
        this._descriptionEl.querySelectorAll('.tts-active').forEach(function(el) {
            el.classList.remove('tts-active');
        });
    }

    _notifyStateChange() {
        if (this._onStateChange) {
            this._onStateChange(this._state);
        }
    }
}

var _ttsReader = null;
var _ttsObserverRef = null;
var _ttsObserverTarget = null;
var _ttsObserverOptions = { childList: true, characterData: true, subtree: true };

function initTTS() {
    // Check for SpeechSynthesis support
    if (!window.speechSynthesis) {
        return;
    }

    var ttsBtn = document.getElementById('tts-btn');
    var speedControl = document.getElementById('tts-speed-control');
    var speedSelect = document.getElementById('tts-speed-select');

    if (!ttsBtn) return;

    // Show button and speed control
    ttsBtn.classList.remove('hidden');
    speedControl.classList.remove('hidden');

    _ttsReader = new TTSReader();

    _ttsReader._onStateChange = function(newState) {
        ttsBtn.classList.remove('playing', 'paused');
        if (newState === 'playing') {
            ttsBtn.classList.add('playing');
            ttsBtn.title = 'Pause reading';
            ttsBtn.setAttribute('aria-label', 'Pause reading');
            ttsBtn.innerHTML = '&#128266;';
        } else if (newState === 'paused') {
            ttsBtn.classList.add('paused');
            ttsBtn.title = 'Resume reading';
            ttsBtn.setAttribute('aria-label', 'Resume reading');
            ttsBtn.innerHTML = '&#128264;';
        } else {
            ttsBtn.title = 'Read problem aloud';
            ttsBtn.setAttribute('aria-label', 'Read problem aloud');
            ttsBtn.innerHTML = '&#128266;';
        }
    };

    ttsBtn.addEventListener('click', function() {
        var descEl = document.getElementById('problem-description');
        if (!descEl || !descEl.textContent.trim()) return;

        if (_ttsReader.state === 'idle') {
            _ttsReader.prepare(descEl);
            _ttsReader.play();
        } else if (_ttsReader.state === 'playing') {
            _ttsReader.pause();
        } else if (_ttsReader.state === 'paused') {
            _ttsReader.play();
        }
    });

    speedSelect.addEventListener('change', function() {
        var rate = parseFloat(speedSelect.value);
        if (_ttsReader) {
            _ttsReader.setRate(rate);
        }
    });

    // Stop TTS when problem changes - observe problem-title for text changes
    var titleEl = document.getElementById('problem-title');
    if (titleEl) {
        _ttsObserverTarget = titleEl;
        _ttsObserverRef = new MutationObserver(function() {
            if (_ttsReader && _ttsReader.state !== 'idle') {
                _ttsReader.stop();
            }
        });
        _ttsObserverRef.observe(titleEl, _ttsObserverOptions);
    }

    // Preload voices
    speechSynthesis.getVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = function() {
            speechSynthesis.getVoices();
        };
    }
}

function disconnectTtsObserver() {
    if (_ttsObserverRef) {
        _ttsObserverRef.disconnect();
    }
}

function connectTtsObserver() {
    if (_ttsObserverRef && _ttsObserverTarget) {
        _ttsObserverRef.disconnect();
        _ttsObserverRef.observe(_ttsObserverTarget, _ttsObserverOptions);
    }
}

// ============================================================
// Ticket 32: Streak System with Freeze / Recovery
// ============================================================

class StreakManager {
    constructor() {
        this._storageKey = 'leettutor_streak';
        this._data = this._load();
        this._todaySolveCount = 0;
        this.onUpdate = null;
    }

    _getToday() {
        return new Date().toISOString().split('T')[0];
    }

    _load() {
        try {
            var raw = localStorage.getItem(this._storageKey);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return this._defaultData();
    }

    _defaultData() {
        return {
            currentStreak: 0,
            longestStreak: 0,
            lastActiveDate: null,
            freezesAvailable: 0,
            freezeUsedToday: false,
            streakHistory: [],
            repairAvailable: false,
            repairTarget: 2,
        };
    }

    _save() {
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(this._data));
        } catch (e) { /* ignore */ }
    }

    get data() { return this._data; }

    checkOnLoad() {
        var today = this._getToday();
        var lastActive = this._data.lastActiveDate;

        if (!lastActive) {
            // First time user, no streak
            this._data.repairAvailable = false;
            this._save();
            this._notify();
            return;
        }

        if (lastActive === today) {
            // Already active today
            this._data.repairAvailable = false;
            this._data.freezeUsedToday = false;
            this._save();
            this._notify();
            return;
        }

        var daysDiff = this._daysBetween(lastActive, today);

        if (daysDiff === 1) {
            // Yesterday was active, streak continues, waiting for today's activity
            this._data.repairAvailable = false;
            this._data.freezeUsedToday = false;
            this._save();
            this._notify();
            return;
        }

        if (daysDiff === 2) {
            // Missed one day (yesterday)
            var missedDate = this._addDays(lastActive, 1);
            if (this._data.freezesAvailable > 0) {
                // Auto-use freeze
                this._data.freezesAvailable--;
                this._data.freezeUsedToday = true;
                this._addHistory(missedDate, 'freeze');
                this._save();
                this._notify();
                return;
            } else {
                // Streak breaks, repair available
                this._data.repairAvailable = true;
                this._data.repairTarget = 2;
                this._todaySolveCount = 0;
                this._save();
                this._notify();
                return;
            }
        }

        // 3+ days missed - streak resets, no repair
        this._data.currentStreak = 0;
        this._data.repairAvailable = false;
        this._data.freezeUsedToday = false;
        this._save();
        this._notify();
    }

    recordActivity() {
        var today = this._getToday();

        // Handle repair mode
        if (this._data.repairAvailable) {
            this._todaySolveCount++;
            if (this._todaySolveCount >= this._data.repairTarget) {
                // Repair successful - streak continues as if never broken
                this._data.repairAvailable = false;
                this._data.lastActiveDate = today;
                this._addHistory(today, 'active');
                this._data.currentStreak++;
                this._checkFreezeEarning();
                if (this._data.currentStreak > this._data.longestStreak) {
                    this._data.longestStreak = this._data.currentStreak;
                }
                this._save();
                this._notify();
                this._checkMilestone();
                return 'repaired';
            }
            this._save();
            this._notify();
            return 'repair_progress';
        }

        // Normal activity
        if (this._data.lastActiveDate === today) {
            // Already counted today
            return 'already_active';
        }

        this._data.currentStreak++;
        this._data.lastActiveDate = today;
        this._addHistory(today, 'active');
        this._checkFreezeEarning();

        if (this._data.currentStreak > this._data.longestStreak) {
            this._data.longestStreak = this._data.currentStreak;
        }

        this._save();
        this._notify();
        this._checkMilestone();
        return 'incremented';
    }

    _checkFreezeEarning() {
        if (this._data.currentStreak > 0 && this._data.currentStreak % 7 === 0) {
            if (this._data.freezesAvailable < 2) {
                this._data.freezesAvailable++;
            }
        }
    }

    _checkMilestone() {
        var milestones = [7, 14, 30, 50, 100];
        var streak = this._data.currentStreak;
        if (milestones.indexOf(streak) !== -1) {
            var msg = streak + '-day streak!';
            if (streak % 7 === 0 && this._data.freezesAvailable <= 2) {
                msg += ' You earned a streak freeze.';
            }
            _showStreakMilestoneToast(msg);
        }
    }

    _addHistory(dateStr, type) {
        this._data.streakHistory.push({ date: dateStr, type: type });
        if (this._data.streakHistory.length > 30) {
            this._data.streakHistory = this._data.streakHistory.slice(-30);
        }
    }

    _daysBetween(dateStr1, dateStr2) {
        var d1 = new Date(dateStr1 + 'T00:00:00');
        var d2 = new Date(dateStr2 + 'T00:00:00');
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    _addDays(dateStr, days) {
        var d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    }

    _notify() {
        if (this.onUpdate) this.onUpdate(this._data);
    }

    getRepairStatus() {
        if (!this._data.repairAvailable) return null;
        return {
            needed: this._data.repairTarget,
            done: this._todaySolveCount,
            remaining: this._data.repairTarget - this._todaySolveCount,
        };
    }
}

var _streakManager = null;

function _showStreakMilestoneToast(message) {
    var toast = document.getElementById('streak-milestone-toast');
    if (!toast) return;
    toast.textContent = '\uD83D\uDD25 ' + message;
    toast.classList.remove('hidden');
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function() {
        toast.classList.remove('visible');
        setTimeout(function() { toast.classList.add('hidden'); }, 300);
    }, 4000);
}

function _renderStreakUI(data) {
    var display = document.getElementById('streak-display');
    var countEl = document.getElementById('streak-count');
    var freezeBadge = document.getElementById('streak-freeze-badge');
    var freezeCount = document.getElementById('streak-freeze-count');
    var repairBanner = document.getElementById('streak-repair-banner');

    if (!display) return;
    display.classList.remove('hidden');

    if (countEl) countEl.textContent = data.currentStreak;

    if (freezeBadge && freezeCount) {
        if (data.freezesAvailable > 0) {
            freezeBadge.classList.remove('hidden');
            freezeCount.textContent = data.freezesAvailable;
        } else {
            freezeBadge.classList.add('hidden');
        }
    }

    // Update repair banner
    if (repairBanner && _streakManager) {
        var repair = _streakManager.getRepairStatus();
        if (repair) {
            repairBanner.textContent = 'Your streak paused \u2014 solve ' + repair.remaining + ' more problem' + (repair.remaining !== 1 ? 's' : '') + ' today to pick it back up! (' + repair.done + '/' + repair.needed + ' done)';
            repairBanner.classList.remove('hidden');
        } else {
            repairBanner.classList.add('hidden');
        }
    }
}

function _renderStreakPopover(data) {
    var currentVal = document.getElementById('streak-current-val');
    var longestVal = document.getElementById('streak-longest-val');
    var freezesVal = document.getElementById('streak-freezes-val');
    var calendarEl = document.getElementById('streak-calendar');
    var repairInfo = document.getElementById('streak-repair-info');

    if (currentVal) currentVal.textContent = data.currentStreak;
    if (longestVal) longestVal.textContent = data.longestStreak;
    if (freezesVal) freezesVal.textContent = data.freezesAvailable;

    // Build 28-day calendar (4 weeks for clean grid)
    if (calendarEl) {
        var today = new Date();
        var todayStr = today.toISOString().split('T')[0];
        var html = '';

        // Build a map of dates to types
        var historyMap = {};
        if (data.streakHistory) {
            data.streakHistory.forEach(function(entry) {
                historyMap[entry.date] = entry.type;
            });
        }

        for (var i = 27; i >= 0; i--) {
            var d = new Date(today);
            d.setDate(d.getDate() - i);
            var dateStr = d.toISOString().split('T')[0];
            var dayNum = d.getDate();
            var type = historyMap[dateStr] || '';

            var classes = 'streak-cal-day';
            if (type === 'active') classes += ' active';
            else if (type === 'freeze') classes += ' freeze';
            if (dateStr === todayStr) {
                classes += ' today';
                if (data.repairAvailable) classes += ' repair';
            }

            html += '<div class="' + classes + '" title="' + dateStr + '">' + dayNum + '</div>';
        }
        calendarEl.innerHTML = html;
    }

    // Repair info
    if (repairInfo && _streakManager) {
        var repair = _streakManager.getRepairStatus();
        if (repair) {
            repairInfo.textContent = 'Solve ' + repair.remaining + ' more problem' + (repair.remaining !== 1 ? 's' : '') + ' today to save your streak!';
            repairInfo.classList.remove('hidden');
        } else {
            repairInfo.classList.add('hidden');
        }
    }
}

function _toggleStreakPopover() {
    var popover = document.getElementById('streak-popover');
    if (!popover) return;

    if (popover.classList.contains('hidden')) {
        if (_streakManager) {
            _renderStreakPopover(_streakManager.data);
        }
        popover.classList.remove('hidden');
    } else {
        popover.classList.add('hidden');
    }
}

function initStreakSystem() {
    _streakManager = new StreakManager();
    _streakManager.onUpdate = function(data) {
        _renderStreakUI(data);
    };

    // Insert streak display into header controls
    var streakDisplay = document.getElementById('streak-display');
    var controls = document.querySelector('.header .controls');
    if (streakDisplay && controls) {
        controls.insertBefore(streakDisplay, controls.firstChild);
    }

    // Check streak on load
    _streakManager.checkOnLoad();
    _renderStreakUI(_streakManager.data);

    // Wire popover toggle
    var badge = document.getElementById('streak-badge');
    if (badge) {
        badge.addEventListener('click', _toggleStreakPopover);
    }

    var popoverClose = document.getElementById('streak-popover-close');
    if (popoverClose) {
        popoverClose.addEventListener('click', function() {
            document.getElementById('streak-popover').classList.add('hidden');
        });
    }

    // Close popover when clicking outside
    document.addEventListener('click', function(e) {
        var popover = document.getElementById('streak-popover');
        var badgeEl = document.getElementById('streak-badge');
        if (popover && !popover.classList.contains('hidden')) {
            if (!popover.contains(e.target) && badgeEl && !badgeEl.contains(e.target)) {
                popover.classList.add('hidden');
            }
        }
    });

    // Hook into submit success to record activity
    _hookSubmitForStreak();
}

function _hookSubmitForStreak() {
    // Monkey-patch displayTestResults to detect all-pass on submit only
    var _current = window.displayTestResults;
    if (_current && !_current._streakPatched) {
        window.displayTestResults = function(results) {
            _current(results);
            // Only record streak on submit (not run) — check the flag set by submitCode()
            if (window._isSubmitRun && results && results.failed === 0 && _streakManager) {
                var result = _streakManager.recordActivity();
                if (result === 'repaired') {
                    addChatMessage('system', 'Streak repaired! Great perseverance.');
                }
            }
        };
        window.displayTestResults._streakPatched = true;
    }
}

// ============================================================
// Initialize Tickets 27, 28, 32 at DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    initMicroFeedback();
    initTTS();
    initStreakSystem();
    initPanelSwitcher();
});

// ============================================================
// Ticket 39: Mobile / Responsive Panel Switcher
// ============================================================

function initPanelSwitcher() {
    const switcher = document.getElementById('panel-switcher');
    const main = document.querySelector('.main');
    if (!switcher || !main) return;

    // Set initial active panel
    main.setAttribute('data-active-panel', 'problem');

    const buttons = switcher.querySelectorAll('.panel-switcher-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.dataset.panel;
            if (!panel) return;

            // Update active button
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Set active panel on main
            main.setAttribute('data-active-panel', panel);

            // Trigger Monaco editor resize if switching to editor
            if (panel === 'editor' && state.editorReady && state.editor) {
                // Delay slightly so DOM has updated display
                requestAnimationFrame(() => {
                    state.editor.layout();
                });
            }
        });
    });

    // When a problem is selected, auto-switch to editor on mobile
    _patchProblemSelectForMobile(main, buttons);
}

function _patchProblemSelectForMobile(mainEl, switcherButtons) {
    // Watch for problem title changes to auto-switch to editor on mobile
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const titleEl = document.getElementById('problem-title');
    if (!titleEl) return;
    const observer = new MutationObserver(() => {
        // When the problem title text changes (problem loaded), switch to editor on mobile
        if (mediaQuery.matches && titleEl.textContent !== 'Select a Problem') {
            switchToPanel('editor', mainEl, switcherButtons);
        }
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
}

function switchToPanel(panelName, mainEl, switcherButtons) {
    if (!mainEl) mainEl = document.querySelector('.main');
    if (!switcherButtons) switcherButtons = document.querySelectorAll('.panel-switcher-btn');
    mainEl.setAttribute('data-active-panel', panelName);
    switcherButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.panel === panelName);
    });
    if (panelName === 'editor' && state.editorReady && state.editor) {
        requestAnimationFrame(() => { state.editor.layout(); });
    }
}

// ============================================================
// Excalidraw Whiteboard
// ============================================================

let _whiteboardSavedHeight = null;
let _whiteboardSavedPanelWidth = null;
const _WHITEBOARD_MIN_PANEL_WIDTH = 770;

function initWhiteboard() {
    const section = document.getElementById('whiteboard-section');
    const toggleBtn = document.getElementById('whiteboard-toggle-btn');
    const sendBtn = document.getElementById('send-to-tutor-btn');
    const clearBtn = document.getElementById('whiteboard-clear-btn');
    const resizeHandle = document.getElementById('whiteboard-resize');
    if (!section || !toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        if (section.classList.contains('collapsed')) {
            expandWhiteboard();
        } else {
            collapseWhiteboard();
        }
    });

    if (sendBtn) {
        sendBtn.addEventListener('click', sendWhiteboardToTutor);
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (window.excalidrawBridge) {
                window.excalidrawBridge.clear();
            }
        });
    }

    // Vertical resize for whiteboard
    if (resizeHandle) {
        initResize(resizeHandle, 'vertical', {
            getSize: () => section.getBoundingClientRect().height,
            setSize: (val) => { section.style.height = val + 'px'; },
            getDelta: (startPos, e) => e.clientY - startPos,
            min: 100,
            max: () => {
                const rightPanel = document.querySelector('.right-panel');
                return rightPanel ? rightPanel.getBoundingClientRect().height - 80 : 400;
            },
        });
    }

    // Wire up auto-save on whiteboard changes
    const _waitForBridge = setInterval(() => {
        if (window.excalidrawBridge && window.excalidrawBridge.setOnChangeCallback) {
            window.excalidrawBridge.setOnChangeCallback(_onWhiteboardChange);
            clearInterval(_waitForBridge);
        }
    }, 500);
}

function expandWhiteboard() {
    const section = document.getElementById('whiteboard-section');
    if (!section) return;
    section.classList.remove('collapsed');
    const rightPanel = document.querySelector('.right-panel');
    const height = _whiteboardSavedHeight || (rightPanel ? rightPanel.getBoundingClientRect().height * 0.5 : 300);
    section.style.height = height + 'px';
    // Widen the right panel so Excalidraw gets its desktop toolbar
    if (rightPanel) {
        const currentWidth = rightPanel.getBoundingClientRect().width;
        if (currentWidth < _WHITEBOARD_MIN_PANEL_WIDTH) {
            _whiteboardSavedPanelWidth = currentWidth;
            rightPanel.style.width = _WHITEBOARD_MIN_PANEL_WIDTH + 'px';
        }
    }
    const toggleBtn = document.getElementById('whiteboard-toggle-btn');
    if (toggleBtn) toggleBtn.innerHTML = '&#9660;';
}

function collapseWhiteboard() {
    const section = document.getElementById('whiteboard-section');
    if (!section) return;
    _whiteboardSavedHeight = section.getBoundingClientRect().height;
    section.classList.add('collapsed');
    section.style.height = '';
    // Restore original right panel width
    if (_whiteboardSavedPanelWidth !== null) {
        const rightPanel = document.querySelector('.right-panel');
        if (rightPanel) rightPanel.style.width = _whiteboardSavedPanelWidth + 'px';
        _whiteboardSavedPanelWidth = null;
    }
    const toggleBtn = document.getElementById('whiteboard-toggle-btn');
    if (toggleBtn) toggleBtn.innerHTML = '&#9650;';
}

async function sendWhiteboardToTutor() {
    if (!window.excalidrawBridge) {
        addChatMessage('system', 'Whiteboard is not loaded yet.');
        return;
    }
    const count = window.excalidrawBridge.getElementCount();
    if (count === 0) {
        addChatMessage('system', 'Whiteboard is empty. Draw something first.');
        return;
    }
    if (!state.sessionId) {
        addChatMessage('system', 'Start a session first before sending a drawing.');
        return;
    }

    const sendBtn = document.getElementById('send-to-tutor-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

    try {
        const blob = await window.excalidrawBridge.exportToPng();
        if (!blob) {
            addChatMessage('system', 'Failed to export whiteboard.');
            return;
        }

        const formData = new FormData();
        formData.append('image', blob, 'whiteboard.png');
        formData.append('session_id', state.sessionId);

        const headers = {};
        if (state.authToken) {
            headers['Authorization'] = 'Bearer ' + state.authToken;
        }

        const resp = await fetch('/api/whiteboard-image', {
            method: 'POST',
            headers,
            body: formData,
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            addChatMessage('system', 'Failed to upload drawing: ' + (err.detail || resp.statusText));
            return;
        }

        // Tell the tutor to look at the drawing
        addChatMessage('user', '[Sent a whiteboard drawing]');
        wsSend({
            type: 'message',
            content: 'I just saved a whiteboard drawing to ./whiteboard.png — please read and analyze it. Describe what you see and help me with my approach.',
            code: getEditorValue(),
        });
    } catch (e) {
        console.error('sendWhiteboardToTutor error:', e);
        addChatMessage('system', 'Error sending drawing: ' + e.message);
    } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to Tutor'; }
    }
}

document.addEventListener('DOMContentLoaded', initWhiteboard);

// ---- Whiteboard state persistence ----
let _whiteboardSaveTimeout = null;
const _WHITEBOARD_SAVE_DEBOUNCE_MS = 3000;

function _onWhiteboardChange() {
    if (!state.sessionId) return;
    if (_whiteboardSaveTimeout) clearTimeout(_whiteboardSaveTimeout);
    _whiteboardSaveTimeout = setTimeout(_saveWhiteboardState, _WHITEBOARD_SAVE_DEBOUNCE_MS);
}

async function _saveWhiteboardState() {
    if (!state.sessionId || !window.excalidrawBridge) return;
    const stateData = window.excalidrawBridge.getState();
    try {
        const headers = { 'Content-Type': 'application/json', ...authHeaders() };
        const resp = await fetch(`/api/sessions/${state.sessionId}/whiteboard-state`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ whiteboard_state: stateData }),
        });
        if (!resp.ok) {
            console.warn('Failed to save whiteboard state:', resp.status);
        }
    } catch (e) {
        console.warn('Failed to save whiteboard state:', e);
    }
}
