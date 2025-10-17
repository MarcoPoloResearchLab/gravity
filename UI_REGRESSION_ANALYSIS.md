# UI Regression Analysis

## Summary

Created comprehensive Puppeteer tests documenting the correct UI styles from commit `574c880` (Oct 10, 2025 - Alpine refactoring merge). All tests pass on the good commit, establishing a baseline for future regression detection.

## Test File

`tests/ui.styles.regression.puppeteer.test.js`

## Documented Baseline Styles (from 574c880)

### 1. Top Editor (#top-editor)
- **Position**: `sticky` at `top: 64px`
- **Z-index**: `8`
- **Background**: `rgb(11, 12, 15)` (#0b0c0f)
- **Border**: `1px solid rgb(32, 35, 43)` (#20232b)
- **Padding**: `0.8rem 1rem` (~12.8px 16px)

### 2. Note Cards (.markdown-block)
- **Display**: `grid`
- **Grid Template**: `1fr 6.25rem` (content | actions columns)
- **Column Gap**: `12px` (0.75rem)
- **Row Gap**: `5.6px` (0.35rem)
- **Border Bottom**: `1px solid #20232b`
- **Padding**: `0.6rem 1rem 0.9rem 1rem`
- **Background**: `rgb(11, 12, 15)` or transparent (for top editor)

### 3. Action Buttons Column (.actions)
- **Grid Column**: `2` (second column)
- **Display**: `flex`
- **Flex Direction**: `column`
- **Gap**: `5.6px` (0.35rem)
- **Visibility**: VISIBLE (not `display: none`)

### 4. Action Buttons (.action-button)
- **Display**: NOT `none` (visible)
- **Border**: `1px solid rgb(40, 49, 74)` (#28314a)
- **Color**: `rgb(122, 162, 255)` (#7aa2ff)
- **Font Size**: `10-14px` range (varies slightly)
- **Opacity**: `0.5`

### 5. Content Elements
- **Grid Column**: `1` (first column)
- Content (.markdown-content, .markdown-editor) placed in grid column 1
- Actions placed in grid column 2

## Test Results

### On Commit 574c880 (Good Baseline)
```
✔ Top Editor (#top-editor) - should have correct sticky positioning and padding
✔ Note Cards (.markdown-block) - should use grid layout with two columns
✔ Action buttons (.actions) - should be in grid column 2 and visible
✔ Action buttons (.action-button) - should have proper styling and be visible
✔ Content elements - should be in grid column 1

ℹ tests 5
ℹ pass 5
ℹ fail 0
```

All tests pass, confirming the baseline is correct.

### On Master Branch
Tests cannot run due to browser launch guard added after 574c880. The guard prevents multiple Puppeteer launches and requires using shared browser harness.

## Key Findings

1. **Grid Layout is Intentional**: The two-column grid layout (content | actions) existed in the good commit and was working correctly.

2. **Action Buttons Were Visible**: The `.action-button` elements had `opacity: 0.5` but were NOT hidden with `display: none`.

3. **Top Editor Had Special Styling**: The `#top-editor` element had specific sticky positioning and padding that made it distinct from regular notes.

4. **HTML Structure Changed**: Between 574c880 and master, the HTML changed from:
   - `.app-controls` with simple buttons
   - To `.app-auth` with complex authentication UI (avatar, menu, profile)

5. **CSS Mismatch Issue**: The restored CSS from 574c880 had `.app-controls` styles but current HTML uses `.app-auth`, causing a mismatch.

## Recommendations

To fix the UI regression:

1. **Option A - Use These Tests**: Update the test to use the shared browser harness (instead of direct launch) so it can run on master

2. **Option B - CSS Audit**: Use the test assertions as a checklist to audit current master CSS against the baseline

3. **Option C - Bisect**: Use `git bisect` between 574c880 and master with this test to find the exact breaking commit

## Files Created

- `tests/ui.styles.regression.puppeteer.test.js` - Baseline style tests
- `UI_REGRESSION_ANALYSIS.md` - This document

## Next Steps

1. Update test to work with shared browser harness on master
2. Run test on master to identify which specific styles regressed
3. Fix the regressed styles to match the 574c880 baseline
