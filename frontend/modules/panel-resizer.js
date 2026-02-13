// --- Panel Resizer Module ---
// Handles drag-to-resize for problem panel, chat panel, and test results panel.

/**
 * Generic resize handler. Attaches mousedown/mousemove/mouseup listeners
 * to a drag handle so the user can resize an adjacent panel.
 *
 * @param {HTMLElement} handle    - The drag-handle element.
 * @param {'horizontal'|'vertical'} direction - Resize axis.
 * @param {Object} opts
 * @param {() => number}             opts.getSize  - Returns the current size (px).
 * @param {(val: number) => void}    opts.setSize  - Applies the new size (px).
 * @param {(startPos: number, e: MouseEvent) => number} opts.getDelta - Signed px moved.
 * @param {number}                   opts.min      - Minimum allowed size (px).
 * @param {number | (() => number)}  opts.max      - Maximum allowed size (px or fn).
 */
export function initResize(handle, direction, opts) {
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

/**
 * Initialise all three resize handles:
 *  - problem-panel  (horizontal, drag right = wider)
 *  - right-panel / chat  (horizontal, drag left = wider)
 *  - test-results   (vertical, drag up = taller)
 */
export function initResizeHandles() {
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

// ---------------------------------------------------------------------------
// Reset layout — animate all panels back to CSS defaults
// ---------------------------------------------------------------------------

const DEFAULT_PANEL_WIDTH = '350px';
const TRANSITION_FALLBACK_MS = 300;

export function resetLayout(opts = {}) {
    const problem = document.getElementById('problem-panel');
    const right = document.querySelector('.right-panel');
    const testResults = document.getElementById('test-results');

    // Uncollapse + animate problem panel to default width
    if (problem) {
        if (problem.classList.contains('collapsed')) {
            _syncProblemToggle(false);
            problem.classList.remove('collapsed');
        }
        _pinAndAnimate(problem, 'width', DEFAULT_PANEL_WIDTH);
    }

    // Animate right panel to default width
    if (right) _pinAndAnimate(right, 'width', DEFAULT_PANEL_WIDTH);

    // Snap test results back to CSS default (no animation needed)
    if (testResults) {
        testResults.style.height = '';
        testResults.style.maxHeight = '';
    }

    // Collapse whiteboard if callback provided
    if (opts.collapseWhiteboard) opts.collapseWhiteboard();
}

/**
 * Pin an element at its current computed size, force reflow,
 * then set the target so CSS transition animates between them.
 */
function _pinAndAnimate(el, prop, target) {
    const current = window.getComputedStyle(el)[prop];
    el.style[prop] = current;
    // Force reflow so the browser sees the pinned value
    void el.offsetWidth;
    el.style[prop] = target;
    _clearAfterTransition(el, prop);
}

/**
 * After transition ends (with a fallback timeout), remove the inline
 * style so CSS defaults own the property again.
 */
function _clearAfterTransition(el, prop) {
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        el.style[prop] = '';
    };
    el.addEventListener('transitionend', function handler(e) {
        if (e.propertyName === prop) {
            el.removeEventListener('transitionend', handler);
            cleanup();
        }
    });
    setTimeout(cleanup, TRANSITION_FALLBACK_MS);
}

/**
 * Sync the collapse/expand UI (toggle button title, expand button, resize handle).
 * @param {boolean} collapsed - true if collapsing, false if expanding
 */
function _syncProblemToggle(collapsed) {
    const toggleBtn = document.getElementById('toggle-problem');
    const expandBtn = document.getElementById('expand-problem');
    const resizeHandle = document.getElementById('problem-panel-resize');

    if (toggleBtn) {
        toggleBtn.innerHTML = collapsed ? '&#9654;' : '&#9664;';
        toggleBtn.title = collapsed ? 'Expand problem panel' : 'Collapse problem panel';
    }
    if (expandBtn) expandBtn.style.display = collapsed ? '' : 'none';
    if (resizeHandle) resizeHandle.style.display = collapsed ? 'none' : '';
}
