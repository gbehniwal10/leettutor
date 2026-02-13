// Shared application state — single source of truth.
// All modules import this object and mutate it directly.

export const state = {
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
    reviewQueue: null,  // { due_problems: [...], due_topics: [...] } from /api/review-queue
};
