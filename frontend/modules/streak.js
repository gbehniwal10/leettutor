// ============================================================
// Streak System with Freeze / Recovery
// ============================================================

import { eventBus, Events } from './event-bus.js';

// --- Dependency injection ---
let deps = {
    addChatMessage: null,
};

export function configureStreakDeps({ addChatMessage }) {
    deps.addChatMessage = addChatMessage;
}

// --- Module-scoped state ---
var _streakManager = null;

// --- StreakManager class ---

class StreakManager {
    constructor() {
        this._storageKey = 'leettutor_streak';
        this._data = this._load();
        this._todaySolveCount = 0;
        this.onUpdate = null;
    }

    _getToday() {
        return new Date().toISOString().split('T')[0];
    }

    _load() {
        try {
            var raw = localStorage.getItem(this._storageKey);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return this._defaultData();
    }

    _defaultData() {
        return {
            currentStreak: 0,
            longestStreak: 0,
            lastActiveDate: null,
            freezesAvailable: 0,
            freezeUsedToday: false,
            streakHistory: [],
            repairAvailable: false,
            repairTarget: 2,
        };
    }

    _save() {
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(this._data));
        } catch (e) { /* ignore */ }
    }

    get data() { return this._data; }

    checkOnLoad() {
        var today = this._getToday();
        var lastActive = this._data.lastActiveDate;

        if (!lastActive) {
            // First time user, no streak
            this._data.repairAvailable = false;
            this._save();
            this._notify();
            return;
        }

        if (lastActive === today) {
            // Already active today
            this._data.repairAvailable = false;
            this._data.freezeUsedToday = false;
            this._save();
            this._notify();
            return;
        }

        var daysDiff = this._daysBetween(lastActive, today);

        if (daysDiff === 1) {
            // Yesterday was active, streak continues, waiting for today's activity
            this._data.repairAvailable = false;
            this._data.freezeUsedToday = false;
            this._save();
            this._notify();
            return;
        }

        if (daysDiff === 2) {
            // Missed one day (yesterday)
            var missedDate = this._addDays(lastActive, 1);
            if (this._data.freezesAvailable > 0) {
                // Auto-use freeze
                this._data.freezesAvailable--;
                this._data.freezeUsedToday = true;
                this._addHistory(missedDate, 'freeze');
                this._save();
                this._notify();
                return;
            } else {
                // Streak breaks, repair available
                this._data.repairAvailable = true;
                this._data.repairTarget = 2;
                this._todaySolveCount = 0;
                this._save();
                this._notify();
                return;
            }
        }

        // 3+ days missed - streak resets, no repair
        this._data.currentStreak = 0;
        this._data.repairAvailable = false;
        this._data.freezeUsedToday = false;
        this._save();
        this._notify();
    }

    recordActivity() {
        var today = this._getToday();

        // Handle repair mode
        if (this._data.repairAvailable) {
            this._todaySolveCount++;
            if (this._todaySolveCount >= this._data.repairTarget) {
                // Repair successful - streak continues as if never broken
                this._data.repairAvailable = false;
                this._data.lastActiveDate = today;
                this._addHistory(today, 'active');
                this._data.currentStreak++;
                this._checkFreezeEarning();
                if (this._data.currentStreak > this._data.longestStreak) {
                    this._data.longestStreak = this._data.currentStreak;
                }
                this._save();
                this._notify();
                this._checkMilestone();
                return 'repaired';
            }
            this._save();
            this._notify();
            return 'repair_progress';
        }

        // Normal activity
        if (this._data.lastActiveDate === today) {
            // Already counted today
            return 'already_active';
        }

        this._data.currentStreak++;
        this._data.lastActiveDate = today;
        this._addHistory(today, 'active');
        this._checkFreezeEarning();

        if (this._data.currentStreak > this._data.longestStreak) {
            this._data.longestStreak = this._data.currentStreak;
        }

        this._save();
        this._notify();
        this._checkMilestone();
        return 'incremented';
    }

    _checkFreezeEarning() {
        if (this._data.currentStreak > 0 && this._data.currentStreak % 7 === 0) {
            if (this._data.freezesAvailable < 2) {
                this._data.freezesAvailable++;
            }
        }
    }

    _checkMilestone() {
        var milestones = [7, 14, 30, 50, 100];
        var streak = this._data.currentStreak;
        if (milestones.indexOf(streak) !== -1) {
            var msg = streak + '-day streak!';
            if (streak % 7 === 0 && this._data.freezesAvailable <= 2) {
                msg += ' You earned a streak freeze.';
            }
            _showStreakMilestoneToast(msg);
        }
    }

    _addHistory(dateStr, type) {
        this._data.streakHistory.push({ date: dateStr, type: type });
        if (this._data.streakHistory.length > 30) {
            this._data.streakHistory = this._data.streakHistory.slice(-30);
        }
    }

    _daysBetween(dateStr1, dateStr2) {
        var d1 = new Date(dateStr1 + 'T00:00:00');
        var d2 = new Date(dateStr2 + 'T00:00:00');
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    _addDays(dateStr, days) {
        var d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    }

    _notify() {
        if (this.onUpdate) this.onUpdate(this._data);
    }

    getRepairStatus() {
        if (!this._data.repairAvailable) return null;
        return {
            needed: this._data.repairTarget,
            done: this._todaySolveCount,
            remaining: this._data.repairTarget - this._todaySolveCount,
        };
    }
}

// --- UI helpers ---

