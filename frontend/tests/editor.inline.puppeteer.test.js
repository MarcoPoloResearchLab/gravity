import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const NOTE_ID = "inline-fixture";
const INITIAL_MARKDOWN = `# Inline Fixture\n\nThis note verifies inline editing.`;
const CARET_NOTE_ID = "inline-caret-fixture";
const CARET_MARKDOWN = `First paragraph line one.\nSecond paragraph line two.\nThird line to ensure scrolling.`;
const PREVIEW_CARET_NOTE_ID = "inline-htmlView-caret-fixture";
const PREVIEW_CARET_MARKDOWN = "Alpha **bold** bravo [link](https://example.com) charlie delta.";
const PREVIEW_COMPLEX_NOTE_ID = "inline-htmlView-complex-fixture";
const PREVIEW_COMPLEX_MARKDOWN = [
    "Alpha anchor paragraph lines the htmlView.",
    "Second pass mixes **bold**, `inline code`, and [link targets](https://example.com) for caret mapping.",
    "Third stanza finishes the markdown sample."
].join("\n");
const PREVIEW_LIST_NOTE_ID = "inline-htmlView-list-fixture";
const PREVIEW_LIST_MARKDOWN = [
    "* Alpha baseline list item",
    "* Beta caret mapping check",
    "* Gamma trailing control"
].join("\n");
const UNORDERED_NOTE_ID = "inline-unordered-fixture";
const UNORDERED_MARKDOWN = "* Alpha\n* Beta";
const ORDERED_NOTE_ID = "inline-ordered-fixture";
const ORDERED_MARKDOWN = "1. First\n2. Second";
const ORDERED_RENUMBER_NOTE_ID = "inline-ordered-renumber-fixture";
const ORDERED_RENUMBER_MARKDOWN = "1. Alpha\n2. Bravo\n3. Charlie";
const TABLE_NOTE_ID = "inline-table-fixture";
const TABLE_MARKDOWN = "| Col1 | Col2 |\n| --- | --- |\n| A | B |";
const FENCE_NOTE_ID = "inline-fence-fixture";
const FENCE_MARKDOWN = "```js";
const TASK_NOTE_ID = "inline-task-fixture";
const TASK_MARKDOWN = "- [ ] Pending task\n- [x] Completed task";
const LONG_NOTE_ID = "inline-long-fixture";
const LONG_NOTE_PARAGRAPH_COUNT = 18;
const LONG_NOTE_MARKDOWN = Array.from({ length: LONG_NOTE_PARAGRAPH_COUNT }, (_, index) => `Paragraph ${index + 1} maintains scroll state.`).join("\n\n");
const HEIGHT_RESET_NOTE_ID = "inline-height-reset";
const BRACKET_NOTE_ID = "inline-bracket-fixture";
const BRACKET_MARKDOWN = "Bracket baseline";
const DELETE_LINE_NOTE_ID = "inline-delete-line-fixture";
const DELETE_LINE_MARKDOWN = "Alpha\nBeta";
const NESTED_ORDER_NOTE_ID = "inline-nested-ordered-fixture";
const NESTED_ORDER_MARKDOWN = "1. Alpha\n2. Beta\n3. Gamma";
const PIN_FIRST_NOTE_ID = "inline-pin-first";
const PIN_FIRST_MARKDOWN = "First note to pin.";
const PIN_SECOND_NOTE_ID = "inline-pin-second";
const PIN_SECOND_MARKDOWN = "Second note to pin.";
const FOCUS_SUPPRESSION_NOTE_ID = "inline-focus-suppression";
const FOCUS_SUPPRESSION_MARKDOWN = "Focus suppression baseline.";
const BORDER_NOTE_ID = "inline-border-fixture";
const BORDER_MARKDOWN = "Border baseline.";
const LAYOUT_NOTE_ID = "inline-layout-fixture";
const LAYOUT_MARKDOWN = [
    "# Layout Fixture",
    "",
    "This content ensures the editor aligns with rendered markdown."
].join("\n");
const DIVIDER_NOTE_ID = "inline-divider-fixture";
const DIVIDER_MARKDOWN = [
    "Divider regression baseline content.",
    "",
    "Ensures border styling stays subtle."
].join("\n");
const GN47_NOTE_ID = "inline-caret-layout-fixture";
const GN47_TARGET_TEXT = "Caret anchor landing zone ensures mapping works with links inline.";
const GN47_PADDING_NOTE_ID = "inline-caret-layout-padding";
const GN47_PADDING_MARKDOWN = Array.from({ length: 12 }, (_, index) => `Padding paragraph ${index + 1} keeps the target card below the fold to stress scroll behavior.`).join("\n\n");
const GN47_MARKDOWN = [
    "Introductory paragraph establishes the baseline height before editing.",
    "",
    "Caret anchor **landing zone** ensures mapping works with [links](https://example.com) inline.",
    "",
    "Follow-up paragraph with extended detail so the htmlView truncates before editing takes place, including `inline code` and additional emphasis for measurement.",
    "",
    "Supporting paragraph three elaborates on measurements and ensures the htmlView develops a fade-out overlay in view mode.",
    "",
    "Closing paragraph adds further depth to guarantee the card must grow downward rather than shifting upward."
].join("\n");
const GN48_NOTE_ID = "inline-editing-click-fixture";
const GN48_MARKDOWN = [
    "# Editing Click Fixture",
    "",
    "This note validates that re-clicking an already-editing card keeps the editor in place without flickering back to htmlView.",
    "",
    "The body includes multiple paragraphs so the editor has height and padding beyond the CodeMirror viewport.",
    "",
    "Double clicking different parts of the card should merely reposition the caret."
].join("\n");
const GN81_CURRENT_EDIT_NOTE_ID = "inline-double-click-current-edit";
const GN81_CURRENT_EDIT_MARKDOWN = [
    "# Current Edit Baseline",
    "",
    "This note begins in edit mode so that double-clicking another card must retarget the editor correctly."
].join("\n");
const GN81_TARGET_NOTE_ID = "inline-double-click-target";
const GN81_TARGET_MARKDOWN = [
    "Alpha baseline paragraph anchors the rendered layout before interacting with other cards.",
    "",
    "Bravo line contains the double click anchor substring ensures mapping fidelity for caret placement.",
    "",
    "Charlie passage preserves additional context so the card has multiple paragraphs."
].join("\n");
const GN81_TRAILING_NOTE_ID = "inline-double-click-trailing";
const GN81_TRAILING_MARKDOWN = [
    "Trailing note confirms no other cards gain focus during the regression scenario."
].join("\n");
const GN82_NOTE_ID = "inline-align-html-editor";
const GN82_MARKDOWN = [
    "Alignment baseline paragraph keeps htmlView padding measurable.",
    "",
    "Secondary paragraph verifies vertical spacing while comparing editor offsets."
].join("\n");
const GN105_NOTE_ID = "inline-outside-click-dismiss";
const GN105_MARKDOWN = [
    "# Outside Click Finalizes",
    "",
    "This note verifies that interacting with non-editor surfaces exits markdown mode.",
    "",
    "A trailing paragraph keeps the card tall so clicks can land on surrounding chrome."
].join("\n");
const GN106_INLINE_WRAP_NOTE_ID = "inline-backtick-wrap";
const GN106_INLINE_WRAP_MARKDOWN = "Backtick wrapping baseline text";
const GN106_NESTED_WRAP_NOTE_ID = "inline-backtick-nested";
const GN106_NESTED_WRAP_MARKDOWN = "Nested `inline` snippet baseline";
const GN105_SECOND_NOTE_ID = "inline-outside-click-dismiss-secondary";
const GN105_SECOND_MARKDOWN = [
    "# Outside Click Secondary",
    "",
    "This companion note provides a nearby htmlView to receive the outside pointer interaction.",
    "",
    "Single clicking this card must finalize the first note without requiring an extra pointer press."
].join("\n");
const GN308_NOTE_ID = "inline-control-column-dismiss";
const GN308_MARKDOWN = [
    "# Control Column Finalizes",
    "",
    "This note ensures the control column counts as an outside surface so markdown mode exits cleanly without flickering.",
    "",
    "Additional paragraphs keep the editor tall enough to verify the rendered view persists after the interaction."
].join("\n");
const GN202_DOUBLE_CLICK_NOTE_ID = "inline-gesture-double-click";
const GN202_DOUBLE_CLICK_MARKDOWN = "Double click activation baseline.";
const GN202_TAP_NOTE_ID = "inline-gesture-tap";
const GN202_TAP_MARKDOWN = "Tap activation baseline.";
const GN202_FINISH_NOTE_ID = "inline-gesture-finish";
const GN202_FINISH_MARKDOWN = [
    "# Gesture Finish Fixture",
    "",
    "This card verifies that leaving the editor with double clicks behaves like other pointer gestures.",
    "",
    "Additional prose keeps the card tall enough to measure pointer coordinates."
].join("\n");
const GN304_TARGET_NOTE_ID = "inline-anchor-fixture";
const GN304_TARGET_MARKDOWN = [
    "# Anchored Editing Fixture",
    "",
    "Paragraph one ensures the card lays out a visible htmlView before entering edit mode.",
    "",
    "Paragraph two extends the rendered height so expanding to markdown noticeably increases the surface.",
    "",
    "Paragraph three reinforces the need for a taller editor by including additional lines of prose.",
    "",
    "Paragraph four wraps the sample to guarantee the editor must grow downward during inline editing."
].join("\n");
const GN304_FILLER_PREFIX = "inline-anchor-filler";
const GN304_FILLER_MARKDOWN = Array.from(
    { length: 8 },
    (_, index) => `Filler paragraph ${index + 1} expands the scroll context for anchoring regression coverage.`
).join("\n\n");

const getCodeMirrorInputSelector = (scope) => `${scope} .CodeMirror [contenteditable="true"], ${scope} .CodeMirror textarea`;

