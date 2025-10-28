# ISSUES (Append-only Log)

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here. Read @NOTES.md for the process to follow when fixing issues.

## Features (120–199)

- [ ] [GN-120] Search in a note: have a shortcut and render a search filed in the right top corner of the text editing area. Check with MDE if built in tools can be leveraged
- [ ] [GN-121] Search across notes. Use Cntr + Space to display a search dialog. The search works as a gravity point that pushes the irrelevant notes down and raises the relevant notes up. The search dialog is situated in the footer. The gravity point disappears when the search dialog is closed

## Improvements (200–299)

- [x] [GN-200] Change the double chevron sign to an "arrow down in a circle", the way it is in ChatGPT.  to fold in the same arrow in a circle but pointing up
  - Replaced the expand toggle with an SVG circle-arrow icon, aligned the CSS/README copy, and added Puppeteer coverage that confirms the icon structure and rotation.
- [x] [GN-201] Ensure it works for the area where the sign is, so a rectangular area of the card limited by the height of the sign, not just the imidiate sign  
  - Broadened the expand toggle button to cover the full bottom strip and added a Puppeteer check that an off-center click still expands the htmlView.
- [x] [GN-202] Treat a doubleclick, a tap and a click the same:
  - enters editing mode on a card
  - finishes editing mode outside the text area
  - Added Puppeteer coverage for double-click, tap, and outside blur interactions to confirm inline editing transitions remain consistent.
- [x] [GN-203] Change the responsive mobile design to keep note control above the note on small screens
  - Updated the mobile grid to stack `.card-controls` above the content column and added regression coverage to verify the layout on narrow viewports.
- [ ] [GN-204] Add an ability for an app to run in full-screen mode. Have an icon in the header that switches the app in and out of the full screen mode. use a diagonal line with aroows at the end to indicate expansion to the full screen and a diagonal line with "chicken paws" at the end to indicate the contraction
- [ ] [GN-205] Have built-in browser grammar check work. There is no grammar check working in the markdown mode now, and there should be.
- [ ] [GN-206] Develop a system that reloads all JS/HTML when a new version is released. Today, we are hosted on GitHub and the new version is probably the new code. Find a way to detect when the code changed and reload it in a browser with an ovlder version of code.


## BugFixes (300–399)

- [x] [GN-300] Typing is sometimes blocked (can't type) or paste.  Unsure of the use case, seems haphazard. Review the code to see if you can find the potential cause
  - Resolved by preserving in-progress inline edits during note re-renders and adding regression coverage for the snapshot flow (`frontend/js/app.js`, `frontend/tests/editor.inline.puppeteer.test.js`).
- [x] [GN-302] A large space is left under the markdown notes from time to time. Ensure we are aware of the real height of the note and can measure the height needed. Check with MDE if the editor we use exposes an ability to measure the text's height
  - Eliminated delayed height reapplication and added regression coverage so cards release their edit lock without leaving empty gaps (`frontend/js/ui/card.js`, `frontend/tests/editor.inline.puppeteer.test.js`).
- [x] [GN-303] The synchronization doesn't refresh. I just added a note on another device then logged in a computer where a session was already running and got no note there. When I opened the console I saw a lof of message about expired authentication. We shall look into how do we keep the account logged in.
  - Refreshes backend tokens automatically when sync detects expiration, persists the updated credentials, and reconnects realtime streaming so cross-device edits land immediately.
- [x] [GN-304] Clicking on a note starts it for editing (expected behavior) and places the cursor in the right place but it yanks the note to the top (unexpected behavior).
  - Centered inline edit entry and suppressed htmlView scroll restoration so cards stay in view, plus updated regression coverage to keep cards comfortable on finalize.
	- Solutions:
		- Center the whole scroll around the active card. Introduce a notion of a card being active, if not already. Consider active being last selected, e.g. the card stays immobile but the feed around it moves. So a card that finished editing doesnt move but all other cards moved underneath it. 
    - Effectively clicking on a card freezes it on the screen after moving it to the vewport. So if I click on a large renderedHTML view, I expect to get the rendered markdown view with the cursor in the place of my click, and no movement as the point of click was clearly in the view when I clicked on it
- [x] [GN-305] I can still see scrollers ![scroller screenshot](scroller.png). There should be no scrollers.
  - Hid browser-native scrollbars by suppressing the root scrollbar pseudo element on `html`/`body` and added regression coverage guaranteeing the viewport stays scrollable without rendering scrollbar chrome.
- [ ] [GN-306] The notes duplicate when I click on a checkmark in renderedHTML view. I have used Safari on iPad. Have test to confirm and prepare a fix
- [ ] [GN-307] Center the expand/fold in signs along the full width of the card, not just the text part.
- [ ] [GN-308] Clicking on the control part of the note flickers the renderHTML view instead of switching to it. I expect a click outside of currently edited note to switch it to renderedHTML. The outside area includes the control area. It currently switches briefly and then goes back to markdown.

## Maintenance (400–499)

## Planning (do not work on these, not ready)

- [ ] [GN-55] The current llm-proxy URL is wrong -- there is no such path as https://llm-proxy.mprlab.com/v1/gravity/
  classify. There is only https://llm-proxy.mprlab.com/, and we need to be sending a system prompt to it to get classification. I have copied llm-proxy codebase under the tools folder. Prepare a system prompt for classification of the notes and send it to llm-proxy service. 

- [ ] [GN-80] [P2] There are various issues logged by JS Console when working from localhost. The errors are from a browser console when everything is served through http. Analyze each, develop a plan to address it. I am unsure what configuration changes are required.
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
