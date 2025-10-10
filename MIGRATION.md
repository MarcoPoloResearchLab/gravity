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
| `gravity:auth-sign-in` | `{ user: { id, email, name, pictureUrl }, credential }` | Namespace `GravityStore` to the authenticated user and refresh the notebook. |
| `gravity:auth-sign-out` | `{ reason }` | Return to the anonymous notebook and hide the profile controls. |
| `gravity:auth-error` | `{ reason, error }` | Surface authentication failures via the toast pipeline without crashing the app. |

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
* `js/ui/authControls.js` renders the Google Identity button and profile summary. It dispatches local sign-out requests
  back to the composition root, which forwards them to `createGoogleIdentityController`, and controls visibility of the
  avatar menu wrapper.
* `js/ui/menu/avatarMenu.js` encapsulates the avatar-triggered dropdown, handling outside clicks, keyboard dismissal,
  and focus hand-off for the stacked export / import / sign-out actions.

## Per-User Storage & Authentication

* `GravityStore.setUserScope(userId)` switches the active `localStorage` key to `gravityNotesData:user:<encodedUserId>`.
  Passing `null` resets the scope to the shared anonymous notebook.
* `js/app.js` calls `GravityStore.setUserScope(null)` on boot, then responds to `gravity:auth-sign-in` /
  `gravity:auth-sign-out` events by rehydrating the card grid via `initializeNotes()`.
* Google Identity Services loads from `https://accounts.google.com/gsi/client`; the client ID lives in
  `appConfig.googleClientId` and should be reused across environments.
* The auth controls hide the Google button once a profile is active and expose the stacked avatar menu (export, import,
  sign out). The sign-out item dispatches `gravity:auth-sign-out`.

## Testing Expectations

Puppeteer coverage now includes `tests/app.notifications.puppeteer.test.js` to confirm the import error path emits a
`gravity:notify` toast and `tests/preview.bounded.puppeteer.test.js` to keep the viewport anchored when expanding long
previews. Run `npm test` after modifying any event contract to maintain parity with the automation suite.