test.describe("Markdown inline editor", () => {

    test("top editor clears after submitting long note", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });
        const cmInputSelector = getCodeMirrorInputSelector("#top-editor");

        try {
            await page.waitForSelector(cmInputSelector);

            const longNote = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of extended content.`).join("\n");
            await page.focus(cmInputSelector);
            await page.keyboard.type(longNote);

            await page.keyboard.down("Control");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Control");

            await page.waitForSelector(".markdown-block[data-note-id]");
            await page.waitForSelector("#editor-toast.toast--visible");
            const topEditorState = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                if (!(wrapper instanceof HTMLElement)) {
                    return { value: null, line: -1, ch: -1 };
                }
                const host = /** @type {any} */ (wrapper).__markdownHost;
                const codeMirror = wrapper.querySelector(".CodeMirror");
                const cm = codeMirror ? /** @type {any} */ (codeMirror).CodeMirror : null;
                const cursor = cm ? cm.getCursor() : { line: -1, ch: -1 };
                return {
                    value: host && typeof host.getValue === "function" ? host.getValue() : null,
                    line: cursor.line,
                    ch: cursor.ch
                };
            });
            assert.equal(topEditorState.value, "", "Top editor clears value after submit");
            assert.equal(topEditorState.line, 0, "Top editor caret returns to first line");
            assert.equal(topEditorState.ch, 0, "Top editor caret resets to first column");
        } finally {
            await teardown();
        }
    });

    test("double clicking outside inline editor finalizes edit mode", async () => {
        const { page, teardown } = await preparePage({
            records: [
                buildNoteRecord({
                    noteId: GN202_FINISH_NOTE_ID,
                    markdownText: GN202_FINISH_MARKDOWN
                })
            ]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN202_FINISH_NOTE_ID}"]`;
        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 5000 });
            const outsidePoint = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                const targetY = Math.min(rect.bottom + 48, window.innerHeight - 20);
                const targetX = Math.min(rect.left + rect.width / 2, window.innerWidth - 20);
                return { x: targetX, y: targetY };
            });
            assert.ok(outsidePoint, "outside click target should resolve");
            await page.mouse.click(outsidePoint.x, outsidePoint.y);
            await pause(page, 30);
            await page.mouse.click(outsidePoint.x, outsidePoint.y);
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 4000, hidden: true });
        } finally {
            await teardown();
        }
    });

    test("inline editor matches htmlView padding and origin", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN82_NOTE_ID,
            markdownText: GN82_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN82_NOTE_ID}"]`;
        const htmlSelector = `${cardSelector} .note-html-view .markdown-content`;

        try {
            await page.waitForSelector(htmlSelector, { timeout: 5000 });
            const htmlMetrics = await page.$eval(htmlSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                const styles = window.getComputedStyle(element);
                return {
                    top: rect.top,
                    left: rect.left,
                    paddingTop: parseFloat(styles.paddingTop || "0"),
                    paddingBottom: parseFloat(styles.paddingBottom || "0"),
                    paddingLeft: parseFloat(styles.paddingLeft || "0"),
                    paddingRight: parseFloat(styles.paddingRight || "0"),
                    marginTop: parseFloat(styles.marginTop || "0"),
                    marginBottom: parseFloat(styles.marginBottom || "0"),
                    marginLeft: parseFloat(styles.marginLeft || "0"),
                    marginRight: parseFloat(styles.marginRight || "0"),
                    borderTopWidth: parseFloat(styles.borderTopWidth || "0"),
                    borderBottomWidth: parseFloat(styles.borderBottomWidth || "0"),
                    borderLeftWidth: parseFloat(styles.borderLeftWidth || "0"),
                    borderRightWidth: parseFloat(styles.borderRightWidth || "0"),
                    cardTop: (() => {
                        const parent = element.closest(".markdown-block");
                        if (!(parent instanceof HTMLElement)) {
                            return 0;
                        }
                        return parent.getBoundingClientRect().top;
                    })(),
                    cardLeft: (() => {
                        const parent = element.closest(".markdown-block");
                        if (!(parent instanceof HTMLElement)) {
                            return 0;
                        }
                        return parent.getBoundingClientRect().left;
                    })()
                };
            });
            assert.ok(htmlMetrics, "Expected to capture htmlView metrics prior to editing");

            await page.click(`${cardSelector} .note-html-view`, { clickCount: 2 });
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 5000 });
            await page.waitForSelector(`${cardSelector} .CodeMirror-lines`, { timeout: 5000 });

            const editorMetrics = await page.$eval(`${cardSelector} .CodeMirror-lines`, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                const styles = window.getComputedStyle(element);
                return {
                    top: rect.top,
                    left: rect.left,
                    paddingTop: parseFloat(styles.paddingTop || "0"),
                    paddingBottom: parseFloat(styles.paddingBottom || "0"),
                    paddingLeft: parseFloat(styles.paddingLeft || "0"),
                    paddingRight: parseFloat(styles.paddingRight || "0"),
                    marginTop: parseFloat(styles.marginTop || "0"),
                    marginBottom: parseFloat(styles.marginBottom || "0"),
                    marginLeft: parseFloat(styles.marginLeft || "0"),
                    marginRight: parseFloat(styles.marginRight || "0"),
                    borderTopWidth: parseFloat(styles.borderTopWidth || "0"),
                    borderBottomWidth: parseFloat(styles.borderBottomWidth || "0"),
                    borderLeftWidth: parseFloat(styles.borderLeftWidth || "0"),
                    borderRightWidth: parseFloat(styles.borderRightWidth || "0"),
                    cardTop: (() => {
                        const parent = element.closest(".markdown-block");
                        if (!(parent instanceof HTMLElement)) {
                            return 0;
                        }
                        return parent.getBoundingClientRect().top;
                    })(),
                    cardLeft: (() => {
                        const parent = element.closest(".markdown-block");
                        if (!(parent instanceof HTMLElement)) {
                            return 0;
                        }
                        return parent.getBoundingClientRect().left;
                    })()
                };
            });
            assert.ok(editorMetrics, "Expected to capture CodeMirror metrics after entering edit mode");

            const htmlOffset = {
                top: htmlMetrics.top - htmlMetrics.cardTop,
                left: htmlMetrics.left - htmlMetrics.cardLeft
            };
            const editorOffset = {
                top: editorMetrics.top - editorMetrics.cardTop,
                left: editorMetrics.left - editorMetrics.cardLeft
            };

            const originTolerancePx = 1.5;
            assert.ok(
                Math.abs(editorOffset.top - htmlOffset.top) <= originTolerancePx,
                `Editor offset top (${editorOffset.top}) should align with htmlView offset top (${htmlOffset.top})`
            );
            assert.ok(
                Math.abs(editorOffset.left - htmlOffset.left) <= originTolerancePx,
                `Editor offset left (${editorOffset.left}) should align with htmlView offset left (${htmlOffset.left})`
            );

            const paddingTolerancePx = 0.11;
            const paddingComparisons = [
                ["top", editorMetrics.paddingTop, htmlMetrics.paddingTop],
                ["bottom", editorMetrics.paddingBottom, htmlMetrics.paddingBottom],
                ["left", editorMetrics.paddingLeft, htmlMetrics.paddingLeft],
                ["right", editorMetrics.paddingRight, htmlMetrics.paddingRight]
            ];

            paddingComparisons.forEach(([label, editorValue, htmlValue]) => {
                assert.ok(
                    Math.abs(/** @type {number} */ (editorValue) - /** @type {number} */ (htmlValue)) <= paddingTolerancePx,
                    `Editor padding ${label} (${editorValue}) should match htmlView padding ${label} (${htmlValue})`
                );
            });
        } finally {
            await teardown();
        }
    });

    test("top editor grows when multiline input is typed", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });
        const cmInputSelector = getCodeMirrorInputSelector("#top-editor");

        try {
            await page.waitForSelector(cmInputSelector);
            const heightBefore = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                return wrapper instanceof HTMLElement ? wrapper.getBoundingClientRect().height : 0;
            });

            const multiline = Array.from({ length: 6 }, (_, index) => `Line ${index + 1} content`).join("\n");
            await page.focus(cmInputSelector);
            await page.keyboard.type(multiline);

            const heightAfter = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                return wrapper instanceof HTMLElement ? wrapper.getBoundingClientRect().height : 0;
            });

            assert.ok(heightAfter > heightBefore + 40, `Top editor should expand when typing multiline input. Before=${heightBefore}, After=${heightAfter}`);
        } finally {
            await teardown();
        }
    });

    test("top editor hides EasyMDE htmlView pane", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });

        try {
            await page.waitForSelector("#top-editor .EasyMDEContainer");
            const htmlViewVisibility = await page.evaluate(() => {
                const container = document.querySelector("#top-editor .EasyMDEContainer");
                if (!(container instanceof HTMLElement)) {
                    return null;
                }
                const htmlView = container.querySelector(".editor-preview-side");
                if (!(htmlView instanceof HTMLElement)) {
                    return null;
                }
                const computed = window.getComputedStyle(htmlView);
                return { display: computed.display, width: computed.width };
            });

            assert.ok(htmlViewVisibility, "HtmlView element should exist in DOM for measurement");
            assert.equal(htmlViewVisibility.display, "none", "EasyMDE htmlView pane must remain hidden in the top editor");
            assert.equal(htmlViewVisibility.width, "0px", "EasyMDE htmlView pane should not consume horizontal space");
        } finally {
            await teardown();
        }
    });

    test("top editor respects external focus selections", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });
        const cmInputSelector = getCodeMirrorInputSelector("#top-editor");

        try {
            await page.waitForSelector(cmInputSelector);

            await page.focus(cmInputSelector);

            const externalFocus = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                const host = wrapper && wrapper instanceof HTMLElement ? /** @type {any} */ (wrapper).__markdownHost : null;
                const textarea = host && typeof host.getTextarea === "function" ? host.getTextarea() : null;
                const probe = document.createElement("button");
                probe.id = "focus-probe";
                probe.type = "button";
                probe.textContent = "Probe";
                document.body.appendChild(probe);
                if (textarea instanceof HTMLTextAreaElement) {
                    textarea.blur();
                }
                probe.focus();
                const activeTag = document.activeElement?.tagName ?? null;
                probe.remove();
                return activeTag;
            });
            assert.equal(externalFocus, "BUTTON", "external control can receive focus");

            const refocusResult = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                const host = wrapper && wrapper instanceof HTMLElement ? /** @type {any} */ (wrapper).__markdownHost : null;
                if (host && typeof host.focus === "function") {
                    host.focus();
                }
                const activeElement = document.activeElement;
                if (activeElement instanceof HTMLElement && activeElement.getAttribute("contenteditable") === "true") {
                    return true;
                }
                return activeElement instanceof HTMLTextAreaElement;
            });
            assert.equal(refocusResult, true, "top editor regains focus when the user returns to it");
        } finally {
            await teardown();
        }
    });

    test("editing cards expand without internal scrollbars", async () => {
        const seededRecords = [
            buildNoteRecord({
                noteId: LONG_NOTE_ID,
                markdownText: LONG_NOTE_MARKDOWN
            })
        ];
        const { page, teardown } = await preparePage({ records: seededRecords });
        const cardSelector = `[data-note-id="${LONG_NOTE_ID}"]`;

        try {
            await enterCardEditMode(page, cardSelector);

            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return false;
                }
                const cardStyle = window.getComputedStyle(card);
                if (cardStyle.overflowY === "auto" || cardStyle.overflowY === "scroll") {
                    return false;
                }
                const cmScroll = card.querySelector(".CodeMirror-scroll");
                if (!(cmScroll instanceof HTMLElement)) {
                    return false;
                }
                const cmStyle = window.getComputedStyle(cmScroll);
                if (cmStyle.overflowY === "auto" || cmStyle.overflowY === "scroll") {
                    return false;
                }
                const cardWithinBounds = card.scrollHeight <= card.clientHeight + 16;
                const cmWithinBounds = cmScroll.scrollHeight <= cmScroll.clientHeight + 64;
                return cardWithinBounds && cmWithinBounds;
            }, { timeout: 1000 }, cardSelector);

            const metrics = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const cardStyle = window.getComputedStyle(card);
                const cmScroll = card.querySelector(".CodeMirror-scroll");
                const cmStyle = cmScroll instanceof HTMLElement ? window.getComputedStyle(cmScroll) : null;

                return {
                    cardOverflowY: cardStyle.overflowY,
                    cardScrollHeight: card.scrollHeight,
                    cardClientHeight: card.clientHeight,
                    codeMirrorOverflowY: cmStyle?.overflowY ?? null,
                    codeMirrorScrollHeight: cmScroll instanceof HTMLElement ? cmScroll.scrollHeight : null,
                    codeMirrorClientHeight: cmScroll instanceof HTMLElement ? cmScroll.clientHeight : null
                };
            }, cardSelector);

            assert.ok(metrics, "expected editing metrics to be captured");
            assert.notEqual(metrics.cardOverflowY, "auto", "card must not show a vertical scrollbar");
            assert.notEqual(metrics.cardOverflowY, "scroll", "card must not show a vertical scrollbar");
            assert.ok(
                metrics.cardScrollHeight <= metrics.cardClientHeight + 16,
                `card should grow instead of scrolling (scrollHeight=${metrics.cardScrollHeight}, clientHeight=${metrics.cardClientHeight})`
            );
            if (typeof metrics.codeMirrorOverflowY === "string") {
                assert.notEqual(metrics.codeMirrorOverflowY, "auto", "CodeMirror scroll container must not introduce scrollbars");
                assert.notEqual(metrics.codeMirrorOverflowY, "scroll", "CodeMirror scroll container must not introduce scrollbars");
            }
            if (typeof metrics.codeMirrorScrollHeight === "number" && typeof metrics.codeMirrorClientHeight === "number") {
                assert.ok(
                    metrics.codeMirrorScrollHeight <= metrics.codeMirrorClientHeight + 64,
                    `editor should not rely on large internal scroll areas (scrollHeight=${metrics.codeMirrorScrollHeight}, clientHeight=${metrics.codeMirrorClientHeight})`
                );
            }
        } finally {
            await teardown();
        }
    });

    test("finalizing long edits clears height constraints", async () => {
        const seededRecords = [
            buildNoteRecord({
                noteId: HEIGHT_RESET_NOTE_ID,
                markdownText: LONG_NOTE_MARKDOWN
            })
        ];
        const { page, teardown } = await preparePage({ records: seededRecords });
        const cardSelector = `.markdown-block[data-note-id="${HEIGHT_RESET_NOTE_ID}"]`;
        const editorInputSelector = getCodeMirrorInputSelector(cardSelector);
        try {
            await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(editorInputSelector, { timeout: 5000 });
            await page.type(editorInputSelector, " ");

            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");

            await page.waitForSelector(`${cardSelector}.editing-in-place`, { hidden: true, timeout: 2000 });

            const postFinalizeState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const computed = window.getComputedStyle(card);
                return {
                    heightVar: card.style.getPropertyValue("--note-expanded-edit-height"),
                    inlineHeight: card.style.height,
                    inlineMinHeight: card.style.minHeight,
                    inlineMaxHeight: card.style.maxHeight,
                    overflowY: computed.overflowY,
                    scrollHeight: card.scrollHeight,
                    clientHeight: card.clientHeight
                };
            }, cardSelector);

            assert.ok(postFinalizeState, "expected to capture card metrics after finalizing");
            assert.equal(postFinalizeState.heightVar, "", "height lock variable should clear after finalizing edit");
            assert.equal(postFinalizeState.inlineHeight, "", "card inline height should reset after finalizing");
            assert.equal(postFinalizeState.inlineMinHeight, "", "card inline min-height should reset after finalizing");
            assert.equal(postFinalizeState.inlineMaxHeight, "", "card inline max-height should reset after finalizing");
            assert.ok(
                postFinalizeState.scrollHeight <= postFinalizeState.clientHeight + 8,
                `card should not retain artificial gaps after edit (scrollHeight=${postFinalizeState.scrollHeight}, clientHeight=${postFinalizeState.clientHeight})`
            );
        } finally {
            await teardown();
        }
    });

    test("top editor retains compact visual footprint", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });

        try {
            await page.waitForSelector("#top-editor .markdown-block.top-editor");

            const styleSnapshot = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                if (!(wrapper instanceof HTMLElement)) {
                    return null;
                }
                const computed = window.getComputedStyle(wrapper);
                const { height } = wrapper.getBoundingClientRect();
                return {
                    background: computed.backgroundColor,
                    paddingTop: computed.paddingTop,
                    paddingBottom: computed.paddingBottom,
                    borderBottomWidth: computed.borderBottomWidth,
                    borderBottomColor: computed.borderBottomColor,
                    height
                };
            });

            assert.ok(styleSnapshot, "Top editor wrapper should be present");
            assert.equal(styleSnapshot.background, "rgba(0, 0, 0, 0)", "Top editor stays transparent like baseline notes");
            assert.equal(styleSnapshot.paddingTop, "0px", "Top editor must not introduce extra top padding");
            assert.equal(styleSnapshot.paddingBottom, "0px", "Top editor must not introduce extra bottom padding");
            assert.equal(styleSnapshot.borderBottomWidth, "1px", "Top editor delineator must remain one pixel tall");
            assert.equal(styleSnapshot.borderBottomColor, "rgba(58, 68, 94, 0.7)", "Top editor delineator must reuse the shared divider color");
            assert.ok(styleSnapshot.height <= 80, `Top editor height should stay compact, received ${styleSnapshot.height}`);
        } finally {
            await teardown();
        }
    });

    test("single click enters edit mode and expands overflowing htmlView", async () => {
        const expandNoteId = "inline-expand-behaviour";
        const noteRecord = buildNoteRecord({
            noteId: expandNoteId,
            markdownText: LONG_NOTE_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${expandNoteId}"]`;
        const htmlViewSelector = `${cardSelector} .note-html-view`;

        try {
            await page.waitForSelector(cardSelector);

            const initialState = await page.$eval(htmlViewSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                return {
                    overflow: element.classList.contains("note-html-view--overflow"),
                    expanded: element.classList.contains("note-html-view--expanded")
                };
            });
            assert.ok(initialState);
            assert.equal(initialState.overflow, true, "fixture should overflow to require expansion");
            assert.equal(initialState.expanded, false, "htmlView must start collapsed");

            await page.click(htmlViewSelector);
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 4000 });

            const htmlViewDuringEdit = await page.$(htmlViewSelector);
            assert.equal(htmlViewDuringEdit, null, "htmlView should be removed while editing after single click");

            const expandedHeight = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return "";
                }
                return element.style.getPropertyValue("--note-expanded-edit-height");
            });
            assert.notEqual(expandedHeight, "", "editing-in-place should lock the expanded edit height variable");

            await page.keyboard.down("Control");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Control");
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { hidden: true, timeout: 4000 });
        } finally {
            await teardown();
        }
    });

    test("inline editor renders without outer border", async () => {
        const noteRecord = buildNoteRecord({
            noteId: BORDER_NOTE_ID,
            markdownText: BORDER_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${BORDER_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector);
            await enterCardEditMode(page, cardSelector);

            const borderSnapshot = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const codeMirror = card.querySelector(".CodeMirror");
                if (!(codeMirror instanceof HTMLElement)) {
                    return null;
                }
                const computed = window.getComputedStyle(codeMirror);
                return {
                    top: computed.borderTopWidth,
                    right: computed.borderRightWidth,
                    bottom: computed.borderBottomWidth,
                    left: computed.borderLeftWidth,
                    topStyle: computed.borderTopStyle,
                    rightStyle: computed.borderRightStyle,
                    bottomStyle: computed.borderBottomStyle,
                    leftStyle: computed.borderLeftStyle
                };
            }, cardSelector);

            assert.ok(borderSnapshot, "CodeMirror wrapper should be present while editing");
            assert.equal(borderSnapshot.top, "0px", "Top border width must be zero");
            assert.equal(borderSnapshot.right, "0px", "Right border width must be zero");
            assert.equal(borderSnapshot.bottom, "0px", "Bottom border width must be zero");
            assert.equal(borderSnapshot.left, "0px", "Left border width must be zero");
            assert.equal(borderSnapshot.topStyle, "none", "Top border style must be none");
            assert.equal(borderSnapshot.rightStyle, "none", "Right border style must be none");
            assert.equal(borderSnapshot.bottomStyle, "none", "Bottom border style must be none");
            assert.equal(borderSnapshot.leftStyle, "none", "Left border style must be none");
        } finally {
            await teardown();
        }
    });

    test("note cards render with a single subtle bottom divider", async () => {
        const seededRecords = [
            buildNoteRecord({
                noteId: DIVIDER_NOTE_ID,
                markdownText: DIVIDER_MARKDOWN
            })
        ];
        const { page, teardown } = await preparePage({
            records: seededRecords
        });
        const cardSelector = `.markdown-block[data-note-id="${DIVIDER_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector);
            const dividerSnapshot = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const styles = window.getComputedStyle(element);
                return {
                    topWidth: styles.borderTopWidth,
                    rightWidth: styles.borderRightWidth,
                    bottomWidth: styles.borderBottomWidth,
                    leftWidth: styles.borderLeftWidth,
                    bottomStyle: styles.borderBottomStyle,
                    bottomColor: styles.borderBottomColor
                };
            });

            assert.ok(dividerSnapshot, "Expected to measure card divider styles");
            assert.equal(dividerSnapshot.topWidth, "0px", "Top border must be absent");
            assert.equal(dividerSnapshot.rightWidth, "0px", "Right border must be absent");
            assert.equal(dividerSnapshot.leftWidth, "0px", "Left border must be absent");
            assert.equal(dividerSnapshot.bottomStyle, "solid", "Bottom border must render as a solid divider");
            const computedWidth = parseFloat(dividerSnapshot.bottomWidth ?? "0");
            assert.ok(computedWidth >= 0.9 && computedWidth <= 1.1, `Bottom border must remain a single pixel (received ${dividerSnapshot.bottomWidth})`);
            assert.equal(
                dividerSnapshot.bottomColor,
                "rgba(58, 68, 94, 0.7)",
                "Bottom divider color must use the shared delineator tone"
            );
        } finally {
            await teardown();
        }
    });

    test("htmlView click enters edit mode at click point without shifting card upward", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN47_NOTE_ID,
            markdownText: GN47_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [
                buildNoteRecord({
                    noteId: GN47_PADDING_NOTE_ID,
                    markdownText: GN47_PADDING_MARKDOWN
                }),
                noteRecord
            ]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN47_NOTE_ID}"]`;
        const targetSubstring = GN47_TARGET_TEXT;
        try {
            await page.waitForSelector(cardSelector);
            await page.evaluate(() => {
                window.scrollTo(0, 200);
            });
            const scrollBefore = await page.evaluate(() => window.scrollY);
            const maxScrollBefore = await page.evaluate(() => {
                const element = document.scrollingElement || document.documentElement;
                if (!(element instanceof Element)) {
                    return 0;
                }
                return Math.max(0, element.scrollHeight - window.innerHeight);
            });
        const layoutBefore = await page.$eval(cardSelector, (element) => {
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return {
                top: rect.top,
                height: rect.height,
                bottom: rect.bottom,
                viewportHeight: window.innerHeight
            };
        });
            assert.ok(layoutBefore, "Initial layout metrics should be captured for the card");

            const clickPoint = await page.$eval(
                `${cardSelector} .markdown-content`,
                (element, substring) => {
                    if (!(element instanceof HTMLElement)) {
                        return null;
                    }
                    const plainText = element.textContent || "";
                    const startIndex = plainText.indexOf(substring);
                    if (startIndex < 0) {
                        return null;
                    }
                    const midpointPlainOffset = startIndex + Math.floor(substring.length / 2);
                    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                    let remaining = midpointPlainOffset;
                    while (walker.nextNode()) {
                        const node = walker.currentNode;
                        const value = typeof node.nodeValue === "string" ? node.nodeValue : "";
                        if (value.length === 0) {
                            continue;
                        }
                        if (remaining >= value.length) {
                            remaining -= value.length;
                            continue;
                        }
                        const clamp = Math.min(Math.max(remaining, 0), value.length - 1);
                        const end = Math.min(clamp + 1, value.length);
                        const range = element.ownerDocument.createRange();
                        range.setStart(node, clamp);
                        range.setEnd(node, end);
                        const rect = range.getBoundingClientRect();
                        if (rect.width === 0 && rect.height === 0) {
                            return null;
                        }
                        return {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                            plainOffset: midpointPlainOffset,
                            plainStart: startIndex,
                            plainLength: substring.length
                        };
                    }
                    return null;
                },
                targetSubstring
            );
            if (!clickPoint) {
                const htmlViewText = await page.$eval(`${cardSelector} .markdown-content`, (element) => {
                    if (!(element instanceof HTMLElement)) {
                        return "";
                    }
                    return element.textContent || "";
                });
                assert.fail(`The htmlView should expose the target substring for clicking. htmlView="${htmlViewText}" target="${targetSubstring}"`);
            }

            await page.mouse.click(clickPoint.x, clickPoint.y, { clickCount: 2 });
            await page.waitForSelector(`${cardSelector}.editing-in-place`);
            await page.waitForSelector(getCodeMirrorInputSelector(cardSelector));

        const layoutAfter = await page.$eval(cardSelector, (element) => {
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return {
                top: rect.top,
                height: rect.height,
                bottom: rect.bottom,
                viewportHeight: window.innerHeight
            };
        });
            assert.ok(layoutAfter, "Layout metrics after entering edit mode should be measurable");

            const scrollAfter = await page.evaluate(() => window.scrollY);
            const maxScrollAfter = await page.evaluate(() => {
                const element = document.scrollingElement || document.documentElement;
                if (!(element instanceof Element)) {
                    return 0;
                }
                return Math.max(0, element.scrollHeight - window.innerHeight);
            });
            assert.ok(
                layoutAfter.height >= layoutBefore.height + 24,
                `Card should grow downward instead of shrinking (before=${layoutBefore.height}, after=${layoutAfter.height})`
            );
            assert.ok(
                layoutAfter.bottom >= layoutBefore.bottom + 20,
                `Bottom edge should extend downward (before=${layoutBefore.bottom}, after=${layoutAfter.bottom})`
            );
            assert.ok(
                layoutAfter.top >= 60,
                `Card should remain visible without snapping to the viewport top (top=${layoutAfter.top})`
            );

            const caretState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = Reflect.get(card, "__markdownHost");
                const codeMirror = card.querySelector(".CodeMirror");
                if (!host || !codeMirror) {
                    return null;
                }
                const cm = /** @type {any} */ (codeMirror).CodeMirror;
                if (!cm || typeof cm.getDoc !== "function") {
                    return null;
                }
                const doc = cm.getDoc();
                const cursor = doc.getCursor();
                const index = doc.indexFromPos(cursor);
                return {
                    index,
                    value: doc.getValue()
                };
            }, cardSelector);
            assert.ok(caretState, "Caret state should be retrievable from CodeMirror");
            assert.equal(caretState.value, GN47_MARKDOWN, "Editor value should match the stored markdown");

            const caretPlainOffset = computePlainOffsetForMarkdown(caretState.value, caretState.index);
            assert.ok(
                caretPlainOffset >= clickPoint.plainStart
                && caretPlainOffset <= clickPoint.plainStart + clickPoint.plainLength,
                `Caret must land within the clicked substring (plainOffset=${caretPlainOffset}, range=[${clickPoint.plainStart}, ${clickPoint.plainStart + clickPoint.plainLength}])`
            );
            assert.ok(
                Math.abs(caretPlainOffset - clickPoint.plainOffset) <= 1,
                `Caret should stay near the click midpoint (expected≈${clickPoint.plainOffset}, actual=${caretPlainOffset})`
            );
        } finally {
            await teardown();
        }
    });

    test("near-bottom cards stay anchored while editing and after submit", async () => {
        const fillerRecords = Array.from({ length: 6 }, (_, index) => buildNoteRecord({
            noteId: `${GN304_FILLER_PREFIX}-${index + 1}`,
            markdownText: `${GN304_FILLER_MARKDOWN}\n\nFiller block ${index + 1}.`
        }));
        const records = [
            ...fillerRecords,
            buildNoteRecord({
                noteId: GN304_TARGET_NOTE_ID,
                markdownText: GN304_TARGET_MARKDOWN
            })
        ];
        const { page, teardown } = await preparePage({ records });
        const cardSelector = `.markdown-block[data-note-id="${GN304_TARGET_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector);
            await page.evaluate(() => {
                const scroller = document.scrollingElement || document.documentElement;
                if (scroller) {
                    const maxScroll = Math.max(0, scroller.scrollHeight - window.innerHeight);
                    window.scrollTo(0, Math.max(0, maxScroll - 8));
                }
            });
            await pause(page, 50);
            await waitForViewportStability(page, cardSelector);

            const baseline = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                return {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    viewportHeight: window.innerHeight,
                    scrollY: window.scrollY
                };
            });
            assert.ok(baseline, "Baseline metrics should be captured for the anchored regression card");
            assert.ok(
                baseline.bottom > baseline.viewportHeight - 12,
                `Card should begin near the viewport edge (bottom=${baseline.bottom}, viewportHeight=${baseline.viewportHeight})`
            );

            const clickPoint = await page.$eval(`${cardSelector} .note-html-view`, (element) => {
                if (!(element instanceof HTMLElement)) {
                    throw new Error("Expected htmlView surface for anchored regression");
                }
                const rect = element.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + Math.min(rect.height - 12, rect.height / 2)
                };
            });
            await page.mouse.click(clickPoint.x, clickPoint.y);
            await page.waitForSelector(`${cardSelector}.editing-in-place`);
            await page.waitForSelector(getCodeMirrorInputSelector(cardSelector));
            await pause(page, 50);
            await waitForViewportStability(page, cardSelector);
            await waitForViewportStability(page, cardSelector);

            const editingMetrics = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const margin = 24;
                const minTop = -margin;
                const maxTop = Math.max(viewportHeight - rect.height - margin, minTop);
                const centered = (viewportHeight - rect.height) / 2;
                const targetTop = Math.max(minTop, Math.min(centered, maxTop));
                return {
                    top: rect.top,
                    targetTop,
                    scrollY: window.scrollY
                };
            });
            assert.ok(editingMetrics, "Expected to capture editing metrics after entering inline mode");
            assert.ok(
                editingMetrics.top >= 60,
                `Card should remain comfortably within the viewport when editing (top=${editingMetrics.top})`
            );

            await page.keyboard.type("\nAnchored regression line.");
            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { hidden: true });
            await pause(page, 50);
            await waitForViewportStability(page, cardSelector);
            await waitForViewportStability(page, cardSelector);

            const finalMetrics = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const margin = 24;
                const minTop = -margin;
                const maxTop = Math.max(viewportHeight - rect.height - margin, minTop);
                const centered = (viewportHeight - rect.height) / 2;
                const targetTop = Math.max(minTop, Math.min(centered, maxTop));
                return {
                    top: rect.top,
                    targetTop,
                    scrollY: window.scrollY
                };
            });
            assert.ok(finalMetrics, "Expected final metrics after submitting inline edits");
            const anchoredDelta = Math.abs(finalMetrics.top - editingMetrics.top);
            assert.ok(
                anchoredDelta <= 140,
                `Card should remain anchored after submission (delta=${anchoredDelta.toFixed(2)}px)`
            );
            const finalCenterDelta = Math.abs(finalMetrics.top - finalMetrics.targetTop);
            assert.ok(
                finalCenterDelta <= 24,
                `Rendered htmlView should remain near the anchored position (delta=${finalCenterDelta.toFixed(2)}px)`
            );
            assert.ok(
                finalMetrics.top >= 60,
                `Final html view should remain comfortably visible (top=${finalMetrics.top})`
            );
        } finally {
            await teardown();
        }
    });

    test("clicking an already editing card outside the editor finalizes edit mode", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN48_NOTE_ID,
            markdownText: GN48_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN48_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            const textareaSelector = await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(textareaSelector, { timeout: 5000 });
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && card.classList.contains("editing-in-place");
            }, {}, cardSelector);

            const baselineState = await beginCardEditingTelemetry(page, cardSelector);
            assert.ok(baselineState, "Expected to capture initial editor state");
            assert.equal(baselineState.mode, "edit", "Card should begin in edit mode");
            assert.equal(baselineState.hasEditingClass, true, "Card should carry editing-in-place class");

            const pointerTarget = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const cardContent = card.querySelector(".card-content");
                if (!(cardContent instanceof HTMLElement)) {
                    return null;
                }
                const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
                cardContent.dispatchEvent(pointerDown);
                const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
                cardContent.dispatchEvent(mouseDown);
                const pointerUp = new PointerEvent("pointerup", { bubbles: true, cancelable: true });
                cardContent.dispatchEvent(pointerUp);
                const mouseUp = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
                cardContent.dispatchEvent(mouseUp);
                const click = new MouseEvent("click", { bubbles: true, cancelable: true });
                cardContent.dispatchEvent(click);
                const activeElement = document.activeElement;
                if (activeElement instanceof HTMLElement) {
                    activeElement.blur();
                }
                return {
                    tagName: cardContent.tagName.toLowerCase(),
                    classList: Array.from(cardContent.classList)
                };
            }, cardSelector);
            assert.ok(pointerTarget, "Expected to dispatch pointer events on the card chrome surface");
            assert.equal(pointerTarget.tagName, "div", "Card chrome target should be a div element");
            assert.ok(pointerTarget.classList.includes("card-content"), "Pointer target must be the card content wrapper");
            await pause(page, 50);

            const postClickState = await collectCardEditingTelemetry(page, cardSelector);
            assert.ok(postClickState, "Expected to capture post-click editor state");
            assert.equal(postClickState.mode, "view", "Card must exit edit mode after clicking outside the editor");
            assert.equal(postClickState.hasEditingClass, false, "Card should remove editing-in-place class after clicking outside");
            if (Array.isArray(postClickState.modeTransitions)) {
                assert.ok(
                    postClickState.modeTransitions.includes("view"),
                    `Mode transitions must include view: ${postClickState.modeTransitions.join(", ")}`
                );
            }
            if (Array.isArray(postClickState.editClassTransitions) && postClickState.editClassTransitions.length > 0) {
                const removed = postClickState.editClassTransitions.some((value) => value === false);
                assert.equal(removed, true, "Editing class should be removed when leaving edit mode via card chrome");
            }
        } finally {
            await teardown();
        }
    });

    test("clicking outside the markdown editor finalizes editing", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN105_NOTE_ID,
            markdownText: GN105_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN105_NOTE_ID}"]`;
        const metaChipsSelector = `${cardSelector} .meta-chips`;

        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await page.waitForSelector(metaChipsSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 5000 });

            const baselineTelemetry = await beginCardEditingTelemetry(page, cardSelector);
            assert.ok(baselineTelemetry, "Expected to begin telemetry for the editing card");
            assert.equal(baselineTelemetry.mode, "edit", "Card should be in edit mode before outside click");
            assert.equal(baselineTelemetry.hasEditingClass, true, "Card must have the editing indicator before outside click");

            const clickPoint = await page.$eval(metaChipsSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                return {
                    x: rect.left + Math.min(rect.width / 2, 8),
                    y: rect.top + Math.min(rect.height / 2, 8),
                    descriptor: element.className || element.tagName
                };
            });
            assert.ok(clickPoint, "Meta chips click target should resolve");

            await page.mouse.click(clickPoint.x, clickPoint.y);
            await pause(page, 50);

            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return false;
                }
                if (card.classList.contains("editing-in-place")) {
                    return false;
                }
                const host = Reflect.get(card, "__markdownHost");
                return Boolean(host && typeof host.getMode === "function" && host.getMode() === "view");
            }, { timeout: 1500 }, cardSelector);

            await page.waitForSelector(`${cardSelector} .note-html-view .markdown-content`, { timeout: 2000 });
            const finalTelemetry = await collectCardEditingTelemetry(page, cardSelector);
            assert.ok(finalTelemetry, "Expected to collect telemetry after exiting edit mode");
            assert.equal(finalTelemetry.mode, "view", "Card should return to view mode after outside click");
            assert.equal(finalTelemetry.hasEditingClass, false, "Editing class must be removed after outside click");
        } finally {
            await teardown();
        }
    });

    test("single clicking a different card after double click editing finalizes the current card", async () => {
        const firstNote = buildNoteRecord({
            noteId: GN105_NOTE_ID,
            markdownText: GN105_MARKDOWN
        });
        const secondNote = buildNoteRecord({
            noteId: GN105_SECOND_NOTE_ID,
            markdownText: GN105_SECOND_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [firstNote, secondNote]
        });
        const firstCardSelector = `.markdown-block[data-note-id="${GN105_NOTE_ID}"]`;
        const secondCardSelector = `.markdown-block[data-note-id="${GN105_SECOND_NOTE_ID}"]`;
        const secondHtmlViewSelector = `${secondCardSelector} .note-html-view`;

        try {
            await page.waitForSelector(firstCardSelector, { timeout: 5000 });
            await page.waitForSelector(secondCardSelector, { timeout: 5000 });
            await enterCardEditMode(page, firstCardSelector);
            await page.waitForSelector(`${firstCardSelector}.editing-in-place`, { timeout: 5000 });

            const baselineTelemetry = await beginCardEditingTelemetry(page, firstCardSelector);
            assert.ok(baselineTelemetry, "Expected to begin telemetry for the editing card");
            assert.equal(baselineTelemetry.mode, "edit", "Card should be in edit mode before outside click");
            assert.equal(baselineTelemetry.hasEditingClass, true, "Card must have the editing indicator before outside click");

            await page.$eval(secondHtmlViewSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return;
                }
                element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            });
            await pause(page, 50);

            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return false;
                }
                if (card.classList.contains("editing-in-place")) {
                    return false;
                }
                const host = Reflect.get(card, "__markdownHost");
                return Boolean(host && typeof host.getMode === "function" && host.getMode() === "view");
            }, { timeout: 1500 }, firstCardSelector);

            const finalTelemetry = await collectCardEditingTelemetry(page, firstCardSelector);
            assert.ok(finalTelemetry, "Expected to collect telemetry after exiting edit mode");
            assert.equal(finalTelemetry.mode, "view", "Card should return to view mode after outside card click");
            assert.equal(finalTelemetry.hasEditingClass, false, "Editing class must be removed after outside card click");

            await page.waitForSelector(`${secondCardSelector}.editing-in-place`, { timeout: 2000 });
        } finally {
            await teardown();
        }
    });

    test("clicking the control column finalizes edit mode without returning to markdown", async () => {
        const controlNote = buildNoteRecord({
            noteId: GN308_NOTE_ID,
            markdownText: GN308_MARKDOWN,
            classification: { category: "Research" }
        });
        const { page, teardown } = await preparePage({ records: [controlNote] });
        const cardSelector = `.markdown-block[data-note-id="${GN308_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 4000 });

            const baselineTelemetry = await beginCardEditingTelemetry(page, cardSelector);
            assert.ok(baselineTelemetry, "Baseline telemetry should resolve before interacting with controls");
            assert.equal(baselineTelemetry.mode, "edit", "Card must begin in edit mode");
            assert.equal(baselineTelemetry.hasEditingClass, true, "Editing class should be present before the control click");

            const controlClickPoint = await page.$eval(cardSelector, (card) => {
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const controls = card.querySelector(".card-controls");
                if (!(controls instanceof HTMLElement)) {
                    return null;
                }
                const rect = controls.getBoundingClientRect();
                const doc = controls.ownerDocument;
                for (let offsetY = rect.top + 4; offsetY <= rect.bottom - 4; offsetY += 6) {
                    for (let offsetX = rect.left + 4; offsetX <= rect.right - 4; offsetX += 6) {
                        const hit = doc.elementFromPoint(offsetX, offsetY);
                        if (!(hit instanceof Element)) {
                            continue;
                        }
                        if (hit.closest(".actions") || hit.closest(".action-button")) {
                            continue;
                        }
                        return { x: offsetX, y: offsetY };
                    }
                }
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };
            });

            assert.ok(controlClickPoint, "Control column click target should resolve");
            await page.mouse.click(controlClickPoint.x, controlClickPoint.y);
            await pause(page, 80);

            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return false;
                }
                if (card.classList.contains("editing-in-place")) {
                    return false;
                }
                const host = Reflect.get(card, "__markdownHost");
                if (!host || typeof host.getMode !== "function") {
                    return false;
                }
                return host.getMode() === "view";
            }, { timeout: 1500 }, cardSelector);

            await pause(page, 120);
            const finalTelemetry = await collectCardEditingTelemetry(page, cardSelector);
            assert.ok(finalTelemetry, "Final telemetry should resolve after clicking the control column");
            assert.equal(finalTelemetry.mode, "view", "Card should remain in view mode after interacting with the control column");
            assert.equal(finalTelemetry.hasEditingClass, false, "Editing class must remain cleared after the control column click");
        } finally {
            await teardown();
        }
    });

    test("pressing backtick wraps the selected text with inline code", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN106_INLINE_WRAP_NOTE_ID,
            markdownText: GN106_INLINE_WRAP_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN106_INLINE_WRAP_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);
            await pause(page, 80);
            await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host) {
                    return;
                }
                const value = host.getValue();
                const target = "wrapping";
                const startIndex = value.indexOf(target);
                if (startIndex < 0) {
                    return;
                }
                const endIndex = startIndex + target.length;
                const cmElement = card.querySelector(".CodeMirror");
                const cmInstance = cmElement && typeof /** @type {any} */ (cmElement).CodeMirror !== "undefined"
                    ? /** @type {any} */ (cmElement).CodeMirror
                    : null;
                if (!cmInstance || typeof cmInstance.getDoc !== "function") {
                    return;
                }
                const doc = cmInstance.getDoc();
                const startPos = doc.posFromIndex(startIndex);
                const endPos = doc.posFromIndex(endIndex);
                doc.setSelection(startPos, endPos);
                cmInstance.focus();
            }, cardSelector);

            const selectionBefore = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const cmElement = card.querySelector(".CodeMirror");
                const cmInstance = cmElement && typeof /** @type {any} */ (cmElement).CodeMirror !== "undefined"
                    ? /** @type {any} */ (cmElement).CodeMirror
                    : null;
                if (!cmInstance || typeof cmInstance.getDoc !== "function") {
                    return null;
                }
                const doc = cmInstance.getDoc();
                const selection = doc.getSelection();
                const primary = doc.listSelections()?.[0] ?? null;
                return {
                    selection,
                    anchor: primary?.anchor ?? null,
                    head: primary?.head ?? null
                };
            }, cardSelector);
            assert.ok(selectionBefore, "Expected to capture selection state before wrapping");
            assert.equal(selectionBefore.selection, "wrapping", "Selection should target the wrapping token before inserting backticks");

            await page.keyboard.press("Backquote");

            const editorState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host || typeof host.getValue !== "function") {
                    return null;
                }
                const cmElement = card.querySelector(".CodeMirror");
                const cmInstance = cmElement && typeof /** @type {any} */ (cmElement).CodeMirror !== "undefined"
                    ? /** @type {any} */ (cmElement).CodeMirror
                    : null;
                const doc = cmInstance && typeof cmInstance.getDoc === "function"
                    ? cmInstance.getDoc()
                    : null;
                const selections = doc ? doc.listSelections() : [];
                const selectedText = doc ? doc.getSelection() : "";
                return {
                    value: host.getValue(),
                    selectedText,
                    selectionCount: Array.isArray(selections) ? selections.length : 0
                };
            }, cardSelector);

            assert.ok(editorState, "Expected to capture editor state after wrapping");
            assert.equal(editorState.value, "Backtick `wrapping` baseline text");
            assert.equal(editorState.selectedText, "wrapping", "Selection should remain on the original text");
            assert.equal(editorState.selectionCount, 1, "Single selection range expected");
        } finally {
            await teardown();
        }
    });

    test("backticks expand the wrapper around existing markdown", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN106_NESTED_WRAP_NOTE_ID,
            markdownText: GN106_NESTED_WRAP_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN106_NESTED_WRAP_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);
            await pause(page, 80);
            await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host) {
                    return;
                }
                const value = host.getValue();
                const target = "`inline`";
                const startIndex = value.indexOf(target);
                if (startIndex < 0) {
                    return;
                }
                const endIndex = startIndex + target.length;
                const cmElement = card.querySelector(".CodeMirror");
                const cmInstance = cmElement && typeof /** @type {any} */ (cmElement).CodeMirror !== "undefined"
                    ? /** @type {any} */ (cmElement).CodeMirror
                    : null;
                if (!cmInstance || typeof cmInstance.getDoc !== "function") {
                    return;
                }
                const doc = cmInstance.getDoc();
                const startPos = doc.posFromIndex(startIndex);
                const endPos = doc.posFromIndex(endIndex);
                doc.setSelection(startPos, endPos);
                cmInstance.focus();
            }, cardSelector);

            const selectionBefore = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const cmElement = card.querySelector(".CodeMirror");
                const cmInstance = cmElement && typeof /** @type {any} */ (cmElement).CodeMirror !== "undefined"
                    ? /** @type {any} */ (cmElement).CodeMirror
                    : null;
                if (!cmInstance || typeof cmInstance.getDoc !== "function") {
                    return null;
                }
                const doc = cmInstance.getDoc();
                const selection = doc.getSelection();
                const primary = doc.listSelections()?.[0] ?? null;
                return {
                    selection,
                    anchor: primary?.anchor ?? null,
                    head: primary?.head ?? null
                };
            }, cardSelector);
            assert.ok(selectionBefore, "Expected to capture selection state before expanding backticks");
            assert.equal(selectionBefore.selection, "`inline`", "Selection should target the inline snippet before expanding wrapper");

            await page.keyboard.press("Backquote");

            const markdownValue = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                return host && typeof host.getValue === "function"
                    ? host.getValue()
                    : null;
            }, cardSelector);

            assert.equal(markdownValue, "Nested ```inline``` snippet baseline");
        } finally {
            await teardown();
        }
    });

    test("inline editing survives sync snapshot re-render", async () => {
        const noteId = "inline-sync-snapshot";
        const noteRecord = buildNoteRecord({
            noteId,
            markdownText: "Snapshot baseline paragraph."
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${noteId}"]`;
        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);
            await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host || typeof host.getValue !== "function" || typeof host.setValue !== "function") {
                    return;
                }
                const currentValue = host.getValue();
                host.setValue(`${currentValue} Local draft`);
            }, cardSelector);

            const draftValue = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host || typeof host.getValue !== "function") {
                    return null;
                }
                return host.getValue();
            }, cardSelector);
            assert.ok(draftValue && draftValue.endsWith(" Local draft"), "typed draft should be present before snapshot");

            await page.evaluate(() => {
                const root = document.querySelector("[x-data]");
                if (!root) {
                    throw new Error("application root not found");
                }
                root.dispatchEvent(new CustomEvent("gravity:sync-snapshot-applied"));
            });

            await pause(page, 150);

            const postSnapshotState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return { editing: false, value: null };
                }
                const host = /** @type {any} */ (card).__markdownHost;
                const mode = host && typeof host.getMode === "function" ? host.getMode() : null;
                const value = host && typeof host.getValue === "function" ? host.getValue() : null;
                return {
                    editing: card.classList.contains("editing-in-place") && mode === "edit",
                    value
                };
            }, cardSelector);
            assert.equal(postSnapshotState.editing, true, "card should remain in edit mode after snapshot");
            assert.equal(postSnapshotState.value, draftValue, "unsaved draft should survive snapshot");

            await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host || typeof host.getValue !== "function" || typeof host.setValue !== "function") {
                    return;
                }
                host.setValue(`${host.getValue()} continues`);
            }, cardSelector);
            const continuedDraft = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                if (!host || typeof host.getValue !== "function") {
                    return null;
                }
                return host.getValue();
            }, cardSelector);
            assert.ok(continuedDraft && continuedDraft.endsWith(" Local draft continues"), "further typing should still be captured");
        } finally {
            await teardown();
        }
    });

    test("markdown editors expose browser grammar hints", async () => {
        const noteRecord = buildNoteRecord({
            noteId: "inline-grammar-check-fixture",
            markdownText: "Grammar baseline note."
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="inline-grammar-check-fixture"]`;

        try {
            await page.waitForSelector(getCodeMirrorInputSelector("#top-editor"), { timeout: 5000 });
            const topEditorAttributes = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .CodeMirror");
                const cm = wrapper ? /** @type {any} */ (wrapper).CodeMirror : null;
                const inputField = cm && typeof cm.getInputField === "function" ? cm.getInputField() : null;
                return {
                    inputSpellcheck: inputField?.getAttribute("spellcheck") ?? null,
                    inputAutocorrect: inputField?.getAttribute("autocorrect") ?? null,
                    inputAutocapitalize: inputField?.getAttribute("autocapitalize") ?? null
                };
            });
            assert.deepEqual(topEditorAttributes, {
                inputSpellcheck: "true",
                inputAutocorrect: "on",
                inputAutocapitalize: "sentences"
            });

            await page.waitForSelector(cardSelector, { timeout: 5000 });
            await enterCardEditMode(page, cardSelector);

            const cardAttributes = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const cmElement = card.querySelector(".CodeMirror");
                const cm = cmElement ? /** @type {any} */ (cmElement).CodeMirror : null;
                const inputField = cm && typeof cm.getInputField === "function" ? cm.getInputField() : null;
                return {
                    inputSpellcheck: inputField?.getAttribute("spellcheck") ?? null,
                    inputAutocorrect: inputField?.getAttribute("autocorrect") ?? null,
                    inputAutocapitalize: inputField?.getAttribute("autocapitalize") ?? null
                };
            }, cardSelector);

            assert.ok(cardAttributes, "Card attribute snapshot should resolve");
            assert.deepEqual(cardAttributes, {
                inputSpellcheck: "true",
                inputAutocorrect: "on",
                inputAutocapitalize: "sentences"
            });
        } finally {
            await teardown();
        }
    });

    test("double clicking a card enters inline edit mode", async () => {
        const { page, teardown } = await preparePage({
            records: [
                buildNoteRecord({
                    noteId: GN202_DOUBLE_CLICK_NOTE_ID,
                    markdownText: GN202_DOUBLE_CLICK_MARKDOWN
                })
            ]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN202_DOUBLE_CLICK_NOTE_ID}"]`;
        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            const clickPoint = await page.$eval(cardSelector, (card) => {
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const htmlView = card.querySelector(".note-html-view") || card;
                if (!(htmlView instanceof HTMLElement)) {
                    return null;
                }
                const rect = htmlView.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };
            });
            assert.ok(clickPoint, "click point should resolve inside the card");
            await page.mouse.click(clickPoint.x, clickPoint.y, { clickCount: 2, delay: 30 });
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 4000 });
        } finally {
            await teardown();
        }
    });

    test("touch tap enters inline edit mode", async () => {
        const { page, teardown } = await preparePage({
            records: [
                buildNoteRecord({
                    noteId: GN202_TAP_NOTE_ID,
                    markdownText: GN202_TAP_MARKDOWN
                })
            ]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN202_TAP_NOTE_ID}"]`;
        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            const tapPoint = await page.$eval(cardSelector, (card) => {
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const htmlView = card.querySelector(".note-html-view") || card;
                if (!(htmlView instanceof HTMLElement)) {
                    return null;
                }
                const rect = htmlView.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                };
            });
            assert.ok(tapPoint, "tap point should resolve inside the card");
            await page.touchscreen.tap(tapPoint.x, tapPoint.y);
            await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 4000 });
        } finally {
            await teardown();
        }
    });

    test("double clicking a different card focuses that card at the clicked location", async () => {
        const { page, teardown } = await preparePage({
            records: [
                buildNoteRecord({
                    noteId: GN81_CURRENT_EDIT_NOTE_ID,
                    markdownText: GN81_CURRENT_EDIT_MARKDOWN
                }),
                buildNoteRecord({
                    noteId: GN81_TARGET_NOTE_ID,
                    markdownText: GN81_TARGET_MARKDOWN
                }),
                buildNoteRecord({
                    noteId: GN81_TRAILING_NOTE_ID,
                    markdownText: GN81_TRAILING_MARKDOWN
                })
            ]
        });
        const currentEditSelector = `.markdown-block[data-note-id="${GN81_CURRENT_EDIT_NOTE_ID}"]`;
        const targetSelector = `.markdown-block[data-note-id="${GN81_TARGET_NOTE_ID}"]`;

        try {
            await page.waitForSelector(targetSelector);
            await enterCardEditMode(page, currentEditSelector);
            await page.waitForSelector(`${currentEditSelector}.editing-in-place`);

            const clickContext = await page.$eval(
                targetSelector,
                (card) => {
                    if (!(card instanceof HTMLElement)) {
                        return null;
                    }
                    const htmlView = card.querySelector(".note-html-view .markdown-content");
                    if (!(htmlView instanceof HTMLElement)) {
                        return null;
                    }
                    const htmlRect = htmlView.getBoundingClientRect();
                    const cardRect = card.getBoundingClientRect();
                    const doc = card.ownerDocument;

                    const candidates = [];
                    for (let offsetY = cardRect.top + 4; offsetY <= cardRect.bottom - 4; offsetY += 6) {
                        for (let offsetX = cardRect.left + 4; offsetX <= cardRect.right - 4; offsetX += 6) {
                            if (offsetX >= htmlRect.left && offsetX <= htmlRect.right
                                && offsetY >= htmlRect.top && offsetY <= htmlRect.bottom) {
                                continue;
                            }
                            const targetElement = doc.elementFromPoint(offsetX, offsetY);
                            if (!(targetElement instanceof Element)) {
                                continue;
                            }
                            if (!card.contains(targetElement)) {
                                continue;
                            }
                            if (targetElement.closest(".actions") || targetElement.closest(".note-task-checkbox")) {
                                continue;
                            }
                            let container = null;
                            if (typeof doc.caretRangeFromPoint === "function") {
                                const range = doc.caretRangeFromPoint(offsetX, offsetY);
                                container = range ? range.startContainer : null;
                            } else if (typeof doc.caretPositionFromPoint === "function") {
                                const position = doc.caretPositionFromPoint(offsetX, offsetY);
                                container = position ? position.offsetNode : null;
                            }
                            if (container && htmlView.contains(container)) {
                                continue;
                            }
                            candidates.push({
                                x: offsetX,
                                y: offsetY,
                                distance: Math.hypot(
                                    offsetX - (htmlRect.left + htmlRect.width / 2),
                                    offsetY - (htmlRect.top + htmlRect.height / 2)
                                )
                            });
                        }
                    }
                    if (candidates.length === 0) {
                        return null;
                    }
                    candidates.sort((a, b) => a.distance - b.distance);
                    const clickX = candidates[0].x;
                    const clickY = candidates[0].y;

                    const walker = doc.createTreeWalker(htmlView, NodeFilter.SHOW_TEXT);
                    let plainOffsetBase = 0;
                    let bestSegment = null;
                    while (walker.nextNode()) {
                        const node = walker.currentNode;
                        const text = typeof node.textContent === "string" ? node.textContent : "";
                        const length = text.length;
                        if (length === 0) {
                            continue;
                        }
                        const range = doc.createRange();
                        range.selectNodeContents(node);
                        const rects = Array.from(range.getClientRects());
                        range.detach?.();
                        if (rects.length === 0) {
                            plainOffsetBase += length;
                            continue;
                        }
                        rects.forEach((rect, index) => {
                            const verticalDistance = clickY < rect.top
                                ? rect.top - clickY
                                : clickY > rect.bottom
                                    ? clickY - rect.bottom
                                    : 0;
                            const horizontalDistance = clickX < rect.left
                                ? rect.left - clickX
                                : clickX > rect.right
                                    ? clickX - rect.right
                                    : 0;
                            const distance = Math.hypot(horizontalDistance, verticalDistance);
                            const segmentStart = plainOffsetBase + Math.floor(length * (index / rects.length));
                            const segmentEnd = plainOffsetBase + Math.floor(length * ((index + 1) / rects.length));
                            if (!bestSegment || distance < bestSegment.distance) {
                                bestSegment = {
                                    distance,
                                    plainStart: segmentStart,
                                    plainEnd: Math.max(segmentEnd, segmentStart + 1)
                                };
                            }
                        });
                        plainOffsetBase += length;
                    }
                    const plainTextLength = htmlView.textContent ? htmlView.textContent.length : 0;
                    if (!bestSegment) {
                        bestSegment = {
                            distance: 0,
                            plainStart: 0,
                            plainEnd: Math.max(plainTextLength, 1)
                        };
                    }
                    const targetOffset = Math.floor((bestSegment.plainStart + bestSegment.plainEnd) / 2);
                    return {
                        clickX,
                        clickY,
                        targetOffset,
                        plainStart: bestSegment.plainStart,
                        plainEnd: bestSegment.plainEnd
                    };
                }
            );
            assert.ok(clickContext, "Expected to compute click context for the control column interaction");

            const caretInside = await page.evaluate((selector, context) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const htmlView = card.querySelector(".note-html-view .markdown-content");
                if (!(htmlView instanceof HTMLElement)) {
                    return null;
                }
                const doc = card.ownerDocument;
                if (typeof doc.caretRangeFromPoint === "function") {
                    const range = doc.caretRangeFromPoint(context.clickX, context.clickY);
                    return range ? htmlView.contains(range.startContainer) : false;
                }
                if (typeof doc.caretPositionFromPoint === "function") {
                    const position = doc.caretPositionFromPoint(context.clickX, context.clickY);
                    return position ? htmlView.contains(position.offsetNode) : false;
                }
                return null;
            }, targetSelector, clickContext);
            assert.equal(caretInside, false, "Click context should fall outside htmlView text nodes for the regression scenario");

            await page.mouse.click(clickContext.clickX, clickContext.clickY, { clickCount: 2 });

            await page.waitForSelector(`${targetSelector}.editing-in-place`);
            await page.waitForSelector(getCodeMirrorInputSelector(targetSelector));
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && !card.classList.contains("editing-in-place");
            }, {}, currentEditSelector);

            const editingNoteId = await page.evaluate(() => {
                const editingCard = document.querySelector(".markdown-block.editing-in-place");
                if (!(editingCard instanceof HTMLElement)) {
                    return null;
                }
                return editingCard.getAttribute("data-note-id");
            });
            assert.equal(editingNoteId, GN81_TARGET_NOTE_ID, "Editing must switch to the card that was double clicked");

            const caretState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const codeMirror = card.querySelector(".CodeMirror");
                const host = Reflect.get(card, "__markdownHost");
                if (!codeMirror || !host) {
                    return null;
                }
                const cm = /** @type {any} */ (codeMirror).CodeMirror;
                if (!cm || typeof cm.getDoc !== "function") {
                    return null;
                }
                const doc = cm.getDoc();
                const cursor = doc.getCursor();
                const index = doc.indexFromPos(cursor);
                return {
                    index,
                    value: doc.getValue()
                };
            }, targetSelector);
            assert.ok(caretState, "Caret state should be retrievable after double clicking a different card");
            assert.equal(caretState.value, GN81_TARGET_MARKDOWN, "Editor value must match the target card markdown");

            const caretPlainOffset = computePlainOffsetForMarkdown(caretState.value, caretState.index);
            assert.ok(
                caretPlainOffset >= clickContext.plainStart
                && caretPlainOffset <= clickContext.plainEnd,
                `Caret should land within the nearest htmlView segment (plainOffset=${caretPlainOffset}, segment=[${clickContext.plainStart}, ${clickContext.plainEnd}])`
            );
            const tolerance = Math.max(2, Math.floor((clickContext.plainEnd - clickContext.plainStart) / 2));
            assert.ok(
                Math.abs(caretPlainOffset - clickContext.targetOffset) <= tolerance,
                `Caret should align with the control column click (expected≈${clickContext.targetOffset}, actual=${caretPlainOffset}, tolerance=${tolerance})`
            );
        } finally {
            await teardown();
        }
    });

});

