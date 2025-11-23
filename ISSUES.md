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

- [ ] [GN-300] Integrate with TAuth service for user authentication and keeping user logged in. Deliver a plan of integration expressed as issues in @ISSUES.md. Read @tools/mpr-ui/docs/integration-guide.md, @tools/TAuth/ARCHITECTURE.md and @tools/TAuth/README.md.  
  - [ ] Capture a written integration plan (steps + owners) that references the required docs and records the dependency order for GN-302 → GN-305.
- [ ] [GN-301] Implement the plan delivered by GN-300.  
  - Status: blocked until GN-300 produces the detailed rollout plan and sequencing checklist.
- [x] [GN-302] Add a runnable TAuth service to the local/dev stack (docker-compose, env templates) and expose shared configuration (signing secret, Google client ID, allowed origins, base URL) so both Gravity frontend (runtime config + docs) and backend know where to reach it.  
  - Docker compose (dev + prod) now builds/depends on a `tauth` service, `backend/env.example` + `tauth/env.example` share secrets/client IDs, and runtime config/README/ARCHITECTURE expose the new `authBaseUrl`.
- [ ] [GN-303] Replace the backend’s Google-token exchange with TAuth session validation: accept the `app_session` cookie (and fallback Authorization header), verify HS256 signatures using the shared signing secret + issuer, drop `/auth/google`, and update config + integration tests to cover the new middleware.  
  - Status: no code has landed; backend still exposes `/auth/google` and depends on Google token exchange. Backend tests need new coverage once the session validator exists.
- [ ] [GN-304] Rebuild the frontend authentication flow to call TAuth (`/auth/nonce`, `/auth/google`, `/auth/logout`) while loading `auth-client.js` for session refresh; propagate profile data to existing Alpine stores, fire the `gravity:auth-*` events, and update backend client calls to use cookie-based `apiFetch`/`credentials: "include"` instead of Bearer tokens.  
  - Status: frontend continues to call Gravity’s `/auth/google` endpoint and persists Bearer tokens; the WIP `improvement/GN-304-tauth-e2e-coverage` branch never merged.  
  - [ ] Land the TAuth session bridge (`ensureTAuthClientLoaded` + `createTAuthSession`) so Alpine bootstraps after the helper script loads and emits `gravity:auth-*` events with TAuth profiles.  
  - [ ] Remove bespoke backend token issuance (`createBackendClient.exchangeGoogleCredential`) and teach the sync manager/Realtime layer to rely on cookie-authenticated fetches instead of Bearer headers.  
  - [ ] Update the Google Identity wiring to request a nonce from TAuth before prompting and to pass credentials through `/auth/google` (no interception hacks in tests or dev builds).
- [ ] [GN-305] Add end-to-end coverage and docs for the TAuth flow: Puppeteer tests that sign in, survive refresh, auto-refresh sessions, and sync notes via the Gravity backend using TAuth cookies; README/ARCHITECTURE updates outlining the cross-service auth contract.  
  - Status: existing tests still stub `/auth/google` via `fetch` interception and never exercise real cookies; README/ARCHITECTURE still describe the legacy Bearer token exchange.  
  - [ ] Update the Playwright/Puppeteer harnesses to use the real TAuth helper (no inline intercept) so sign-in, refresh, and logout run against `/auth/nonce`, `/auth/google`, `/auth/refresh`, and `/auth/logout`.  
  - [ ] Refresh README/ARCHITECTURE to document the cross-service contract (cookie scope, shared signing key, runtime config) once GN-304 replaces the bespoke flow.

## Maintenance (400–499)

## Planning
**Do not work on these, not ready**

- [ ] [GN-55] The current llm-proxy URL is wrong -- there is no such path as https://llm-proxy.mprlab.com/v1/gravity/
  classify. There is only https://llm-proxy.mprlab.com/, and we need to be sending a system prompt to it to get classification. I have copied llm-proxy codebase under the tools folder. Prepare a system prompt for classification of the notes and send it to llm-proxy service. 
