# ISSUES (Append-only Log)

Entries record newly discovered requests or changes, with their outcomes. No instructive content lives here. Read @NOTES.md for the process to follow when fixing issues.

### Features

### Improvements

  - [ ] [GN-70] Use screenshots of the areas that tests run on when in local enviornment. CI environment is defined as an enviornment that has an env var CI=true. Do not save screenshots on CI.
  - [ ] [GN-71] The changes in the notes height must only happen in response to user actions. If a note was clicked on and extended in height, it stays so untill the user clicks and folds the note back in. The note does not auto resizes back when the user clicks or edits another note. Apply the logc to thwe UI: only users actions change the height of the cards containing notes:
    1. Clicking expands the note
    2. Clicking an expanded note returns it to its original height
    3. Doubleclicking switches the note to editing -- markdown
    4. Shift-enter finishes editing
    5. Clicking outside of the note finishes editing 
    6. The height of expanded rendered note and the height of markedown not must be identical. Work on the stling that gurantees that the size of markdown and rendered note are the same.

### BugFixes

  - [ ] [GN-57] There are various issues logged by JS Console. Analyze each, develop a plan to address it and deliver a fix
    ```
    Cookie warnings 2
    The value of the attribute “expires” for the cookie “_ga_WYL7PDVTHN” has been overwritten. localhost:8000
    The value of the attribute “expires” for the cookie “_ga_WYL7PDVTHN” has been overwritten. localhost:8000
    Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:270:37
    Feature Policy: Skipping unsupported feature name “identity-credentials-get”. client:271:336
    GET
    https://accounts.google.com/gsi/button?theme=outline&size=small&shape=pill&text=signin_with&is_fedcm_supported=false&client_id=156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com&iframe_id=gsi_797939_130691&cas=itY6hAE+jQe797Ft4XPD4xNL9LIm9tlWDUgVDynSwmo
    [HTTP/3 403  75ms]

    XHRGET
    https://accounts.google.com/gsi/status?client_id=156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com&cas=itY6hAE+jQe797Ft4XPD4xNL9LIm9tlWDUgVDynSwmo&is_itp=true
    [HTTP/3 403  76ms]

    Content-Security-Policy warnings 5
    Content-Security-Policy: Ignoring “'unsafe-inline'” within script-src: ‘strict-dynamic’ specified button
    Content-Security-Policy: Ignoring “https:” within script-src: ‘strict-dynamic’ specified button
    Content-Security-Policy: Ignoring “http:” within script-src: ‘strict-dynamic’ specified button
    Content-Security-Policy: Ignoring “'unsafe-inline'” within script-src: nonce-source or hash-source specified button
    Content-Security-Policy: Couldn’t process unknown directive ‘require-trusted-types-for’ button
    [GSI_LOGGER]: The given origin is not allowed for the given client ID. client:74:89
    [GSI_LOGGER]: The given origin is not allowed for the given client ID. m=credential_button_library:74:89
    ```

  - [ ] [GN-59] Double-clicking opens a wrong note. Adjust the code to 
    1. identify the card that was clicked on 
    2. identify the position in the rendered card that the click as made 
    3. find the closest word or character to the clicking point in this card 
    4. open markdown editing and place the cursor on the identified position
  
  - [ ] [GN-67] Editing starts in a very different position than rendered HTML. Work on aligning these positions so that markdown and rendered HTML would be in the same places visually

### Maintenance

  - [ ] [GN-60] Code refactoring: we have screenshots, we have HTML view and we have markdown view. Use this rough taxonomy and revise the code to ensure there is no word previewe mentioned anywhere in the code. While working on it ensure that the code flow doesnt assume previewes, storing previews in the DOM, cahcing previewes or doing any operation wich pre-calculate views. Simplify the code where possible. Remember to rely on [marked.js](marked.js.md) and [MD](MDE.v2.19.0.md)

  - [ ] [GN-61] Document the code flow when each card calls createHTMLView when it's loaded into view and deleteHTMLView when it's unloaded from the view or is getting edited  


### Planning (do not work on these, not ready)

- [ ] [GN-55] The current llm-proxy URL is wrong -- there is no such path as https://llm-proxy.mprlab.com/v1/gravity/
  classify. There is only https://llm-proxy.mprlab.com/, and we need to be sending a system prompt to it to get classification. I have copied llm-proxy codebase under the tools folder. Prepare a system prompt for classification of the notes and send it to llm-proxy service. 

