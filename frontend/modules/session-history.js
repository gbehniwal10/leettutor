// Session History module — history modal, session list, and session detail view.

import { state } from './state.js';
import { authHeaders, handleAuthError, escapeHtml, renderMarkdown, trapFocus, releaseFocus } from './utils.js';

// --- Dependency injection ---
// Functions from other modules that viewSession needs to call.
// Set via configureHistoryDeps() before first use.

let _deps = {
    resumeSession: null,
};

export function configureHistoryDeps({ resumeSession }) {
    _deps = { resumeSession };
}

// --- Public functions ---

export function showHistoryModal() {
    const modal = document.getElementById('history-modal');
    modal.classList.remove('hidden');
    loadSessions();
    trapFocus(modal);
}

export function hideHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
    releaseFocus();
}

export async function loadSessions() {
    const container = document.getElementById('session-list');
    const detail = document.getElementById('session-detail');
    detail.classList.add('hidden');
    container.classList.remove('hidden');
    document.getElementById('history-back').classList.add('hidden');
    document.getElementById('history-modal-title').textContent = 'Session History';

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
        document.getElementById('history-modal-title').textContent = session.problem_id + ' \u2014 ' + session.mode;
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
                _deps.resumeSession(btn.dataset.sessionId);
            });
        }
    } catch (error) {
        detail.innerHTML = '<p style="color:var(--accent-red);padding:16px;">Failed to load session.</p>';
    }
}
