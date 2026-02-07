# Ticket 51: Guard Against DOMPurify CDN Load Failure

## Priority: MEDIUM

## Problem

`renderMarkdown()` in `app.js:439-445` calls `DOMPurify.sanitize()` without checking that DOMPurify actually loaded from the CDN. If the CDN is unreachable (network issue, blocked by firewall, corporate proxy), `DOMPurify` is undefined and the call crashes. Depending on the fallback behavior, this could either break all markdown rendering or — worse — fall back to unsanitized HTML, opening an XSS vector.

**Audit ref:** Issue #12

## Files
- `frontend/app.js` (`renderMarkdown` function)
- `frontend/index.html` (DOMPurify script tag)

## Requirements

1. Before calling `DOMPurify.sanitize()`, check that `typeof DOMPurify !== 'undefined'`
2. If DOMPurify is not available, fall back to a safe default: strip all HTML tags rather than passing unsanitized content through (e.g., use a simple regex or `textContent`-based approach)
3. Log a console warning when DOMPurify is unavailable so developers notice during testing
4. Consider adding a `crossorigin` and `integrity` (SRI hash) attribute to the DOMPurify `<script>` tag for supply-chain safety

## Scope
- `frontend/app.js`: Add guard check in `renderMarkdown()`
- `frontend/index.html`: Optionally add SRI hash to DOMPurify script tag
