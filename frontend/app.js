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
};

document.addEventListener('DOMContentLoaded', () => {
    initMonacoEditor();
    initWebSocket();
    initEventListeners();
    loadProblems();
});

function renderMarkdown(text) {
    try {
        if (typeof marked !== 'undefined' && marked.parse) return marked.parse(text);
    } catch (e) { console.warn('marked.parse failed:', e); }
    // Fallback: basic HTML escaping with newlines preserved
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
}

function initMonacoEditor() {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

    require(['vs/editor/editor.main'], function () {
        monaco.editor.defineTheme('leetcode-dark', {
            base: 'vs-dark', inherit: true, rules: [],
            colors: { 'editor.background': '#1e1e1e' }
        });

        state.editor = monaco.editor.create(document.getElementById('editor'), {
            value: '# Select a problem to begin',
            language: 'python',
            theme: 'leetcode-dark',
            fontSize: 14,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
        });
        state.editorReady = true;
        console.log('Monaco editor ready');
    });
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);

    state.ws.onopen = () => {
        state.wsReady = true;
        const banner = document.getElementById('ws-status');
        if (banner) banner.classList.add('hidden');
    };
    state.ws.onmessage = (event) => handleWebSocketMessage(JSON.parse(event.data));
    state.ws.onclose = () => {
        state.wsReady = false;
        const banner = document.getElementById('ws-status');
        if (banner) banner.classList.remove('hidden');
        setTimeout(initWebSocket, 3000);
    };
    state.ws.onerror = () => {};
}

function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
        return true;
    }
    console.warn('WebSocket not connected, message dropped:', obj.type);
    return false;
}

function initEventListeners() {
    document.getElementById('mode-select').addEventListener('change', (e) => { state.mode = e.target.value; updateModeUI(); });
    document.getElementById('new-problem-btn').addEventListener('click', showProblemModal);
    document.getElementById('close-modal').addEventListener('click', hideProblemModal);
    document.getElementById('toggle-problem').addEventListener('click', toggleProblemDescription);
    document.getElementById('expand-problem').addEventListener('click', toggleProblemPanel);
    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('submit-btn').addEventListener('click', submitCode);
    document.getElementById('hint-btn').addEventListener('click', requestHint);
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('history-btn').addEventListener('click', showHistoryModal);
    document.getElementById('close-history').addEventListener('click', hideHistoryModal);
    document.getElementById('history-back').addEventListener('click', showSessionList);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape closes any modal
        if (e.key === 'Escape') {
            hideProblemModal();
            hideHistoryModal();
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
        const response = await fetch('/api/problems');
        state.allProblems = await response.json();
        renderProblemList(state.allProblems);
        initProblemFilters();
    } catch (error) { console.error('Failed to load problems:', error); }
}

function initProblemFilters() {
    document.getElementById('problem-search').addEventListener('input', filterProblems);
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterProblems();
        });
    });
}

function filterProblems() {
    const search = (document.getElementById('problem-search').value || '').toLowerCase();
    const difficulty = document.querySelector('.filter-tab.active')?.dataset.difficulty || 'all';
    const filtered = state.allProblems.filter(p => {
        if (difficulty !== 'all' && p.difficulty !== difficulty) return false;
        if (search && !p.title.toLowerCase().includes(search) && !p.tags.some(t => t.includes(search))) return false;
        return true;
    });
    renderProblemList(filtered);
}

function renderProblemList(problems) {
    const container = document.getElementById('problem-list');
    container.innerHTML = problems.map(p => `
        <div class="problem-item" data-id="${p.id}">
            <span class="title">${p.title}</span>
            <span class="difficulty ${p.difficulty}">${p.difficulty}</span>
            <div class="tags">${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
        </div>
    `).join('');

    container.querySelectorAll('.problem-item').forEach(item => {
        item.addEventListener('click', () => selectProblem(item.dataset.id));
    });
}

