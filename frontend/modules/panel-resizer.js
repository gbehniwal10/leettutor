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
