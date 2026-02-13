// Shared constants used across modules.

export const WS_MESSAGE_TYPES = {
    // Client -> Server
    AUTH: 'auth',
    START_SESSION: 'start_session',
    MESSAGE: 'message',
    REQUEST_HINT: 'request_hint',
    RESUME_SESSION: 'resume_session',
    END_SESSION: 'end_session',
    TIME_UPDATE: 'time_update',
    TIME_UP: 'time_up',
    NUDGE_REQUEST: 'nudge_request',
    TEST_RESULTS_UPDATE: 'test_results_update',
    SAVE_STATE: 'save_state',
    APPROACH_RESOLVE: 'approach_resolve',

    // Server -> Client
    SESSION_STARTED: 'session_started',
    SESSION_RESUMED: 'session_resumed',
    ASSISTANT_CHUNK: 'assistant_chunk',
    ASSISTANT_MESSAGE: 'assistant_message',
    ERROR: 'error',
    REVIEW_PHASE_STARTED: 'review_phase_started',
    APPROACH_CLASSIFIED: 'approach_classified',
    APPROACH_DUPLICATE: 'approach_duplicate',
    SOLUTION_COUNT_UPDATED: 'solution_count_updated',

    // Deprecated / unused (kept for backward compatibility)
    HINT: 'hint',
    NUDGE: 'nudge',
};

export const MODES = {
    LEARNING: 'learning',
    INTERVIEW: 'interview',
    PATTERN_QUIZ: 'pattern-quiz',
};

export const DEFAULT_SETTINGS = {
    theme: 'dark',
    editorFontSize: 14,
    editorFontFamily: 'default',
    editorLineHeight: 1.5,
    editorLigatures: false,
    zenMode: false,
    inactivityNudgeMinutes: 2,
    ambientSound: 'off',
    ambientVolume: 0.3,
    earcons: false,
    earconVolume: 0.3,
    reducedMotion: 'system',
    confirmDestructive: true,
    uiFontSize: 14,
};

export const FONT_FAMILY_MAP = {
    'default': "'Consolas', 'Courier New', monospace",
    'jetbrains-mono': "'JetBrains Mono', 'Consolas', monospace",
    'fira-code': "'Fira Code', 'Consolas', monospace",
    'comic-mono': "'Comic Mono', 'Comic Sans MS', monospace",
};

export const THEME_TO_MONACO = {
    'dark': 'leetcode-dark',
    'sepia': 'leetcode-sepia',
    'low-distraction': 'leetcode-muted',
};

export const TAG_TO_PATTERN = {
    'two-pointers': 'Two Pointers',
    'two-pointer': 'Two Pointers',
    'sliding-window': 'Sliding Window',
    'binary-search': 'Binary Search',
    'stack': 'Stack',
    'monotonic-stack': 'Stack',
    'monotonic-queue': 'Stack',
    'heap-(priority-queue)': 'Heap / Priority Queue',
    'linked-list': 'Linked List',
    'tree': 'Trees',
    'binary-tree': 'Trees',
    'binary-search-tree': 'Trees',
    'graph': 'Graphs (BFS/DFS)',
    'depth-first-search': 'Graphs (BFS/DFS)',
    'breadth-first-search': 'Graphs (BFS/DFS)',
    'topological-sort': 'Graphs (BFS/DFS)',
    'shortest-path': 'Graphs (BFS/DFS)',
    'minimum-spanning-tree': 'Graphs (BFS/DFS)',
    'dynamic-programming': 'Dynamic Programming',
    'memoization': 'Dynamic Programming',
    'backtracking': 'Backtracking',
    'greedy': 'Greedy',
    'trie': 'Trie',
    'union-find': 'Union Find',
    'math': 'Math / Bit Manipulation',
    'bit-manipulation': 'Math / Bit Manipulation',
    'prefix-sum': 'Sliding Window',
    'divide-and-conquer': 'Binary Search',
    'hash-map': 'Arrays & Hashing',
    'hash-table': 'Arrays & Hashing',
    'hash-function': 'Arrays & Hashing',
};

export const PATTERN_LIST = [
    'Arrays & Hashing', 'Two Pointers', 'Sliding Window', 'Binary Search',
    'Stack', 'Heap / Priority Queue', 'Linked List', 'Trees',
    'Graphs (BFS/DFS)', 'Dynamic Programming', 'Backtracking', 'Greedy',
    'Trie', 'Union Find', 'Math / Bit Manipulation',
];

export const INTERVIEW_DURATION_SECS = 45 * 60;

export const WS_MAX_BACKOFF_MS = 30000;

export const CLICK_DEBOUNCE_MS = 300;

export const RESUME_TIMEOUT_MS = 30000;