test.describe("Markdown inline editor — actions", () => {

    test("card actions finalize editing and remain clickable", async () => {
        const seededRecords = [buildNoteRecord({
            noteId: PIN_FIRST_NOTE_ID,
            markdownText: PIN_FIRST_MARKDOWN
        })];
        const { page, teardown } = await preparePage({
            records: seededRecords
        });
        const cardSelector = `.markdown-block[data-note-id="${PIN_FIRST_NOTE_ID}"]`;
        const pinButtonSelector = `${cardSelector} .actions [data-action="toggle-pin"]`;

        try {
            await page.waitForSelector(cardSelector, { timeout: 5000 });
            const textareaSelector = await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(textareaSelector, { timeout: 5000 });
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && card.classList.contains("editing-in-place");
            }, { timeout: 5000 }, cardSelector);

            const baselineTelemetry = await beginCardEditingTelemetry(page, cardSelector);
            assert.ok(baselineTelemetry, "Expected to capture baseline telemetry while editing");
            assert.equal(baselineTelemetry.mode, "edit", "Card should be in edit mode before interacting with actions");
            assert.equal(baselineTelemetry.hasEditingClass, true, "Editing class must be present before interacting with actions");

            const initialPinnedState = await page.$eval(cardSelector, (card) => card.getAttribute("data-pinned"));
            assert.equal(initialPinnedState, "false", "Card should begin unpinned for the regression scenario");

            await page.waitForSelector(pinButtonSelector, { timeout: 5000 });
            await page.click(pinButtonSelector);

            const pinnedApplied = await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && card.dataset.pinned === "true";
            }, { timeout: 5000 }, cardSelector).catch(() => null);
            assert.ok(pinnedApplied, "Card should report pinned state after clicking the pin action");

            const exitedEditMode = await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return false;
                }
                const host = Reflect.get(card, "__markdownHost");
                const mode = host && typeof host.getMode === "function" ? host.getMode() : null;
                return !card.classList.contains("editing-in-place") && mode === "view";
            }, { timeout: 5000 }, cardSelector).catch(() => null);
            assert.ok(exitedEditMode, "Card should exit edit mode after toggling pin");

            const finalTelemetry = await collectCardEditingTelemetry(page, cardSelector);
            assert.ok(finalTelemetry, "Expected to collect telemetry after clicking actions while editing");
            assert.equal(finalTelemetry.mode, "view", "Card must exit edit mode after action click");
            assert.equal(finalTelemetry.hasEditingClass, false, "Editing class must be removed after action click");
            if (Array.isArray(finalTelemetry.modeTransitions)) {
                const viewIndex = finalTelemetry.modeTransitions.indexOf("view");
                assert.ok(viewIndex >= 0, "Mode transitions should include a shift to view mode");
                const revertedToEdit = finalTelemetry.modeTransitions.slice(viewIndex + 1).includes("edit");
                assert.equal(revertedToEdit, false, "Card must not fall back to edit mode after the action finishes");
            }
            if (Array.isArray(finalTelemetry.editClassTransitions) && finalTelemetry.editClassTransitions.length > 0) {
                const removalIndex = finalTelemetry.editClassTransitions.indexOf(false);
                assert.ok(removalIndex >= 0, "Editing class transitions should record removal after the action click");
                const reattached = finalTelemetry.editClassTransitions.slice(removalIndex + 1).some((value) => value === true);
                assert.equal(reattached, false, "Editing class must remain removed after the action click");
            }
        } finally {
            await teardown();
        }
    });

    test("finalizing inline edit rebuilds htmlView without badge errors", async () => {
        const seededRecords = [buildNoteRecord({
            noteId: NOTE_ID,
            markdownText: INITIAL_MARKDOWN
        })];
        const { page, teardown } = await preparePage({ records: seededRecords });
        const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;
        const capturedErrors = [];

        const handlePageError = (error) => {
            const message = error && typeof error.message === "string" ? error.message : String(error);
            capturedErrors.push(message);
        };

        page.on("pageerror", handlePageError);

        try {
            await page.waitForSelector(cardSelector);
            await enterCardEditMode(page, cardSelector);
            await focusCardEditor(page, cardSelector, "end");

            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");

            await page.waitForSelector(`${cardSelector}:not(.editing-in-place)`);
            await page.waitForSelector(`${cardSelector} .note-html-view .markdown-content`);
            const badgeCount = await page.$$eval(`${cardSelector} .note-badges`, (elements) => elements.length);
            assert.equal(badgeCount, 1, "Card should retain a single badge container after finalizing");
            assert.equal(capturedErrors.length, 0, `Expected no page errors, received: ${capturedErrors.join(" | ")}`);
        } finally {
            page.off("pageerror", handlePageError);
            await teardown();
        }
    });

    test("shift-enter finalizes inline editing", async () => {
        const seededRecords = [buildNoteRecord({
            noteId: NOTE_ID,
            markdownText: INITIAL_MARKDOWN,
            attachments: {}
        })];

        const { page, teardown } = await preparePage({ records: seededRecords });
        const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector);
            await enterCardEditMode(page, cardSelector);
            await focusCardEditor(page, cardSelector, "end");
            const baselineState = await beginCardEditingTelemetry(page, cardSelector);
            assert.ok(baselineState, "Expected baseline telemetry after entering edit mode");
            assert.equal(baselineState.mode, "edit", "Shift+Enter baseline should begin in edit mode");
            assert.equal(baselineState.hasEditingClass, true, "Shift+Enter baseline should carry editing class");

            await page.keyboard.type("\nAdditional content line");

            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");

            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && !card.classList.contains("editing-in-place");
            }, {}, cardSelector);
            await pause(page, 50);

            const telemetry = await collectCardEditingTelemetry(page, cardSelector);
            assert.ok(telemetry, "Expected to collect telemetry after Shift+Enter submission");
            assert.equal(telemetry.mode, "view", "Shift+Enter should leave the card in view mode");
            assert.equal(telemetry.hasEditingClass, false, "Editing class must remain removed after Shift+Enter");
            if (Array.isArray(telemetry.modeTransitions)) {
                const firstViewIndex = telemetry.modeTransitions.indexOf("view");
                assert.ok(firstViewIndex >= 0, "Shift+Enter should emit a transition to view mode");
                if (firstViewIndex >= 0) {
                    const reenteredEdit = telemetry.modeTransitions.slice(firstViewIndex + 1).includes("edit");
                    assert.equal(reenteredEdit, false, "Card must not re-enter edit mode after Shift+Enter submission");
                }
            }
            if (Array.isArray(telemetry.editClassTransitions) && telemetry.editClassTransitions.length > 0) {
                const firstRemoval = telemetry.editClassTransitions.indexOf(false);
                assert.ok(firstRemoval >= 0, "Editing class transitions should record removal after Shift+Enter");
                if (firstRemoval >= 0) {
                    const reattached = telemetry.editClassTransitions.slice(firstRemoval + 1).some((value) => value === true);
                    assert.equal(reattached, false, "Editing class must not be reattached after Shift+Enter finalization");
                }
            }

            const updatedHtmlView = await page.$eval(`${cardSelector} .markdown-content`, (element) => element.textContent || "");
            assert.ok(updatedHtmlView.includes("Additional content line"), "Shift+Enter should submit edits and update the htmlView");
        } finally {
            await teardown();
        }
    });

    test("inline editing keeps actions column fixed and editor aligned", async () => {
        const noteRecord = buildNoteRecord({
            noteId: LAYOUT_NOTE_ID,
            markdownText: LAYOUT_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${LAYOUT_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector);

            const baseline = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const actions = card.querySelector(".actions");
                const content = card.querySelector(".markdown-content");
                if (!(actions instanceof HTMLElement) || !(content instanceof HTMLElement)) {
                    return null;
                }
                const cardRect = card.getBoundingClientRect();
                const actionsRect = actions.getBoundingClientRect();
                const contentRect = content.getBoundingClientRect();
                return {
                    cardLeft: cardRect.left,
                    cardRight: cardRect.right,
                    actionsLeft: actionsRect.left,
                    actionsWidth: actionsRect.width,
                    contentLeft: contentRect.left,
                    contentRight: contentRect.right
                };
            }, cardSelector);
            assert.ok(baseline, "Baseline layout should be measurable");

            await enterCardEditMode(page, cardSelector);

            const layoutAfterEdit = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const actions = card.querySelector(".actions");
                const codeMirror = card.querySelector(".CodeMirror");
                if (!(actions instanceof HTMLElement) || !(codeMirror instanceof HTMLElement)) {
                    return null;
                }
                const actionsRect = actions.getBoundingClientRect();
                const codeMirrorRect = codeMirror.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const content = card.querySelector(".markdown-content");
                const htmlViewDisplay = content instanceof HTMLElement
                    ? window.getComputedStyle(content).display
                    : "none";
                return {
                    actionsLeft: actionsRect.left,
                    actionsWidth: actionsRect.width,
                    codeMirrorLeft: codeMirrorRect.left,
                    codeMirrorRight: codeMirrorRect.right,
                    cardLeft: cardRect.left,
                    htmlViewDisplay
                };
            }, cardSelector);
            assert.ok(layoutAfterEdit, "Layout after entering edit mode should be measurable");

            assert.ok(Math.abs(layoutAfterEdit.actionsLeft - baseline.actionsLeft) <= 1, "Actions column must stay anchored");
            assert.ok(Math.abs(layoutAfterEdit.actionsWidth - baseline.actionsWidth) <= 1, "Actions column width must remain unchanged");

            assert.equal(layoutAfterEdit.htmlViewDisplay, "none", "Rendered htmlView hides when editing");
            assert.ok(layoutAfterEdit.codeMirrorLeft <= baseline.contentLeft + 1, "Editor should align with original content column");
            assert.ok(layoutAfterEdit.codeMirrorRight <= baseline.actionsLeft - 4, "Editor must not overlap the actions column");
            assert.ok(layoutAfterEdit.codeMirrorLeft < layoutAfterEdit.actionsLeft, "Editor must remain left of the actions controls");
            assert.ok(layoutAfterEdit.codeMirrorLeft >= baseline.contentLeft - 1, "Editor should start near the card's left padding");
        } finally {
            await teardown();
        }
    });

        test("inline editor saves appended markdown", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: NOTE_ID,
                markdownText: INITIAL_MARKDOWN,
                attachments: {}
            })];

            const { page, teardown } = await preparePage({ records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;

            try {
                await page.waitForSelector(cardSelector);
                const initialCardHeight = await page.$eval(cardSelector, (el) => el.clientHeight);

                await enterCardEditMode(page, cardSelector);
                await focusCardEditor(page, cardSelector, "end");
                await page.keyboard.type("\nAdditional line one.\nAdditional line two.\nAdditional line three.");

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");

                await page.waitForFunction((selector) => {
                    const card = document.querySelector(selector);
                    return card instanceof HTMLElement && !card.classList.contains("editing-in-place");
                }, {}, cardSelector);

                const finalCardHeight = await page.$eval(cardSelector, (el) => el.clientHeight);
                assert.ok(finalCardHeight >= initialCardHeight, "Card height stays consistent after save");

                const storedMarkdown = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? record.markdownText : null;
                }, NOTE_ID);
                assert.ok(storedMarkdown?.includes("Additional line three."));
            } finally {
                await teardown();
            }
        });

        test("checkbox toggles from htmlView persist to markdown", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: TASK_NOTE_ID,
                markdownText: TASK_MARKDOWN,
                attachments: {}
            })];

            const { page, teardown } = await preparePage({ records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${TASK_NOTE_ID}"]`;
            const checkboxSelector = `${cardSelector} input[type="checkbox"][data-task-index="0"]`;

            try {
                await page.waitForSelector(cardSelector);
                await page.waitForSelector(checkboxSelector);

                await page.click(checkboxSelector);
                await page.waitForFunction((selector) => {
                    const card = document.querySelector(selector);
                    if (!(card instanceof HTMLElement)) return false;
                    const host = /** @type {any} */ (card).__markdownHost;
                    return Boolean(host && typeof host.getValue === "function" && host.getValue().includes("- [x] Pending task"));
                }, {}, cardSelector);

                let storedMarkdown = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? record.markdownText : null;
                }, TASK_NOTE_ID);
                assert.ok(storedMarkdown?.includes("- [x] Pending task"));

                await page.waitForSelector(checkboxSelector);
                await page.click(checkboxSelector);
                await page.waitForFunction((selector) => {
                    const card = document.querySelector(selector);
                    if (!(card instanceof HTMLElement)) return false;
                    const host = /** @type {any} */ (card).__markdownHost;
                    return Boolean(host && typeof host.getValue === "function" && host.getValue().includes("- [ ] Pending task"));
                }, {}, cardSelector);

                storedMarkdown = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? record.markdownText : null;
                }, TASK_NOTE_ID);
                assert.ok(storedMarkdown?.includes("- [ ] Pending task"));
            } finally {
                await teardown();
            }
        });

        test("inline editor bracket pairing and closing skip duplicates", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: BRACKET_NOTE_ID,
                markdownText: BRACKET_MARKDOWN,
                attachments: {}
            })];

            const { page, teardown } = await preparePage({ records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${BRACKET_NOTE_ID}"]`;
            const hiddenTextareaSelector = `${cardSelector} .markdown-editor`;

            try {
                await page.waitForSelector(cardSelector);
                await enterCardEditMode(page, cardSelector);
                await page.evaluate((selector) => {
                    const card = document.querySelector(selector);
                    if (!(card instanceof HTMLElement)) return;
                    const host = /** @type {any} */ (card).__markdownHost;
                    host?.setValue?.("");
                    host?.setCaretPosition?.("start");
                }, cardSelector);
                await focusCardEditor(page, cardSelector, "start");
                await page.keyboard.type("[");

                let textareaState = await page.$eval(hiddenTextareaSelector, (el) => ({
                    value: el.value,
                    selectionStart: el.selectionStart ?? 0,
                    selectionEnd: el.selectionEnd ?? 0
                }));
                assert.equal(textareaState.value, "[ ] ");
                assert.equal(textareaState.selectionStart, textareaState.value.length);
                assert.equal(textareaState.selectionEnd, textareaState.selectionStart);

                await page.evaluate((selector) => {
                    const card = document.querySelector(selector);
                    if (!(card instanceof HTMLElement)) return;
                    const host = /** @type {any} */ (card).__markdownHost;
                    host?.setValue?.("[ ] ");
                }, cardSelector);
                const closingIndex = await page.evaluate((selector) => {
                    const card = document.querySelector(selector);
                    if (!(card instanceof HTMLElement)) return 0;
                    const host = /** @type {any} */ (card).__markdownHost;
                    if (!host || typeof host.getValue !== "function") return 0;
                    const value = host.getValue();
                    const index = value.indexOf("]");
                    return index >= 0 ? index : value.length;
                }, cardSelector);
                await focusCardEditor(page, cardSelector, closingIndex);
                await page.keyboard.type("]");

                textareaState = await page.$eval(hiddenTextareaSelector, (el) => ({
                    value: el.value,
                    selectionStart: el.selectionStart ?? 0,
                    selectionEnd: el.selectionEnd ?? 0
                }));
                assert.equal(textareaState.value, "[ ] ", "existing closing bracket is skipped");
                assert.equal(textareaState.selectionStart, closingIndex + 1);
                assert.equal(textareaState.selectionEnd, closingIndex + 1);
            } finally {
                await teardown();
            }
        });

        test("delete line shortcut removes the active row", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: DELETE_LINE_NOTE_ID,
                markdownText: DELETE_LINE_MARKDOWN,
                attachments: {}
            })];

            const { page, teardown } = await preparePage({ records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${DELETE_LINE_NOTE_ID}"]`;

            try {
                await page.waitForSelector(cardSelector);
                await enterCardEditMode(page, cardSelector);
                await focusCardEditor(page, cardSelector, 1);

                await page.keyboard.down("Control");
                await page.keyboard.down("Shift");
                await page.keyboard.press("KeyK");
                await page.keyboard.up("Shift");
                await page.keyboard.up("Control");

                const editorState = await getCardEditorState(page, cardSelector);
                assert.ok(editorState);
                assert.equal(editorState.value, "Beta", "First line removed");
            } finally {
                await teardown();
            }
        });

        test("duplicate line shortcut duplicates the active row", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: DELETE_LINE_NOTE_ID,
                markdownText: DELETE_LINE_MARKDOWN,
                attachments: {}
            })];

            const { page, teardown } = await preparePage({ records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${DELETE_LINE_NOTE_ID}"]`;

            try {
                await page.waitForSelector(cardSelector);
                await enterCardEditMode(page, cardSelector);
                await focusCardEditor(page, cardSelector, "start");

                await page.keyboard.down("Control");
                await page.keyboard.down("Shift");
                await page.keyboard.press("KeyD");
                await page.keyboard.up("Shift");
                await page.keyboard.up("Control");

                const editorState = await getCardEditorState(page, cardSelector);
                assert.ok(editorState);
                assert.equal(editorState.value.split("\n")[0], "Alpha", "First line remains Alpha");
                assert.equal(editorState.value.split("\n")[1], "Alpha", "Duplicated line inserted");
            } finally {
                await teardown();
            }
        });

        test("ordered list renumbers on enter", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: ORDERED_RENUMBER_NOTE_ID,
                markdownText: ORDERED_RENUMBER_MARKDOWN,
                attachments: {}
            })];

            const { page, teardown } = await preparePage({ records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${ORDERED_RENUMBER_NOTE_ID}"]`;

            try {
                await page.waitForSelector(cardSelector);
                await enterCardEditMode(page, cardSelector);
                const caretIndex = await page.evaluate((selector) => {
                    const card = document.querySelector(selector);
                    if (!(card instanceof HTMLElement)) return 0;
                    const host = /** @type {any} */ (card).__markdownHost;
                    if (!host || typeof host.getValue !== "function") return 0;
                    const value = host.getValue();
                    const bravoIndex = value.indexOf("Bravo");
                    return bravoIndex >= 0 ? bravoIndex + "Bravo".length : value.length;
                }, cardSelector);
                await focusCardEditor(page, cardSelector, caretIndex);

                await page.keyboard.press("Enter");

                const editorState = await getCardEditorState(page, cardSelector);
                assert.ok(editorState);
                const lines = editorState.value.split("\n");
                assert.equal(lines.length, 4);
                lines.forEach((line, index) => {
                    assert.ok(line.startsWith(`${index + 1}. `), `Line ${index + 1} maintains numbering`);
                });
            } finally {
                await teardown();
            }
        });
    });


