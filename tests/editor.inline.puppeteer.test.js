import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { MESSAGE_NOTE_SAVED } from "../js/constants.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

const {
    homeDir: SANDBOX_HOME_DIR,
    userDataDir: SANDBOX_USER_DATA_DIR,
    cacheDir: SANDBOX_CACHE_DIR,
    configDir: SANDBOX_CONFIG_DIR,
    crashDumpsDir: SANDBOX_CRASH_DUMPS_DIR
} = await ensurePuppeteerSandbox();

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
const TASK_NOTE_ID = "inline-task-fixture";
const TASK_MARKDOWN = "- [ ] Pending task\n- [x] Completed task";
const LONG_NOTE_ID = "inline-long-fixture";
const LONG_NOTE_PARAGRAPH_COUNT = 18;
const LONG_NOTE_MARKDOWN = Array.from({ length: LONG_NOTE_PARAGRAPH_COUNT }, (_, index) => `Paragraph ${index + 1} maintains scroll state.`).join("\n\n");

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    const executablePath = typeof puppeteerModule.executablePath === "function"
        ? puppeteerModule.executablePath()
        : undefined;
    if (typeof executablePath === "string" && executablePath.length > 0) {
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    }
    test.describe("Markdown inline editor", () => {
        /** @type {import('puppeteer').Browser} */
        let browser;
        /** @type {Error|null} */
        let launchError = null;

        const skipIfNoBrowser = () => {
            if (!browser) {
                test.skip(launchError ? launchError.message : "Puppeteer launch unavailable in sandbox.");
                return true;
            }
            return false;
        };

        test.before(async () => {
            const launchArgs = [
                "--allow-file-access-from-files",
                "--disable-crashpad",
                "--disable-features=Crashpad",
                "--noerrdialogs",
                "--no-crash-upload",
                "--enable-crash-reporter=0",
                `--crash-dumps-dir=${SANDBOX_CRASH_DUMPS_DIR}`
            ];
            if (process.env.CI) {
                launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
            }
            try {
                browser = await puppeteerModule.launch({
                    headless: "new",
                    args: launchArgs,
                    userDataDir: SANDBOX_USER_DATA_DIR,
                    env: {
                        ...process.env,
                        HOME: SANDBOX_HOME_DIR,
                        XDG_CACHE_HOME: SANDBOX_CACHE_DIR,
                        XDG_CONFIG_HOME: SANDBOX_CONFIG_DIR
                    }
                });
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            if (browser) await browser.close();
            await cleanupPuppeteerSandbox();
        });

        test("click-to-edit auto-grows and saves inline", async () => {
            if (skipIfNoBrowser()) return;
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

        test("checkbox toggles from preview persist to markdown", async () => {
            if (skipIfNoBrowser()) return;
            const seededRecords = [buildNoteRecord({
                noteId: TASK_NOTE_ID,
                markdownText: TASK_MARKDOWN,
                attachments: {}
            })];

            const page = await preparePage(browser, { records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${TASK_NOTE_ID}"]`;
            const checkboxSelector = `${cardSelector} input[type="checkbox"][data-task-index="0"]`;

            try {
                await page.waitForSelector(cardSelector);
                await page.waitForSelector(checkboxSelector);

                await page.click(checkboxSelector);
                await page.waitForFunction((selector) => {
                    const textarea = document.querySelector(selector);
                    return textarea instanceof HTMLTextAreaElement && textarea.value.includes("- [x] Pending task");
                }, {}, `${cardSelector} .markdown-editor`);

                let storedMarkdown = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? record.markdownText : null;
                }, TASK_NOTE_ID);
                assert.ok(storedMarkdown);
                assert.ok(storedMarkdown.includes("- [x] Pending task"));

                await page.waitForSelector(checkboxSelector);
                await page.click(checkboxSelector);
                await page.waitForFunction((selector) => {
                    const textarea = document.querySelector(selector);
                    return textarea instanceof HTMLTextAreaElement && textarea.value.includes("- [ ] Pending task");
                }, {}, `${cardSelector} .markdown-editor`);

                storedMarkdown = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? record.markdownText : null;
                }, TASK_NOTE_ID);
                assert.ok(storedMarkdown);
                assert.ok(storedMarkdown.includes("- [ ] Pending task"));
            } finally {
                await page.close();
            }
        });

        test("preview checkbox bubbling waits before reordering", async () => {
            if (skipIfNoBrowser()) return;

            const RECENT_NOTE_ID = "recent-note";
            const TARGET_NOTE_ID = "checkbox-note";
            const recentNote = buildNoteRecord({
                noteId: RECENT_NOTE_ID,
                markdownText: "Recent note",
                attachments: {}
            });
            recentNote.createdAtIso = "2024-02-01T00:00:00.000Z";
            recentNote.updatedAtIso = "2024-02-01T00:00:00.000Z";
            recentNote.lastActivityIso = "2024-02-01T00:00:00.000Z";

            const targetNote = buildNoteRecord({
                noteId: TARGET_NOTE_ID,
                markdownText: "- [ ] First task\n- [x] Second task",
                attachments: {}
            });
            targetNote.createdAtIso = "2024-01-01T00:00:00.000Z";
            targetNote.updatedAtIso = "2024-01-01T00:00:00.000Z";
            targetNote.lastActivityIso = "2024-01-01T00:00:00.000Z";

            const page = await preparePage(browser, {
                records: [recentNote, targetNote],
                previewBubbleDelayMs: 300
            });

            const getNoteOrder = async () => page.evaluate(() => (
                Array.from(document.querySelectorAll('.markdown-block:not(.top-editor)'))
                    .map((node) => node.getAttribute('data-note-id'))
            ));

            try {
                await page.waitForSelector(`.markdown-block[data-note-id="${TARGET_NOTE_ID}"]`);
                const initialOrder = await getNoteOrder();
                assert.deepEqual(initialOrder.slice(0, 2), [RECENT_NOTE_ID, TARGET_NOTE_ID]);

                const checkboxSelector = `[data-note-id="${TARGET_NOTE_ID}"] input[type="checkbox"][data-task-index="0"]`;
                await page.waitForSelector(checkboxSelector);
                await page.click(checkboxSelector);
                await pause(page, 120);
                const afterFirstClick = await getNoteOrder();
                assert.deepEqual(afterFirstClick.slice(0, 2), [RECENT_NOTE_ID, TARGET_NOTE_ID]);

                await page.click(checkboxSelector);
                await pause(page, 120);
                const afterSecondClick = await getNoteOrder();
                assert.deepEqual(afterSecondClick.slice(0, 2), [RECENT_NOTE_ID, TARGET_NOTE_ID]);

                await page.waitForFunction((targetId) => {
                    const ids = Array.from(document.querySelectorAll('.markdown-block:not(.top-editor)'))
                        .map((node) => node.getAttribute('data-note-id'));
                    return ids.length > 0 && ids[0] === targetId;
                }, {}, TARGET_NOTE_ID);

                const finalOrder = await getNoteOrder();
                assert.equal(finalOrder[0], TARGET_NOTE_ID);
            } finally {
                await page.close();
            }
        });

        test("editing re-renders preview after bubbling", async () => {
            if (skipIfNoBrowser()) return;

            const OTHER_NOTE_ID = "up-to-date-note";
            const TARGET_NOTE_ID = "render-update-note";
            const otherNote = buildNoteRecord({
                noteId: OTHER_NOTE_ID,
                markdownText: "Other note",
                attachments: {}
            });
            otherNote.createdAtIso = "2024-03-01T00:00:00.000Z";
            otherNote.updatedAtIso = "2024-03-01T00:00:00.000Z";
            otherNote.lastActivityIso = "2024-03-01T00:00:00.000Z";

            const targetNote = buildNoteRecord({
                noteId: TARGET_NOTE_ID,
                markdownText: "Original content",
                attachments: {}
            });
            targetNote.createdAtIso = "2024-01-01T00:00:00.000Z";
            targetNote.updatedAtIso = "2024-01-01T00:00:00.000Z";
            targetNote.lastActivityIso = "2024-01-01T00:00:00.000Z";

            const page = await preparePage(browser, {
                records: [otherNote, targetNote]
            });

            const targetSelector = `.markdown-block[data-note-id="${TARGET_NOTE_ID}"]`;
            const editorSelector = `${targetSelector} .markdown-editor`;
            const previewSelector = `${targetSelector} .markdown-content`;

            try {
                await page.waitForSelector(targetSelector);
                const initialOrder = await page.evaluate(() => (
                    Array.from(document.querySelectorAll('.markdown-block:not(.top-editor)'))
                        .map((node) => node.getAttribute('data-note-id'))
                ));
                assert.deepEqual(initialOrder.slice(0, 2), [OTHER_NOTE_ID, TARGET_NOTE_ID]);

                await page.click(`${targetSelector} .note-preview`);
                await page.waitForSelector(`${targetSelector}.editing-in-place`);
                await page.focus(editorSelector);
                await page.evaluate((noteId, markdown) => {
                    const card = document.querySelector(`.markdown-block[data-note-id="${noteId}"]`);
                    const host = card?.__markdownHost;
                    if (host) {
                        host.setValue(markdown);
                    }
                }, TARGET_NOTE_ID, '# Updated Title\n\nExpanded body.');

                await page.keyboard.down('Control');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Control');

                await page.waitForFunction((selector) => {
                    const node = document.querySelector(selector);
                    return node && !node.classList.contains('editing-in-place');
                }, {}, targetSelector);

                await page.waitForFunction((targetId) => {
                    const ids = Array.from(document.querySelectorAll('.markdown-block:not(.top-editor)'))
                        .map((node) => node.getAttribute('data-note-id'));
                    return ids.length > 0 && ids[0] === targetId;
                }, {}, TARGET_NOTE_ID);

                const previewHtml = await page.$eval(previewSelector, (element) => element.innerHTML || "");
                assert.match(previewHtml, /<h1[^>]*>Updated Title<\/h1>/);
                assert.ok(previewHtml.includes('<p>Expanded body.</p>'));
            } finally {
                await page.close();
            }
        });

        test("clicking a long note reveals the full content and caret at end", async () => {
            if (skipIfNoBrowser()) return;
            const seededRecords = [buildNoteRecord({
                noteId: LONG_NOTE_ID,
                markdownText: LONG_NOTE_MARKDOWN,
                attachments: {}
            })];

            const page = await preparePage(browser, { records: seededRecords });
            const cardSelector = `.markdown-block[data-note-id="${LONG_NOTE_ID}"]`;
            const editorSelector = `${cardSelector} .markdown-editor`;

            try {
                await page.waitForSelector(cardSelector);
                await page.click(`${cardSelector} .note-preview`);
                await page.waitForSelector(`${cardSelector}.editing-in-place`);
                await page.waitForSelector(editorSelector);

                await page.waitForFunction((selector) => {
                    const textarea = document.querySelector(selector);
                    if (!(textarea instanceof HTMLTextAreaElement)) return false;
                    const { selectionStart, selectionEnd, value } = textarea;
                    if (typeof selectionStart !== "number" || typeof selectionEnd !== "number") return false;
                    const valueLength = value.length;
                    return selectionStart === valueLength && selectionEnd === valueLength;
                }, {}, editorSelector);

                const editorState = await page.$eval(editorSelector, (el) => ({
                    clientHeight: el.clientHeight,
                    scrollHeight: el.scrollHeight,
                    selectionStart: el.selectionStart ?? 0,
                    selectionEnd: el.selectionEnd ?? 0,
                    valueLength: el.value.length
                }));

                assert.ok(
                    editorState.scrollHeight <= editorState.clientHeight + 1,
                    "Fallback textarea expands immediately to fit long notes"
                );
                assert.equal(
                    editorState.selectionStart,
                    editorState.valueLength,
                    "Caret snaps to the end of the long note"
                );
                assert.equal(
                    editorState.selectionEnd,
                    editorState.valueLength,
                    "Caret selection collapses at the note end"
                );
            } finally {
                await page.close();
            }
        });

        test("second click keeps caret position and prevents clipping", async () => {
            if (skipIfNoBrowser()) return;
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
            if (skipIfNoBrowser()) return;
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
            if (skipIfNoBrowser()) return;
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

async function preparePage(browser, { records, previewBubbleDelayMs }) {
    const page = await browser.newPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload, bubbleDelay) => {
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
        if (typeof bubbleDelay === "number") {
            window.__gravityPreviewBubbleDelayMs = bubbleDelay;
        }
    }, appConfig.storageKey, serialized, typeof previewBubbleDelayMs === "number" ? previewBubbleDelayMs : null);

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor");
    await page.waitForSelector(".markdown-block[data-note-id]");
    return page;
}

async function pause(page, durationMs) {
    await page.evaluate((ms) => new Promise((resolve) => {
        setTimeout(resolve, typeof ms === "number" ? Math.max(ms, 0) : 0);
    }), durationMs);
}
