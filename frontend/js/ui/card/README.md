# Card UI Helpers

The card controller was decomposed into small modules that hide global state and pointer heuristics.

## pointerTracking.js

- Registers global pointer handlers once and records the last pointer target.
- `shouldKeepEditingAfterBlur` keeps inline editing active when focus transitions inside the card.
- `shouldIgnoreCardPointerTarget` guards non-editable surfaces (`.actions`, `.card-controls`, etc.).
- `isPointerWithinInlineEditorSurface` maps DOM lookups to determine whether a pointer target lives inside the markdown editing host.

## cardState.js

- Stores editor hosts, finalize suppression counters, suppression metadata, and pending animation frames per card.
- Consumers must call the exported helpers (`setEditorHost`, `incrementFinalizeSuppression`, `getOrCreatePendingHeightFrames`, …) instead of touching WeakMaps directly.
- `disposeCardState` clears all tracked state when a card is removed from the grid.

## copyFeedback.js

- Tracks clipboard feedback timers keyed by feedback elements so repeated copy events stay debounced.

Tests under `frontend/tests` cover these helpers via Node stubs (`card.state.test.js`, `pointerTracking.test.js`).