async function enterCardEditMode(page, cardSelector) {
    await page.click(`${cardSelector} .note-html-view`, { clickCount: 2 });
    await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 5000 });
    const codeMirrorTextarea = getCodeMirrorInputSelector(cardSelector);
    await page.waitForSelector(codeMirrorTextarea, { timeout: 5000 });
    return codeMirrorTextarea;
}

async function focusCardEditor(page, cardSelector, caretPosition = "end") {
    const textareaSelector = getCodeMirrorInputSelector(cardSelector);
    await page.waitForSelector(textareaSelector);
    await page.evaluate((selector, position) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) return;
        const host = /** @type {any} */ (card).__markdownHost;
        if (!host || typeof host.setCaretPosition !== "function") return;
        host.setCaretPosition(position);
    }, cardSelector, caretPosition);
    await page.focus(textareaSelector);
}

async function getCardEditorState(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) return null;
        const wrapper = card.querySelector('.CodeMirror');
        if (!wrapper) return null;
        const cm = /** @type {any} */ (wrapper).CodeMirror;
        if (!cm) return null;
        const cursor = cm.getCursor();
        return { value: cm.getValue(), cursor };
    }, cardSelector);
}

function buildNoteRecord({ noteId, markdownText, attachments = {}, pinned = false, classification = null }) {
    const timestamp = new Date().toISOString();
    const record = {
        noteId,
        markdownText,
        attachments,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        pinned
    };
    if (classification && typeof classification === "object") {
        record.classification = classification;
    }
    return record;
}

