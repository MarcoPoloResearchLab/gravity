# Notes

## Role

You are a staff level full stack engineer. Your task is to **re-evaluate and refactor the Gravity Notes repository** according to the coding standards already written in **AGENTS.md**.

## Context

* AGENTS.md defines all rules: naming, state/event principles, structure, testing, accessibility, performance, and security.
* The repo uses Alpine.js, CDN scripts only, no bundlers.
* Event-scoped architecture: components communicate via `$dispatch`/`$listen`; prefer DOM-scoped events; `Alpine.store` only for true shared domain state.
* The backend uses Go language ecosystem

## Your tasks

1. **Read AGENTS.md first** → treat it as the *authoritative style guide*.
2. **Scan the codebase** → identify violations (inline handlers, globals, duplicated strings, lack of constants, cross-component state leakage, etc.).
3. **Generate PLAN.md** → bullet list of problems and refactors needed, scoped by file. PLAN.md is a part of PR metadata. It's a transient document outlining the work on a given issue.
4. **Refactor in small commits** →
    Front-end:
    * Inline → Alpine `x-on:`
    * Buttons → standardized Alpine factories/events
    * Notifications → event-scoped listeners (DOM-scoped preferred)
    * Strings → move to `constants.js`
    * Utilities → extract into `/js/utils/`
    * Composition → normalize `/js/app.js` as Alpine composition root
    Backend:
    * Use "object-oreinted" stye of functions attached to structs
    * Prioritize data-driven solutions over imperative approach
    * Design and use shared components
5. **Tests** → Add/adjust Puppeteer tests for key flows (button → event → notification; cross-panel isolation). Prioritize end-2-end and integration tests.
6. **Docs** → Update README and MIGRATION.md with new event contracts, removed globals, and developer instructions.
7. **Timeouts**  Set a timer before running any CLI command, tests, build, git etc. If an operation takes unreasonably long without producing an output, abort it and consider a diffeernt approach. Prepend all CLI invocations with `timeout -k <N>s -s SIGKILL <N>s` command. Theis is MANDATORY for each and every CLI command.

## Output requirements

* Always follow AGENTS.md rules (do not restate them, do not invent new ones).
* Output a **PLAN.md** first, then refactor step-by-step.
* Only modify necessary files.
* Descriptive identifiers, no single-letter names.
* End with a short summary of changed files and new event contracts.

**Begin by reading AGENTS.md and generating PLAN.md now.**

## Rules of engagement

Review the NOTES.md. Make a plan for autonomously fixing every item under Features, BugFixes, Improvements, Maintenance. Ensure no regressions. Ensure adding tests. Lean into integration tests. Fix every issue. Document the changes.

Fix issues one by one, working sequentially. 
1. Create a new git bracnh with descriptive name, for example `feature/LA-56-widget-defer` or `bugfix/LA-11-alpine-rehydration`. Use the taxonomy of issues as prefixes: improvement/, feature/, bugfix/, maintenace/, issue ID and a short descriptive. Respect the name limits.
2. Describe an issue through tests. 
2a. Ensure that the tests are comprehensive and failing to begin with. 
2b. Ensure AGENTS.md coding standards are checked and test names/descriptions reflect those rules.
3. Fix the issue
4. Rerun the tests
5. Repeat pp 2-4 untill the issue is fixed: 
5a. old and new comprehensive tests are passing
5b. Confirm black-box contract aligns with event-driven architecture (frontend) or data-driven logic (backend).
5c. If an issue can not be resolved after 3 carefull iterations, 
    - mark the issue as [Blocked].
    - document the reason for the bockage.
    - commit the changes into a separate branch called "blocked/<issue-id>".
    - work on the next issue from the divergence point of the previous issue.
