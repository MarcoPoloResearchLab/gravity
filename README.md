# Gravity Notes

Gravity Notes is a simple, single-page web application for taking notes using Markdown. Notes surface in a stable grid
with bounded previews, and a full-screen Markdown overlay handles all editing and creation.

## Features

* **Bounded previews:** Each card renders the first two paragraphs (or ~450 characters), the first image as a cover
  thumbnail, and a six-line preview of the first code block. A fade mask signals truncated content.
* **Preview badges:** Every note advertises its word count, total inline images, and whether code is present, making it
  easy to skim dense boards.
* **Overlay editor:** Editing always happens inside a fixed overlay that locks the background, auto-grows to match the
  note content, and supports keyboard shortcuts (`Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` to save, `Esc` to close with a
  confirmation when dirty, `Tab`/`Shift+Tab` to indent/outdent).
* **New-note workflow:** Use the “New note” button in the sticky header to start a fresh entry inside the same overlay.
* **Rich Markdown:** Markdown rendering is powered by [marked.js](https://marked.js.org/) with sanitisation from
  [DOMPurify](https://github.com/cure53/DOMPurify). Inline image pasting is preserved through attachment placeholders.
* **Organise & share:** Notes retain the existing move, merge, copy, and classification behaviours, and you can import
  or export notebooks as JSON snapshots without introducing duplicates.

## How to Use

1. **Create a note:** Tap the empty “new note” card pinned beneath the header. The full-screen overlay opens immediately;
   start typing with standard Markdown syntax. The editor auto-grows as you type and never adds inner scrollbars.
2. **Autosave everywhere:** Gravity persists changes automatically while you type. A subtle “Saved” toast confirms each
   sync—no manual save button required.
3. **Keyboard shortcuts:**
    * `Enter` inserts a newline (no implicit submission).
    * `Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` still trigger an on-demand sync if you want immediate confirmation.
    * `Esc` closes the overlay; any pending changes are flushed before the overlay dismisses.
    * `Tab` / `Shift+Tab` indents or outdents the selected block, making lists and code blocks easy to adjust.
4. **Edit existing notes:** Click anywhere in a note to drop straight into the overlay editor. The grid remains frozen in
   place—the background never jumps while you edit.
5. **Preview in context:** Use the **Expand** control on a card to open a rendered, read-only view. From there, choose
   **Edit** to switch into the Markdown overlay.
6. **Skim with previews:** Each card shows a deterministic snippet, fade mask, and badges for total words, image count,
   and whether code appears. Scroll the main page instead of individual cards.
7. **Organise:** Reorder, merge, or delete notes with the familiar toolbar actions along the right edge. The copy button
   still mirrors either Markdown or sanitized HTML (including attachment metadata) depending on the current mode.
8. **Import / Export:** Use the header buttons to move notebooks between browsers. Imports skip records that match on
   identifier and content, preserving the single source of truth.

## Editor & Preview

- **Deterministic preview:** Cards render the first two paragraphs (or the first ~450 characters), the first inline image
  as a cover thumbnail, and up to six lines of the earliest fenced code block. A `_…continues_` marker appears when the
  source is truncated.
- **Fade mask:** A gradient mask is layered over the last few pixels of the preview to avoid sudden cut-offs while
  keeping the card height capped at roughly `18vh` when content overflows.
- **Dynamic height:** Cards shrink to match their rendered content and grow only up to the shared `18vh` limit, so short
  notes stay compact while longer ones fade out.
- **Metadata badges:** Each card surface lists the note’s word count, total inline images, and whether code is present so
  you can judge complexity at a glance.
- **Autosave:** The overlay syncs changes automatically and surfaces a non-blocking “Saved” toast. Shortcuts still work
  for explicit saves, but no manual button is required.

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

- `npm test` drives the Node test suite, including Puppeteer coverage for the overlay editor and bounded preview rules.
- Run `npx puppeteer browsers install chrome` once to download the Chromium binary that Puppeteer uses during the
  end-to-end tests.
- GitHub Actions executes the same test command on every push and pull request, validating the overlay workflow and
  preview truncation remain stable.

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
