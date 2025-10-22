# ISSUES (Append-only Log)

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here. Read @NOTES.md for the process to follow when fixing issues.

### Features

### Improvements

  - [x] [GN-70] Use screenshots of the areas that tests run on when in local enviornment. CI environment is defined as an enviornment that has an env var CI=true. Do not save screenshots on CI. — Automated local screenshot artifacts per Puppeteer suite with new helper and harness test (branch improvement/GN-70-local-screenshots).
  - [x] [GN-71] The changes in the notes height must only happen in response to user actions. If a note was clicked on and extended in height, it stays so untill the user clicks and folds the note back in. The note does not auto resizes back when the user clicks or edits another note. Apply the logc to thwe UI: only users actions change the height of the cards containing notes: — per-card expansions persist across interactions, editing locks to the expanded footprint, and new Puppeteer coverage guards the flow (branch improvement/GN-71-note-height-behavior).
    1. Clicking expands the note
    2. Clicking an expanded note returns it to its original height
    3. Doubleclicking switches the note to editing -- markdown
    4. Shift-enter finishes editing
    5. Clicking outside of the note finishes editing 
    6. The height of expanded rendered note and the height of markedown note must be identical. Work on the stling that gurantees that the size of markdown and rendered note are the same.
  - [x] [GN-72] Front-end redesign — note cards now use a 2:1 text-to-controls grid, classification badges live in the control column, and the expand indicator aligns to the preview footer with refreshed Puppeteer layout coverage (branch improvement/GN-72-layout).

