# Notes

### Role

You are a senior front-end engineer. Your task is to **re-evaluate and refactor the repository Gravity Notes** according to the coding standards already written in **AGENTS.md**.

### Context

* AGENTS.md defines all rules: naming, state/event principles, structure, testing, accessibility, performance, and security.
* The repo uses Alpine.js, CDN scripts only, no bundlers.
* Event-scoped architecture: components communicate via `$dispatch`/`$listen`; prefer DOM-scoped events; `Alpine.store` only for true shared domain state.

### Your tasks

1. **Read AGENTS.md first** → treat it as the *authoritative style guide*.
2. **Scan the codebase** → identify violations (inline handlers, globals, duplicated strings, lack of constants, cross-component state leakage, etc.).
3. **Generate PLAN.md** → bullet list of problems and refactors needed, scoped by file.
4. **Refactor in small commits** →

   * Inline → Alpine `x-on:`
   * Buttons → standardized Alpine factories/events
   * Notifications → event-scoped listeners (DOM-scoped preferred)
   * Strings → move to `constants.js`
   * Utilities → extract into `/js/utils/`
   * Composition → normalize `/js/app.js` as Alpine composition root
5. **Tests** → Add/adjust Puppeteer tests for key flows (button → event → notification; cross-panel isolation).
6. **Docs** → Update README and MIGRATION.md with new event contracts, removed globals, and developer instructions.

### Output requirements

* Always follow AGENTS.md rules (do not restate them, do not invent new ones).
* Output a **PLAN.md** first, then refactor step-by-step.
* Only modify necessary files.
* Descriptive identifiers, no single-letter names.
* End with a short summary of changed files and new event contracts.

**Begin by reading AGENTS.md and generating PLAN.md now.**

## Rules of engagement

Review the NOTES.md. Make a plan for autonomously fixing every item under Features, BugFixes, Improvements, Maintenance. Ensure no regressions. Ensure adding tests. Lean into integration tests. Fix every issue. Document the changes.

Fix issues one by one. 
1. Create a new git branch with descriptive name
2. Describe an issue through tests. Ensure that the tests are comprehensive and failing to begin with.
3. Fix the issue
4. Rerun the tests
5. Repeat 2-4 untill the issue is fixed and comprehensive tests are passing
6. Write a nice comprehensive commit message AFTER EACH issue is fixed and tested and covered with tests.
7. Optional: update the README in case the changes warrant updated documentation
8. Optional: ipdate the PRD in case the changes warrant updated product requirements
9. Optional: update the code examples in case the changes warrant updated code examples
10. Mark an issue as done ([X])in the NOTES.md after the issue is fixed: New and existing tests are passing without regressions
11. Commit the changes and push to the remote.

Do not work on all issues at once. Work at one issue at a time sequntially.

Leave Features, BugFixes, Improvements, Maintenance sections empty when all fixes are implemented but don't delete the sections themselves.

## Features

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

## Improvements

- [x] [GN-10] When the note is expanded in rendering mode do not move the viewpoint to its end. Leave the note staying as is and just exand it to full rendering
- [x] [GN-14] Organize header bar buttons into a stackable menu. The stackable menu shall be under the user avatar. The user avatar is shown in a circle, which gains white outline on hover. On a click it displays the stacked dropdown:
    - Export Notes
    - Import Notes
    - Sign Out
- [x] [GN-20] Allow for Export only of the notes for un-authenticated user. Have an Export button available that downlaods json containing all the notes. Reuse existing functionality.
- [x] [GN-22] Open the note in the place a user clicked on when swithcing from rendered view to editing. That way if a user clicked in the middle of the sentence in the rendered view, the cursor goes to that middle of the sentence in the markdown editing view

## BugFixes

- [x] [GN-13] Remove the button "Sign In with Google" after successfull login
- [x] [GN-15] Remove "Not Signed In" sign when the user is not signed in, and leave only the Sign in with Google button
- [x] [GN-16] Remove "Signed In" sign when the user is signed in
- [x] [GN-17] Remove the button "Sign In with Google" after successfull login
- [x] [GN-21] Rename items in the stacked dropdown after login to:
    - Export -> "Export Notes"
    - Import -> "Import Notes"
- [x] [GN-23] Check if a user presses closing square bracket after [ and avoid duplication. We already do it for other nrackets, bu [ is a special case when we add space closing sqaure bracket space. we shall still verify that thge user doesnt close the brackets and swallow an extra ] if the user does it (covered by inline/enhanced bracket skip tests)


## Maintenance
