# Gravity Notes — Vision and Architecture Evolution

## Product Vision

- Capture ideas instantly with inline Markdown editing; no modals or navigation context switches.
- Keep HTML views readable and stable in a card grid; expand in place without reflowing the viewport.
- Work offline by default and sync seamlessly when signed in; each Google account has an isolated notebook.
- Classify notes with a remote LLM proxy when available; fall back locally without blocking the UX.
- Be secure, testable, and easy to run: CDN-only frontend, single binary backend, and deterministic tests.

## Current Architecture

### Frontend

Gravity boots through the Alpine composition root in `frontend/js/app.js`. The root wires stores, event bridges, and DOM-scoped
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

- `frontend/js/ui/topEditor.js` composes new note records and dispatches `gravity:note-create`; it never mutates storage directly.
- `frontend/js/ui/card.js` emits update, delete, and pin events while delegating persistence to `syncStoreFromDom`.
- `frontend/js/ui/importExport.js` translates JSON flows into `gravity:notes-imported` events and raises `gravity:notify` feedback.
- `frontend/js/ui/authControls.js` renders Google Identity Services, proxies sign-out requests, and raises the auth events.
- `frontend/js/ui/menu/avatarMenu.js` encapsulates dropdown presentation, outside-click dismissal, and focus hand-off.
- `frontend/js/ui/notesState.js` keeps a single pinned note authoritative by reconciling `GravityStore` with in-memory state before cards render.
- `frontend/js/ui/fullScreenToggle.js` manages the diagonal header control, mirrors the native Fullscreen API across vendors, and surfaces failures via the notification pipeline.
- `frontend/js/ui/keyboardShortcutsModal.js` builds the F1-driven shortcut overlay, handling focus restoration and body scroll locking so the modal stays accessible.
- `frontend/js/ui/saveFeedback.js` posts toast feedback to the live region whenever inline edits finish saving.

**Bootstrap & Observability**

- `frontend/js/app.js` initializes runtime configuration, starts Alpine, mounts the composition root, and wires periodic sync and storage listeners.
- `frontend/js/core/analytics.js` conditionally loads Google Analytics only in production builds, guarding the CDN injection behind configuration checks.
- `frontend/js/utils/versionRefresh.js` polls `data/version.json` on an interval, emits reload notifications, and invokes a supplied `reload` callback so stale tabs refresh promptly.

**Rendering & Editing**

- EasyMDE (2.19.0) powers inline Markdown editing with cursor positioning lifted from rendered HTML views.
- Markdown rendering leverages marked.js alongside DOMPurify; detecting code blocks surfaces a `code` badge on cards.
- Cards clamp HTML views without inner scrollbars, and expanding a note keeps the grid anchored in place.
- `createHtmlView` rebuilds the rendered HTML whenever a card enters view mode (initial render, mode toggle back from edit, or after transformations such as checkbox toggles and merges) so the DOM always reflects the latest markdown+attachment payload.
- `deleteHtmlView` runs before a card switches to markdown edit mode so the textarea/EasyMDE surface stays as the only visible state; exiting edit mode immediately calls `createHtmlView` with the current markdown.
- `appConfig.useMarkdownEditor` toggles EasyMDE; disabling it falls back to the legacy `<textarea>` without removing inline editing affordances.
- CDN assets for EasyMDE live in `frontend/index.html`; no bundler is used, so keep script and stylesheet references aligned with the documented versions.
- Clipboard and drag-and-drop image handling route through `frontend/js/ui/imagePaste.js` (`insertAttachmentPlaceholders`) so storage logic and sanitisation remain centralised.

**Storage, Configuration, and Auth**

- `GravityStore` persists notes in `localStorage` for offline-first behaviour; reconciliation applies backend snapshots.
- `GravityStore.setUserScope(userId)` switches the storage namespace so each Google account receives an isolated notebook.
- Runtime configuration loads from environment-specific JSON files under `data/`, selected according to the active hostname.
- Authentication flows through Google Identity Services with `appConfig.googleClientId`, replaying sessions on reload.

#### Frontend Dependencies

- Alpine.js `3.13.5` — `https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js`
- EasyMDE `2.19.0` — scripts and styles referenced from jsDelivr.
- marked.js `12.0.2` — `https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js`
- DOMPurify `3.1.7` — `https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js`
- Google Identity Services — `https://accounts.google.com/gsi/client` using client ID `156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com`.
- Loopaware widget — `https://loopaware.mprlab.com/widget.js` when the feature is enabled.

### Backend (Go)

- HTTP API (Gin): `/auth/google` (GSI credential exchange), `/notes` (snapshot), `/notes/sync` (ops queue).
- Auth: verify Google ID tokens, then issue backend JWTs (HS256) with configurable TTL via Viper.
- Data: GORM + SQLite (CGO-free driver) with `notes` and append-only `note_changes` tables for idempotency and audit.
- Conflict strategy: `(client_edit_seq, updated_at)` precedence; server `version` remains monotonic per note.
- Layout: Cobra CLI under `cmd/`, domain packages in `internal/`, zap for logging, configuration via Viper.

#### Prerequisites

- Go `1.21` or newer.
- SQLite (bundled via the CGO-free driver) and access to the filesystem location used for the data store.

#### Configuration

- `GRAVITY_GOOGLE_CLIENT_ID` — OAuth client ID expected by Google Identity Services.
- `GRAVITY_AUTH_SIGNING_SECRET` — HS256 secret that signs issued JWTs.
- Optional overrides: `GRAVITY_HTTP_ADDRESS` (default `0.0.0.0:8080`), `GRAVITY_GOOGLE_JWKS_URL`, `GRAVITY_DATABASE_PATH` (default `gravity.db`), `GRAVITY_TOKEN_TTL_MINUTES` (default `30`), `GRAVITY_LOG_LEVEL` (default `info`).

