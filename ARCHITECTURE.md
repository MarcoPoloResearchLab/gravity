# Gravity Notes — Vision and Architecture Evolution

## Product Vision

- Capture ideas instantly with inline Markdown editing; no modals or navigation context switches.
- Keep HTML views readable and stable in a card grid; expand in place without reflowing the viewport.
- Work offline by default and sync seamlessly when signed in; each Google account has an isolated notebook.
- Classify notes with a remote LLM proxy when available; fall back locally without blocking the UX.
- Be secure, testable, and easy to run: CDN-only frontend, single binary backend, and deterministic tests.

## Current Architecture

### Frontend

Gravity boots through the Alpine composition root in `js/app.js`. The root wires stores, event bridges, and DOM-scoped
listeners so every surface keeps its own `x-data` state while shared behaviour flows through `$dispatch` / `$listen`.
Network boundaries (`js/core/backendClient.js`, `js/core/classifier.js`) remain injectable so tests can stub effects.

**Event Contracts**

| Event | Detail payload | Purpose |
| --- | --- | --- |
| `gravity:note-create` | `{ record, storeUpdated, shouldRender }` | Upsert freshly composed note records. |
| `gravity:note-update` | `{ record, noteId, storeUpdated, shouldRender }` | Persist inline edits, merges, and reorder side effects emitted from cards. |
| `gravity:note-delete` | `{ noteId, storeUpdated, shouldRender }` | Remove notes that were cleared or merged away. |
| `gravity:note-pin-toggle` | `{ noteId, storeUpdated, shouldRender }` | Keep a single pinned note while the DOM reorders locally. |
| `gravity:notes-imported` | `{ records, storeUpdated, shouldRender }` | Rehydrate the UI after JSON imports append unique records. |
| `gravity:notify` | `{ message, durationMs }` | Surface toast notifications without blocking dialogs. |
| `gravity:auth-sign-in` | `{ user: { id, email, name, pictureUrl }, credential }` | Namespace `GravityStore` to the authenticated user and refresh the notebook. |
| `gravity:auth-sign-out` | `{ reason }` | Return to the anonymous notebook and hide the profile controls. |
| `gravity:auth-error` | `{ reason, error }` | Surface authentication failures via the toast pipeline without crashing the app. |
| `gravity:sync-snapshot-applied` | `{ records, source }` | Rehydrate the grid after backend reconciliation updates the persisted notes. |

**Module Guidelines**

- `js/ui/topEditor.js` composes new note records and dispatches `gravity:note-create`; it never mutates storage directly.
- `js/ui/card.js` emits update, delete, and pin events while delegating persistence to `syncStoreFromDom`.
- `js/ui/importExport.js` translates JSON flows into `gravity:notes-imported` events and raises `gravity:notify` feedback.
- `js/ui/authControls.js` renders Google Identity Services, proxies sign-out requests, and raises the auth events.
- `js/ui/menu/avatarMenu.js` encapsulates dropdown presentation, outside-click dismissal, and focus hand-off.

**Rendering & Editing**

- EasyMDE (2.19.0) powers inline Markdown editing with cursor positioning lifted from rendered HTML views.
- Markdown rendering leverages marked.js alongside DOMPurify; detecting code blocks surfaces a `code` badge on cards.
- Cards clamp HTML views without inner scrollbars, and expanding a note keeps the grid anchored in place.
- `createHtmlView` rebuilds the rendered HTML whenever a card enters view mode (initial render, mode toggle back from edit, or after transformations such as checkbox toggles and merges) so the DOM always reflects the latest markdown+attachment payload.
- `deleteHtmlView` runs before a card switches to markdown edit mode so the textarea/EasyMDE surface stays as the only visible state; exiting edit mode immediately calls `createHtmlView` with the current markdown.

**Storage, Configuration, and Auth**

- `GravityStore` persists notes in `localStorage` for offline-first behaviour; reconciliation applies backend snapshots.
- `GravityStore.setUserScope(userId)` switches the storage namespace so each Google account receives an isolated notebook.
- Runtime configuration loads from environment-specific JSON files under `data/`, selected according to the active hostname.
- Authentication flows through Google Identity Services with `appConfig.googleClientId`, replaying sessions on reload.

### Backend (Go)

- HTTP API (Gin): `/auth/google` (GSI credential exchange), `/notes` (snapshot), `/notes/sync` (ops queue).
- Auth: verify Google ID tokens, then issue backend JWTs (HS256) with configurable TTL via Viper.
- Data: GORM + SQLite (CGO-free driver) with `notes` and append-only `note_changes` tables for idempotency and audit.
- Conflict strategy: `(client_edit_seq, updated_at)` precedence; server `version` remains monotonic per note.
- Layout: Cobra CLI under `cmd/`, domain packages in `internal/`, zap for logging, configuration via Viper.