async function ensureCardInViewMode(page, cardSelector, originalMarkdown) {
    await page.evaluate((selector, markdown) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return;
        }
        const host = Reflect.get(card, "__markdownHost");
        if (!host || typeof host.setMode !== "function") {
            return;
        }
        host.setMode("view");
        if (typeof markdown === "string" && typeof host.setValue === "function") {
            host.setValue(markdown);
        }
    }, cardSelector, originalMarkdown ?? null);
    await page.waitForFunction((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return false;
        }
        const host = Reflect.get(card, "__markdownHost");
        return Boolean(host && typeof host.getMode === "function" && host.getMode() === "view");
    }, {}, cardSelector);
}

async function waitForViewportStability(page, cardSelector, maximumFrames = 24, tolerance = 0.75) {
    await page.evaluate(async (selector, frames, epsilon) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return;
        }
        const waitForFrame = () => new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
        let previousTop = card.getBoundingClientRect().top;
        for (let iteration = 0; iteration < frames; iteration += 1) {
            await waitForFrame();
            const currentTop = card.getBoundingClientRect().top;
            if (Math.abs(currentTop - previousTop) <= epsilon) {
                return;
            }
            previousTop = currentTop;
        }
    }, cardSelector, maximumFrames, tolerance);
}

async function pause(page, durationMs) {
    await page.evaluate((ms) => new Promise((resolve) => {
        setTimeout(resolve, typeof ms === "number" ? Math.max(ms, 0) : 0);
    }), durationMs);
}

