// ============================================================
// Typography Module - Font Loading + UI Font Size
// ============================================================

// --- Dependency injection ---
let _deps = { settingsManager: null, applyEditorSettings: null };

export function configureTypographyDeps({ settingsManager, applyEditorSettings }) {
    _deps.settingsManager = settingsManager;
    _deps.applyEditorSettings = applyEditorSettings;
}

// --- Module-scoped state ---
const _loadedFonts = new Set();

export const GOOGLE_FONT_URLS = {
    "jetbrains-mono": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap",
    "fira-code": "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap",
    "comic-mono": "https://fonts.googleapis.com/css2?family=Comic+Mono&display=swap",
};

export function loadGoogleFont(fontKey) {
    if (fontKey === 'default' || _loadedFonts.has(fontKey)) return;
    const url = GOOGLE_FONT_URLS[fontKey];
    if (!url) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.fontKey = fontKey;
    document.head.appendChild(link);
    _loadedFonts.add(fontKey);
}

export function applyUiFontSize(size) {
    document.documentElement.style.setProperty('--ui-font-size', size + 'px');
}

export function initTypography() {
    const { settingsManager, applyEditorSettings } = _deps;

    // Load the currently selected font on startup
    const currentFont = settingsManager.get('editorFontFamily');
    if (currentFont !== 'default') {
        loadGoogleFont(currentFont);
    }

    // Wire font family change to load the font
    settingsManager.onChange('editorFontFamily', (fontKey) => {
        loadGoogleFont(fontKey);
        applyEditorSettings();
    });

    // Wire uiFontSize to CSS variable
    settingsManager.onChange('uiFontSize', (size) => {
        applyUiFontSize(size);
    });

    // Apply initial uiFontSize
    applyUiFontSize(settingsManager.get('uiFontSize'));

    // Keyboard shortcuts: Ctrl+Plus / Ctrl+Minus for quick font size
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        // Don't fire when typing in input/textarea, but allow when Monaco editor is focused
        const active = document.activeElement;
        const tag = active ? active.tagName : '';
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && !active.closest('#editor')) return;

        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            const current = settingsManager.get('editorFontSize');
            const newSize = Math.min(24, current + 1);
            settingsManager.set('editorFontSize', newSize);
            showFontSizeToast(newSize);
        } else if (e.key === '-') {
            e.preventDefault();
            const current = settingsManager.get('editorFontSize');
            const newSize = Math.max(12, current - 1);
            settingsManager.set('editorFontSize', newSize);
            showFontSizeToast(newSize);
        }
    });
}

export function showFontSizeToast(size) {
    let toast = document.getElementById('font-size-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'font-size-toast';
        toast.className = 'font-size-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = 'Font size: ' + size + 'px';
    toast.classList.remove('hidden');
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('visible');
        toast.classList.add('hidden');
    }, 1500);
}
