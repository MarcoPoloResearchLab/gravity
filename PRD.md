# PRD – Gravity Notes Editor

## Overview
Gravity Notes must provide a Markdown-only editor with stable previews and a no-jump UX. This PRD defines the product behavior, UX principles, and technical constraints.

## Goals
- Markdown is the sole editing mode (no quick capture).
- Grid remains visually stable; no layout jumps.
- Previews are bounded but meaningful.
- Full editor is distraction-free and accessible.

## Requirements

### 1. View Mode (Grid Preview)
- [x] Render deterministic preview subset
  - [x] First 2 paragraphs or ~450 chars
  - [x] Honor inline media only when it appears inside the previewed range
  - [x] First 6 lines of code blocks
- [x] Cards shrink to natural height and fade once content exceeds ≈18vh
- [x] No inner scrollbars inside cards
- [x] Show badges for word count, image count, code presence
- [x] Expand button → open full editor overlay
- [x] Grid never reflows after render

### 2. Editor Overlay
- [x] Always full Markdown editor (no lightweight capture)
- [x] Overlay is fixed, modal; background frozen
- [x] Long notes scroll inside overlay only
- [x] Textarea auto-grows to scrollHeight; no inner scrollbars

### 3. Editor Behavior
- [x] Edits autosave continuously; no explicit Save button is shown
- [x] Enter → newline
- [x] Cmd/Ctrl+Enter or Cmd/Ctrl+S → optional manual sync (no UI affordance required)
- [x] Esc → close overlay (pending changes flush before dismiss)
- [x] Tab / Shift+Tab → indent / outdent lists and code
- [x] Autosave completion surfaces a non-modal “Saved” toast

### 4. UX Principles
- No jumping or reflow in view mode or editor.
- Previews always meaningful (structured truncation, not blind crop).
- Accessibility: consistent keyboard shortcuts, ARIA live region for save status.
- Desktop and mobile consistent: on mobile, Enter always newline, explicit Save button.

## Non-Goals
- No quick capture mode.
- No in-card scrolling.
- No legacy save buttons inside cards.

## Success Criteria
- Users can skim notes without grid instability.
- Users can edit long Markdown comfortably without layout disruption.
- Keyboard shortcuts consistent across devices.