async function preparePage({ records, htmlViewBubbleDelayMs, waitUntil = "domcontentloaded" }) {
    const { page, teardown } = await createSharedPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload, bubbleDelay) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
        window.__gravityForceMarkdownEditor = true;
        if (typeof bubbleDelay === "number") {
            window.__gravityHtmlViewBubbleDelayMs = bubbleDelay;
        }
    }, appConfig.storageKey, serialized, typeof htmlViewBubbleDelayMs === "number" ? htmlViewBubbleDelayMs : null);

    await page.goto(PAGE_URL, { waitUntil });
    await page.waitForSelector(getCodeMirrorInputSelector("#top-editor"));
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return { page, teardown };
}

async function beginCardEditingTelemetry(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return null;
        }
        const host = Reflect.get(card, "__markdownHost");
        if (!host || typeof host.getMode !== "function" || typeof host.on !== "function" || typeof host.off !== "function") {
            return null;
        }

        const existingListener = Reflect.get(card, "__modeChangeListener");
        if (typeof existingListener === "function") {
            host.off("modechange", existingListener);
        }

        const modeTransitions = [];
        const modeListener = ({ mode }) => {
            modeTransitions.push(mode);
        };
        host.on("modechange", modeListener);
        Reflect.set(card, "__modeTransitions", modeTransitions);
        Reflect.set(card, "__modeChangeListener", modeListener);

        const priorObserver = Reflect.get(card, "__editClassObserver");
        if (priorObserver && typeof priorObserver.disconnect === "function") {
            priorObserver.disconnect();
        }

        const editClassTransitions = [];
        const observer = new MutationObserver(() => {
            editClassTransitions.push(card.classList.contains("editing-in-place"));
        });
        observer.observe(card, { attributes: true, attributeFilter: ["class"] });
        Reflect.set(card, "__editClassObserver", observer);
        Reflect.set(card, "__editClassTransitions", editClassTransitions);

        return {
            mode: host.getMode(),
            hasEditingClass: card.classList.contains("editing-in-place")
        };
    }, cardSelector);
}

