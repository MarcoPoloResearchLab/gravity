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
const PREVIEW_CARET_NOTE_ID = "inline-preview-caret-fixture";
const PREVIEW_CARET_MARKDOWN = "Alpha **bold** bravo [link](https://example.com) charlie delta.";
const PREVIEW_COMPLEX_NOTE_ID = "inline-preview-complex-fixture";
const PREVIEW_COMPLEX_MARKDOWN = [
    "Alpha anchor paragraph lines the preview.",
    "Second pass mixes **bold**, `inline code`, and [link targets](https://example.com) for caret mapping.",
    "Third stanza finishes the markdown sample."
].join("\n");
const PREVIEW_LIST_NOTE_ID = "inline-preview-list-fixture";
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
    "Follow-up paragraph with extended detail so the preview truncates before editing takes place, including `inline code` and additional emphasis for measurement.",
    "",
    "Supporting paragraph three elaborates on measurements and ensures the preview develops a fade-out overlay in view mode.",
    "",
    "Closing paragraph adds further depth to guarantee the card must grow downward rather than shifting upward."
].join("\n");
const GN48_NOTE_ID = "inline-editing-click-fixture";
const GN48_MARKDOWN = [
    "# Editing Click Fixture",
    "",
    "This note validates that re-clicking an already-editing card keeps the editor in place without flickering back to preview.",
    "",
    "The body includes multiple paragraphs so the editor has height and padding beyond the CodeMirror viewport.",
    "",
    "Double clicking different parts of the card should merely reposition the caret."
].join("\n");

