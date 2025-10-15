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