async function selectProblem(problemId) {
    try {
        const response = await fetch(`/api/problems/${problemId}`);
        state.currentProblem = await response.json();
    } catch (error) {
        console.error('Failed to fetch problem:', error);
        return;
    }

    // Update UI — each step independent so one failure doesn't block the rest
    document.getElementById('problem-title').textContent = state.currentProblem.title;
    document.getElementById('problem-difficulty').textContent = state.currentProblem.difficulty;
    document.getElementById('problem-difficulty').className = `difficulty ${state.currentProblem.difficulty}`;
    document.getElementById('problem-description').innerHTML = renderMarkdown(state.currentProblem.description);

    // Ensure problem panel is expanded
    const panel = document.getElementById('problem-panel');
    if (panel.classList.contains('collapsed')) toggleProblemPanel();

    if (state.editorReady && state.editor) {
        state.editor.setValue(state.currentProblem.starter_code);
    }

    document.getElementById('test-results').innerHTML = '';
    hideProblemModal();
    startSession();
}

function showProblemModal() {
    document.getElementById('problem-modal').classList.remove('hidden');
    const search = document.getElementById('problem-search');
    if (search) { search.value = ''; }
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('.filter-tab[data-difficulty="all"]');
    if (allTab) allTab.classList.add('active');
    renderProblemList(state.allProblems);
}
function hideProblemModal() { document.getElementById('problem-modal').classList.add('hidden'); }
let savedProblemPanelWidth = 350;

function toggleProblemPanel() {
    const panel = document.getElementById('problem-panel');
    const expandBtn = document.getElementById('expand-problem');
    const resizeHandle = document.getElementById('problem-panel-resize');
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        panel.style.width = savedProblemPanelWidth + 'px';
        expandBtn.style.display = 'none';
        resizeHandle.style.display = '';
    } else {
        savedProblemPanelWidth = panel.getBoundingClientRect().width || 350;
        panel.classList.add('collapsed');
        panel.style.width = '0';
        expandBtn.style.display = 'block';
        resizeHandle.style.display = 'none';
    }
}

function toggleProblemDescription() {
    toggleProblemPanel();
}

function startSession() {
    if (!wsSend({ type: 'start_session', problem_id: state.currentProblem.id, mode: state.mode })) {
        addChatMessage('system', 'WebSocket not connected. Trying to reconnect...');
        return;
    }
    document.getElementById('chat-messages').innerHTML = '';
    addChatMessage('system', `Starting ${state.mode} session for "${state.currentProblem.title}"`);
    if (state.mode === 'interview') startTimer();
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

function updateModeUI() {
    if (state.mode === 'learning') {
        document.getElementById('timer').classList.add('hidden');
        if (state.timerInterval) clearInterval(state.timerInterval);
        if (state.timeSyncInterval) clearInterval(state.timeSyncInterval);
    }
}

function getEditorValue() {
    return (state.editorReady && state.editor) ? state.editor.getValue() : '';
}

async function runCode() {
    if (!state.currentProblem) return;
    const btn = document.getElementById('run-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';
    const code = getEditorValue();
    try {
        const response = await fetch('/api/run', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, problem_id: state.currentProblem.id })
        });
        const results = await response.json();
        displayTestResults(results);
    } catch (error) {
        document.getElementById('test-results').innerHTML = '<div class="result-banner wrong-answer"><span class="banner-text">Error</span><span class="banner-info">Failed to run code. Check your connection.</span></div>';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '&#9654; Run';
    }
}

