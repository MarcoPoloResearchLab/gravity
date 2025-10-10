# Gravity Notes

Gravity Notes is a simple, single-page web application for taking notes using Markdown. Notes surface in a stable grid
with bounded previews, and every note edits inline—no modal overlays or context switches.

## Features

* **Bounded previews:** Each card renders the first two paragraphs (or ~450 characters), the first image as a cover
  thumbnail, and a six-line preview of the first code block. A fade mask signals truncated content.
* **Code badge:** Notes that contain code display a `code` pill so technical snippets stand out at a glance.
* **Interactive checklists:** Click rendered task checkboxes to flip their state without entering edit mode; updates
  persist immediately and bubble that note to the top.
* **Inline editor:** Click any card—or the blank capture slot at the top—to switch that note into Markdown mode in
  place. The textarea auto-grows with your prose, accepts `Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` to commit, and supports
  `Tab`/`Shift+Tab` indentation for lists and code blocks.
* **Always-ready capture:** The sticky blank note beneath the header is the entry point for brand new ideas. Type there,
  click away, or hit `Cmd/Ctrl+Enter` to persist immediately.
* **Rich Markdown:** Markdown rendering is powered by [marked.js](https://marked.js.org/) with sanitisation from
  [DOMPurify](https://github.com/cure53/DOMPurify). Inline image pasting is preserved through attachment placeholders.
* **Organise & share:** Notes retain the existing move, merge, copy, and classification behaviours, and you can import
  or export notebooks as JSON snapshots without introducing duplicates.
* **Account-aware storage:** Sign in with Google (or continue anonymously) from the header controls. Each authenticated
  Google account receives an isolated notebook persisted in `localStorage`, so coworkers sharing a browser never see one
  another's notes.

## How to Use

1. **Capture a note:** Place the cursor in the blank card anchored beneath the header and start writing Markdown. The
   editor auto-grows as you type and never introduces inner scrollbars.
2. **Autosave everywhere:** Gravity persists changes whenever you click away or press `Cmd/Ctrl+Enter`. A subtle “Saved”
   toast confirms each sync—no manual save button required.
3. **Keyboard shortcuts:**
    * `Enter` inserts a newline (no implicit submission).
    * `Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` commit changes immediately.
    * `Tab` / `Shift+Tab` indent or outdent the current selection, making lists and code blocks easy to adjust.
    * `Cmd/Ctrl+Shift+K` deletes the current line; `Cmd/Ctrl+Shift+D` duplicates it in place.
4. **Edit existing notes:** Click anywhere in a rendered note to switch it into Markdown mode inline. The grid stays in
   place while you edit, then re-renders the preview once you finish.
5. **Skim with previews:** Each card shows a deterministic snippet and fade mask; notes with code call it out with a
   `code` badge, and overflowing notes expose a rotated double-chevron toggle to expand the full preview in place.
6. **Organise:** Reorder, merge, or delete notes with the familiar toolbar actions along the right edge. The copy button
   still mirrors either Markdown or sanitized HTML (including attachment metadata) depending on the current mode.
7. **Import / Export:** Use the header buttons to move notebooks between browsers. Imports skip records that match on
   identifier and content, preserving the single source of truth.
8. **Toggle identity:** Use the profile controls in the header to sign in with Google Identity Services. Once signed in,
   Gravity swaps to a user-specific storage namespace. Signing out returns to the anonymous notebook without blending
   data between identities.

## Authentication Flow

- Gravity Notes loads Google Identity Services directly from the official CDN (`https://accounts.google.com/gsi/client`).
- `js/app.js` wires the sign-in button through `createGoogleIdentityController` and listens for `gravity:auth-sign-in`
  / `gravity:auth-sign-out` events to refresh the notebook in-place.
- `GravityStore.setUserScope(userId)` switches the `localStorage` key to `gravityNotesData:user:<encodedUserId>`, keeping
  the anonymous notebook (`gravityNotesData`) intact.
- The UI surfaces the active user's avatar, name, and a sign-out affordance while hiding the Google button—no manual
  page reload is required to change accounts.

## Architecture

* **Alpine composition root:** `index.html` boots `gravityApp()` from `js/app.js`, wiring the shared stores, event
  bridges, and static copy in one place.
* **Event pipeline:** UI modules dispatch DOM-scoped custom events
  (`gravity:note-create`, `gravity:note-update`, `gravity:note-delete`, `gravity:note-pin-toggle`,
  `gravity:notes-imported`, `gravity:notify`, `gravity:auth-sign-in`, `gravity:auth-sign-out`, `gravity:auth-error`) so
  the root component can persist through `GravityStore`, update the auth controls, and schedule re-renders.
* **Module boundaries:** `ui/` focuses on DOM work, `core/` wraps domain services, and `utils/` exposes shared
  helpers. All user-facing strings live in `js/constants.js` to keep copy consistent.
* **Toast notifications:** Non-blocking feedback flows through `gravity:notify` instead of `alert()`, keeping the UI
  accessible and aligned with the design system.

## Editor & Preview

- **Deterministic preview:** Cards render the full sanitized Markdown and clamp at roughly `18vh`. Shorter notes shrink
  to their natural height, while longer ones fade out gracefully.
- **Fade mask:** A gradient mask is layered over the last few pixels of the preview to avoid sudden cut-offs while
  keeping the card height capped at roughly `18vh` when content overflows.
- **Dynamic height:** Cards shrink to match their rendered content and grow only up to the shared `18vh` limit, so short
  notes stay compact while longer ones fade out.
- **Expandable overflow:** Overflowing notes get a rotated `»` toggle at the bottom border—click to expand the rendered
  preview downward, click again (or edit any note) to collapse.
- **Code indicator:** A `code` badge appears when a note includes inline or fenced code so heavy snippets are easy to
  spot without opening the editor.
- **Autosave:** Inline edits flush on blur or `Cmd/Ctrl+Enter` and surface a non-blocking “Saved” toast. Shortcuts still
  work for explicit saves, but no manual button is required.

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

- `npm test` drives the Node test suite, including Puppeteer coverage for the inline editor, bounded previews, and
  the notification flow.
- `tests/preview.bounded.puppeteer.test.js` now guards the viewport anchoring behaviour—expanding a rendered note keeps
  the card in place even if the browser attempts to scroll to the bottom of the preview.
- Run `npx puppeteer browsers install chrome` once to download the Chromium binary that Puppeteer uses during the
  end-to-end tests.
- GitHub Actions executes the same test command on every push and pull request, validating the inline editing workflow and
  preview truncation remain stable.

## Dependencies

* **marked.js** — rendered via `https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js`.
* **DOMPurify** — sanitiser loaded from `https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js`.
* **EasyMDE** — Markdown editor UI delivered through `https://cdn.jsdelivr.net/npm/easymde@2.19.1/dist/easymde.min.js` and its companion stylesheet.
* **Google Identity Services** — the sign-in client loads from `https://accounts.google.com/gsi/client` and uses the
  `156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com` client ID baked into `appConfig`.

## Markdown Editor

* Enable or disable the EasyMDE experience via the `appConfig.useMarkdownEditor` flag in `config.js` — set it to `false` to fall back to the legacy `<textarea>` editors.
* Clipboard and drag-and-drop image handling remains routed through `insertAttachmentPlaceholders` in `ui/imagePaste.js`, ensuring all storage logic and attachment sanitisation are unchanged.
* CDN assets for the editor live exclusively in `index.html`; no build tooling or bundlers are required.

## License

Gravity Notes is released under the [MIT License](LICENSE).
