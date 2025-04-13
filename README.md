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
* **Note Merging:**
    * Merge a passive note *down* into the note immediately below it using the `Merge ↓` button (available on all
      passive notes except the bottom one).
    * Merge the *bottom-most* note *up* into the active (top) note using the `Merge ↑` button (only available on the
      bottom note when there are at least two notes).
* **Image Pasting:** Paste images directly from your clipboard into the editor. They are converted to base64 data URLs
  and embedded in the Markdown.
* **Auto-Resizing Editor:** The text area automatically adjusts its height to fit the content as you type.
* **Session-Based:** Notes exist only within the current browser session. Reloading the page will clear all notes.

## How to Use

1. **Open:** Download the `[your_file_name].html` file (replace `[your_file_name]` with the actual file name) and open
   it in your web browser.
2. **Start Typing:** You begin with a single, empty note at the top in edit mode. Start typing your notes using Markdown
   syntax.
3. **Create New Note:** When you're done with the current note:
    * Press `Enter` (without holding `Shift`).
    * Or, click outside the editing area (blur the textarea).
    * If the note wasn't empty, it will be finalized (displaying the rendered Markdown), and a new empty note will
      appear above it, ready for editing. If the note was empty, it remains the active note.
4. **Edit Existing Notes:** Click on the content area of any note below the top one. It will instantly move to the top
   and become the active note in edit mode.
5. **Move Notes:** Use the `▲` and `▼` buttons on passive notes to change their order relative to other passive notes.
6. **Merge Notes:**
    * To combine a note with the one below it, click the `Merge ↓` button on that note. Its content will be appended to
      the note below it, separated by newlines.
    * To combine the very last note with the currently active (top) note, click the `Merge ↑` button on the last note.
      Its content will be appended to the active note's content, separated by newlines, and the active note will remain
      focused.
7. **Paste Images:** Copy an image to your clipboard and paste (`Ctrl+V` or `Cmd+V`) directly into the editor textarea.
   The image will be inserted as Markdown `![pasted image](data:...)`.

## Setup

No installation is required. Simply open the HTML file in a modern web browser that supports the necessary JavaScript
features.

## Dependencies

* **marked.js:** Used for rendering Markdown to HTML. Included via CDN.