# ISSUES (Append-only Log)

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here. Read @NOTES.md for the process to follow when fixing issues.

## Features

## Improvements

## BugFixes (110)

## Maintenance

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
