// Test Feedback / Micro-Feedback module
// Renders per-test progress bar, improvement detection, and confetti celebration.

import { eventBus, Events } from './event-bus.js';
import { escapeHtml } from './utils.js';

// Dependencies injected via configureFeedbackDeps().
let _deps = {
    shouldReduceMotion: () => false,
};

export function configureFeedbackDeps({ shouldReduceMotion }) {
    _deps.shouldReduceMotion = shouldReduceMotion;
}

// --- Module-scoped state ---

let _microFeedbackState = {
    lastPassCount: null,
    lastTotal: null,
};

// --- Public functions ---

export function renderMicroFeedback(results, isSubmit) {
    const container = document.getElementById('test-results');
    if (!container || !results || !results.results) return;

    const total = results.passed + results.failed;
    const allPassed = results.failed === 0;
    const testResults = results.results;

    // Improvement detection
    let improvementMsg = '';
    if (_microFeedbackState.lastPassCount !== null && _microFeedbackState.lastTotal === total) {
        if (results.passed > _microFeedbackState.lastPassCount) {
            improvementMsg = 'Progress! You went from ' + _microFeedbackState.lastPassCount + ' to ' + results.passed + ' passing tests.';
        }
    }
    _microFeedbackState.lastPassCount = results.passed;
    _microFeedbackState.lastTotal = total;

    // Build HTML
    let html = '<div class="mf-container">';

    // Progress bar
    html += '<div class="mf-progress-wrapper">';
    html += '<div class="mf-progress-bar" id="mf-progress-bar">';
    for (let i = 0; i < testResults.length; i++) {
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
    for (let j = 0; j < testResults.length; j++) {
        const r = testResults[j];
        const passed = r.passed;
        const expanded = !passed;
        const iconClass = passed ? 'pass' : 'fail';
        const icon = passed ? '&#10003;' : '&#10007;';

        let inputStr = '';
        if (r.input) {
            inputStr = Object.entries(r.input).map(function(kv) { return kv[0] + ' = ' + JSON.stringify(kv[1]); }).join(', ');
        }
        const shortLabel = 'Test ' + r.test_num + (inputStr ? ': ' + inputStr : '');

        html += '<div class="mf-test-row">';
        html += '<div class="mf-test-header" data-test-idx="' + j + '">';
        html += '<span class="mf-test-icon ' + iconClass + '">' + icon + '</span>';
        html += '<span class="mf-test-label">' + escapeHtml(shortLabel) + '</span>';
        html += '<span class="mf-test-chevron' + (expanded ? ' expanded' : '') + '">&#9654;</span>';
        html += '</div>';

        let detailHtml = '<div class="mf-test-detail' + (expanded ? ' expanded' : '') + '" data-test-detail="' + j + '">';
        if (r.input) {
            const inStr = Object.entries(r.input).map(function(kv) { return kv[0] + ' = ' + JSON.stringify(kv[1]); }).join('\n');
            detailHtml += '<div class="detail-row"><label>Input</label><pre>' + escapeHtml(inStr) + '</pre></div>';
        }
        const outputStr = r.error ? r.error : JSON.stringify(r.actual);
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
            const idx = header.dataset.testIdx;
            const detail = container.querySelector('[data-test-detail="' + idx + '"]');
            const chevron = header.querySelector('.mf-test-chevron');
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

// --- Private helpers ---

function _animateProgressSegments(container, testResults, allPassed) {
    const segments = container.querySelectorAll('.mf-progress-segment');
    const progressBar = container.querySelector('#mf-progress-bar');
    const reduceMotion = _deps.shouldReduceMotion();
    const delay = reduceMotion ? 0 : 120;

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
    const colors = ['#4ec9b0', '#569cd6', '#dcdcaa', '#f48771', '#c586c0', '#d7ba7d', '#ce9178'];
    const particleCount = 18;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';
        particle.style.left = (Math.random() * 80 + 10) + 'vw';
        particle.style.top = '-10px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.animationDuration = (1.0 + Math.random() * 1.0) + 's';
        particle.style.animationDelay = (Math.random() * 0.5) + 's';
        const size = 6 + Math.random() * 6;
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

// --- Initialization ---

export function initMicroFeedback() {
    // Subscribe to test results via event bus instead of monkey-patching
    eventBus.on(Events.TEST_RESULTS_DISPLAYED, (results, isSubmit) => {
        renderMicroFeedback(results, isSubmit);
    });
}
