# Notes

## Rules of engagement

Review the notes.md. make a plan for autonomously fixing every bug. ensure no regressions. ensure adding tests. lean into integration tests. fix every bug.

Fix bugs one by one. Write a nice comprehensive commit message AFTER EACH bug is fixed and tested and covered with tests. Remove the bug from the notes.md. commit and push to the remote.

## BugFixes

### Autocontinuation

there is no more autocintuation of lists or tables. That was in the shared prototype, when lists tables etc were autocntinued e.g. an enter in a numbered or bulletted list will add a new item. have comprehensive tests for mardown editing. The auto-completion is not limited to lists or tables -- brackets, ``` code marks
        etc etc

MDE already has this functionality and we shall lean heavility on MDE rather than implementing it ourselves. See an example provided earlier (consier auto-completion):

```html
// Mode toggle (keep existing bindings to note.markdownText)
function showEditMode() { /* show editor, hide rendered */ }
function showRenderedMode() {
    const html = marked.parse(note.markdownText);
    renderedPane.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    /* show rendered, hide editor */
}

// CodeMirror enter behavior
cm.addKeyMap({
    Enter(cm) {
    const line = cm.getLine(cm.getCursor().line);
    if (isTableRow(line) && !isSeparator(line)) {
    }
    cm.execCommand("newlineAndIndentContinueMarkdownList");
    autoRenumberOrderedList(cm);
    },
    "Shift-Enter"(cm) { cm.replaceSelection("  \n"); }
});

// Smart bullet normalization on input/paste
// Clipboard images (TIFF → PNG)
cm.on("paste", async (_cm, ev) => {
    const files = extractImageFiles(ev.clipboardData.items);
    if (!files.length) return;
    ev.preventDefault();
    for (const file of files) {
    const normalized = isTiff(file) ? await tiffToPng(file) : file;
    const url = await storeImageUsingExistingPath(normalized); // REUSE existing app function
    cm.replaceSelection(`![image](${url})\n`);
    }
});

// Drag & drop images uses the same storage function
```

The coninuation is incorrect.e.g. * list is continued with - list
