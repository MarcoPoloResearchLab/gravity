# Migration Notes

## Event-Driven Composition

Gravity Notes now boots through the Alpine composition root defined in `js/app.js`. The root listens for the following
DOM-scoped events and persists note data via `GravityStore`:

| Event | Detail payload | Purpose |
| --- | --- | --- |
| `gravity:note-create` | `{ record, storeUpdated, shouldRender }` | Upsert new note records and re-render when dispatched by the top editor. |
| `gravity:note-update` | `{ record, noteId, storeUpdated, shouldRender }` | Persist inline edits, merges, and reorder side effects emitted from card components. |
| `gravity:note-delete` | `{ noteId, storeUpdated, shouldRender }` | Remove notes that were cleared or merged away. |
| `gravity:note-pin-toggle` | `{ noteId, storeUpdated, shouldRender }` | Keep a single pinned note while the DOM reorders locally. |
| `gravity:notes-imported` | `{ records, storeUpdated, shouldRender }` | Rehydrate the UI after JSON imports append unique records. |
| `gravity:notify` | `{ message, durationMs }` | Surface toast notifications without blocking dialogs. |
| `gravity:auth-sign-in` | `{ user: { id, email, name, pictureUrl }, credential }` | Namespace `GravityStore` to the authenticated user and refresh the notebook. |
| `gravity:auth-sign-out` | `{ reason }` | Return to the anonymous notebook and hide the profile controls. |
| `gravity:auth-error` | `{ reason, error }` | Surface authentication failures via the toast pipeline without crashing the app. |
| `gravity:sync-snapshot-applied` | `{ records, source }` | Rehydrate the grid after backend reconciliation updates the persisted notes. |

`storeUpdated` identifies whether the origin component already synchronised storage (e.g., card merges call
`syncStoreFromDom`). `shouldRender` lets card-level flows opt-out of full list re-renders when they already reconciled
the DOM.

## UI Module Guidelines

* `js/ui/topEditor.js` no longer writes to `GravityStore`; it dispatches `gravity:note-create` after composing a record.
* `js/ui/card.js` emits `gravity:note-update` / `gravity:note-delete` / `gravity:note-pin-toggle` instead of mutating the
  store directly. Card helpers pass overrides to `syncStoreFromDom` so timestamps stay accurate during inline edits.
* `js/ui/importExport.js` replaces `alert()` with `gravity:notify` events and raises `gravity:notes-imported` whenever a
  JSON payload appends notes.
* Toast feedback is centralised in `js/app.js` through `showSaveFeedback`, ensuring a single toast element handles all
  notification copy.
* `js/ui/authControls.js` renders the Google Identity button and profile summary. It dispatches local sign-out requests
  back to the composition root, which forwards them to `createGoogleIdentityController`, and controls visibility of the
  avatar menu wrapper.
* `js/ui/menu/avatarMenu.js` encapsulates the avatar-triggered dropdown, handling outside clicks, keyboard dismissal,
  and focus hand-off for the stacked export / import / sign-out actions.

## Per-User Storage & Authentication

* `GravityStore.setUserScope(userId)` switches the active `localStorage` key to `gravityNotesData:user:<encodedUserId>`.
  Passing `null` resets the scope to the shared anonymous notebook.
* `js/app.js` calls `GravityStore.setUserScope(null)` on boot, then responds to `gravity:auth-sign-in` /
  `gravity:auth-sign-out` events by rehydrating the card grid via `initializeNotes()`.
* Google Identity Services loads from `https://accounts.google.com/gsi/client`; the client ID lives in
  `appConfig.googleClientId` and should be reused across environments.
* `appConfig.backendBaseUrl` and `appConfig.llmProxyUrl` now load from `data/runtime.config.<environment>.json`, picked
  automatically based on the current hostname. The repository ships with development and production JSON files; edit
  these to point at custom backends or proxies.
* The auth controls hide the Google button once a profile is active and expose the stacked avatar menu (export, import,
  sign out). The sign-out item dispatches `gravity:auth-sign-out`.
* Successful `gravity:auth-sign-in` handlers now persist `{ user, credential }` in `localStorage` so reloads replay the
  sign-in event automatically. `gravity:auth-sign-out` clears the stored state to return to the anonymous notebook.

## Testing Expectations

Puppeteer coverage now includes `tests/app.notifications.puppeteer.test.js` to confirm the import error path emits a
`gravity:notify` toast and `tests/preview.bounded.puppeteer.test.js` to keep the viewport anchored when expanding long
previews. `tests/fullstack.endtoend.puppeteer.test.js` and `tests/sync.endtoend.puppeteer.test.js` start the Go backend
harness to assert note creation flows enqueue real sync operations, while
`tests/auth.sessionPersistence.puppeteer.test.js` guards the persisted Google session behaviour. Run `npm test` after
modifying any event contract to maintain parity with the automation suite.

`tests/run-tests.js` orchestrates the suite instead of invoking `node --test` directly. Each file executes with a
30-second watchdog and ANSI summary; tune the timeout via `GRAVITY_TEST_TIMEOUT_MS`, adjust the SIGKILL grace period
with `GRAVITY_TEST_KILL_GRACE_MS`, or supply per-file overrides through the `GRAVITY_TEST_TIMEOUT_OVERRIDES` /
`GRAVITY_TEST_KILL_GRACE_OVERRIDES` environment variables (`relative/path.test.js=45000`). Filter runs using
`GRAVITY_TEST_PATTERN="auth.sessionPersistence" npm test` when iterating on a specific suite. The long-running backend
integration suites have relaxed defaults baked in so they can bootstrap the Go binary without tripping the watchdog.

## Backend Scaffold

* The monorepo now ships a Go backend under `/backend` to sync notes across devices while preserving local-first storage.
* `cmd/gravity-api/main.go` hosts a Cobra CLI; configuration flows through Viper with the `GRAVITY_` prefix and validates
  the Google client ID, signing secret, and SQLite path in `PreRunE`.
* SQLite persistence is initialised via `internal/database.OpenSQLite` and runs migrations for both `notes` and
  `note_changes` tables. Schema aligns with the conflict-resolution spec (composite primary key, version tracking,
  append-only audit log).
* `internal/auth/google_verifier.go` verifies Google ID tokens offline by caching JWKS responses; tests cover valid and
  invalid flows. `internal/auth/token_issuer.go` handles backend JWT issuance (HS256) and validation.
* `internal/notes/service.go` implements the edit-sequence conflict algorithm: higher `client_edit_seq` wins, ties break
  on `updated_at_s`, and equal timestamps favour the client. Accepted changes bump the `version`, update
  `last_writer_edit_seq`, and record `note_changes` entries with deterministic UUID v7 identifiers.
* `internal/server/router.go` wires Gin, CORS, the auth middleware, and two endpoints:
  - `POST /auth/google` → verifies the Google token and issues a backend JWT.
  - `POST /notes/sync` → accepts batched operations, applies conflict resolution, and returns server state (including the
    definitive payload when rejecting stale updates).
* The integration test `tests/integration/auth_and_sync_test.go` exercises the full flow: token exchange, successful
  upsert, and rejection of a stale edit sequence.
* The browser client now instantiates `js/core/syncManager.js`, intercepting create/update/delete/pin/import events to
  enqueue operations, flush them after `EVENT_AUTH_SIGN_IN`, and reconcile server snapshots for cross-tab persistence.
