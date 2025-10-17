# UI Regression Analysis - GN-43

## Root Cause Identified

**Commit:** `6526198` - "ui: overlay autosave editor and uniform previews" (Oct 5, 2025)

**Problem:** Invalid CSS syntax at line 494 broke CSS parsing:
```css
body.${OVERLAY_BODY_LOCK_CLASS} ???
```

This template literal was never resolved and caused browsers to stop parsing subsequent CSS rules.

## Impact

When CSS parsing breaks at line 494, all subsequent styles (lines 495-750) are ignored by browsers, including:

1. **Editor toolbar** - Lines 495-544
2. **CodeMirror/EasyMDE styles** - Lines 545-573
3. **Screen reader utilities** - Lines 575-585
4. **Toast notifications** - Lines 587-611
5. **Keyboard shortcuts modal** - Lines 613-721
6. **Footer** - Lines 723-737
7. **Media queries** - Lines 739-752

This explains the "horrendous UI regressions" - approximately **40% of the stylesheet was being ignored**.

## Symptoms

The broken CSS would cause:
- Giant/unstyled first note (missing editor-specific sizing)
- Different colors (default browser styles instead of theme colors)
- Multicolumn issues (grid layouts not applying correctly)
- Missing overlays and modals
- Broken responsive design

## Fix Applied

**Branch:** `bugfix/GN-43-ui-regression-css-fix`

**Changes:**
1. Removed invalid template literal placeholder (line 494)
2. Added comprehensive CSS validity test suite (`tests/css.validity.test.js`)
3. Tests prevent future template literals, syntax errors, and structural issues

## Verification

The unused placeholder `${OVERLAY_BODY_LOCK_CLASS}` was meant to be `keyboard-shortcuts-open` (already defined at line 720). The JavaScript code uses `keyboard-shortcuts-open` class, confirming the placeholder was leftover development code that should never have been committed.

## Recommendation

**Merge bugfix branch immediately** - This is a critical rendering bug affecting all users.

The fix is minimal, safe, and well-tested:
- Only removes 2 lines of invalid CSS
- Adds 5 comprehensive validation tests
- No functional changes to working code
- Restores proper rendering for all UI components
