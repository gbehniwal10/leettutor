# Ticket 78: Migrate Monaco Editor from CDN to npm + Vite

**Priority:** Low
**Component:** `frontend/index.html`, `frontend/app.js`, `package.json`
**Estimated Scope:** Medium (build config + import changes)
**Depends on:** None (but pairs well with any Vite setup work)
**Port of:** focus-engine `app.js` Monaco worker config + `vite.config.js` chunking

## Overview

Replace the CDN `<script>` tag for Monaco Editor with an npm dependency bundled by Vite. This eliminates CDN latency, enables tree-shaking, improves caching via content-hash chunks, and removes the AMD `require()` loader boilerplate.

## Current State

Monaco is loaded from a CDN via `<script>` tags in `index.html`. The editor initialization uses the AMD `require()` pattern with `requireConfig`. This works but:
- CDN is a single point of failure
- No tree-shaking (full Monaco bundle loaded)
- AMD require conflicts with ES module imports
- No content-hash caching (CDN URL changes require cache bust)

## Implementation

### 1. Install npm dependency

```bash
npm install monaco-editor
```

### 2. Configure Vite workers

Monaco requires web workers for language services. Vite handles these via `?worker` imports:

```javascript
// app.js (top level)
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
        if (label === 'json') return new jsonWorker();
        if (label === 'typescript' || label === 'javascript') return new tsWorker();
        return new editorWorker();
    }
};
```

### 3. Vite chunk splitting

```javascript
// vite.config.js
build: {
    rollupOptions: {
        output: {
            manualChunks(id) {
                if (id.includes('monaco-editor') && !id.includes('worker'))
                    return 'monaco';
            }
        }
    }
}
```

### 4. Remove CDN references

- Delete Monaco `<script>` and `<link>` tags from `index.html`
- Remove AMD `require()` / `requireConfig` from `app.js`
- Import Monaco CSS: `import 'monaco-editor/min/vs/editor/editor.main.css'` in `style.css` or `app.js`

## Migration Guidance (from focus-engine experience)

This migration was already completed in `focus-engine/`. The following pitfalls were discovered
the hard way — read all of them before starting.

### Use HTML entry point, not rollup input entries

The current `vite.config.js` uses `rollupOptions.input` with separate JS/JSX entries. This
means `vite build` does NOT produce an `index.html` — just loose JS/CSS chunks. The backend
then has to parse the Vite manifest and do string replacement on the source HTML to inject
hashed filenames. This is fragile and the #1 source of bugs.

**Fix:** Remove `rollupOptions.input`. Let Vite use `index.html` as the entry point (the
default). Vite rewrites all `<script>` and `<link>` tags in the built HTML automatically.
The backend just serves `dist/index.html` as-is — no manifest parsing needed.

### Change HTML asset paths from `/static/X` to `/X`

The current HTML uses `src="/static/app.js"`. The Vite proxy for `/static` intercepts this
and sends it to the backend raw, bypassing Vite's module transforms. Bare imports
(`monaco-editor`, `marked`, etc.) then fail in the browser with "Failed to resolve module
specifier".

**Fix:** Change to `/app.js`, `/style.css` (relative to Vite root). Remove the `/static`
proxy from `vite.config.js`. Keep only `/api` and `/ws` proxies. For prod mode, add a
`/style.css` FileResponse route in `server.py`.

### Also migrate marked and DOMPurify

While you're at it, replace the CDN globals with ES imports:
```js
import { marked } from 'marked';
import DOMPurify from 'dompurify';
```
Remove the CDN `<script>` tags. Add both to `package.json`. Search for `window.marked`,
`window.DOMPurify`, and bare `marked(` / `DOMPurify.sanitize(` references.

### Simplify `server.py` after migration

Delete `_get_vite_island_tags()`, manifest parsing, all `_*_script_tag` variables, and
the HTML string replacement logic. Replace with:
```python
_has_dist = (DIST_DIR / "index.html").is_file()

@app.get("/")
async def index():
    if _has_dist:
        html = (DIST_DIR / "index.html").read_text()
    else:
        html = (FRONTEND_DIR / "index.html").read_text()
    return HTMLResponse(html)
```

### Stale `dist/` causes 404s in dev

`_has_dist` is computed once at server import time. A leftover `dist/` from a previous build
makes the server serve old hashed filenames → 404s on every asset. Always delete
`frontend/dist/` before dev mode. Create a `dev.sh` script that does this automatically
(copy from `focus-engine/dev.sh`).

### Dev mode requires two servers

After migration, `:8000` cannot serve the frontend directly — bare imports need Vite's
transforms. Dev flow: backend on `:8000`, Vite on `:5173`, open `:5173`. The `dev.sh`
should also `unset CLAUDECODE` to prevent "cannot launch inside another Claude Code session"
errors when running from Claude Code's terminal.

### Reference files

All of these exist in `focus-engine/` as working examples:
- `focus-engine/frontend/vite.config.js` — HTML entry point, no rollup inputs, no `/static` proxy
- `focus-engine/frontend/app.js` — Monaco ES import + worker config
- `focus-engine/backend/server.py` — simplified `_has_dist` + index route
- `focus-engine/dev.sh` — two-server launcher with dist cleanup and CLAUDECODE unset

## Acceptance Criteria

- [ ] Monaco loaded from npm, not CDN
- [ ] Workers configured via Vite `?worker` imports
- [ ] Monaco in a separate chunk (`monaco-[hash].js`)
- [ ] No AMD `require()` in codebase
- [ ] CDN script/link tags removed from `index.html`
- [ ] Editor loads and functions identically
- [ ] Dev mode (hot reload) works with Monaco workers