### Client Sync Semantics

- Queue `upsert` / `delete` operations with `client_edit_seq`, `client_time_s`, `updated_at_s`, and payload metadata.
- On sign-in: exchange the Google credential for a backend token, flush the queue, fetch the snapshot, and re-render.
- Classification flows through the proxy client with timeouts; when disabled or failing, conservative local defaults win.

### Testing & Tooling

- The Node harness (`tests/run-tests.js`) orchestrates per-file timeouts, shared Chromium instances, and coloured output.
- Puppeteer suites cover inline editing, bounded HTML views, notifications, auth persistence, and backend sync flows.
- Runtime config injection keeps tests deterministic by mocking `fetch` for `data/runtime.config.*.json` lookups.
- Backend integration tests spin up the Go API to validate credential exchange and conflict resolution end-to-end.

## Evolution by Theme (GN-IDs)

- Identity & Accounts
  - GN-11: Google Identity Services integration; frontend-only logging and sign-in setup.
  - GN-31: Persist auth sessions across refresh; apply storage scope before syncing; integration coverage added.
  - GN-43: Address Firefox console warnings and origin constraints.

- Persistence & Sync
  - GN-18: Backend contract defined (auth, notes, sync); GORM schema (`notes`, `note_changes`) and JWT strategy.
  - GN-19: Frontend integration with backend; cross-client persistence verified by E2E.
  - GN-27, GN-29: Environment-resolved backends and LLM proxy endpoints; CORS-friendly configuration.

- Editor UX
  - GN-22, GN-26, GN-28: Cursor maps from HTML view click to exact editor position; tests confirm behavior.
  - GN-37, GN-38: Leverage EasyMDE for list continuation and checklist behavior; remove fallback editor paths.
  - GN-10: Expand HTML view without auto-scrolling to bottom; viewport remains anchored.
  - GN-23: Skip duplicate closing brackets; covered by enhanced editor tests.

- UI & Navigation
  - GN-14: Avatar-driven stacked menu (Export, Import, Sign Out); hover/active states tuned.
  - GN-13, GN-15, GN-16, GN-17, GN-21: Post-auth cleanup of labels and visibility; guest export added (GN-20).
  - GN-44: Fixed regressions (oversized first note, misaligned multicolumn editing); added style guard tests.

- LLM Classification
  - GN-29: Proxy endpoint configurable; local fallback classification introduced for resilience.

- Testing & Harness
  - GN-32: E2E harness design; Puppeteer + Go backend over mocks.
  - GN-33, GN-34, GN-35, GN-40: Stability and speed—per-test timeouts, colored summaries, early termination, and performance refactors.

- Deployment & Ops
  - GN-24: Dockerfile, GHCR workflow, docker-compose for local full-stack runs.
  - GN-35, GN-36: Privacy page and sitemap entry.

## Major Decisions (Rationale)

- Event-driven Alpine with DOM-scoped events keeps components isolated yet composable.
- EasyMDE standardized editor behaviors (lists, checkboxes, history) to avoid reimplementing complex UX.
- Backend token exchange (GSI → JWT) decouples the app from per-request Google validation and allows a clean tenancy model.
- Append-only `note_changes` enables idempotency, auditability, and conflict reconciliation without complex merges.
- Network boundaries (`backendClient`, `classifier`) are small, injectable modules to make tests reliable.
- Deterministic tests via a shared harness and timeouts reduce flakiness and keep CI within budget.

## Current Open Items (From NOTES.md)

- GN-45: Encode a “no scrollers in cards” rule in tests for both editing and rendering.
- GN-46: Remove thick grey separators; ensure cards only have thin bottom borders.
- GN-47: While editing, card must expand downward without shifting its top; cursor remains where clicked in render.
- GN-48: Clicking an already-editing card only repositions the cursor; no flicker or mode switch.
- GN-49: Shift+Enter ends editing and returns to render mode.

Acceptance criteria for the above should be captured in Puppeteer tests under `tests/` and CSS expectations pinned in `tests/css.validity.test.js` when applicable.

## Roadmap (Next 3 Steps)

1) Encode GN-45..GN-49 behaviors in black-box tests, then adjust CSS/JS to pass without regressions.
2) Expand sync tests to include concurrent edits from two clients to validate conflict handling and audit logging.
3) Optionally add a minimal CSP header later for production hardening (low priority). When enabled, verify with a Puppeteer smoke test (scripts load, GSI initializes, no CSP violations).
