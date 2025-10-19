// GN-45 No scrollers in cards (rendering and editing)
- [x] tests/preview.bounded.puppeteer.test.js — assert note previews keep overflow hidden; rely on fade mask without scrollbars.
- [x] tests/editor.inline.puppeteer.test.js — assert editing cards expand and avoid internal scroll areas.
- [x] tests/css.validity.test.js — pin CodeMirror overflow policy to prevent scrollbars.
- [x] styles.css — enforce overflow/height rules for preview and editing states to favor container growth over scrollbars.
- [x] README.md — document the “no inner scrollbars” UX guarantee.
