# Gravity Notes

Gravity Notes is a simple, single-page web application for taking notes using Markdown. It features a unique "gravity"
model where the currently active note always stays at the top for easy editing, and new notes are added above finalized
ones.

## Features

* **Markdown Support:** Write notes using standard Markdown syntax.
* **Live Preview:** See your formatted Markdown as you type (powered by [marked.js](https://marked.js.org/)).
* **Active Note Focus:** The top note is always the active editing area. New notes start here.
* **Automatic Note Creation:** Pressing `Enter` (without `Shift`) or clicking away from a non-empty active note
  finalizes it and creates a new empty active note above it. Empty active notes remain active.
* **Easy Navigation:** Click any passive (non-top) note's content area to make it the active note, moving it to the top
  and entering edit mode.
* **Note Reordering:** Move passive notes up or down relative to other passive notes using the `▲` (Up) and `▼` (Down)
  buttons. You cannot move a note above the currently active note.
* **Clipboard-Friendly Copy:** The copy control mirrors the current note state, returning Markdown or sanitized HTML and
  preserving any pasted images via metadata so they can be restored on paste.
* **Note Merging:**
    * Merge a passive note *down* into the note immediately below it using the `Merge ↓` button (available on all
      passive notes except the bottom one).
    * Merge the *bottom-most* note *up* into the active (top) note using the `Merge ↑` button (only available on the
      bottom note when there are at least two notes).
* **Image Pasting:** Paste images directly from your clipboard into the editor. Notes keep readable placeholders such as
  `![[pasted-image-*.png]]` while the rendered preview displays the actual image data.
* **Auto-Resizing Editor:** The text area automatically adjusts its height to fit the content as you type.
* **Session-Based:** Notes exist only within the current browser session. Reloading the page will clear all notes.
* **Import & Export:** Download all saved notes as JSON and import them in another browser without creating duplicates.

## How to Use

1. **Start Typing:** You begin with a single, empty note at the top in edit mode. Start typing your notes using Markdown
   syntax.
2. **Create New Note:** When you're done with the current note:
    * Press `Enter` (without holding `Shift`).
    * Or, click outside the editing area (blur the textarea).
    * If the note wasn't empty, it will be finalized (displaying the rendered Markdown), and a new empty note will
      appear above it, ready for editing. If the note was empty, it remains the active note.
3. **Edit Existing Notes:** Click on the content area of any note below the top one. It will instantly move to the top
   and become the active note in edit mode.
4. **Export Notes:** Click **Export** in the header to download a `gravity-notes.json` file containing every saved note.
5. **Import Notes:** Click **Import** and choose a Gravity Notes JSON export to append non-duplicate notes from another browser.
   The import ignores records whose `noteId`, Markdown content, attachments, and classification all match an existing note.
6. **Move Notes:** Use the `▲` and `▼` buttons on passive notes to change their order relative to other passive notes.
7. **Merge Notes:**
    * To combine a note with the one below it, click the `Merge ↓` button on that note. Its content will be appended to
      the note below it, separated by newlines.
    * To combine the very last note with the currently active (top) note, click the `Merge ↑` button on the last note.
      Its content will be appended to the active note's content, separated by newlines, and the active note will remain
      focused.
8. **Paste Images:** Copy an image to your clipboard and paste (`Ctrl+V` or `Cmd+V`) directly into the editor textarea.
   The image will be inserted as Markdown `![pasted image](data:...)`.

## Setup

No installation is required to view the app—open `index.html` in any modern browser. For development and testing, install
the Node tooling:

```shell
npm install
```

### Local Environment

```shell
python3 -m http.server 8000
```

## Testing

- `npm test` runs the Node test suite, including the Puppeteer-based clipboard integration specs.
- Run `npx puppeteer browsers install chrome` once to download the Chromium binary that Puppeteer drives in tests.
- GitHub Actions executes the same test command on every push and pull request, ensuring clipboard behaviour stays
  stable.

## Dependencies

* **marked.js** — rendered via `https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js`.
* **DOMPurify** — sanitiser loaded from `https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js`.
* **EasyMDE** — Markdown editor UI delivered through `https://cdn.jsdelivr.net/npm/easymde@2.19.1/dist/easymde.min.js` and its companion stylesheet.

## Markdown Editor

* Enable or disable the EasyMDE experience via the `appConfig.useMarkdownEditor` flag in `config.js` — set it to `false` to fall back to the legacy `<textarea>` editors.
* Clipboard and drag-and-drop image handling remains routed through `insertAttachmentPlaceholders` in `ui/imagePaste.js`, ensuring all storage logic and attachment sanitisation are unchanged.
* CDN assets for the editor live exclusively in `index.html`; no build tooling or bundlers are required.

## License

Gravity Notes is released under the [MIT License](LICENSE).