async function collectCardEditingTelemetry(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return null;
        }
        const host = Reflect.get(card, "__markdownHost");
        const listener = Reflect.get(card, "__modeChangeListener");
        if (host && typeof host.off === "function" && typeof listener === "function") {
            host.off("modechange", listener);
        }
        Reflect.deleteProperty(card, "__modeChangeListener");

        const modeTransitions = Reflect.get(card, "__modeTransitions");
        Reflect.deleteProperty(card, "__modeTransitions");

        const observer = Reflect.get(card, "__editClassObserver");
        if (observer && typeof observer.disconnect === "function") {
            observer.disconnect();
        }
        Reflect.deleteProperty(card, "__editClassObserver");

        const editClassTransitions = Reflect.get(card, "__editClassTransitions");
        Reflect.deleteProperty(card, "__editClassTransitions");

        return {
            mode: host && typeof host.getMode === "function" ? host.getMode() : null,
            hasEditingClass: card.classList.contains("editing-in-place"),
            modeTransitions: Array.isArray(modeTransitions) ? [...modeTransitions] : [],
            editClassTransitions: Array.isArray(editClassTransitions) ? [...editClassTransitions] : []
        };
    }, cardSelector);
}

function computePlainOffsetForMarkdown(markdown, markdownIndex) {
    const source = typeof markdown === "string" ? markdown : "";
    const limit = Math.max(Math.min(typeof markdownIndex === "number" ? markdownIndex : 0, source.length), 0);
    let plainOffset = 0;
    let pointer = 0;
    while (pointer < limit) {
        const current = source[pointer];
        const next = source[pointer + 1];
        if (current === "*" && next === "*") {
            pointer += 2;
            continue;
        }
        if (current === "_" && next === "_") {
            pointer += 2;
            continue;
        }
        if (current === "`") {
            pointer += 1;
            continue;
        }
        if (current === "[") {
            pointer += 1;
            continue;
        }
        if (current === "]") {
            pointer += 1;
            if (source[pointer] === "(") {
                pointer += 1;
                while (pointer < source.length && pointer < limit && source[pointer] !== ")") {
                    pointer += 1;
                }
                if (pointer < source.length && source[pointer] === ")") {
                    pointer += 1;
                }
            }
            continue;
        }
        plainOffset += 1;
        pointer += 1;
    }
    return plainOffset;
}
