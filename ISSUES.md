# ISSUES
**Append-only section-based log**

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here. Read @NOTES.md for the process to follow when fixing issues.

Read @AGENTS.md, @AGENTS.GO.md, @AGENTS.DOCKER.md, @AGENTS.FRONTEND.md, @AGENTS.GIT.md, @POLICY.md, @NOTES.md, @README.md and @ISSUES.md. Start working on open issues. Work autonomously and stack up PRs.

Each issue is formatted as `- [ ] [GN-<number>]`. When resolved it becomes -` [x] [GN-<number>]`

## Features (120–199)

- [ ] [GN-120] Search in a note: have a shortcut and render a search filed in the right top corner of the text editing area. Check with MDE if built in tools can be leveraged
- [ ] [GN-121] Search across notes. Use Cntr + Space to display a search dialog. The search works as a gravity point that pushes the irrelevant notes down and raises the relevant notes up. The search dialog is situated in the footer. The gravity point disappears when the search dialog is closed
- [ ] [GN-122] Add settings section under the user's avatar when a user is logged. in. There is a dropdown there, add settings before log out. Include such things as font size, and gravity control (whether to gravitate the card to the top on change, on clipboard copy)
- [ ] [GN-123] add a section to setting to delete all notes. show a modal pop up cfirmation that asks to type DELETYE before actually deleting all notes.
- [ ] [GN-124] The moving behaviour:

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

- let's prepare a carefull plan and a list of behaviors that need to be defined or changed bases on this new visual behaviour
- [ ] [GN-125] Have an info button in the control panel for every note. The info button will show when the note was created, when was it last edited, how manu words and charachters in it

## Improvements (200–299)

## BugFixes (300–399)