#### Local Execution

```shell
cd backend
go run ./cmd/gravity-api --http-address :8080
```

#### API Overview

- `POST /auth/google`
  - Request body: `{ "id_token": "<GSI ID token>" }`
  - Flow: verifies the Google token offline via JWKS and returns `{ "access_token": "<jwt>", "expires_in": 1800 }`.
- `POST /notes/sync`
  - Requires `Authorization: Bearer <jwt>` header (the token issued by `/auth/google`).
  - Request body: `{ "operations": [{ "note_id": "uuid", "operation": "upsert" | "delete", "client_edit_seq": 1, "client_device": "web", "client_time_s": 1700000000, "created_at_s": 1700000000, "updated_at_s": 1700000000, "payload": { … } }] }`
  - Response: `{ "results": [{ "note_id": "uuid", "accepted": true, "version": 1, "updated_at_s": 1700000000, "last_writer_edit_seq": 1, "is_deleted": false, "payload": { … } }] }` where rejected changes return the authoritative server copy for reconciliation.

Conflict resolution follows the documented `(client_edit_seq, updated_at)` precedence while writing an append-only `note_changes` audit log.

### Client Sync Semantics

- Queue `upsert` / `delete` operations with `client_edit_seq`, `client_time_s`, `updated_at_s`, and payload metadata.
- On sign-in: exchange the Google credential for a backend token, flush the queue, fetch the snapshot, and re-render.
- Classification flows through the proxy client with timeouts; when disabled or failing, conservative local defaults win.

#### Runtime Configuration Profiles

Profiles live under `frontend/data/runtime.config.<environment>.json` and are selected according to `location.hostname`. Production hosts (e.g., `*.com`) load the production profile; everything else falls back to development unless a custom entry is added.

```jsonc
// data/runtime.config.development.json
{
  "environment": "development",
  "backendBaseUrl": "http://localhost:8080",
  "llmProxyUrl": "http://localhost:8081/v1/gravity/classify"
}
```

```jsonc
// data/runtime.config.production.json
{
  "environment": "production",
  "backendBaseUrl": "https://gravity-api.mprlab.com",
  "llmProxyUrl": "https://llm-proxy.mprlab.com/v1/gravity/classify"
}
```

When serving from an alternate hostname, add a new profile or override the URLs explicitly before bootstrapping the Alpine application.

### Testing & Tooling

- The Node harness (`frontend/tests/run-tests.js`) orchestrates per-file timeouts, shared Chromium instances, and coloured output.
- Puppeteer suites cover inline editing, bounded HTML views, notifications, auth persistence, and backend sync flows.
- Runtime config injection keeps tests deterministic by mocking `fetch` for `data/runtime.config.*.json` lookups.
- Backend integration tests spin up the Go API to validate credential exchange and conflict resolution end-to-end.
- Run the browser suite with `npm test` from `frontend/`. Customise execution via:
  - `GRAVITY_TEST_TIMEOUT_MS` / `GRAVITY_TEST_KILL_GRACE_MS` to adjust the default per-suite budget.
  - `GRAVITY_TEST_PATTERN="editor.inline" npm test` to run a focused subset.
  - `npm test -- --screenshots=enabled` to collect screenshots, or `--screenshots=allowlist` with `--screenshot-allowlist=<file>` for targeted captures.
  - `--screenshot-dir` and `--screenshot-force` flags for artifact management.
- Set `CI=true` so the harness enables Chromium sandbox flags and other CI-only safeguards.
- Install Chromium once via `npx puppeteer browsers install chrome` before running Puppeteer tests locally.

## Repository Layout

- `frontend/` — static site, Alpine composition root, browser tests, and npm tooling.
- `backend/` — Go API, CLI entrypoints, and persistence layers.
- `CHANGELOG.md`, `ISSUES.md`, `NOTES.md` — process journals and release history.
- `docker-compose.yml` / `docker-compose.dev.yml` — local stack orchestration.
- `POLICY.md`, `AGENTS.md` — coding standards and confident programming policy.
- `PLAN.md` — temporary per-issue scratchpad (ignored in commits).

## Local Development

- The frontend ships as static assets; serve `frontend/` via any static host or the provided Docker stack.
- The backend exposes a single binary API; run it locally with `go run ./cmd/gravity-api` or through Docker.

### Docker Workflow

- `docker-compose.yml` provisions the Go API (`backend`) and a static web host (`frontend`) backed by [gHTTP](https://github.com/temirov/ghttp).
- Fetch the latest images with `docker compose pull`, then start the stack using `docker compose up`. The UI serves from <http://localhost:8000> and the API from <http://localhost:8080>.
- The backend container loads secrets from `backend/.env`; adjust the file to point at different credentials or storage paths.
- Tail logs with `docker compose logs -f backend`, and stop the stack using `docker compose down` when finished.

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

Acceptance criteria for the above should be captured in Puppeteer tests under `frontend/tests/` and CSS expectations pinned in `tests/css.validity.test.js` when applicable.

## Roadmap (Next 3 Steps)

1) Encode GN-45..GN-49 behaviors in black-box tests, then adjust CSS/JS to pass without regressions.
2) Expand sync tests to include concurrent edits from two clients to validate conflict handling and audit logging.
3) Optionally add a minimal CSP header later for production hardening (low priority). When enabled, verify with a Puppeteer smoke test (scripts load, GSI initializes, no CSP violations).
