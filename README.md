# Gravity Notes

Gravity Notes is a simple, single-page web application for taking notes using Markdown. Notes surface in a stable grid
with bounded HTML views, and every note edits inline—no modal overlays or context switches.

## Features

* **Bounded HTML views:** Each card renders the first two paragraphs (or ~450 characters), the first image as a cover
  thumbnail, and a six-line HTML view of the first code block. A fade mask signals truncated content.
* **Code badge:** Notes that contain code display a `code` pill so technical snippets stand out at a glance.
* **Interactive checklists:** Click rendered task checkboxes to flip their state without entering edit mode; updates
  persist immediately and bubble that note to the top.
* **Inline editor:** Click any card—or the blank capture slot at the top—to switch that note into Markdown mode in
  place. The textarea auto-grows with your prose, accepts `Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` to commit, and supports
  `Tab`/`Shift+Tab` indentation for lists and code blocks.
* **Always-ready capture:** The sticky blank note beneath the header is the entry point for brand new ideas. Type there,
  click away, or hit `Cmd/Ctrl+Enter` to persist immediately.
* **Full-screen workspace:** Flip the header's diagonal toggle to expand Gravity Notes to full screen and collapse it without
  leaving the current editing context.
* **Scrollbar-free cards:** HTML view panes clamp behind fade masks, and editing surfaces expand vertically so no inner scrollbars appear.
* **Rich Markdown:** Markdown rendering is powered by [marked.js](https://marked.js.org/) with sanitisation from
  [DOMPurify](https://github.com/cure53/DOMPurify). Inline image pasting is preserved through attachment placeholders.
* **Native grammar tools:** The inline editor keeps browser spellcheck and grammar suggestions active so typos surface while you type.
* **Auto updates:** A lightweight manifest check keeps the client in sync and reloads when a new Gravity Notes build ships.
* **Organise & share:** Notes retain the existing move, merge, copy, and classification behaviours, and you can import
  or export notebooks as JSON snapshots without introducing duplicates.
* **Account-aware storage:** Sign in with Google (or continue anonymously) from the header controls. Each authenticated
  Google account receives an isolated notebook persisted in `localStorage`, so coworkers sharing a browser never see one
  another's notes. Sessions survive page refreshes, keeping the last active account signed in until you explicitly sign
  out.

## Repository Layout

- `frontend/` — the static site, browser tests, and npm tooling.
- `backend/` — the Go API and supporting infra.
- GitHub Pages deployments should point at the `frontend/` directory (e.g., `gh pages set --source gh-pages --branch main --path frontend`).

## How to Use

1. **Capture a note:** Place the cursor in the blank card anchored beneath the header and start writing Markdown. The
   editor auto-grows as you type and never introduces inner scrollbars.
2. **Autosave everywhere:** Gravity persists changes whenever you click away or press `Cmd/Ctrl+Enter`. A subtle “Saved”
   toast confirms each sync—no manual save button required.
3. **Keyboard shortcuts:**
    * `Enter` inserts a newline (no implicit submission).
    * `Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` commit changes immediately.
    * `Tab` / `Shift+Tab` indent or outdent the current selection, making lists and code blocks easy to adjust.
    * `Cmd/Ctrl+Shift+K` deletes the current line; `Cmd/Ctrl+Shift+D` duplicates it in place.
4. **Edit existing notes:** Click anywhere in a rendered note to switch it into Markdown mode inline. The grid stays in
   place while you edit, then re-renders the HTML view once you finish.
5. **Skim with HTML views:** Each card shows a deterministic snippet and fade mask; notes with code call it out with a
   `code` badge, and overflowing notes expose a circular arrow toggle to expand the full HTML view in place.
6. **Organise:** Reorder, merge, or delete notes with the familiar toolbar actions along the right edge. The copy button
   still mirrors either Markdown or sanitized HTML (including attachment metadata) depending on the current mode.
7. **Import / Export:** Click the profile avatar to open the stacked account menu—export and import live alongside the
   identity actions and still skip duplicates, preserving the single source of truth.
8. **Toggle identity:** Use the header profile controls to sign in with Google Identity Services. Once signed in,
   Gravity swaps to a user-specific storage namespace and hides the Google button behind the avatar menu. Signing out
   returns to the anonymous notebook without blending data between identities.
9. **Focus mode:** Use the diagonal toggle in the header to enter or exit full-screen mode without leaving your current
   editing session.

## Authentication Flow

- Gravity Notes loads Google Identity Services directly from the official CDN (`https://accounts.google.com/gsi/client`).
- `js/app.js` wires the sign-in button through `createGoogleIdentityController` and listens for `gravity:auth-sign-in`
  / `gravity:auth-sign-out` events to refresh the notebook in-place.
- `GravityStore.setUserScope(userId)` switches the `localStorage` key to `gravityNotesData:user:<encodedUserId>`, keeping
  the anonymous notebook (`gravityNotesData`) intact.
- The UI surfaces the active user's avatar, name, and a dropdown menu for export, import, and sign-out actions while
  hiding the Google button host—no manual page reload is required to change accounts.
- Successful sign-in persists a minimal `{ user, credential }` payload in `localStorage` (`gravityAuthState`). On page
  reload the app replays `gravity:auth-sign-in` automatically; signing out clears the persisted state so shared devices
  return to the anonymous notebook.

## Architecture

* **Alpine composition root:** `index.html` boots `gravityApp()` from `js/app.js`, wiring the shared stores, event
  bridges, and static copy in one place.
* **Event pipeline:** UI modules dispatch DOM-scoped custom events
  (`gravity:note-create`, `gravity:note-update`, `gravity:note-delete`, `gravity:note-pin-toggle`,
  `gravity:notes-imported`, `gravity:notify`, `gravity:auth-sign-in`, `gravity:auth-sign-out`, `gravity:auth-error`) so
  the root component can persist through `GravityStore`, update the auth controls, and schedule re-renders.
* **Module boundaries:** `ui/` focuses on DOM work, `core/` wraps domain services, and `utils/` exposes shared
  helpers. All user-facing strings live in `js/constants.js` to keep copy consistent.
* **Toast notifications:** Non-blocking feedback flows through `gravity:notify` instead of `alert()`, keeping the UI
  accessible and aligned with the design system.

## Editor & HTML View

- **Deterministic HTML view:** Cards render the full sanitized Markdown and clamp at roughly `18vh`. Shorter notes shrink
  to their natural height, while longer ones fade out gracefully.
- **Fade mask:** A gradient mask is layered over the last few pixels of the HTML view to avoid sudden cut-offs while
  keeping the card height capped at roughly `18vh` when content overflows.
- **Dynamic height:** Cards shrink to match their rendered content and grow only up to the shared `18vh` limit, so short
  notes stay compact while longer ones fade out.
- **Expandable overflow:** Overflowing notes get a rotated `»` toggle at the bottom border—click to expand the rendered
  HTML view downward, click again (or edit any note) to collapse.
- **Code indicator:** A `code` badge appears when a note includes inline or fenced code so heavy snippets are easy to
  spot without opening the editor.
- **Autosave:** Inline edits flush on blur or `Cmd/Ctrl+Enter` and surface a non-blocking “Saved” toast. Shortcuts still
  work for explicit saves, but no manual button is required.

## Setup

No installation is required to view the app—open `index.html` in any modern browser. For development and testing, install
the Node tooling:

```shell
cd frontend
npm install
```

Run all subsequent npm-based tasks from `frontend/`.

### Local Environment

```shell
python3 -m http.server 8000
```

## Backend Service

Gravity Notes now ships with a Go API that persists and reconciles notes across devices while keeping the local-first
experience intact.

### Prerequisites

- Go 1.21+
- Environment variables for the backend:
  - `GRAVITY_GOOGLE_CLIENT_ID` — the OAuth client ID used by Google Identity Services.
  - `GRAVITY_AUTH_SIGNING_SECRET` — random HS256 secret used to mint backend JWTs.
  - Optional overrides: `GRAVITY_HTTP_ADDRESS` (`0.0.0.0:8080`), `GRAVITY_GOOGLE_JWKS_URL`,
    `GRAVITY_DATABASE_PATH` (`gravity.db`), `GRAVITY_TOKEN_TTL_MINUTES` (30), `GRAVITY_LOG_LEVEL` (`info`).

### Running Locally

```shell
cd backend
go run ./cmd/gravity-api --http-address :8080
```

### API Overview

- `POST /auth/google`
  - Body: `{ "id_token": "<GSI ID token>" }`
  - Verifies the Google token offline via JWKS, then returns `{ "access_token": "<jwt>", "expires_in": 1800 }`.
- `POST /notes/sync`
  - Requires `Authorization: Bearer <jwt>` header (the JWT from `/auth/google`).
  - Body: `{ "operations": [{ "note_id": "uuid", "operation": "upsert" | "delete", "client_edit_seq": 1, "client_device": "web", "client_time_s": 1700000000, "created_at_s": 1700000000, "updated_at_s": 1700000000, "payload": { … } }] }`
  - Responds with `{ "results": [{ "note_id": "uuid", "accepted": true, "version": 1, "updated_at_s": 1700000000, "last_writer_edit_seq": 1, "is_deleted": false, "payload": { … } }] }` where rejected changes include the
    authoritative server copy for reconciliation.

Conflict resolution follows the documented `(client_edit_seq, updated_at)` precedence while writing an append-only
`note_changes` audit log.

### Frontend Sync

- `appConfig.backendBaseUrl` and `appConfig.llmProxyUrl` load from `data/runtime.config.<environment>.json`, selected automatically according to `location.hostname`. When the host ends with `.com` the production profile is used; localhost and other domains default to the development profile. Each JSON entry can still disable classification by setting `"llmProxyUrl": ""`.
- `appConfig.environment` reflects the environment declared in the loaded JSON file. The repository ships with:
    - `production` → backend `https://gravity-api.mprlab.com`, LLM proxy `https://llm-proxy.mprlab.com/v1/gravity/classify`
    - `development` → backend `http://localhost:8080`, LLM proxy `http://computercat:8081/v1/gravity/classify`
  Explicit URL overrides still take precedence over the environment defaults.
- The UI keeps persisting to `localStorage` for offline usage while enqueuing operations for the backend.
- On sign-in the client exchanges the Google credential for a backend token, flushes the queue, and reconciles a fresh snapshot so additional tabs/devices pick up the latest state.
- Pin toggles, imports, and deletions immediately enqueue operations; failed sync attempts remain queued until connectivity returns.
- `gravity:sync-snapshot-applied` fires after reconciliation so the Alpine composition root can re-render using the latest server snapshot.

#### Runtime configuration

Select the desired profile by editing the JSON files under `data/`:

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

Note: When serving the app from a custom domain, ensure the hostname detection resolves to the intended profile (e.g., `.com` for production). Adjust the JSON files or extend the detection logic if additional environments are required.

## Development with Docker

- `docker-compose.yml` provisions both services required for local development: the Go API (`backend`) pulled from
  `ghcr.io/marcopoloresearchlab/gravity-backend:latest`, and a static web host powered by
  [gHTTP](https://github.com/temirov/ghttp) (`frontend`) that serves the working directory read-only.
- Run `docker compose pull` to fetch the default backend image (`ghcr.io/marcopoloresearchlab/gravity-backend:latest`),
  then start the stack with `docker compose up`. The UI serves from <http://localhost:8000> while the API listens on
  <http://localhost:8080>. The backend service
  automatically sources secrets from `backend/.env`.
- To tail application output run `docker compose logs -f backend`, and stop the stack with `docker compose down` when
  finished.

## Testing

- The test harness (run from `frontend/` as `node tests/run-tests.js`) executes each suite in isolation with a 30 s watchdog and renders a
  coloured summary. Adjust the default timeout or kill grace via `GRAVITY_TEST_TIMEOUT_MS` and
  `GRAVITY_TEST_KILL_GRACE_MS`, narrow the run with `GRAVITY_TEST_PATTERN="editor.inline" npm test (from frontend/)`, or provide
  per-file overrides using `GRAVITY_TEST_TIMEOUT_OVERRIDES` /
  `GRAVITY_TEST_KILL_GRACE_OVERRIDES` (comma-separated `file=testTimeoutMs`). The harness already relaxes the budget
  for `persistence.backend`, `sync.endtoend`, and `fullstack.endtoend` suites so they can bootstrap the Go backend.
- `npm test` (run from `frontend/`) drives the Node test suite, including Puppeteer coverage for the inline editor, bounded HTML views, and
  the notification flow.
- Continuous integration runs must export `CI=true` so the harness marks the runtime as CI, enabling Chromium sandbox flags and other CI-only safeguards.
- Screenshot artifacts are opt-in. Run `npm test -- --screenshots=enabled` to capture for every suite, or
  `npm test -- --screenshots=allowlist --screenshot-allowlist="editor.duplicateRendering.puppeteer.test.js,helpers/local-only.test.js"`
  to target specific files. Append `--screenshot-dir=/tmp/gravity-artifacts` to choose the output directory, or
  `--screenshot-force` to allow `withScreenshotCapture(() => ...)` blocks inside a test to persist artifacts without enabling screenshots globally.
  Individual tests can import `withScreenshotCapture` from `tests/helpers/screenshotArtifacts.js` to wrap the exact steps that should emit screenshots.
- `frontend/tests/htmlView.bounded.puppeteer.test.js` now guards the viewport anchoring behaviour—expanding a rendered note keeps
  the card in place even if the browser attempts to scroll to the bottom of the HTML view.
- `frontend/tests/sync.endtoend.puppeteer.test.js` starts the Go backend harness and uses the real UI to create notes, asserting
  that operations propagate through `createSyncManager` to the server snapshot.
- `frontend/tests/auth.sessionPersistence.puppeteer.test.js` signs in via the event bridge, reloads the page, and verifies the
  persisted auth state restores the user scope without a second Google prompt.
- Run `npx puppeteer browsers install chrome` once to download the Chromium binary that Puppeteer uses during the
  end-to-end tests.
- GitHub Actions executes the same test command on every push and pull request, validating the inline editing workflow and
  HTML view truncation remain stable.

## Dependencies

* **marked.js** — rendered via `https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js`.
* **DOMPurify** — sanitiser loaded from `https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js`.
* **EasyMDE** — Markdown editor UI delivered through `https://cdn.jsdelivr.net/npm/easymde@2.19.0/dist/easymde.min.js` and its companion stylesheet.
* **Google Identity Services** — the sign-in client loads from `https://accounts.google.com/gsi/client` and uses the
  `156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com` client ID baked into `appConfig`.

## Markdown Editor

* Enable or disable the EasyMDE experience via the `appConfig.useMarkdownEditor` flag in `config.js` — set it to `false` to fall back to the legacy `<textarea>` editors.
* Clipboard and drag-and-drop image handling remains routed through `insertAttachmentPlaceholders` in `ui/imagePaste.js`, ensuring all storage logic and attachment sanitisation are unchanged.
* CDN assets for the editor live exclusively in `index.html`; no build tooling or bundlers are required.

## License

Gravity Notes is released under the [MIT License](LICENSE).

## Runtime Versions

- Alpine.js — `https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js`
- EasyMDE — `2.19.0`
- marked.js — `12.0.2`
- DOMPurify — `3.1.7`
- Google Identity Services — `https://accounts.google.com/gsi/client`