6. Write a nice comprehensive commit message AFTER EACH issue is fixed and tested and covered with tests.
7. Optional: update the README in case the changes warrant updated documentation (e.g. have user-facing consequences)
8. Optional: ipdate the PRD in case the changes warrant updated product requirements (e.g. change product undestanding)
9. Optional: update the code examples in case the changes warrant updated code examples
10. Mark an issue as done ([X])in the NOTES.md after the issue is fixed: New and existing tests are passing without regressions
11. Commit and push the changes to the remote branch.
12. Repeat till all issues are fixed, and commits abd branches are stacked up (one starts from another).

Do not work on all issues at once. Work at one issue at a time sequntially.

Leave Features, BugFixes, Improvements, Maintenance sections empty when all fixes are implemented but don't delete the sections themselves.

## Issues

### Features

  - [x] [GN-11] Add logging using Google Login SDK (frontend only). Employ the GSI approach you can find in the countodwn folder [text](countdown/app.js). use Google Client ID "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com"
  - [x] [GN-12] Associate local storage where we store all notes with the user (see [GN-11]). A good test would be to confirm that thwo users logged in in the same browser will not see each other notes.
  - [x] [GN-18] Scaffold backend in Go. 
      1. I want to keep a monorepo for both the frontend and the backend, backend being written in Go and frontend staying as it is now, with Alpine and GSI SDK. we can place the backend under /backend folder for now
      2. The backend will need to be accepting the JWT from the front end to verify user's identity. The main function of the backend is to store the notes. We can use a simple data store for now, sqlite. 
      3. Have a flexible payload schema for now, effectively key value with a value being the whole payload of the message (maybe large givwn image embeddings) . 
          - ID (an Id is initially assigned  by the client where the note is created,  uuid v7 to minimizes the collision chances) 
          - CrestedAt (unixtime)
          - UpdatedAt (unixtime)
          - Payload (JSON)
      4. It is paramount to have the app working offline so that the notes can be used when on the airplane etc. so we first store the notes in the local storage on the front end and we then syncronize them to the backend using a background worker.
      5. Conflict resolution:
          When a client submits an upsert or delete for a `(user_id, note_id)`:

          1. Compare client’s `client_edit_seq` vs stored `last_writer_edit_seq`:

          * If **client_edit_seq > stored** ⇒ **accept client**.
          * If **client_edit_seq < stored** ⇒ **reject client** (no change; return server state).
          * If **equal** ⇒ go to step 2.

          1. Tie-breaker: compare `client.updated_at_s` vs stored `updated_at_s`:

          * If **client > stored** ⇒ **accept client**.
          * If **client < stored** ⇒ **reject client**.
          * If **equal** ⇒ **client wins** (accept client).

          **On accept:**

          * Increment `version` by 1.
          * Update `payload_json`, `is_deleted` (false for upsert, true for delete), `updated_at_s = max(stored, client)`.
          * Set `last_writer_device = client_device`.
          * Set `last_writer_edit_seq = client_edit_seq`.
          * Insert `note_changes` row:

          * `op = "upsert"` or `"delete"`
          * `prev_version` = previous `version`
          * `new_version` = new `version`
          * `client_edit_seq` = client value
          * `server_edit_seq_seen` = previous `last_writer_edit_seq`.

          **On reject:**

          * Do not mutate `notes`.
          * Optionally record `note_changes` only if you want a rejection audit (not required).
          * Return current server copy so client can reconcile.
      6. Auth model:
          - Login path: Frontend obtains GSI ID token (JWT) → send once to POST /auth/google.
          - Backend verifies offline (JWKS cached) and then issues your own short-lived JWT (e.g., 30 min).
          - All API calls use Authorization: Bearer <your_jwt> (or SameSite=Lax HttpOnly cookie if you keep API on same origin).
          - No per-request Google calls.
          * **Endpoint:** `POST /auth/google`

          * Request JSON: `{ "id_token": "<GSI ID token JWT>" }`
          * Validate offline with Google JWKS (library caches keys). Verify `aud == GOOGLE_OAUTH_CLIENT_ID`, `iss` in Google issuers, `exp` valid.
          * On success: issue **backend JWT** (HS256) with:

              * `sub` = stable user identifier from Google payload (use `sub`)
              * `aud = "gravity-api"`
              * `iss = "gravity-auth"`
              * `exp` = now + `JWT_TTL_MINUTES`
          * Response JSON: `{ "access_token": "<backend JWT>", "expires_in": <seconds> }`
          * **All subsequent API requests:** `Authorization: Bearer <backend JWT>`.
          * **Tenancy:** derive `user_id` = `sub` from backend JWT on every request; all queries filter by `user_id`.
      7. Ensure that all persistence operations are done through GORM, and that teh DB can be later swapped to another one (e.g. from SQLite to Postgres etc). GORM shall also handle migrations
          - Data model (GORM terms; **no code**)
          - Table: `notes`
          * Composite primary key: `(user_id, note_id)`.
          * Columns (names and types exactly):

          * `user_id` TEXT, not null, PK part, size ≤ 190.
          * `note_id` TEXT, not null, PK part, size ≤ 190. **Client-generated UUID (prefer v7; v5 allowed).**
          * `created_at_s` INTEGER (unix seconds), not null.
          * `updated_at_s` INTEGER (unix seconds), not null, indexed.
          * `payload_json` TEXT, not null (opaque JSON blob; may be large).
          * `is_deleted` BOOLEAN, not null, default `false`, indexed.
          * `version` INTEGER, not null, default `1` (server-side monotonic).
          * `last_writer_device` TEXT, not null, default `""`, size ≤ 190.
          * `last_writer_edit_seq` INTEGER, not null, default `0`, indexed.
          * Indices:

          * `idx_notes_user_updated` on `(user_id, last_writer_edit_seq, updated_at_s, is_deleted)`.

          - Table: `note_changes` (append-only idempotency & audit)

          * Primary key: `change_id` TEXT (UUID v7).
          * Columns:

          * `user_id` TEXT, not null, indexed (first in composite index below).
          * `note_id` TEXT, not null.
          * `change_id` TEXT, not null, PK.
          * `applied_at_s` INTEGER, not null, indexed (second in composite index below).
          * `client_device` TEXT, not null, size ≤ 190.
          * `client_time_s` INTEGER, not null.
          * `op` TEXT, not null, values: `upsert` | `delete`.
          * `payload_json` TEXT, not null (the client’s payload for this change; for deletes, store last known).
          * `prev_version` INTEGER, nullable.
          * `new_version` INTEGER, nullable.
          * `client_edit_seq` INTEGER, not null, default `0`.
          * `server_edit_seq_seen` INTEGER, not null, default `0`.
          * Indices:
              * `idx_changes_user_time` on `(user_id, applied_at_s)`.

  - [x] [GN-19] Prepare frontend integration with the Go backend to allow Notes to be saved and restored based on the logged in user across mutliple clients. Review [GN-18] for backecnd details. have intgeration tests that allow verification of the end-2-end flow

