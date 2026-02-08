// ============================================================
// Audio Module
// Ticket 30: Ambient Sound Generator (Brown Noise / Pink Noise)
// Ticket 33: Earcons (Subtle Audio Feedback)
// ============================================================

import { state } from './state.js';

// Dependency injection for cross-module references
let _deps = {
    settingsManager: null,
};

export function configureAudioDeps({ settingsManager }) {
    _deps.settingsManager = settingsManager;
}

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
        var volume = _deps.settingsManager.get('ambientVolume');
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

    _deps.settingsManager.onChange('ambientSound', handleSoundChange);
    _deps.settingsManager.onChange('ambientVolume', handleVolumeChange);

    // Apply saved preference on load (will queue until user gesture)
    var savedType = _deps.settingsManager.get('ambientSound');
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
    player.setEnabled(_deps.settingsManager.get('earcons'));
    _deps.settingsManager.onChange('earcons', function(enabled) {
        player.setEnabled(enabled);
        if (enabled) {
            connectEarconObserver();
        } else {
            disconnectEarconObserver();
        }
    });

    // Wire volume slider
    player.setVolume(_deps.settingsManager.get('earconVolume'));
    _deps.settingsManager.onChange('earconVolume', function(vol) {
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
        if (_deps.settingsManager.get('earcons')) {
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

export {
    initAmbientSound,
    initEarcons,
    disconnectEarconObserver,
    connectEarconObserver,
};
