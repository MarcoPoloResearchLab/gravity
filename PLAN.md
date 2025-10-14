// Outstanding refactors and fixes
- [x] tests/run-tests.js — finalize the per-suite watchdog, parallel kill switch, runtime analytics, and ANSI summary output (GN-33, GN-35).
- [x] tests/helpers/testHarness.js — expose color helpers, timeout enforcement hooks, and shared CLI formatting utilities (GN-33, GN-35).
- [x] tests/harness/run-tests.harness.test.js — cover watchdog termination paths, summary totals, and error reporting (GN-33, GN-35).
- [x] tests/harness/fixtures/hanging.test.js — provide deterministic timeout fixture for harness integration tests (GN-33).
- [x] tests/helpers/puppeteerEnvironment.js — centralize browser/page lifecycle management to cut suite setup cost (GN-34).
- [x] tests/editor.inline.puppeteer.test.js — consolidate navigation flows and waits so the inline editor finishes within the watchdog budget (GN-34).
- [x] tests/persistence.backend.puppeteer.test.js — reuse shared helpers and shorten sync waits to avoid 30s hangs (GN-34).
- [x] tests/auth.sessionPersistence.puppeteer.test.js — align waits and fixtures with the new timeout contract (GN-34).
- [x] README.md — document the harness CLI, watchdog flags, and runtime expectations (GN-33, GN-35).
- [x] MIGRATION.md — record the harness migration steps and timeout policies (GN-33, GN-34, GN-35).
- [x] NOTES.md — mark GN-33, GN-34, and GN-35 complete once validated.

- [x] index.html — add the footer “Privacy • Terms” link and switch Google Sign-In to the compact button variant (GN-35, GN-39).
- [x] privacy/index.html — serve the provided privacy policy content at `/privacy` (GN-35).
- [x] sitemap.xml — include `/privacy` in the sitemap (GN-36).

- [x] js/ui/markdownEditorHost.js — adjust EasyMDE list-enter handling for first-line lists and checkmark continuation (GN-37, GN-38).
- [x] tests/editor.enhanced.puppeteer.test.js — extend coverage for the new list-enter behaviors (GN-37, GN-38).
- [x] constants.js — lift any new user-facing copy introduced by the list behavior changes (GN-37, GN-38).
