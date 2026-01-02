# ISSUES
**Append-only section-based log**

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here. Read @NOTES.md for the process to follow when fixing issues.

Read @AGENTS.md, @AGENTS.GO.md, @AGENTS.DOCKER.md, @AGENTS.FRONTEND.md, @AGENTS.GIT.md, @POLICY.md, @NOTES.md, @README.md and @ISSUES.md. Start working on open issues. Work autonomously and stack up PRs.

Each issue is formatted as `- [ ] [GN-<number>]`. When resolved it becomes -` [x] [GN-<number>]`

## Features (126–199)

- [ ] [GN-120] (P1) Search in a note: have a shortcut and render a search filed in the right top corner of the text editing area.
  Check with MDE if built in tools can be leveraged
- [ ] [GN-121] (P1) Search across notes.
  Use Cntr + Space to display a search dialog. The search works as a gravity point that pushes the irrelevant notes down and raises the relevant notes up. The search dialog is situated in the footer. The gravity point disappears when the search dialog is closed
- [ ] [GN-122] (P0) Add settings section under the user's avatar when a user is logged.
  in. There is a dropdown there, add settings before log out. Include such things as font size, and gravity control (whether to gravitate the card to the top on change, on clipboard copy)
- [ ] [GN-123] (P2) Add settings option to delete all notes with typed DELETE confirmation.
  ### Summary
  - Add a destructive "Delete all notes" action in Settings guarded by a confirmation modal that requires typing `DELETE` before enabling the action.
  - Keep the flow aligned with Gravity's inline, no-jump UX while using the existing storage/sync pipeline.
  
  ### Analysis
  - The frontend is Alpine-driven with semantic components; the modal should be an explicit, event-opened component (no auto-open), consistent with `$dispatch`/`$listen` usage.
  - User-facing strings belong in `frontend/js/constants.js`, so modal copy and button labels should be constants for consistency.
  - Deletion should route through `GravityStore` and the existing note event flow (e.g., `gravity:note-delete`) or a single clear-all event so UI, local storage, and backend sync stay consistent.
  - Focus management matters: trap focus while open and restore focus to the settings trigger on close to preserve keyboard UX.
  
  ### Deliverables
  - Settings section exposes a "Delete all notes" action; Acceptance: action is visible in Settings/Avatar menu and does not navigate away.
  - Confirmation modal includes warning text, input, Cancel, and Delete buttons; Acceptance: Delete stays disabled until input exactly matches `DELETE` (case-sensitive, trimmed), and Escape/Cancel closes without changes.
  - Confirming deletion clears the notebook via the standard persistence path; Acceptance: the grid is empty, local storage is cleared for the active user scope, and signed-in sessions propagate deletes to the backend sync layer.
  - User feedback on success; Acceptance: a toast/notification is emitted via the existing notification pipeline (e.g., `gravity:notify`).
  - Browser E2E coverage in `frontend/tests/`; Acceptance: tests cover mismatch/cancel (no deletion) and confirmed deletion (all notes removed).
- [x] [GN-124] The moving behaviour:.
  # Active Card Behavior (Minimal Spec)
  1. **Anchor invariant**
    * While active, the card’s on-screen Y position stays fixed during mode switches and edits. Other cards may reflow.
  2. **Modes**
    * `HTML_VIEW` ↔ `MD_EDIT`.
  3. **HTML→Markdown (on click)**
    * Do **not** scroll.
    * Place caret at the click point’s corresponding text position.
    * Enter `MD_EDIT` with the card anchored (same on-screen Y).
  4. **During Markdown edit**
    * Content may grow/shrink; auto-scroll inversely to height delta to keep the card’s Y constant.
    * Other cards may move.
  5. **Finish edit**
    * Render to HTML **without collapsing** (keep the edit height).
    * Promote to **first in feed** while compensating scroll so the card’s on-screen Y is unchanged.
    * Remain in `HTML_VIEW`.
  ## Implementation Rules (succinct)
  * **Anchor capture:** Before any transition/re-render, record `anchorY = card.getBoundingClientRect().top`.
  * **Post-render compensation:** After DOM update, compute `delta = card.getBoundingClientRect().top - anchorY`; then `window.scrollBy(0, delta * -1)`.
  * **Caret mapping on click:** From HTML click Range → source Markdown offset (use your md/HTML source map or node `data.position`), set caret to that offset before applying the anchor compensation.
  - Anchors + AST metadata implemented: cards capture viewport positions (pinned or not), keep their edit height in HTML view until the user scrolls away, and HTML nodes now expose `data-md-start`/`data-md-end` from the markdown mapping so caret placement and reordering never cause visible jumps.
  - let's prepare a carefull plan and a list of behaviors that need to be defined or changed bases on this new visual behaviour