async function submitCode() {
    if (!state.currentProblem) return;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    const code = getEditorValue();
    try {
        const response = await fetch('/api/submit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, problem_id: state.currentProblem.id })
        });
        const results = await response.json();
        displayTestResults(results);
        if (results.failed === 0) {
            addChatMessage('system', 'All tests passed! Great job!');
            if (state.mode === 'interview' && !state.inReview) {
                wsSend({ type: 'time_up', code });
            }
        }
    } catch (error) {
        document.getElementById('test-results').innerHTML = '<div class="result-banner wrong-answer"><span class="banner-text">Error</span><span class="banner-info">Failed to submit code. Check your connection.</span></div>';
    } finally {
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
        case 'session_started': state.sessionId = data.session_id; break;
        case 'assistant_message': finalizeAssistantMessage(data.content); break;
        case 'assistant_chunk': appendToLastAssistantMessage(data.content); break;
        case 'review_phase_started':
            state.inReview = true;
            if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
            if (state.timeSyncInterval) { clearInterval(state.timeSyncInterval); state.timeSyncInterval = null; }
            addChatMessage('system', 'Entering review phase.');
            break;
        case 'error': addChatMessage('system', `Error: ${data.content}`); break;
    }
}

function finalizeAssistantMessage(content) {
    const container = document.getElementById('chat-messages');
    const lastMessage = container.querySelector('.chat-message.assistant:last-child');
    if (lastMessage && lastMessage.dataset.streaming === 'true') {
        lastMessage.dataset.streaming = 'false';
        lastMessage.innerHTML = renderMarkdown(content);
        container.scrollTop = container.scrollHeight;
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
    if (lastMessage && lastMessage.dataset.streaming === 'true') {
        lastMessage.dataset.content = (lastMessage.dataset.content || '') + content;
        lastMessage.innerHTML = renderMarkdown(lastMessage.dataset.content);
    } else {
        const message = document.createElement('div');
        message.className = 'chat-message assistant';
        message.dataset.streaming = 'true';
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
    document.getElementById('history-modal').classList.remove('hidden');
    loadSessions();
}

function hideHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
}

async function loadSessions() {
    const container = document.getElementById('session-list');
    const detail = document.getElementById('session-detail');
    detail.classList.add('hidden');
    container.classList.remove('hidden');
    document.getElementById('history-back').classList.add('hidden');
    document.getElementById('history-title').textContent = 'Session History';

    try {
        const response = await fetch('/api/sessions');
        const sessions = await response.json();
        if (!sessions.length) {
            container.innerHTML = '<p style="color:var(--text-secondary);padding:16px;">No sessions yet.</p>';
            return;
        }
        container.innerHTML = sessions.map(s => {
            const date = new Date(s.start_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const dur = s.duration_seconds ? `${Math.round(s.duration_seconds / 60)}m` : 'in progress';
            return `<div class="session-item" data-id="${s.session_id}">
                <span class="title">${s.problem_id}</span>
                <span class="difficulty ${s.mode === 'interview' ? 'medium' : 'easy'}">${s.mode}</span>
                <span class="session-date">${date}</span>
                <span class="session-duration">${dur}</span>
            </div>`;
        }).join('');
        container.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => viewSession(item.dataset.id));
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
        const response = await fetch(`/api/sessions/${sessionId}`);
        const session = await response.json();
        document.getElementById('history-title').textContent = `${session.problem_id} — ${session.mode}`;
        const messages = (session.messages || []).map(m => {
            const cls = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system';
            const content = cls === 'assistant' ? renderMarkdown(m.content) : escapeHtml(m.content);
            return `<div class="chat-message ${cls}">${content}</div>`;
        }).join('');
        const meta = `<div class="session-meta">
            <span>Hints: ${session.hints_requested || 0}</span>
            <span>Duration: ${session.duration_seconds ? Math.round(session.duration_seconds / 60) + 'm' : 'N/A'}</span>
        </div>`;
        detail.innerHTML = meta + '<div class="session-transcript">' + (messages || '<p style="color:var(--text-secondary)">No messages.</p>') + '</div>';
    } catch (error) {
        detail.innerHTML = '<p style="color:var(--accent-red);padding:16px;">Failed to load session.</p>';
    }
}

function showSessionList() {
    loadSessions();
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