- [x] [GN-300] Integrate with TAuth service for user authentication and keeping user logged in. Deliver a plan of integration expressed as issues in @ISSUES.md. Read @tools/mpr-ui/docs/integration-guide.md, @tools/TAuth/ARCHITECTURE.md and @tools/TAuth/README.md.  
  - [x] Captured the dependency chain and owners for GN-302 → GN-305: GN-302 adds Docker/env plumbing, GN-303 migrates backend auth to TAuth cookies, GN-304 rewires the frontend (nonce fetch, `/auth/google`, cookie-based `apiFetch`, realtime/auth state cleanup), and GN-305 lands the black-box Playwright coverage + docs for `/auth/nonce`, `/auth/google`, `/auth/refresh`, `/auth/logout`. Doc review covered docs/mprui-integration.md, docs/mprui-custom-elements.md, docs/tauth-usage.md, tools/mpr-ui/demo/*, tools/mpr-ui/docs/integration-guide.md, tools/TAuth/README.md, and tools/TAuth/ARCHITECTURE.md so the plan references the upstream contract.
- [x] [GN-301] Implement the plan delivered by GN-300.  
  - GN-302/303/304 are complete, and the new backend identity service + migration landed, so the dependency chain is now fully implemented (remaining GN-305/GN-306 tasks are tracked under their own entries).
- [x] [GN-302] Add a runnable TAuth service to the local/dev stack (docker-compose, env templates) and expose shared configuration (signing secret, Google client ID, allowed origins, base URL) so both Gravity frontend (runtime config + docs) and backend know where to reach it.  
  - Docker compose (dev + prod) now builds/depends on a `tauth` service, `backend/env.example` + `tauth/env.example` share secrets/client IDs, and runtime config/README/ARCHITECTURE expose the new `authBaseUrl`.
- [x] [GN-303] Replace the backend’s Google-token exchange with TAuth session validation: accept the `app_session` cookie (and fallback Authorization header), verify HS256 signatures using the shared signing secret + issuer, drop `/auth/google`, and update config + integration tests to cover the new middleware.  
  - Backend now validates TAuth cookies via `SessionValidator`, `/auth/google` was removed, config flags/envs expose `GRAVITY_TAUTH_*`, and the integration tests mint session cookies instead of stubbing Google exchanges.
- [x] [GN-304] Rebuild the frontend authentication flow to call TAuth (`/auth/nonce`, `/auth/google`, `/auth/logout`) while loading `auth-client.js` for session refresh; propagate profile data to existing Alpine stores, fire the `gravity:auth-*` events, and update backend client calls to use cookie-based `apiFetch`/`credentials: "include"` instead of Bearer tokens.  
  - Session bootstrap now blocks on `ensureTAuthClientLoaded`/`createTAuthSession`, requests `/auth/nonce` before GIS prompts, dispatches `gravity:auth-*` events with TAuth profiles, and reuses `window.apiFetch` for every backend call (sync manager + realtime) so no Bearer tokens persist in storage.  
  - [x] Land the TAuth session bridge (`ensureTAuthClientLoaded` + `createTAuthSession`) so Alpine bootstraps after the helper script loads, listens for `EVENT_AUTH_CREDENTIAL_RECEIVED`, requests `/auth/nonce`, exchanges GIS credentials at `/auth/google`, and emits `gravity:auth-*` events with TAuth profiles.  
  - [x] Remove bespoke backend token issuance (`createBackendClient.exchangeGoogleCredential`), drop `backendAccessToken` persistence, and teach the sync manager + realtime controller to rely on cookie-authenticated fetches (`window.apiFetch` + `credentials: "include"`) instead of Bearer headers.  
  - [x] Update the Google Identity wiring to request a nonce from TAuth before prompting, pass credentials through `/auth/google`, and surface retryable errors without the existing fetch-interception hacks in tests or dev builds.  
  - [x] Extend runtime-config consumers/tests (`browserHarness`, Puppeteer harnesses) so `authBaseUrl` overrides flow through before the frontend reads it and every Puppeteer test signs in via the TAuth harness.
- [x] [GN-305] Add end-to-end coverage and docs for the TAuth flow: Puppeteer tests that sign in, survive refresh, auto-refresh sessions, and sync notes via the Gravity backend using TAuth cookies; README/ARCHITECTURE updates outlining the cross-service auth contract.  
  - `auth.tauth.puppeteer.test.js` now drives nonce mismatch handling, cookie-driven refresh, and logout propagation via the real TAuth harness, and the broader sync suites exercise backend sync with cookies only.  
  - README + ARCHITECTURE describe the TAuth contract (nonce exchange, cookie scope, shared secrets, docker orchestration) so implementers know how the services interact.
- [x] [GN-306] Add docker-compose profiles so `dev` builds Gravity locally while `docker` pulls GHCR images; wire both to TAuth + Pinguin with shared `.env` templates and document the workflow in README/ARCHITECTURE (Makefile defaults to `--profile dev`).
- [x] [GN-307] Harden Puppeteer request interception so sync tests stop leaking “offline” handlers between steps.  
  - `sync.scenarios.puppeteer.test.js` is the only suite that failed twice in the attached tri-iteration run (seeds `0x24a370f0`, `0xe525e838`, `0x254884bd`), and logs show its `interceptSyncRequests()` helper leaves interceptors active because `clear()` is a no-op and `registerRequestInterceptor()` never returns a removal handle. Those stale handlers keep aborting `/notes/sync` after the test tries to restore connectivity, so the queue never drains and the test exits non-zero.  
  - Introduced `createRequestInterceptorController()` in `tests/helpers/browserHarness.js`, migrated CDN mirrors and the TAuth harness to disposable interceptors, and taught the sync scenarios helper to unregister network hooks so “offline” simulations stop leaking between tests.
  - Validation: `timeout -k 350s -s SIGKILL 350s npm --prefix frontend test -- --iterations=1 --no-randomize --seed=0x11111111` now passes consistently.
- [x] [GN-308] Introduce a dedicated `SyncScenarioHarness` so queue/metadata assertions stop duplicating brittle Alpine spelunking.  
  - Wrap backend startup, TAuth harness installation, runtime-config overrides, and note factory helpers behind a single module (e.g., `tests/helpers/syncScenarioHarness.js`) that hands out `createSession({ userId, interceptMode })` and `waitForQueueLength(page, expected)` APIs. This keeps tests black-box at the UI boundary (per AGENTS/AGENTS.FRONTEND) while providing one vetted way to interact with `syncManager.getDebugState()`.  
  - Added `tests/helpers/syncScenarioHarness.js` with deterministic note factories, queue/markdown helpers, backend polling, and a session builder that shares contexts and installs the TAuth stub before navigation.
  - Validation: see GN-307 run; the harness exports were exercised via the refactored suite.
- [x] [GN-309] Rewrite `sync.scenarios.puppeteer.test.js` on top of the new harness and split oversized cases for stability.  
  - Replace the current 3-in-1 test with separate `test()` blocks (transient failure retry, offline queue replay, concurrent sessions) that each call into `SyncScenarioHarness` helpers instead of embedding their own Alpine and localStorage plumbing. Keep the scenarios black-box by dispatching `EVENT_NOTE_CREATE`/`EVENT_NOTE_UPDATE` and asserting against rendered cards, but rely on harness helpers for queue state/ backend snapshot polling.  
  - Scenarios now use the shared harness APIs, reuse browser contexts when testing offline queues, and rely on helper-provided `waitForQueueLength`, `synchronize`, and backend polling utilities.
  - Validation: the full front-end suite passes under `timeout -k 350s -s SIGKILL 350s npm --prefix frontend test -- --iterations=1 --no-randomize --seed=0x11111111`.

## Maintenance (400–499)

- [x] [PG-400] docker-compose.yml now exposes `dev` (local backend build) and `docker` (GHCR images) profiles, adds shared `.env` templates (backend, tauth, pinguin), and Makefile `up` target honors `COMPOSE_PROFILE`; docs updated to describe the new flow.
- [x] [PG-401] Backend Docker publish workflow now waits for the `Backend Tests` workflow to finish successfully on push to `master` (via `workflow_run`) before building/pushing images; manual `workflow_dispatch` remains available for emergencies.
- [x] [GN-402] Replace console.log with js/utils/logging.js in frontend production code (syncManager.js, store.js, storeSync.js) to comply with AGENTS.FRONTEND.md.
  - Logging helper now drives all debug output across those modules, keeping console APIs unused in production code.
- [x] [GN-403] Inject zap.Logger into backend Service struct in internal/notes/service.go to align with AGENTS.GO.md and enable structured logging.
  - notes.Service now receives a zap.Logger through ServiceConfig, defaults to a no-op logger, and emits structured error logs across ApplyChanges/ListNotes; HTTP/main wiring and integration tests now pass zap loggers explicitly.

## Planning
**Do not work on these, not ready**

- [ ] [GN-55] The current llm-proxy URL is wrong -- there is no such path as https://llm-proxy.mprlab.com/v1/gravity/
  classify. There is only https://llm-proxy.mprlab.com/, and we need to be sending a system prompt to it to get classification. I have copied llm-proxy codebase under the tools folder. Prepare a system prompt for classification of the notes and send it to llm-proxy service.