- [ ] [GN-125] (P0) Add per-note info button in control panel with metadata panel.
  ### Summary
  Add an info button to each note’s control panel that reveals key metadata (created time, last edited time, word count, character count) without disrupting the inline editing flow or grid stability.
  
  ### Analysis
  Gravity Notes uses inline Markdown editing with a stable HTML view and Alpine-driven UI. The note controls live alongside other per-card actions (pin/copy/merge/delete), so the info button should be implemented as a first-class control with a lightweight panel or tooltip that does not trigger layout jumps. Metadata should be derived from the existing note record (timestamps) and the current markdown content (counts). User-facing strings should be defined in `frontend/js/constants.js`, and the UI should follow the semantic component and event patterns described in `ARCHITECTURE.md` and `AGENTS.FRONTEND.md`. The feature should avoid new global state and remain localized to the card component.
  
  ### Deliverables
  - Add an info control to each note’s control panel that is visible in view mode and non-destructive during edit mode.
  - Display created timestamp, last edited timestamp, word count, and character count for the note based on current markdown content.
  - Ensure the info panel does not introduce scrollbars, reflow, or layout jumps; it should be inline or overlay without shifting the grid.
  - Localize all user-facing strings in `frontend/js/constants.js` and keep Alpine template logic declarative.
  - Add/update black-box UI tests (Playwright) that open the info panel and assert the displayed metadata for a sample note.
  - Acceptance criteria:
    - Info button appears on every note card control panel.
    - Clicking the button reveals the four metadata fields with correct values.
    - The grid remains visually stable; no unexpected reflow or scrollbars appear.
    - Existing editing behavior (inline edit, blur save, no-jump UX) is unchanged.
    - Tests pass via the standard `make test` workflow.


## Improvements (202–299)

- [ ] [GN-200] CORS preflight rejects `X-TAuth-Tenant`, the header our frontend now sends when talking to TAuth.
  The backend’s middleware under `internal/server/router.go` only whitelists `Authorization, Content-Type, X-Requested-With, X-Client`, so every request that includes the tenant header fails at the OPTIONS stage and the browser never reaches `/notes`/`/me`. Update the middleware (and accompanying tests) to keep using gin-contrib/cors or broaden the allowed header list to include `X-TAuth-Tenant`. Ensure OPTIONS handlers continue to return `204` with credentials enabled so cookie auth keeps working.
