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