### Improvements

  - [x] [GN-10] When the note is expanded in rendering mode do not move the viewpoint to its end. Leave the note staying as is and just exand it to full rendering
  - [x] [GN-14] Organize header bar buttons into a stackable menu. The stackable menu shall be under the user avatar. The user avatar is shown in a circle, which gains white outline on hover. On a click it displays the stacked dropdown:
      - Export Notes
      - Import Notes
      - Sign Out
  - [x] [GN-20] Allow for Export only of the notes for un-authenticated user. Have an Export button available that downlaods json containing all the notes. Reuse existing functionality.
  - [x] [GN-22] Open the note in the place a user clicked on when swithcing from rendered view to editing. That way if a user clicked in the middle of the sentence in the rendered view, the cursor goes to that middle of the sentence in the markdown editing view
  - [x] [GN-24] Add Github workflow to package the backend as a Docker file. Add Dockerfile to create an image. add docker-compose.yml to faciliate local development (backend/Dockerfile, docker-compose.yml, and GHCR workflow added).
    Example:
    ```yaml
      name: Build and Publish Docker Image

      on:
      push:
          branches:
          - master
          paths:
          - 'Dockerfile'
          - '**/*.go'
          - 'go.mod'
          - 'go.sum'
      workflow_dispatch:

      jobs:
      build-and-push:
          name: Build and Push Image
          runs-on: ubuntu-latest

          permissions:
          contents: read
          packages: write

          steps:
          - name: Check out repository
              uses: actions/checkout@v4

          - name: Log in to GitHub Container Registry
              uses: docker/login-action@v3
              with:
              registry: ghcr.io
              username: ${{ github.repository_owner }}
              password: ${{ secrets.GITHUB_TOKEN }}

          - name: Build and push Docker image
              uses: docker/build-push-action@v5
              with:
              context: .
              file: Dockerfile
              push: true
              tags: |
                  ghcr.io/${{ github.repository_owner }}/loopaware:latest
                  ghcr.io/${{ github.repository_owner }}/loopaware:${{ github.sha }}
    ```
  - [x] [GN-27] Define a mechanism to allow for local development integration testing between front end and backend. we currently have backendBaseUrl: "http://localhost:8080" in the config.js file but we will need to be able to plug in the url there dynamically depending on the environment we are in
  - [x] [GN-32] Develop a mechanism for end2end tests, allowing to verify the behavior of both front-end and back-end working toghether. Prioritize the correctness of the solution.
      We can consider driving everythign from Go for simplicity and consistency.
      - chromedp (Go) — real-browser E2E without Node
          Drive Chromium headless from Go.
          On CI, run tests inside the deterministic chromedp/headless-shell image (no flaky system deps).
      - httpexpect (Go) — fast API assertions
          For API-level flows that don’t need a browser; keeps failures precise.
  - [x] [GN-34] The tests take too long to complete -- GitHub allows maximum 360 seconds. Take a look at all of thests , measure their time of the execution, consider the techniques of decreasing the time.
  - [x] [GN-37] Check if the enter is pressed at the first line of a list (whether numeric or pointed) and do not add a list item, just use normal enter. Consult MDE documentation
  - [x] [GN-38] Check if a list is a checkmarked list `- [ ]` and add a checkmark item on continuation. Consult MDE documentation.
  - [x] [GN-39] Check if Google Sign In offers a different, minimized styling (small button) so that Google login buttom allows for better rendering on narrow screens.