- [ ] [GN-201] Eliminate remaining shared/global state across the frontend/test harness (for example, globalThis runtime context caches and debug flags).
  Replace with explicit dependency injection or per-instance state so runtime config and test harnesses do not rely on globals.
  Known shared/global state to remove (non-exhaustive, update as found):
  - Frontend module-level mutable state:
    - `frontend/js/ui/imagePaste.js`: `placeholderSequence`
    - `frontend/js/ui/notesState.js`: `pinnedNoteId`
    - `frontend/js/ui/saveFeedback.js`: `toastTimerId`
    - `frontend/js/ui/focusManager.js`: `topEditorAutofocusSuppressed`
    - `frontend/js/core/store.js`: `activeStorageKey`
    - `frontend/js/core/analytics.js`: `analyticsBootstrapped`
    - `frontend/js/ui/card/pointerTracking.js`: `pointerTrackingInitialized`, `lastPointerDownTarget`
    - `frontend/js/ui/card/layout.js`: `pinnedLayoutContainer`, `pinnedLayoutResizeListenerAttached`, `topEditorResizeObserver`
    - `frontend/js/ui/card/editLifecycle.js`: `currentEditingCard`, `mergeInProgress`
    - `frontend/js/ui/card/anchorState.js`: `scrollMonitorRegistered`
  - Frontend custom globals (window/globalThis):
    - `frontend/js/app.js`: `window.Alpine = Alpine`
    - `frontend/js/core/backendClient.js`: `globalThis.apiFetch` override hook
    - `frontend/js/core/store.js`, `frontend/js/ui/storeSync.js`, `frontend/js/core/syncManager.js`: `globalThis.__debugSyncScenarios`
    - `frontend/js/ui/card/htmlView.js`: `globalThis.__gravityHtmlViewBubbleDelayMs` (test override)
  - Test harness shared state:
    - `frontend/tests/helpers/browserHarness.js`: `sharedLaunchContext`
    - `frontend/tests/helpers/backendHarness.js`: `backendBinaryPromise`, `sharedBackendInstance`, `sharedBackendRefs`
    - `frontend/tests/helpers/syncTestUtils.js`: `staticServerOriginPromise`, `staticServerHandle`
    - `frontend/tests/helpers/runtimeContext.js` + `frontend/tests/run-tests.js`: `globalThis.__gravityRuntimeContext`, `cachedContext`
    - `frontend/tests/helpers/browserLaunchGuard.js`: `globalThis.__gravityBrowserLaunchGuardMessage`
    - `frontend/tests/helpers/syncScenarioHarness.js`: `globalThis.__debugSyncScenarios`
    - `frontend/tests/auth.status.puppeteer.test.js`, `frontend/tests/auth.avatarMenu.puppeteer.test.js`: `puppeteerAvailable`
  - Test-only globals in browser context:
    - `window.__gravityForceMarkdownEditor`
    - `window.__gravityHtmlViewBubbleDelayMs`
    - `window.sessionStorage.__gravityTestInitialized`
- [x] [GN-102] Expand synchronization regression coverage across multi-session scenarios: comprehensive Puppeteer suites now verify snapshot application, dual-client editing, offline queue replay, and session bootstrap flows for both freshly authenticated and returning users; helpers gained reusable note event utilities and existing persistence tests consume them, with targeted sync suites executed successfully.
- [x] [GN-429] Conflict-aware LWW sync: retain rejected operations, surface conflicts, and avoid overwriting local edits when the server is ahead. (Resolved by tracking conflict operations, preserving local edits on rejected sync results, and skipping snapshot overwrites for conflicts.)


## BugFixes (429–528)

- [ ] [GN-31] Persist authenticated sessions across reload by validating stored Google credentials before wiring stores, and add integration coverage without relying on the backend harness.
- [x] [GN-311] Synchronization doesnt work properly __ ihave added an addition to a note from one browser but when I opened the note later on on a mobile, it was not there.
  Check the logs at @gravity.log and gravity-filtered.log and try to pinpoint the root cause (Resolved by retrying backend sync calls after refreshing expired TAuth sessions; added backend client regression coverage.)
- [ ] [GN-421] Gravity production runtime config still points authBaseUrl at the old TAuth host, causing nonce/auth client failures after the deployment.
  Update production defaults/runtime config and align tests.
- [x] [GN-422] Align Gravity's TAuth session flow with auth-client endpoint mapping to avoid CORS/404s after client updates.
  (Resolved by using the auth-client endpoint map and updating tests.)
- [x] [GN-424] Gravity still loads the legacy TAuth helper at `/static/auth-client.js`, which no longer exists.
  Update the frontend loader, harness, and docs to use `/tauth.js` so auth can initialize against current TAuth builds. (Resolved by switching loader/harness/docs to `/tauth.js`.)
- [x] [GN-425] Expanded inline editing height locks were ignored because CodeMirror auto sizing with `!important` overrode the inline edit lock.
  Override the height lock with inline `!important` styles so expanded cards keep their height in edit mode.
