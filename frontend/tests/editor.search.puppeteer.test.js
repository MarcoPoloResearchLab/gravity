import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const SEARCH_NOTE_ID = "search-fixture";
const SEARCH_NOTE_MARKDOWN = [
    "Alpha anchors the first paragraph for the inline search baseline.",
    "The second line repeats alpha to ensure multiple matches within the editor.",
    "Closing thoughts shout ALPHA in uppercase to exercise case-insensitive search."
].join("\n");
const FIXED_TIMESTAMP = "2024-10-10T10:00:00Z";

const getCodeMirrorInputSelector = (scope) => `${scope} .CodeMirror [contenteditable="true"], ${scope} .CodeMirror textarea`;
const getSearchInputSelector = (scope) => `${scope} [data-test="editor-search-input"]`;
const getSearchCountSelector = (scope) => `${scope} [data-test="editor-search-count"]`;
const getSearchNextSelector = (scope) => `${scope} [data-test="editor-search-next"]`;
const getSearchPreviousSelector = (scope) => `${scope} [data-test="editor-search-previous"]`;

test.describe("Markdown editor search", () => {
    test("search toolbar surfaces in edit mode and Ctrl+F focuses the search field", async () => {
        const { page, teardown } = await openNotesPage([
            buildRecord(SEARCH_NOTE_ID, SEARCH_NOTE_MARKDOWN)
        ]);
        const cardSelector = `.markdown-block[data-note-id="${SEARCH_NOTE_ID}"]`;
        try {
            await page.waitForSelector(cardSelector);
            await page.waitForSelector(getSearchInputSelector(cardSelector));
            const isVisibleBeforeEdit = await page.$eval(getSearchInputSelector(cardSelector), (element) => element.offsetParent !== null);
            assert.equal(isVisibleBeforeEdit, false);

            await enterEditMode(page, cardSelector);
            await page.waitForSelector(getSearchInputSelector(cardSelector), { visible: true });
            const isVisibleAfterEdit = await page.$eval(getSearchInputSelector(cardSelector), (element) => element.offsetParent !== null);
            assert.equal(isVisibleAfterEdit, true);

            await page.focus(getCodeMirrorInputSelector(cardSelector));
            await page.keyboard.down("Control");
            await page.keyboard.press("KeyF");
            await page.keyboard.up("Control");
            await page.waitForFunction(() => {
                const active = document.activeElement;
                return active instanceof HTMLElement && active.dataset?.test === "editor-search-input";
            }, { timeout: 1000 });
        } finally {
            await teardown();
        }
    });

    test("search highlights matches and cycles via Enter and navigation buttons", async () => {
        const { page, teardown } = await openNotesPage([
            buildRecord(SEARCH_NOTE_ID, SEARCH_NOTE_MARKDOWN)
        ]);
        const cardSelector = `.markdown-block[data-note-id="${SEARCH_NOTE_ID}"]`;
        try {
            await enterEditMode(page, cardSelector);
            await page.waitForSelector(getSearchInputSelector(cardSelector), { visible: true });

            await page.focus(getCodeMirrorInputSelector(cardSelector));
            await page.keyboard.down("Control");
            await page.keyboard.press("KeyF");
            await page.keyboard.up("Control");

            await page.type(getSearchInputSelector(cardSelector), "alpha");

            try {
                await waitForSearchCount(page, cardSelector, "1/3");
            } catch (error) {
                const observed = await page.$eval(getSearchCountSelector(cardSelector), (element) => element.textContent ?? "");
                throw new Error(`Expected first match count to settle at 1/3 but observed "${observed}".`);
            }
            let selection = await getCardSelection(page, cardSelector);
            assert.ok(selection, "Selection state should be available after typing a query");
            assert.equal(selection.countText, "1/3");
            assert.equal(selection.selection, "Alpha");

            await page.keyboard.press("Enter");
            await waitForSearchCount(page, cardSelector, "2/3");
            selection = await getCardSelection(page, cardSelector);
            assert.equal(selection.countText, "2/3");
            assert.equal(selection.selection, "alpha");

            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");
            await waitForSearchCount(page, cardSelector, "1/3");
            selection = await getCardSelection(page, cardSelector);
            assert.equal(selection.countText, "1/3");
            assert.equal(selection.selection, "Alpha");

            // Navigate via buttons to confirm the utility controls in the toolbar.
            await page.click(getSearchNextSelector(cardSelector));
            await waitForSearchCount(page, cardSelector, "2/3");
            selection = await getCardSelection(page, cardSelector);
            assert.equal(selection.selection, "alpha");

            await page.click(getSearchPreviousSelector(cardSelector));
            await waitForSearchCount(page, cardSelector, "1/3");
            selection = await getCardSelection(page, cardSelector);
            assert.equal(selection.selection, "Alpha");
        } finally {
            await teardown();
        }
    });
});

async function waitForSearchCount(page, scopeSelector, expected, timeoutMs = 5000) {
    await page.waitForFunction(
        (selector, value) => {
            const element = document.querySelector(selector);
            return element && element.textContent === value;
        },
        { timeout: timeoutMs },
        getSearchCountSelector(scopeSelector),
        expected
    );
}

async function enterEditMode(page, cardSelector) {
    await page.click(`${cardSelector} .note-html-view`, { clickCount: 2 });
    await page.waitForSelector(`${cardSelector}.editing-in-place`, { timeout: 5000 });
    await page.waitForSelector(getCodeMirrorInputSelector(cardSelector), { timeout: 5000 });
}

async function getCardSelection(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return null;
        }
        const codeMirrorElement = card.querySelector(".CodeMirror");
        if (!codeMirrorElement) {
            return null;
        }
        const cm = /** @type {any} */ (codeMirrorElement).CodeMirror;
        if (!cm || typeof cm.getDoc !== "function") {
            return null;
        }
        const doc = cm.getDoc();
        const selectionText = doc.getSelection();
        const countElement = card.querySelector('[data-test="editor-search-count"]');
        return {
            selection: selectionText,
            countText: countElement ? countElement.textContent : null
        };
    }, cardSelector);
}

async function openNotesPage(records) {
    const { page, teardown } = await createSharedPage();
    const payload = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, serialized) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, serialized);
        window.__gravityForceMarkdownEditor = true;
    }, appConfig.storageKey, payload);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(getCodeMirrorInputSelector("#top-editor"));
    if (records && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return { page, teardown };
}

function buildRecord(noteId, markdownText) {
    return {
        noteId,
        markdownText,
        createdAtIso: FIXED_TIMESTAMP,
        updatedAtIso: FIXED_TIMESTAMP,
        lastActivityIso: FIXED_TIMESTAMP,
        attachments: []
    };
}
