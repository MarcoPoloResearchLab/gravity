// GN-43 UI regression revert
- [x] styles.css — remove the unresolved template literal placeholder that stops browsers from parsing the lower half of the stylesheet.
- [x] tests/css.validity.test.js — add regression tests that fail when placeholders, invalid markers, or unbalanced braces enter the stylesheet.
- [x] NOTES.md — mark the GN-43 regression as fixed after restoring the stylesheet and tests.
