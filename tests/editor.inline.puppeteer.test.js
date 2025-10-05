import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { MESSAGE_NOTE_SAVED } from "../js/constants.js";

let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch (error) {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const NOTE_ID = "inline-fixture";
const INITIAL_MARKDOWN = `# Inline Fixture\n\nThis note verifies inline editing.`;
const CARET_NOTE_ID = "inline-caret-fixture";
const CARET_MARKDOWN = `First paragraph line one.\nSecond paragraph line two.\nThird line to ensure scrolling.`;
const UNORDERED_NOTE_ID = "inline-unordered-fixture";
const UNORDERED_MARKDOWN = "* Alpha\n* Beta";
const ORDERED_NOTE_ID = "inline-ordered-fixture";
const ORDERED_MARKDOWN = "1. First\n2. Second";
const TABLE_NOTE_ID = "inline-table-fixture";
const TABLE_MARKDOWN = "| Col1 | Col2 |\n| --- | --- |\n| A | B |";
const FENCE_NOTE_ID = "inline-fence-fixture";
const FENCE_MARKDOWN = "```js";

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    test.describe("Markdown inline editor", () => {
        /** @type {import('puppeteer').Browser} */
        let browser;

        test.before(async () => {
            const launchArgs = ["--allow-file-access-from-files"];
            if (process.env.CI) {
                launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
            }
            browser = await puppeteerModule.launch({ headless: "new", args: launchArgs });
        });

        test.after(async () => {
            if (browser) await browser.close();
        });

        test("click-to-edit auto-grows and saves inline", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: NOTE_ID,
                markdownText: INITIAL_MARKDOWN,
                attachments: {}
            })];

            const page = await preparePage(browser, { records: seededRecords });
            try {
                const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;
                await page.waitForSelector(cardSelector);

                const initialCardHeight = await page.$eval(cardSelector, (el) => el.clientHeight);
                const initialTextareaHeight = await page.$eval(
                    `${cardSelector} .markdown-editor`,
                    (el) => el.clientHeight
                );

                await page.click(`${cardSelector} .note-preview`);
                await page.waitForSelector(`${cardSelector}.editing-in-place`);

                const isPreviewHidden = await page.$eval(
                    `${cardSelector} .markdown-content`,
                    (el) => window.getComputedStyle(el).display === "none"
                );
                assert.equal(isPreviewHidden, true, "Preview hides while editing inline");

                const editorSelector = `${cardSelector} .markdown-editor`;
                await page.focus(editorSelector);
                await page.type(editorSelector, "\nAdditional line one.\nAdditional line two.\nAdditional line three.");

                const grownTextareaHeight = await page.$eval(editorSelector, (el) => el.clientHeight);
                assert.ok(
                    grownTextareaHeight > initialTextareaHeight,
                    "Textarea grows to fit newly typed content"
                );

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");

                await page.waitForFunction((selector) => {
                    const node = document.querySelector(selector);
                    return node && !node.classList.contains("editing-in-place");
                }, {}, cardSelector);

                await page.waitForSelector("#editor-toast.toast--visible", { timeout: 2000 });
                const toastMessage = await page.$eval("#editor-toast", (el) => el.textContent?.trim());
                assert.equal(toastMessage, MESSAGE_NOTE_SAVED);

                const finalCardHeight = await page.$eval(cardSelector, (el) => el.clientHeight);
                assert.ok(finalCardHeight >= initialCardHeight, "Card height stays consistent after save");

                const persisted = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? record.markdownText : null;
                }, NOTE_ID);
                assert.ok(persisted);
                assert.match(persisted, /Additional line three\.$/);

                const previewText = await page.$eval(
                    `${cardSelector} .markdown-content`,
                    (el) => el.textContent || ""
                );
                assert.ok(previewText.includes("Additional line one."));
            } finally {
                await page.close();
            }
        });

        test("second click keeps caret position and prevents clipping", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: CARET_NOTE_ID,
                markdownText: CARET_MARKDOWN,
                attachments: {}
            })];

            const page = await preparePage(browser, { records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${CARET_NOTE_ID}"]`;
            const editorSelector = `${cardSelector} .markdown-editor`;

            try {
                await page.waitForSelector(cardSelector);
                await page.click(`${cardSelector} .note-preview`);
                await page.waitForSelector(`${cardSelector}.editing-in-place`);
                await page.waitForSelector(editorSelector);

                await page.click(editorSelector);

                const caretSnapshot = await page.$eval(editorSelector, (el) => ({
                    start: el.selectionStart ?? 0,
                    length: el.value.length
                }));
                assert.ok(
                    caretSnapshot.start < caretSnapshot.length,
                    "Caret moves away from end after user click"
                );

                await page.type(editorSelector, "X");
                const currentValue = await page.$eval(editorSelector, (el) => el.value);
                assert.equal(
                    currentValue.endsWith("X"),
                    false,
                    "Typing after reposition should not append at the very end"
                );

                const metrics = await page.$eval(editorSelector, (el) => ({
                    scrollHeight: el.scrollHeight,
                    clientHeight: el.clientHeight
                }));
                assert.ok(
                    metrics.scrollHeight <= metrics.clientHeight + 1,
                    "Textarea expands to show caret without clipping"
                );
            } finally {
                await page.close();
            }
        });

        test("tables render without forcing full card width", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: TABLE_NOTE_ID,
                markdownText: TABLE_MARKDOWN,
                attachments: {}
            })];

            const page = await preparePage(browser, { records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${TABLE_NOTE_ID}"]`;
            const tableSelector = `${cardSelector} .markdown-content table`;

            try {
                await page.waitForSelector(tableSelector);

                const layoutMetrics = await page.$eval(cardSelector, (card) => {
                    const content = card.querySelector(".markdown-content");
                    const table = content?.querySelector("table");
                    if (!content || !table) return null;

                    const tableRect = table.getBoundingClientRect();
                    const contentRect = content.getBoundingClientRect();
                    return {
                        display: window.getComputedStyle(table).display,
                        tableWidth: tableRect.width,
                        contentWidth: contentRect.width
                    };
                });

                assert.ok(layoutMetrics, "Table layout metrics should be captured");
                assert.equal(layoutMetrics.display, "inline-table");
                assert.ok(
                    layoutMetrics.tableWidth <= layoutMetrics.contentWidth - 24,
                    "Table width stays narrower than preview container for compact data"
                );
            } finally {
                await page.close();
            }
        });

        test("lists and tables auto-continue in fallback editor", async () => {
            const seededRecords = [
                buildNoteRecord({ noteId: UNORDERED_NOTE_ID, markdownText: UNORDERED_MARKDOWN, attachments: {} }),
                buildNoteRecord({ noteId: ORDERED_NOTE_ID, markdownText: ORDERED_MARKDOWN, attachments: {} }),
                buildNoteRecord({ noteId: TABLE_NOTE_ID, markdownText: TABLE_MARKDOWN, attachments: {} }),
                buildNoteRecord({ noteId: FENCE_NOTE_ID, markdownText: FENCE_MARKDOWN, attachments: {} })
            ];

            const page = await preparePage(browser, { records: seededRecords });
            try {
                // Unordered list continuation and exit
                const unorderedSelector = `.markdown-block[data-note-id="${UNORDERED_NOTE_ID}"]`;
                const unorderedEditor = `${unorderedSelector} .markdown-editor`;
                await page.click(`${unorderedSelector} .note-preview`);
                await page.waitForSelector(`${unorderedSelector}.editing-in-place`);
                await page.waitForSelector(unorderedEditor);


                const enhancedMode = await page.$eval(unorderedSelector, (card) => Boolean(card.querySelector('.CodeMirror')));
                assert.equal(enhancedMode, false, "Fallback textarea should be active for inline editor tests");

                await page.evaluate((selector) => {
                    const textarea = document.querySelector(selector);
                    if (!(textarea instanceof HTMLTextAreaElement)) return;
                    const newlineIndex = textarea.value.indexOf("\n");
                    let caret = newlineIndex >= 0 ? newlineIndex : textarea.value.length;
                    textarea.focus();
                    textarea.setSelectionRange(caret, caret);
                    if (textarea.selectionStart !== caret && caret > 0) {
                        caret -= 1;
                        textarea.setSelectionRange(caret, caret);
                    }
                }, unorderedEditor);
                await page.$eval(unorderedEditor, (el) => el.selectionStart);
                await page.keyboard.press("Enter");
                try {
                    await page.waitForFunction((selector, expected) => {
                        const textarea = document.querySelector(selector);
                        return textarea instanceof HTMLTextAreaElement && textarea.value === expected;
                    }, { timeout: 2000 }, unorderedEditor, "* Alpha\n* \n* Beta");
                } catch (error) {
                    const actual = await page.$eval(unorderedEditor, (el) => el.value);
                    assert.equal(actual, "* Alpha\n* \n* Beta", "Unordered list continuation preserves bullet");
                }
                let unorderedValue = await page.$eval(unorderedEditor, (el) => el.value);
                assert.equal(unorderedValue, "* Alpha\n* \n* Beta");

                await page.keyboard.press("Enter");
                try {
                    await page.waitForFunction((selector, expected) => {
                        const textarea = document.querySelector(selector);
                        return textarea instanceof HTMLTextAreaElement && textarea.value === expected;
                    }, { timeout: 2000 }, unorderedEditor, "* Alpha\n\n* Beta");
                } catch (error) {
                    const actual = await page.$eval(unorderedEditor, (el) => el.value);
                    assert.equal(actual, "* Alpha\n\n* Beta", "Unordered list exit removes bullet");
                }
                unorderedValue = await page.$eval(unorderedEditor, (el) => el.value);
                assert.equal(unorderedValue, "* Alpha\n\n* Beta");

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");

                // Ordered list continuation with renumbering
                const orderedSelector = `.markdown-block[data-note-id="${ORDERED_NOTE_ID}"]`;
                const orderedEditor = `${orderedSelector} .markdown-editor`;
                await page.click(`${orderedSelector} .note-preview`);
                await page.waitForSelector(`${orderedSelector}.editing-in-place`);
                await page.waitForSelector(orderedEditor);

                await page.evaluate((selector) => {
                    const textarea = document.querySelector(selector);
                    if (!(textarea instanceof HTMLTextAreaElement)) return;
                    const newlineIndex = textarea.value.indexOf("\n");
                    let caret = newlineIndex >= 0 ? newlineIndex : textarea.value.length;
                    textarea.focus();
                    textarea.setSelectionRange(caret, caret);
                    if (textarea.selectionStart !== caret && caret > 0) {
                        caret -= 1;
                        textarea.setSelectionRange(caret, caret);
                    }
                }, orderedEditor);
                await page.$eval(orderedEditor, (el) => el.selectionStart);
                await page.keyboard.press("Enter");
                try {
                    await page.waitForFunction((selector, expected) => {
                        const textarea = document.querySelector(selector);
                        return textarea instanceof HTMLTextAreaElement && textarea.value === expected;
                    }, { timeout: 2000 }, orderedEditor, "1. First\n2. \n3. Second");
                } catch (error) {
                    const actual = await page.$eval(orderedEditor, (el) => el.value);
                    assert.equal(actual, "1. First\n2. \n3. Second", "Ordered list renumbering");
                }
                const orderedLines = await page.$eval(orderedEditor, (el) => el.value.split("\n"));
                assert.deepEqual(orderedLines, ["1. First", "2. ", "3. Second"]);

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");

                // Table row insertion
                const tableSelector = `.markdown-block[data-note-id="${TABLE_NOTE_ID}"]`;
                const tableEditor = `${tableSelector} .markdown-editor`;
                await page.click(`${tableSelector} .note-preview`);
                await page.waitForSelector(`${tableSelector}.editing-in-place`);
                await page.waitForSelector(tableEditor);

                await page.evaluate((selector) => {
                    const textarea = document.querySelector(selector);
                    if (!(textarea instanceof HTMLTextAreaElement)) return;
                    textarea.focus();
                    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                }, tableEditor);

                await page.keyboard.press("Enter");
                const tableState = await page.$eval(tableEditor, (el) => ({
                    value: el.value,
                    caret: el.selectionStart ?? 0
                }));
                const lastLineStart = tableState.value.lastIndexOf("\n") + 1;
                const lastLine = tableState.value.slice(lastLineStart);
                assert.match(lastLine, /^\|\s+\|\s+\|$/);
                assert.equal(tableState.caret, lastLineStart + 2, "Caret moves to first cell of new table row");

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");

                // Code fence auto-closure
                const fenceSelector = `.markdown-block[data-note-id="${FENCE_NOTE_ID}"]`;
                const fenceEditor = `${fenceSelector} .markdown-editor`;
                await page.click(`${fenceSelector} .note-preview`);
                await page.waitForSelector(`${fenceSelector}.editing-in-place`);
                await page.waitForSelector(fenceEditor);

                await page.evaluate((selector) => {
                    const textarea = document.querySelector(selector);
                    if (!(textarea instanceof HTMLTextAreaElement)) return;
                    textarea.focus();
                    const end = textarea.value.length;
                    textarea.setSelectionRange(end, end);
                }, fenceEditor);

                await page.keyboard.press("Enter");
                const fenceState = await page.$eval(fenceEditor, (el) => ({
                    value: el.value,
                    caret: el.selectionStart ?? 0
                }));
                assert.equal(fenceState.value, "```js\n\n```");
                assert.equal(fenceState.caret, 6, "Caret moves inside the new code block");
            } finally {
                await page.close();
            }
        });
    });
}

function buildNoteRecord({ noteId, markdownText, attachments }) {
    const timestamp = new Date().toISOString();
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp
    };
}

async function preparePage(browser, { records }) {
    const page = await browser.newPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
    }, appConfig.storageKey, serialized);

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor");
    await page.waitForSelector(".markdown-block[data-note-id]");
    return page;
}