### BugFixes

  - [ ] [GN-80] There are various issues logged by JS Console. The errors are from a browser console when everything is served through http. Analyze each, develop a plan to address it and deliver a fix. I expect a list of  open PRs , stacked up on top of each other, as a deliverable
    ```
    Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:270:37
    Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:271:336
    GET
    https://accounts.google.com/gsi/button?theme=outline&size=small&shape=pill&text=signin_with&is_fedcm_supported=false&client_id=156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com&iframe_id=gsi_451133_914081&cas=/nrGSe6oSqBoygrIHC3O6DYcFNuiHkz6MfGe2WCWWOY
    [HTTP/2 403  107ms]

    XHRGET
    https://accounts.google.com/gsi/status?client_id=156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com&cas=/nrGSe6oSqBoygrIHC3O6DYcFNuiHkz6MfGe2WCWWOY&is_itp=true
    [HTTP/2 403  103ms]

    Content-Security-Policy warnings 5
    Content-Security-Policy: Ignoring “'unsafe-inline'” within script-src: ‘strict-dynamic’ specified button
    Content-Security-Policy: Ignoring “https:” within script-src: ‘strict-dynamic’ specified button
    Content-Security-Policy: Ignoring “http:” within script-src: ‘strict-dynamic’ specified button
    Content-Security-Policy: Ignoring “'unsafe-inline'” within script-src: nonce-source or hash-source specified button
    Content-Security-Policy: Couldn’t process unknown directive ‘require-trusted-types-for’ button
    [GSI_LOGGER]: The given origin is not allowed for the given client ID. client:74:89
        G https://accounts.google.com/gsi/client:74
        Pg https://accounts.google.com/gsi/client:215
        ba https://accounts.google.com/gsi/client:314
        Jt https://accounts.google.com/gsi/client:332
        Dr https://accounts.google.com/gsi/client:259
        zf https://accounts.google.com/gsi/client:115
        dispatchEvent https://accounts.google.com/gsi/client:114
        lk https://accounts.google.com/gsi/client:163
        pk https://accounts.google.com/gsi/client:166
        me https://accounts.google.com/gsi/client:171
        Xc https://accounts.google.com/gsi/client:171
        (Async: EventHandlerNonNull)
        send https://accounts.google.com/gsi/client:167
        xk https://accounts.google.com/gsi/client:173
        Dr https://accounts.google.com/gsi/client:259
        Jt https://accounts.google.com/gsi/client:332
        ba https://accounts.google.com/gsi/client:314
        ba https://accounts.google.com/gsi/client:348
        us https://accounts.google.com/gsi/client:276
        createGoogleIdentityController http://localhost:8000/js/core/auth.js:111
        (Async: VoidFunction)
        createGoogleIdentityController http://localhost:8000/js/core/auth.js:109
        ensureGoogleIdentityController http://localhost:8000/js/app.js:243
        initializeAuth http://localhost:8000/js/app.js:176
        init http://localhost:8000/js/app.js:99
        generateEvaluatorFromFunction https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:590
        tryCatch https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:541
        evaluate https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:570
        <anonymous> https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:2985
        flushHandlers https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:713
        stopDeferring https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:718
        deferHandlingDirectives https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:721
        initTree https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:204
        start https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:159
        start https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js:158
        bootstrapApplication http://localhost:8000/js/app.js:64
        <anonymous> http://localhost:8000/js/app.js:53
    [GSI_LOGGER]: The given origin is not allowed for the given client ID. m=credential_button_library:74:89
        G https://ssl.gstatic.com/_/gsi/_/js/k=gsi.gsi.en_US.X5DNpFlOsjY.O/am=AAAggLhx/d=1/rs=AF0KOtUvqNNy7mU_1FS76qAaEu2J5KsmpA/m=credential_button_library:74
        Pg https://ssl.gstatic.com/_/gsi/_/js/k=gsi.gsi.en_US.X5DNpFlOsjY.O/am=AAAggLhx/d=1/rs=AF0KOtUvqNNy7mU_1FS76qAaEu2J5KsmpA/m=credential_button_library:142
        <anonymous> https://ssl.gstatic.com/_/gsi/_/js/k=gsi.gsi.en_US.X5DNpFlOsjY.O/am=AAAggLhx/d=1/rs=AF0KOtUvqNNy7mU_1FS76qAaEu2J5KsmpA/m=credential_button_library:307
        <anonymous> https://accounts.google.com/gsi/button?theme=outline&size=small&shape=pill&text=signin_with&is_fedcm_supported=false&client_id=156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com&iframe_id=gsi_451133_914081&cas=/nrGSe6oSqBoygrIHC3O6DYcFNuiHkz6MfGe2WCWWOY:1

    ```
    The google console screenshot is here ![Google console](<Google Console.png>)

  - [ ] [GN-81] Double-clicking opens a wrong note. Adjust the code to 
    1. identify the card that was clicked on 
    2. identify the position in the rendered card that the click as made 
    3. find the closest word or character to the clicking point in this card 
    4. open markdown editing and place the cursor on the identified position
  
  - [ ] [GN-82] Editing starts in a very different position than rendered HTML. Work on aligning these positions so that markdown and rendered HTML would be in the same places visually. Work on [ST-72] prior to this one.

  - [x] [GN-83] Unblocked realtime multi-session sync by instrumenting `EventSource` in the Puppeteer regression, confirming backend note-change broadcasts and Alpine snapshot hydration across tabs (branch bugfix/GN-83-realtime-sync-retry).

  - [ ] [GN-84] ![Card control bug](<card control bug.png>) The card control is not aligned to the top right corner of the cards, as specified in GN-72, in it instead aligned to the bottom right corner of the card. Fix the bug abnd align card controls to the top right corner of the card

  - [ ] [GN-85] Tests are failing on CI (GitHub Actions). Fix the tests
  ```
  go: downloading github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec
  ?   	github.com/MarcoPoloResearchLab/gravity/backend/cmd/gravity-api	[no test files]
  ok  	github.com/MarcoPoloResearchLab/gravity/backend/internal/auth	0.176s
  ?   	github.com/MarcoPoloResearchLab/gravity/backend/internal/config	[no test files]
  ?   	github.com/MarcoPoloResearchLab/gravity/backend/internal/database	[no test files]
  ?   	github.com/MarcoPoloResearchLab/gravity/backend/internal/logging	[no test files]
  ok  	github.com/MarcoPoloResearchLab/gravity/backend/internal/notes	0.009s
  Warning: g] [WARNING] Running in "debug" mode. Switch to "release" mode in production.
  - using env:	export GIN_MODE=release
  - using code:	gin.SetMode(gin.ReleaseMode)

  [GIN-debug] POST   /auth/google              --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleGoogleAuth-fm (3 handlers)
  [GIN-debug] POST   /notes/sync               --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleNotesSync-fm (4 handlers)
  [GIN-debug] GET    /notes                    --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleListNotes-fm (4 handlers)
  [GIN-debug] GET    /notes/stream             --> github.com/MarcoPoloResearchLab/gravity/backend/internal/server.(*httpHandler).handleNotesStream-fm (4 handlers)
  {"level":"info","msg":"realtime stream subscribed","user_id":"user-123"}

  2025/10/22 18:15:14 /home/runner/work/gravity/gravity/backend/internal/notes/service.go:99 record not found
  [0.115ms] [rows:0] SELECT * FROM `notes` WHERE user_id = "user-123" AND note_id = "note-1" LIMIT 1 
  {"level":"info","msg":"broadcasting realtime note change","user_id":"user-123","note_ids":["note-1"]}
  --- FAIL: TestRealtimeStreamEmitsNoteChangeEvents (25.03s)
      realtime_integration_test.go:125: unexpected note identifiers: []string(nil)
  FAIL
  FAIL	github.com/MarcoPoloResearchLab/gravity/backend/internal/server	25.236s
  ok  	github.com/MarcoPoloResearchLab/gravity/backend/tests/integration	0.011s
  FAIL
  Error: Process completed with exit code 1.
  ```

### Maintenance

  - [ ] [GN-90] Code refactoring: we have screenshots, we have HTML view and we have markdown view. Use this rough taxonomy and revise the code to ensure there is no word previewe mentioned anywhere in the code. While working on it ensure that the code flow doesnt assume previewes, storing previews in the DOM, cahcing previewes or doing any operation wich pre-calculate views. Simplify the code where possible. Remember to rely on [marked.js](marked.js.md) and [MD](MDE.v2.19.0.md)

  - [ ] [GN-91] Document the current code flow when each card calls createHTMLView when it's loaded into view and deleteHTMLView when it's unloaded from the view or is getting edited. My understanding may be incorrect -- document the details in @ARCHITECTURE.md to ensure we have an easy guidance on cards rendering in both HTML and Markdown modes.

  - [ ] [GN-92] Restructure the repository so that the /frontend and the /backend are two separate top level folders. Consider changes to GitHub Pages through `gh` utility to continue serving front-end from the github after the change of the front-end index.html path

### Planning (do not work on these, not ready)

- [ ] [GN-55] The current llm-proxy URL is wrong -- there is no such path as https://llm-proxy.mprlab.com/v1/gravity/
  classify. There is only https://llm-proxy.mprlab.com/, and we need to be sending a system prompt to it to get classification. I have copied llm-proxy codebase under the tools folder. Prepare a system prompt for classification of the notes and send it to llm-proxy service. 
