# Migration Notes

## Event-Driven Composition

Gravity Notes now boots through the Alpine composition root defined in `js/app.js`. The root listens for the following
DOM-scoped events and persists note data via `GravityStore`:

| Event | Detail payload | Purpose |
| --- | --- | --- |
| `gravity:note-create` | `{ record, storeUpdated, shouldRender }` | Upsert new note records and re-render when dispatched by the top editor. |
| `gravity:note-update` | `{ record, noteId, storeUpdated, shouldRender }` | Persist inline edits, merges, and reorder side effects emitted from card components. |
| `gravity:note-delete` | `{ noteId, storeUpdated, shouldRender }` | Remove notes that were cleared or merged away. |
| `gravity:note-pin-toggle` | `{ noteId, storeUpdated, shouldRender }` | Keep a single pinned note while the DOM reorders locally. |
| `gravity:notes-imported` | `{ records, storeUpdated, shouldRender }` | Rehydrate the UI after JSON imports append unique records. |
| `gravity:notify` | `{ message, durationMs }` | Surface toast notifications without blocking dialogs. |

`storeUpdated` identifies whether the origin component already synchronised storage (e.g., card merges call
`syncStoreFromDom`). `shouldRender` lets card-level flows opt-out of full list re-renders when they already reconciled
the DOM.

## UI Module Guidelines

* `js/ui/topEditor.js` no longer writes to `GravityStore`; it dispatches `gravity:note-create` after composing a record.
* `js/ui/card.js` emits `gravity:note-update` / `gravity:note-delete` / `gravity:note-pin-toggle` instead of mutating the
  store directly. Card helpers pass overrides to `syncStoreFromDom` so timestamps stay accurate during inline edits.
* `js/ui/importExport.js` replaces `alert()` with `gravity:notify` events and raises `gravity:notes-imported` whenever a
  JSON payload appends notes.
* Toast feedback is centralised in `js/app.js` through `showSaveFeedback`, ensuring a single toast element handles all
  notification copy.

## Testing Expectations

Puppeteer coverage now includes `tests/app.notifications.puppeteer.test.js` to confirm the import error path emits a
`gravity:notify` toast. Run `npm test` after modifying any event contract to maintain parity with the automation suite.