- [x] [GN-426] Gravity now forwards `authTenantId` into the tauth.js loader and TAuth session bridge while dropping the crossOrigin attribute so auth can load in stricter CORS setups.
  (Resolved by wiring authTenantId through runtime config, loader/session init, and harness CORS headers.)
- [x] [GN-427] Harden sync payload validation to require noteId/markdownText, enforce note id matching, and rollback on audit/id failures.
  (Resolved by validating ChangeEnvelope payloads, rejecting invalid sync operations, and adding rollback/normalization coverage.)
- [ ] [GN-428] CRITICAL: Gravity keeps the UI authenticated even when its backend rejects the session token.
  When Gravity returns 401/invalid token (e.g., issuer/signing key mismatch), the frontend stays logged in because it only keys off TAuth `/me`. We need a client-side 401 handler that clears auth state (trigger tauth.js logout or force re-auth) whenever Gravity API calls fail token validation, so users are not shown authenticated UI with failing backend access.
  Repro (local multi-tenant demo):
  - Introduce a session validator mismatch (e.g., set GRAVITY_TAUTH_ISSUER to a non-tauth value or change GRAVITY_TAUTH_SIGNING_SECRET).
  - Sign in via the frontend; TAuth /me returns 200 and UI shows authenticated state.
  - Call any Gravity API; backend logs "session token validation failed" and returns 401.
  Observed:
  - UI remains authenticated and keeps attempting requests that fail with 401.
  Expected:
  - On Gravity API 401 (invalid/expired token), UI clears auth state and triggers tauth.js logout or forces re-auth.
  Acceptance:
  - Any Gravity API 401 caused by session validation should transition the UI to unauthenticated state.
  - The frontend should not show authenticated UI when backend rejects the session.
  Backend alignment (do this in Gravity so issuer config is never required):
  - `tools/gravity/backend/internal/config/config.go`: remove `tauth.issuer` default + validation (stop requiring GRAVITY_TAUTH_ISSUER).
  - `tools/gravity/backend/cmd/gravity-api/main.go`: drop the `tauth-issuer` flag and viper binding.
  - `tools/gravity/backend/internal/auth/session_validator.go`: default issuer to `tauth` when empty (match TAuth), keep whitespace invalid.
  - `tools/gravity/.env.gravity.example`: remove `GRAVITY_TAUTH_ISSUER`.
  - `tools/gravity/README.md` + `tools/gravity/ARCHITECTURE.md`: remove issuer references in setup guidance.
  - `tools/gravity/frontend/tests/helpers/backendHarness.js`: stop passing `GRAVITY_TAUTH_ISSUER` or set it to the default internally.


## Maintenance (428–499)

- [x] [GN-423] Delegate nonce issuance and Google credential exchange to the TAuth auth-client helpers so Gravity no longer hand-rolls `/auth/nonce` + `/auth/google` fetches.
  (Resolved by delegating to auth-client helpers and updating tests/harness.)
- [x] [GN-427] Centralize environment config defaults and stabilize inline spellcheck replacement tests.
  (Resolved by sharing environment defaults across runtime/test harnesses and replacing execCommand-based spellcheck simulation with deterministic replacement events; full test suite passing.)
- [x] [GN-430] Stabilize inline editor tests (backtick wrapping + edit blur) to eliminate flakiness in repeated runs.
  (Resolved by making selection/keypress atomic in tests and clicking a deterministic badge surface for edit-mode exit.)
- [x] [GN-50] Provide a development docker compose that rebuilds the backend image on launch.
  (Resolved by adding a dev compose configuration that rebuilds the backend image on launch.)


## Planning
*do not implement yet*

- [ ] [GN-55] (P1) The current llm-proxy URL is wrong -- there is no such path as https://llm-proxy.mprlab.com/v1/gravity/.
  classify. There is only https://llm-proxy.mprlab.com/, and we need to be sending a system prompt to it to get classification. I have copied llm-proxy codebase under the tools folder. Prepare a system prompt for classification of the notes and send it to llm-proxy service.
- [ ] [GN-428] Evaluate CRDT/OT sync for multi-device edits; define merge strategy, payload schema, and migration plan.
