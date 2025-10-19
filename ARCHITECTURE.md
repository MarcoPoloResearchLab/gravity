# Gravity Notes — Vision and Architecture Evolution

## Product Vision

- Capture ideas instantly with inline Markdown editing; no modals or navigation context switches.
- Keep previews readable and stable in a card grid; expand in place without reflowing the viewport.
- Work offline by default and sync seamlessly when signed in; each Google account has an isolated notebook.
- Classify notes with a remote LLM proxy when available; fall back locally without blocking the UX.
- Be secure, testable, and easy to run: CDN-only frontend, single binary backend, and deterministic tests.

## Current Architecture

- Frontend
  - Alpine.js composition root (`js/app.js`) wires stores, event bridges, and DOM-scoped listeners.
  - Event-driven UI: components communicate via `$dispatch`/`$listen`; local state in `x-data`.
  - Editor: EasyMDE (2.19.0) for inline Markdown; top editor is structural and does not persist.
  - Rendering: marked.js + DOMPurify; code detection adds a lightweight `code` badge.
  - Network clients: `js/core/backendClient.js` and `js/core/classifier.js` (injectable for tests).
  - Runtime config: `appConfig` resolves via `window.GRAVITY_CONFIG` or `<meta>` tags (backend base URL, LLM proxy endpoints).
  - Storage: `localStorage` remains the offline source of truth; server reconciliation applies snapshots on sign-in.

- Backend (Go)
  - HTTP API (Gin): `/auth/google` (GSI credential exchange), `/notes` (snapshot), `/notes/sync` (ops queue).
  - Auth: verify Google ID token; issue backend JWT (HS256) with `sub` (user), `aud` and `iss`; TTL configurable with Viper.
  - Data: GORM + SQLite (CGO-free driver); tables `notes` and append-only `note_changes` for idempotency and audit.
  - Conflict strategy: `(client_edit_seq, updated_at)` precedence; server `version` monotonic per note.
  - Layout: Cobra CLI under `cmd/`, domain packages in `internal/`; zap for logging; configuration via Viper.

- Sync Semantics (Client)
  - Queue `upsert`/`delete` operations with `client_edit_seq`, `client_time_s`, `updated_at_s`, payload.
  - On sign-in: exchange GSI credential for backend token, flush queue, fetch snapshot, apply and re-render.
  - Classification: call proxy with timeouts; if disabled or failing, produce conservative local defaults.

- Testing & Tooling
  - Node test harness orchestrates per-file timeouts and a kill grace; backend harness spins up the Go API for E2E.
  - Puppeteer suites exercise inline editor, preview bounds, auth session persistence, and backend sync.
  - Runtime config injection ensures tests run against ephemeral endpoints without fragile global state.

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
  - GN-22, GN-26, GN-28: Cursor maps from preview click to exact editor position; tests confirm behavior.
  - GN-37, GN-38: Leverage EasyMDE for list continuation and checklist behavior; remove fallback editor paths.
  - GN-10: Expand preview without auto-scrolling to bottom; viewport remains anchored.
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
3) Add a minimal CSP header in dev/prod hosts and verify with a Puppeteer smoke test (scripts load, GSI initializes, no CSP violations).