### BugFixes

  - [x] [GN-13] Remove the button "Sign In with Google" after successfull login
  - [x] [GN-15] Remove "Not Signed In" sign when the user is not signed in, and leave only the Sign in with Google button
  - [x] [GN-16] Remove "Signed In" sign when the user is signed in
  - [x] [GN-17] Remove the button "Sign In with Google" after successfull login
  - [x] [GN-21] Rename items in the stacked dropdown after login to:
      - Export -> "Export Notes"
      - Import -> "Import Notes"
  - [x] [GN-23] Check if a user presses closing square bracket after [ and avoid duplication. We already do it for other nrackets, bu [ is a special case when we add space closing sqaure bracket space. we shall still verify that thge user doesnt close the brackets and swallow an extra ] if the user does it (covered by inline/enhanced bracket skip tests)
  - [x] [GN-24] Refactor go persistant storage implementation to rely on GORM. It looks like we are dependent on go-sqlite3, which requires CGO_ENABLED=0. I have a similar codebase that uses go and sqlite and doesnt require cgo. It's dependencies list reads
      ```go
      require (
          github.com/chromedp/chromedp v0.14.2
          github.com/gin-contrib/cors v1.7.6
          github.com/gin-gonic/gin v1.11.0
          github.com/glebarez/sqlite v1.11.0
          github.com/google/uuid v1.6.0
          github.com/gorilla/sessions v1.4.0
          github.com/spf13/cobra v1.10.1
          github.com/spf13/pflag v1.0.10
          github.com/spf13/viper v1.21.0
          github.com/stretchr/testify v1.11.1
          github.com/temirov/GAuss v0.0.12
          go.uber.org/zap v1.27.0
          golang.org/x/net v0.46.0
          gorm.io/gorm v1.31.0
      )
      ```
  - [x] [GN-25] I have started docker compose with the backend on localhost:8000. I have then started and logged into Gravity Notes running on localhost:800. I was ablle to login on both Firefox and Safari successfully.
  1. I do not see the notes I see on Firefox in Safari after I have logged in as the same user. The synchronization does not work.
  2. I do see errors in JS console of both browsers
    Safari JS Console errors:
    ```js
      [Error] Failed to load resource: the server responded with a status of 403 () (status, line 0)
      [Error] [GSI_LOGGER]: The given origin is not allowed for the given client ID.
          (anonymous function) (client:74:95)
          (anonymous function) (client:213:299)
          (anonymous function) (client:312:232)
          (anonymous function) (client:330:265)
          (anonymous function) (client:257:399)
          zf (client:115:465)
          (anonymous function) (client:114:345)
          lk (client:161:444)
          pk (client:164)
          (anonymous function) (client:169:99)
          (anonymous function) (client:169)
      [Error] Failed to load resource: the server responded with a status of 403 () (button, line 0)
      [Error] [GSI_LOGGER]: The given origin is not allowed for the given client ID.
          (anonymous function)
          (anonymous function)
          (anonymous function)
          Global Code
      [Error] Failed to load resource: the server responded with a status of 429 () (ACg8ocKhysgZSyFQITrmy5XeXGNmTvMXNoyQzVdb1U7L1AGd8wurJmNYIw=s96-c, line 0)
      ```
    Firefox JS Console messages
      ```js
      Cookie warnings 2
      Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:269:37
      Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:270:336
      [GSI_LOGGER]: The given origin is not allowed for the given client ID. client:74:89
      Opening multiple popups was blocked due to lack of user activation. client:80:240
      Storage access automatically granted for origin “https://accounts.google.com” on “http://localhost:8000”.
      Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://llm-proxy.mprlab.com/v1/gravity/classify. (Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 403.
      Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://llm-proxy.mprlab.com/v1/gravity/classify. (Reason: CORS request did not succeed). Status code: (null).
      ```
      I do see the following log on the backend side
      ```
      backend-1  | [GIN-debug] [WARNING] Running in "debug" mode. Switch to "release" mode in production.
      backend-1  |  - using env:      export GIN_MODE=release
      backend-1  |  - using code:     gin.SetMode(gin.ReleaseMode)
      backend-1  | 
      backend-1  | [GIN-debug] POST   /auth/google              --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleGoogleAuth-fm (3 handlers)
      backend-1  | [GIN-debug] POST   /notes/sync               --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleNotesSync-fm (4 handlers)
      backend-1  | [GIN-debug] GET    /notes                    --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleListNotes-fm (4 handlers)
      backend-1  | {"level":"info","ts":1760159017.0436192,"caller":"database/sqlite.go:34","msg":"database initialized","path":"/data/gravity.db"}
      backend-1  | {"level":"info","ts":1760159017.0450127,"caller":"gravity-api/main.go:148","msg":"server starting","address":"0.0.0.0:8080"}
      backend-1  | 
      backend-1  | 2025/10/11 05:12:55 /src/internal/notes/service.go:99 record not found
      backend-1  | [4.194ms] [rows:0] SELECT * FROM `notes` WHERE user_id = "111357980452034959148" AND note_id = "f8d0af07-5827-44ae-8576-e5ac183617ec" LIMIT 1 
      backend-1  | 
      backend-1  | 2025/10/11 05:12:55 /src/internal/notes/service.go:99 record not found
      backend-1  | [0.769ms] [rows:0] SELECT * FROM `notes` WHERE user_id = "111357980452034959148" AND note_id = "39506c3f-aa21-440e-9e57-6cd23f8d98d7" LIMIT 1 
      backend-1  | 
      backend-1  | 2025/10/11 05:14:10 /src/internal/notes/service.go:99 record not found
      backend-1  | [0.136ms] [rows:0] SELECT * FROM `notes` WHERE user_id = "111357980452034959148" AND note_id = "1aca4bed-4bd6-42b3-ad9b-1b58859a9241" LIMIT 1 
      ```
  - [x] [GN-26] When we open markdown for editing we shall place the cursor in the same place as the place it was clicked on in the rendering mode. See [GN-22]
  - [x] [GN-27] Notes randomly duplicate when clicked on rendered checkmarks
  - [x] [GN-28] When we open markdown for editing we shall place the cursor in the same place as the place it was clicked on in the rendering mode. See [GN-22], [GN-26]. Write tests to demonstarte that a cursor in markdown will be placed in the same place as where the click landed in the rendered preview
  - [x] [GN-29] Make a url of llm-proxy environment-dependent (configurable) for development. Current url gives errros about CORS https://llm-proxy.mprlab.com/v1/gravity/classify
  `Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://llm-proxy.mprlab.com/v1/gravity/classify. (Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 403.`
  - [x] [GN-30] The backend receive no events from the client. Prepare an end-2-end test that
      1. Starts the backend
      2. Starts the frontend pointing to the backend
      3. Verifies syncronization between the front-end and the backend
          Current backend logs:
          ```
          Attaching to backend-1
          backend-1  | [GIN-debug] [WARNING] Running in "debug" mode. Switch to "release" mode in production.
          backend-1  |  - using env:      export GIN_MODE=release
          backend-1  |  - using code:     gin.SetMode(gin.ReleaseMode)
          backend-1  | 
          backend-1  | [GIN-debug] POST   /auth/google              --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleGoogleAuth-fm (3 handlers)
          backend-1  | [GIN-debug] POST   /notes/sync               --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleNotesSync-fm (4 handlers)
          backend-1  | [GIN-debug] GET    /notes                    --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleListNotes-fm (4 handlers)
          backend-1  | {"level":"info","ts":1760200071.233145,"caller":"database/sqlite.go:34","msg":"database initialized","path":"/data/gravity.db"}
          backend-1  | {"level":"info","ts":1760200071.2389312,"caller":"gravity-api/main.go:148","msg":"server starting","address":"0.0.0.0:8080"}
          ```
          Frontend configuration:     `<meta name="gravity-backend-base-url" content="http://localhost:8080">`
  - [x] [GN-31] The page refresh logs out a logged in user. Have an integration test that verifies that the page refresh does not log off the user. I see messages in the JS console that maybe relevant: 
  ```
  The value of the attribute “expires” for the cookie “_ga_WYL7PDVTHN” has been overwritten. localhost:8000

  [GSI_LOGGER]: The given origin is not allowed for the given client ID. client:74:89
  ```
      - Follow-up 2025-10-14: GravityStore scope is applied before invoking `syncManager.handleSignIn`, ensuring snapshot persistence and cross-client hydration. `tests/persistence.sync.puppeteer.test.js` now completes in ~3.5s and a full `npm test` run finishes in ~43s (22 suites, 0 failures, 0 timeouts).
      - Real backend harness (`tests/helpers/backendHarness.js`) now powers auth and sync integration suites; all former fetch mocks removed so Go API runs for every puppeteer flow.
  - [x] [GN-31] Persist authenticated sessions across reload by validating stored Google credentials before wiring stores, and add integration coverage without relying on the backend harness.
  - [x] [GN-32] tests are failing: `  ✖ lists and tables auto-continue in fallback editor (3382.860931ms)`
  - [x] [GN-33] tests are hanging indefinetely. Do not run all the tests -- run each test and use a background teask to kill the testing process after 30 seconds. No individual test shall run longer than 30 seconds. Find the slow tests and refactor them into faster tests. Currently the test suit just hangs: nothing happens after that:
  - [x] [GN-35] the tests lost the color formatting. Some tests are failing. There is no comprehensive summary at the end, and the one present is misleading as it doesnt mention the failing tests
  - [ ] [GN-45] Encode in tests that there must be no scrollers in the cards, neither for editing nor for rendering
  - [ ] [GN-46] There are thick grey lines under the notes. each not card must not have any thick borders, and shall only have thin bottom borders
  - [ ] [GN-47] Expected behaviour: when editied the note, the card extends fully to fill in the text. The cursor is placed in the point where the click was registered in the rendered text. The position of the top of the card doesnt change. The card extends downwards.
  - [ ] [GN-48] Clicking on a card that is being edited doesnt change anything other than placing the cursor in the new place. There must be no flickering and no switching to rendering.
  - [ ] [GN-49] Shift-enter finishes editing session and sends card to rendering mode

### Maintenance

  - [x] [GN-35] add a small “Privacy • Terms” link. and I mean small. it must serve a page under /privacy
      ```html
      <!doctype html>
      <html lang="en">
      <head>
      <meta charset="utf-8">
      <title>Privacy Policy — RSVP</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="robots" content="noindex,nofollow">
      <style>
          body{font:16px/1.5 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:40px;max-width:800px}
          h1{font-size:1.6rem;margin-bottom:.2rem}
      </style>
      </head>
      <body>
      <h1>Privacy Policy — Gravity Notes</h1>
      <p><strong>Effective Date:</strong> 2025-10-11</p>
      <p>RSVP uses Google Identity Services to authenticate users. We receive your Google profile
          information (name, email, profile image) only to sign you in. We do not sell or share your data,
          and we only store your notes so the service functions.</p>
      <p>To request deletion of your data, contact
          <a href="mailto:support@mprlab.com">support@mprlab.com</a>.</p>
      </body>
      </html>
      ```
  - [x] [GN-36] add privacy to the sitemap
  - [x] [GN-37] Remove all and any fallbacks in the code, rely on EasyMDE for inline editor functionality. Verified by `tests/editor.inline.puppeteer.test.js` passing and exercising first-line enter and checklist continuation scenarios.
  - [x] [GN-40] Ensure the shared Puppeteer harness terminates immediately after printing the summary so outer CLI timeouts do not kill successful runs.
  - [x] [GN-42] Prepare a docker compose file for development that starts both the back-end and the front-end.
      1. Add a GitHub actions pipeline that generates docker image
      1. Use temirov/ghttp image for the front end. See the documentation at [GH-42-docs.md](/GN-42-docs.md)
      1. Load local .env for the backend
  - [x] [GN-43] Address issues in JS console on Firefox
    Cookie warnings 2
    Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:269:37
    Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:270:336
    [GSI_LOGGER]: The given origin is not allowed for the given client ID. client:74:89
        G https://accounts.google.com/gsi/client:74
        Pg https://accounts.google.com/gsi/client:214
        ba https://accounts.google.com/gsi/client:313
        Jt https://accounts.google.com/gsi/client:331
        Dr https://accounts.google.com/gsi/client:258
        zf https://accounts.google.com/gsi/client:115
        dispatchEvent https://accounts.google.com/gsi/client:114
        lk https://accounts.google.com/gsi/client:162
        pk https://accounts.google.com/gsi/client:165
        me https://accounts.google.com/gsi/client:170
        Xc https://accounts.google.com/gsi/client:170
    Opening multiple popups was blocked due to lack of user activation. client:80:240
    Storage access automatically granted for origin “https://accounts.google.com” on “http://localhost:8000”.
  - [x] [GN-44] There are horrendous UI regressions in the front-end, like a giant first note of a different color, or multicolumn editing mode where the markdown is in a narrow column on the right. FIXED: realigned the EasyMDE container with the card grid, removed injected borders, and collapsed the top editor to its compact height so inline editing stays within the left column.
    - [x] CSS matching commit 574c880 re-applied for note layout; pending manual visual confirmation before closing.
    - [x] Automated regression tests in `tests/editor.inline.puppeteer.test.js` now enforce height, border, editor-alignment, Shift+Enter submission, and preview suppression expectations and pass with the restored styling.
    