test.describe("Markdown inline editor", () => {

    test("top editor clears after submitting long note", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });
        const cmTextarea = "#top-editor .CodeMirror textarea";

        try {
            await page.waitForSelector(cmTextarea);

            const longNote = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of extended content.`).join("\n");
            await page.focus(cmTextarea);
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

    test("top editor grows when multiline input is typed", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });
        const cmTextarea = "#top-editor .CodeMirror textarea";

        try {
            await page.waitForSelector(cmTextarea);
            const heightBefore = await page.evaluate(() => {
                const wrapper = document.querySelector("#top-editor .markdown-block.top-editor");
                return wrapper instanceof HTMLElement ? wrapper.getBoundingClientRect().height : 0;
            });

            const multiline = Array.from({ length: 6 }, (_, index) => `Line ${index + 1} content`).join("\n");
            await page.focus(cmTextarea);
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

    test("top editor hides EasyMDE preview pane", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });

        try {
            await page.waitForSelector("#top-editor .EasyMDEContainer");
            const previewVisibility = await page.evaluate(() => {
                const preview = document.querySelector("#top-editor .EasyMDEContainer .editor-preview-side");
                if (!(preview instanceof HTMLElement)) {
                    return null;
                }
                const computed = window.getComputedStyle(preview);
                return { display: computed.display, width: computed.width };
            });

            assert.ok(previewVisibility, "Preview element should exist in DOM for measurement");
            assert.equal(previewVisibility.display, "none", "EasyMDE preview pane must remain hidden in the top editor");
            assert.equal(previewVisibility.width, "0px", "EasyMDE preview pane should not consume horizontal space");
        } finally {
            await teardown();
        }
    });

    test("top editor respects external focus selections", async () => {
        const { page, teardown } = await preparePage({
            records: []
        });
        const cmTextarea = "#top-editor .CodeMirror textarea";

        try {
            await page.waitForSelector(cmTextarea);

            await page.focus(cmTextarea);

            const externalFocus = await page.evaluate(() => {
                const textarea = document.querySelector("#top-editor .CodeMirror textarea");
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
                const textarea = document.querySelector("#top-editor .CodeMirror textarea");
                if (textarea instanceof HTMLTextAreaElement) {
                    textarea.focus();
                }
                return document.activeElement instanceof HTMLTextAreaElement;
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
                metrics.cardScrollHeight <= metrics.cardClientHeight + 1,
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
                    height
                };
            });

            assert.ok(styleSnapshot, "Top editor wrapper should be present");
            assert.equal(styleSnapshot.background, "rgba(0, 0, 0, 0)", "Top editor stays transparent like baseline notes");
            assert.equal(styleSnapshot.paddingTop, "0px", "Top editor must not introduce extra top padding");
            assert.equal(styleSnapshot.paddingBottom, "0px", "Top editor must not introduce extra bottom padding");
            assert.equal(styleSnapshot.borderBottomWidth, "0px", "Top editor must not draw a separating border");
            assert.ok(styleSnapshot.height <= 80, `Top editor height should stay compact, received ${styleSnapshot.height}`);
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
            assert.ok(parseFloat(dividerSnapshot.bottomWidth ?? "0") <= 1, "Bottom border must be 1px or thinner");
            assert.equal(
                dividerSnapshot.bottomColor,
                "rgba(32, 35, 43, 0.35)",
                "Bottom divider color must remain muted"
            );
        } finally {
            await teardown();
        }
    });

    test("preview click enters edit mode at click point without shifting card upward", async () => {
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
                    bottom: rect.bottom
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
                const previewText = await page.$eval(`${cardSelector} .markdown-content`, (element) => {
                    if (!(element instanceof HTMLElement)) {
                        return "";
                    }
                    return element.textContent || "";
                });
                assert.fail(`The preview should expose the target substring for clicking. preview="${previewText}" target="${targetSubstring}"`);
            }

            await page.mouse.click(clickPoint.x, clickPoint.y);
            await page.waitForSelector(`${cardSelector}.editing-in-place`);
            await page.waitForSelector(`${cardSelector} .CodeMirror textarea`);

            const layoutAfter = await page.$eval(cardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const rect = element.getBoundingClientRect();
                return {
                    top: rect.top,
                    height: rect.height,
                    bottom: rect.bottom
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
                Math.abs(layoutAfter.top - layoutBefore.top) <= 1,
                `Card top must stay anchored (before=${layoutBefore.top}, after=${layoutAfter.top}, scrollBefore=${scrollBefore}, scrollAfter=${scrollAfter}, maxBefore=${maxScrollBefore}, maxAfter=${maxScrollAfter})`
            );
            assert.ok(
                layoutAfter.height >= layoutBefore.height + 24,
                `Card should grow downward instead of shrinking (before=${layoutBefore.height}, after=${layoutAfter.height})`
            );
            assert.ok(
                layoutAfter.bottom >= layoutBefore.bottom + 20,
                `Bottom edge should extend downward (before=${layoutBefore.bottom}, after=${layoutAfter.bottom})`
            );

            assert.ok(
                Math.abs(scrollAfter - scrollBefore) <= 2,
                `Viewport scroll should remain stable (before=${scrollBefore}, after=${scrollAfter})`
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

    test("clicking an already editing card keeps edit mode active", async () => {
        const noteRecord = buildNoteRecord({
            noteId: GN48_NOTE_ID,
            markdownText: GN48_MARKDOWN
        });
        const { page, teardown } = await preparePage({
            records: [noteRecord]
        });
        const cardSelector = `.markdown-block[data-note-id="${GN48_NOTE_ID}"]`;

        try {
            await page.waitForSelector(cardSelector);
            const textareaSelector = await enterCardEditMode(page, cardSelector);
            await page.waitForSelector(textareaSelector);
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && card.classList.contains("editing-in-place");
            }, {}, cardSelector);

            const baselineState = await beginCardEditingTelemetry(page, cardSelector);
            assert.ok(baselineState, "Expected to capture initial editor state");
            assert.equal(baselineState.mode, "edit", "Card should begin in edit mode");
            assert.equal(baselineState.hasEditingClass, true, "Card should carry editing-in-place class");

            const cardClickTarget = await page.$eval(cardSelector, (element) => {
                const rect = element.getBoundingClientRect();
                return {
                    x: rect.right - Math.max(6, Math.min(rect.width / 8, 12)),
                    y: rect.top + rect.height / 2
                };
            });
            await page.mouse.click(cardClickTarget.x, cardClickTarget.y);
            await pause(page, 50);

            const postClickState = await collectCardEditingTelemetry(page, cardSelector);
            assert.ok(postClickState, "Expected to capture post-click editor state");
            assert.equal(postClickState.mode, "edit", "Card must remain in edit mode after redundant click");
            assert.equal(postClickState.hasEditingClass, true, "Card should keep editing-in-place class after redundant click");
            if (Array.isArray(postClickState.modeTransitions)) {
                assert.ok(
                    !postClickState.modeTransitions.includes("view"),
                    `Mode transitions must not include view: ${postClickState.modeTransitions.join(", ")}`
                );
            }
            if (Array.isArray(postClickState.editClassTransitions) && postClickState.editClassTransitions.length > 0) {
                const removed = postClickState.editClassTransitions.some((value) => value === false);
                assert.equal(removed, false, "Editing class should never be removed during redundant click interactions");
            }
        } finally {
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

            const updatedPreview = await page.$eval(`${cardSelector} .markdown-content`, (element) => element.textContent || "");
            assert.ok(updatedPreview.includes("Additional content line"), "Shift+Enter should submit edits and update the preview");
        } finally {
            await teardown();
        }
    });

    test("inline editor releases focus when card action receives focus", async () => {
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

            const focusResult = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return { focused: false, action: null };
                }
                const button = card.querySelector(".actions .action-button");
                if (!(button instanceof HTMLElement)) {
                    return { focused: false, action: null };
                }
                if (typeof button.focus === "function") {
                    button.focus();
                }
                return {
                    focused: document.activeElement === button,
                    action: button.dataset.action || null
                };
            }, cardSelector);
            assert.equal(focusResult.focused, true, "Card action button should receive focus");

            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && !card.classList.contains("editing-in-place");
            }, {}, cardSelector);

            const finalState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                const activeElement = document.activeElement;
                return {
                    hasEditingClass: card.classList.contains("editing-in-place"),
                    mode: host && typeof host.getMode === "function" ? host.getMode() : null,
                    activeTagName: activeElement ? activeElement.tagName : null,
                    activeAction: activeElement instanceof HTMLElement ? (activeElement.dataset.action || null) : null
                };
            }, cardSelector);

            assert.ok(finalState, "Expected to capture final editor state");
            assert.equal(finalState.hasEditingClass, false, "Card should exit inline editing after focus leaves");
            assert.equal(finalState.mode, "view", "Editor host should return to view mode after focus leaves");
            assert.equal(finalState.activeTagName, "BUTTON", "Focus should remain on the action button after blur");
            assert.equal(finalState.activeAction, focusResult.action, "Focused action should remain active after blur");
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
                const content = card.querySelector(".markdown-content");
                if (!(actions instanceof HTMLElement) || !(codeMirror instanceof HTMLElement) || !(content instanceof HTMLElement)) {
                    return null;
                }
                const actionsRect = actions.getBoundingClientRect();
                const codeMirrorRect = codeMirror.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const contentStyles = window.getComputedStyle(content);
                return {
                    actionsLeft: actionsRect.left,
                    actionsWidth: actionsRect.width,
                    codeMirrorLeft: codeMirrorRect.left,
                    codeMirrorRight: codeMirrorRect.right,
                    cardLeft: cardRect.left,
                    previewDisplay: contentStyles.display
                };
            }, cardSelector);
            assert.ok(layoutAfterEdit, "Layout after entering edit mode should be measurable");

            assert.ok(Math.abs(layoutAfterEdit.actionsLeft - baseline.actionsLeft) <= 1, "Actions column must stay anchored");
            assert.ok(Math.abs(layoutAfterEdit.actionsWidth - baseline.actionsWidth) <= 1, "Actions column width must remain unchanged");

            assert.equal(layoutAfterEdit.previewDisplay, "none", "Rendered preview hides when editing");
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

        test("checkbox toggles from preview persist to markdown", async () => {
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
    await page.click(`${cardSelector} .note-preview`);
    await page.waitForSelector(`${cardSelector}.editing-in-place`);
    const codeMirrorTextarea = `${cardSelector} .CodeMirror textarea`;
    await page.waitForSelector(codeMirrorTextarea);
    return codeMirrorTextarea;
}

async function focusCardEditor(page, cardSelector, caretPosition = "end") {
    const textareaSelector = `${cardSelector} .CodeMirror textarea`;
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

function buildNoteRecord({ noteId, markdownText, attachments = {}, pinned = false }) {
    const timestamp = new Date().toISOString();
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        pinned
    };
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

async function preparePage({ records, previewBubbleDelayMs, waitUntil = "domcontentloaded" }) {
    const { page, teardown } = await createSharedPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload, bubbleDelay) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
        window.__gravityForceMarkdownEditor = true;
        if (typeof bubbleDelay === "number") {
            window.__gravityPreviewBubbleDelayMs = bubbleDelay;
        }
    }, appConfig.storageKey, serialized, typeof previewBubbleDelayMs === "number" ? previewBubbleDelayMs : null);

    await page.goto(PAGE_URL, { waitUntil });
    await page.waitForSelector("#top-editor .CodeMirror textarea");
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return { page, teardown };
}

async function pause(page, durationMs) {
    await page.evaluate((ms) => new Promise((resolve) => {
        setTimeout(resolve, typeof ms === "number" ? Math.max(ms, 0) : 0);
    }), durationMs);
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
