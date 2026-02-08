// ============================================================
// TTS (Text-to-Speech) Module
// Extracted from app.js - Ticket 28: TTS Read Aloud
// ============================================================

// Module-scoped state
var _ttsReader = null;
var _ttsObserverRef = null;
var _ttsObserverTarget = null;
var _ttsObserverOptions = { childList: true, characterData: true, subtree: true };

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

export { initTTS, disconnectTtsObserver, connectTtsObserver };
