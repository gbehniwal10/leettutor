// Simple pub/sub event bus.
// Replaces monkey-patching of displayTestResults and other cross-cutting hooks.

const listeners = {};

export const eventBus = {
    on(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
    },

    off(event, callback) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    },

    emit(event, ...args) {
        if (!listeners[event]) return;
        for (const cb of listeners[event]) {
            try { cb(...args); }
            catch (e) { console.error(`Event bus error [${event}]:`, e); }
        }
    },
};

// Event names used across modules
export const Events = {
    TEST_RESULTS_DISPLAYED: 'testResultsDisplayed',
    CODE_SUBMITTED: 'codeSubmitted',
    SESSION_STARTED: 'sessionStarted',
    SESSION_ENDED: 'sessionEnded',
    SESSION_RESUMED: 'sessionResumed',
    PROBLEM_SELECTED: 'problemSelected',
    CHAT_MESSAGE: 'chatMessage',
    WS_MESSAGE: 'wsMessage',
    ACTIVITY: 'activity',
    PROBLEM_SOLVED: 'problem-solved',
};
