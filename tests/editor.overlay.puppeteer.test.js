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
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}?test=overlay`;

const NOTE_ID = "overlay-fixture";
const INITIAL_MARKDOWN = `# Overlay Fixture\n\nThis note verifies the overlay behaviour.`;

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    test.describe("Markdown editor overlay", () => {
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

        test("overlay opens, auto-grows, saves, and confirms before closing", async () => {
            const seededRecords = [buildNoteRecord({
                noteId: NOTE_ID,
                markdownText: INITIAL_MARKDOWN,
                attachments: {}
            })];
            const page = await preparePage(browser, { records: seededRecords });
            try {
                await page.click(`[data-note-id="${NOTE_ID}"] [data-action="expand"]`);
                await page.waitForSelector("#markdown-editor-overlay:not([hidden])");

                let overlayMode = await page.evaluate(() => {
                    const overlay = document.getElementById("markdown-editor-overlay");
                    return overlay?.classList.contains("editor-overlay--mode-view");
                });
                assert.equal(overlayMode, true, "Expand should open overlay in view mode");

                await page.click("#editor-enter-edit-button");
                await page.waitForFunction(() => {
                    const overlay = document.getElementById("markdown-editor-overlay");
                    return overlay?.classList.contains("editor-overlay--mode-edit");
                });

                const bodyHasLock = await page.evaluate(() => document.body.classList.contains("body--overlay-locked"));
                assert.equal(bodyHasLock, true, "body scroll should be locked while overlay is open");

                const initialHeight = await page.$eval("#editor-overlay-textarea", (el) => el.clientHeight);
                await page.click("#editor-overlay-textarea");
                await page.type("#editor-overlay-textarea", "\nLine one\nLine two\nLine three\nLine four\nLine five\nLine six\nLine seven\n");
                const grownHeight = await page.$eval("#editor-overlay-textarea", (el) => el.clientHeight);
                assert.ok(grownHeight > initialHeight, "textarea should auto-grow as content expands");

                await page.waitForSelector("#editor-toast.toast--visible", { timeout: 2000 });
                const toastMessage = await page.$eval("#editor-toast", (el) => el.textContent?.trim());
                assert.equal(toastMessage, MESSAGE_NOTE_SAVED);

                const persisted = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? { markdownText: record.markdownText } : null;
                }, NOTE_ID);
                assert.ok(persisted, "note should persist after save");
                assert.ok(persisted.markdownText.includes("Line seven"));

                await page.type("#editor-overlay-textarea", "\nUnsaved line");

                let dialogCount = 0;
                const dialogHandler = async (dialog) => {
                    dialogCount += 1;
                    await dialog.dismiss();
                };
                page.on("dialog", dialogHandler);
                await page.keyboard.press("Escape");
                await page.waitForSelector("#markdown-editor-overlay[hidden]");
                const bodyUnlocked = await page.evaluate(() => document.body.classList.contains("body--overlay-locked"));
                assert.equal(bodyUnlocked, false, "body lock should clear when overlay closes");
                assert.equal(dialogCount, 0, "autosave close should not prompt");

                const finalRecord = await page.evaluate(async (noteId) => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const record = GravityStore.getById(noteId);
                    return record ? { markdownText: record.markdownText } : null;
                }, NOTE_ID);
                assert.ok(finalRecord);
                assert.ok(finalRecord.markdownText.includes("Unsaved line"));
                page.off("dialog", dialogHandler);
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
    await page.waitForSelector(".new-note-blank");
    await page.waitForSelector(`[data-note-id="${NOTE_ID}"]`);
    return page;
}
