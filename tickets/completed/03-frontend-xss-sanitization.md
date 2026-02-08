# Ticket 03: Fix XSS Vulnerabilities in Frontend

**Priority:** CRITICAL
**Component:** `frontend/app.js`, `frontend/index.html`
**Estimated Scope:** Medium

## Problem

Multiple XSS vectors exist in the frontend:

1. **`marked.parse()` renders unsanitized HTML** (line 179, 423, 434, 444, 450). Raw `<script>` tags or event handler attributes in markdown will execute. This affects problem descriptions and all AI assistant messages.

2. **Problem list HTML injection** (lines 153-158). `p.title`, `p.difficulty`, `p.id`, and `p.tags` are interpolated raw into `innerHTML`. A malicious problem title can execute scripts.

3. **Session list HTML injection** (lines 488-496). `s.session_id`, `s.problem_id`, `s.mode` are unescaped in `innerHTML`.

4. **AI assistant content** rendered through `renderMarkdown` without sanitization — exploitable via prompt injection or compromised backend.

## Files to Modify

- `frontend/index.html` — add DOMPurify CDN script
- `frontend/app.js` — sanitize all dynamic HTML

## Requirements

1. Add DOMPurify (via CDN) to `index.html`.
2. Wrap all `marked.parse()` output with `DOMPurify.sanitize()`:
   ```js
   function renderMarkdown(text) {
       if (typeof marked !== 'undefined') {
           return DOMPurify.sanitize(marked.parse(text));
       }
       return escapeHtml(text);
   }
   ```
3. Use the existing `escapeHtml()` function for all server data interpolated into HTML templates:
   - Problem titles, difficulties, tags, IDs in `renderProblemList`
   - Session IDs, problem IDs, modes in `loadSessions`
   - `data-id` attributes (escape for attribute context)
4. Ensure error messages from WebSocket (`data.content`) are escaped.

## Acceptance Criteria

- A problem with title `<img src=x onerror=alert(1)>` renders as text, not executable HTML.
- AI responses containing `<script>` tags are stripped.
- All `innerHTML` assignments use escaped or sanitized content.
- Markdown formatting (bold, code blocks, lists) still renders correctly.
