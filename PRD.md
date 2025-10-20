# PRD – Gravity Notes Editor

## Overview
Gravity Notes must provide a Markdown-only editor with stable previews, inline editing, and a no-jump UX. This PRD defines the product behavior, UX principles, and technical constraints.

## Goals
- Markdown is the sole editing mode. No separate quick-capture UI; capture occurs inline via the first blank note.
- Grid remains visually stable; no layout jumps.
- Previews are bounded but meaningful.
- Inline editing must be lightweight and accessible (no modal overlays).

## Requirements

### 1. View Mode (Grid Preview)
- [x] Render the full note content with sanitised Markdown
  - [x] Cards clamp at ≈18vh with a fade mask; shorter content shrinks naturally
  - [x] No inner scrollbars inside cards
- [x] Inline media respects Markdown order; images display from the top of the rendered content
- [x] Surface a badge when code is present in the note body
- [x] Overflowing previews expose a downward expand control that grows the card without shifting the surrounding layout
  - [x] Control remains hidden for previews that fit within the bounded viewport
  - [x] Click target stays accessible without covering adjacent notes and remains visible after edits or refreshes when content still overflows
- [x] Clicking rendered checklist items toggles their Markdown state and persists immediately
- [x] Grid never reflows after render
- [x] First note renders as an empty shell ready for immediate editing (no iconography)

### 2. Inline Editing
- [x] Clicking any note (including the first blank note) switches it into Markdown edit mode inline
- [x] While editing, the note expands to fit the full content with an auto-growing textarea
- [x] Caret moves to the end of the note when entering edit mode
- [x] Cmd/Ctrl+Enter finalises edits; clicking away (blur) also finalises and returns to rendered view
- [x] No modal dialogs or overlays are used for editing

### 3. Editor Behavior
- [x] Edits autosave on blur or Cmd/Ctrl+Enter; no explicit Save button is shown
- [x] Enter inserts a newline (no mode switching)
- [x] Cmd/Ctrl+S maps to the same save behavior as Cmd/Ctrl+Enter
- [x] Tab / Shift+Tab indent / outdent lists and code
- [x] Autosave completion surfaces a non-modal “Saved” toast without moving focus

### 4. UX Principles
- No jumping or reflow in view mode or editor.
- Previews always meaningful (structured truncation, not blind crop).
- Accessibility: consistent keyboard shortcuts, ARIA live region for save status.
- Desktop and mobile consistent: Enter inserts a newline; commits occur on blur or explicit commit chord; no Save button.

## Non-Goals
- No separate quick-capture UI (no modal or distinct capture widget).
- No in-card scrolling.
- No legacy save buttons inside cards.

## Success Criteria
- Users can skim notes without grid instability.
- Users can edit long Markdown comfortably without layout disruption.
- Keyboard shortcuts consistent across devices.
