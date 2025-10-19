# ISSUES (Append-only Log)

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here.

## 2025-10-19

- Resolved: DOC-001 Define document roles and ownership
  - Moved guidance to AGENTS.md (Document Roles; Issue Status Terms). ISSUES.md now append-only.

- Resolved: FE-001 Bootstrap requirement vs. actual stack
  - AGENTS.md updated to Alpine.js + Vanilla CSS.

- Resolved: FE-002 Network boundary naming
  - AGENTS.md now names `js/core/backendClient.js` and `js/core/classifier.js` as official clients.

- Resolved: FE-003 EasyMDE version drift
  - Unified to 2.19.0; README versions matrix added.

- Resolved: FE-005 Classifier client injection
  - Added `createClassifierClient({ fetchImplementation })`; tests in `tests/classifier.client.test.js`.

- Resolved: FE-006 Directory layout guidance
  - AGENTS.md marks `/assets` and `/data` as optional.

- Resolved: DOC-003 Project-specific examples
  - AGENTS.md examples updated to `Note` and `NoteClassification`.

- Resolved: DOC-004 Deliverables scope
  - Clarified applies to automation.

- Resolved: FE-004 / SEC-001 External script policy and CSP
  - AGENTS.md enumerates allowed third-party scripts and includes a CSP template.

- Resolved: PROC-001 Test timeouts policy
  - AGENTS.md documents harness-managed timeouts; no shell-level `timeout` wrapping.

## 2025-10-19 (later)

- Resolved: DOC-005 Architecture synthesis document
  - Created `ARCHITECTURE.md` capturing product vision, current architecture, themed evolution across GN-IDs, and open items/roadmap.
- Resolved: GN-45 No scrollers in cards
  - Added CSS and automated tests to keep previews and editing surfaces free of inner scrollbars (`styles.css`, `tests/editor.inline.puppeteer.test.js`, `tests/css.validity.test.js`).