function _showStreakMilestoneToast(message) {
    var toast = document.getElementById('streak-milestone-toast');
    if (!toast) return;
    toast.textContent = '\uD83D\uDD25 ' + message;
    toast.classList.remove('hidden');
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function() {
        toast.classList.remove('visible');
        setTimeout(function() { toast.classList.add('hidden'); }, 300);
    }, 4000);
}

function _renderStreakUI(data) {
    var display = document.getElementById('streak-display');
    var countEl = document.getElementById('streak-count');
    var freezeBadge = document.getElementById('streak-freeze-badge');
    var freezeCount = document.getElementById('streak-freeze-count');
    var repairBanner = document.getElementById('streak-repair-banner');

    if (!display) return;
    display.classList.remove('hidden');

    if (countEl) countEl.textContent = data.currentStreak;

    if (freezeBadge && freezeCount) {
        if (data.freezesAvailable > 0) {
            freezeBadge.classList.remove('hidden');
            freezeCount.textContent = data.freezesAvailable;
        } else {
            freezeBadge.classList.add('hidden');
        }
    }

    // Update repair banner
    if (repairBanner && _streakManager) {
        var repair = _streakManager.getRepairStatus();
        if (repair) {
            repairBanner.textContent = 'Your streak paused \u2014 solve ' + repair.remaining + ' more problem' + (repair.remaining !== 1 ? 's' : '') + ' today to pick it back up! (' + repair.done + '/' + repair.needed + ' done)';
            repairBanner.classList.remove('hidden');
        } else {
            repairBanner.classList.add('hidden');
        }
    }
}

function _renderStreakPopover(data) {
    var currentVal = document.getElementById('streak-current-val');
    var longestVal = document.getElementById('streak-longest-val');
    var freezesVal = document.getElementById('streak-freezes-val');
    var calendarEl = document.getElementById('streak-calendar');
    var repairInfo = document.getElementById('streak-repair-info');

    if (currentVal) currentVal.textContent = data.currentStreak;
    if (longestVal) longestVal.textContent = data.longestStreak;
    if (freezesVal) freezesVal.textContent = data.freezesAvailable;

    // Build 28-day calendar (4 weeks for clean grid)
    if (calendarEl) {
        var today = new Date();
        var todayStr = today.toISOString().split('T')[0];
        var html = '';

        // Build a map of dates to types
        var historyMap = {};
        if (data.streakHistory) {
            data.streakHistory.forEach(function(entry) {
                historyMap[entry.date] = entry.type;
            });
        }

        for (var i = 27; i >= 0; i--) {
            var d = new Date(today);
            d.setDate(d.getDate() - i);
            var dateStr = d.toISOString().split('T')[0];
            var dayNum = d.getDate();
            var type = historyMap[dateStr] || '';

            var classes = 'streak-cal-day';
            if (type === 'active') classes += ' active';
            else if (type === 'freeze') classes += ' freeze';
            if (dateStr === todayStr) {
                classes += ' today';
                if (data.repairAvailable) classes += ' repair';
            }

            html += '<div class="' + classes + '" title="' + dateStr + '">' + dayNum + '</div>';
        }
        calendarEl.innerHTML = html;
    }

    // Repair info
    if (repairInfo && _streakManager) {
        var repair = _streakManager.getRepairStatus();
        if (repair) {
            repairInfo.textContent = 'Solve ' + repair.remaining + ' more problem' + (repair.remaining !== 1 ? 's' : '') + ' today to save your streak!';
            repairInfo.classList.remove('hidden');
        } else {
            repairInfo.classList.add('hidden');
        }
    }
}

function _toggleStreakPopover() {
    var popover = document.getElementById('streak-popover');
    if (!popover) return;

    if (popover.classList.contains('hidden')) {
        if (_streakManager) {
            _renderStreakPopover(_streakManager.data);
        }
        popover.classList.remove('hidden');
    } else {
        popover.classList.add('hidden');
    }
}

// --- Event-bus driven hook (replaces monkey-patch) ---

function _hookSubmitForStreak() {
    eventBus.on(Events.TEST_RESULTS_DISPLAYED, (results, isSubmit) => {
        if (isSubmit && results && results.failed === 0 && _streakManager) {
            var result = _streakManager.recordActivity();
            if (result === 'repaired') {
                deps.addChatMessage('system', 'Streak repaired! Great perseverance.');
            }
        }
    });
}

// --- Init ---

export function initStreakSystem() {
    _streakManager = new StreakManager();
    _streakManager.onUpdate = function(data) {
        _renderStreakUI(data);
    };

    // Insert streak display into header controls
    var streakDisplay = document.getElementById('streak-display');
    var controls = document.querySelector('.header .controls');
    if (streakDisplay && controls) {
        controls.insertBefore(streakDisplay, controls.firstChild);
    }

    // Check streak on load
    _streakManager.checkOnLoad();
    _renderStreakUI(_streakManager.data);

    // Wire popover toggle
    var badge = document.getElementById('streak-badge');
    if (badge) {
        badge.addEventListener('click', _toggleStreakPopover);
    }

    var popoverClose = document.getElementById('streak-popover-close');
    if (popoverClose) {
        popoverClose.addEventListener('click', function() {
            document.getElementById('streak-popover').classList.add('hidden');
        });
    }

    // Close popover when clicking outside
    document.addEventListener('click', function(e) {
        var popover = document.getElementById('streak-popover');
        var badgeEl = document.getElementById('streak-badge');
        if (popover && !popover.classList.contains('hidden')) {
            if (!popover.contains(e.target) && badgeEl && !badgeEl.contains(e.target)) {
                popover.classList.add('hidden');
            }
        }
    });

    // Hook into submit success to record activity via event bus
    _hookSubmitForStreak();
}
