# Frontend Test Failure Analysis

**Investigation Date:** 2025-10-29
**Current HEAD:** 673f7b4 (detached)
**Test File:** `frontend/tests/editor.inline.puppeteer.test.js`

## Executive Summary

Six (6) tests are failing in the inline editor test suite. All failures are related to CSS positioning and layout changes introduced for the inline editor search feature (GN-120/GN-315). A fix exists in commit `92a1e7c` but is not currently merged into the working branch.

## Failing Tests

### 1. "double clicking outside inline editor finalizes edit mode"
- **Error:** Timeout waiting for `.editing-in-place` class to be removed
- **Timeout Duration:** 4000ms exceeded
- **Location:** `editor.inline.puppeteer.test.js:240`

### 2. "inline editor matches htmlView padding and origin"
- **Error:** Editor offset top misalignment
- **Expected:** Editor offset top ≈ htmlView offset top (within 1.5px)
- **Actual:** Editor offset top = 97.65625px, htmlView offset top = 9.59375px
- **Delta:** ~88px misalignment
- **Location:** `editor.inline.puppeteer.test.js:273`

### 3. "editing cards expand without internal scrollbars"
- **Error:** Waiting timeout exceeded
- **Timeout Duration:** 1000ms
- **Location:** `editor.inline.puppeteer.test.js:510`

### 4. "htmlView click enters edit mode at click point without shifting card upward"
- **Error:** Caret position delta exceeds tolerance
- **Actual Delta:** 10.42px
- **Location:** `editor.inline.puppeteer.test.js:822`

### 5. "card controls exit markdown editing back to rendered htmlView"
- **Error:** Element selector not found
- **Missing Selector:** `.markdown-block[data-note-id="..."] .note-html-view`
- **Location:** `editor.inline.puppeteer.test.js:1040`

### 6. "near-bottom cards stay anchored while editing and after submit"
- **Error:** Card position shift after submission
- **Actual Delta:** 254.56px
- **Location:** `editor.inline.puppeteer.test.js:1086`

## Root Cause Analysis

### Primary Issue: Search Overlay CSS Changes

The inline editor search overlay feature (GN-120) introduced CSS changes that added vertical offset to the CodeMirror editor surface. These changes are present in the current commit (673f7b4) but the stabilization fix is in a newer commit (92a1e7c).

**Problematic CSS (current commit 673f7b4):**
```css
.CodeMirror-lines {
    padding: 0 !important;
    margin-top: var(--editor-search-offset, 0px);
    line-height: 1.35;
    min-height: 2.2rem;
}

.CodeMirror-lines::before {
    content: "";
    display: block;
    height: var(--editor-search-offset, 0px);
}
```

### Impact on Tests

1. **Alignment Tests:** The `margin-top` and `::before` pseudo-element create unexpected vertical space, breaking the expectation that CodeMirror-lines should align with the htmlView content position.

2. **Scrollbar Tests:** The height calculation logic in `lockEditingSurfaceHeight()` doesn't account for the search overlay offset, causing incorrect height constraints.

3. **Click Position Tests:** The additional offset shifts the caret position calculations, causing clicks to land at incorrect vertical positions.

4. **Finalization Tests:** The layout instability may be preventing proper detection of "outside clicks" or blur events.

## Git History Context

```
* 92a1e7c fix(ui): stabilize inline editor search overlay (GN-315)  ← FIX EXISTS HERE
* 9d21d68 docs(issues): log GN-315 inline editor regression
* 673f7b4 fix(ui): finalize control strip interactions (GN-313)     ← CURRENT HEAD (DETACHED)
* 9816e86 fix(ui): anchor htmlView click entry at caret position (GN-312)
* ab2b6ee fix(ui): signal expand strip hover with pointer cursor (GN-311)
* 776fd3b fix(ui): keep expanded htmlView checkbox toggles anchored (GN-310)
* dc1c96a Future development
* 1487dbe Future development
* f9fd4c4 Add inline note search support (GN-120)                   ← FEATURE INTRODUCED HERE
```

The feature was introduced in `f9fd4c4`, regressions were logged in `9d21d68`, and a stabilization fix was applied in `92a1e7c`.

## Changes in Fix Commit (92a1e7c)

The fix commit modifies:
- `frontend/js/ui/card.js` (52 line changes)
- `frontend/js/ui/markdownEditorHost.js` (197 line additions)
- `frontend/styles.css` (48 line changes)
- `frontend/tests/editor.inline.puppeteer.test.js` (4 line changes)

Key changes include:
- Better positioning strategy for the search layer
- Refined CSS transitions and opacity handling
- Updated pointer tracking to ignore search UI elements
- Test adjustments for the control strip target selector

## Relevant Code Locations

### JavaScript
- **Card editing logic:** `frontend/js/ui/card.js:1330-1380` (modechange handler)
- **Height locking:** `frontend/js/ui/card.js:1777-1865` (lockEditingSurfaceHeight)
- **Edit mode entry:** `frontend/js/ui/card.js:1690-1740`
- **Pointer tracking:** `frontend/js/ui/card/pointerTracking.js`

### CSS
- **Mode toggles:** `frontend/styles.css:519-530`
- **CodeMirror styling:** `frontend/styles.css:850-870`
- **Search overlay:** `frontend/styles.css:758-800`

## Recommendations

### Option 1: Merge the Fix (Recommended)
Move HEAD to commit `92a1e7c` which contains the stabilization fix for GN-315:
```bash
git checkout 92a1e7c
```

### Option 2: Cherry-pick the Fix
If staying on the current branch is required:
```bash
git cherry-pick 92a1e7c
```

### Option 3: Understand Why Detached
Investigate why HEAD is detached at 673f7b4 instead of tracking a branch. This may indicate:
- A rebasing operation in progress
- Manual checkout of a specific commit
- CI/CD system checkout strategy

## Testing Strategy

After applying the fix:
1. Run the full test suite: `cd frontend && npm test`
2. Verify all 6 failing tests now pass
3. Check for any new regressions in other test suites
4. Validate the search overlay functionality manually

## Additional Notes

- The codebase follows strict timeout policies (30s for individual operations, 350s for full test suite)
- All test failures are in Puppeteer-driven browser automation tests
- The failures are deterministic and reproducible
- No other test suites show failures (30 tests pass, 6 tests fail)

## Files Referenced

### Production Code
- `frontend/js/ui/card.js`
- `frontend/js/ui/markdownEditorHost.js`
- `frontend/js/ui/card/pointerTracking.js`
- `frontend/styles.css`

### Test Code
- `frontend/tests/editor.inline.puppeteer.test.js`

### Configuration
- `AGENTS.md` - Coding standards and architecture guidelines
- `POLICY.md` - Validation and error handling policies
- `NOTES.md` - Development workflow and task management

---

**Conclusion:** The test failures are not due to broken functionality but rather to an incomplete merge state. The code at commit 92a1e7c contains the necessary fixes to stabilize the inline editor search overlay feature and restore test passing status.
