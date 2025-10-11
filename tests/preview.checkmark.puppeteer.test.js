import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

const SANDBOX = await ensurePuppeteerSandbox();
const {
    homeDir: SANDBOX_HOME_DIR,
    userDataDir: SANDBOX_USER_DATA_DIR,
    cacheDir: SANDBOX_CACHE_DIR,
    configDir: SANDBOX_CONFIG_DIR,
    crashDumpsDir: SANDBOX_CRASH_DUMPS_DIR
} = SANDBOX;

let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const CHECKLIST_NOTE_ID = "preview-checklist-dup";
const CHECKLIST_MARKDOWN = [
    "# Checklist duplication regression",
    "",
    "- [ ] Track first task",
    "- [x] Track second task"
].join("\n");

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

    test.describe("Checklist preview interactions", () => {
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
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("toggling preview checkboxes does not persist duplicate cards", async () => {
            if (skipIfNoBrowser()) return;

            const initialRecords = [
                buildNoteRecord({
                    noteId: CHECKLIST_NOTE_ID,
                    markdownText: CHECKLIST_MARKDOWN,
                    attachments: {}
                })
            ];

            const page = await preparePage(browser, {
                records: initialRecords,
                duplicateOnSave: true
            });

            try {
                const cardSelector = `.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"]`;
                await page.waitForSelector(cardSelector);

                const checkboxSelector = `${cardSelector} .note-preview input[data-task-index="0"]`;
                await page.click(checkboxSelector);

                await page.waitForFunction((storageKey, noteId) => {
                    try {
                        const raw = window.localStorage.getItem(storageKey);
                        if (!raw) return false;
                        const parsed = JSON.parse(raw);
                        if (!Array.isArray(parsed)) return false;
                        const copies = parsed.filter((record) => record?.noteId === noteId);
                        return copies.length >= 2;
                    } catch {
                        return false;
                    }
                }, {}, appConfig.storageKey, CHECKLIST_NOTE_ID);

                await page.reload({ waitUntil: "networkidle0" });
                await page.waitForSelector(cardSelector);

                const renderedCount = await page.$$eval(cardSelector, (nodes) => nodes.length);
                assert.equal(renderedCount, 1, "only one checklist card should render after duplicating persistence writes");

                await page.evaluate(async () => {
                    const { GravityStore } = await import("./js/core/store.js");
                    const current = GravityStore.loadAllNotes();
                    GravityStore.saveAllNotes(current);
                });

                const storedRecords = await page.evaluate((storageKey, noteId) => {
                    try {
                        const raw = window.localStorage.getItem(storageKey);
                        if (!raw) return null;
                        const parsed = JSON.parse(raw);
                        if (!Array.isArray(parsed)) return null;
                        const matches = parsed.filter((record) => record?.noteId === noteId);
                        return { total: parsed.length, duplicates: matches.length };
                    } catch {
                        return null;
                    }
                }, appConfig.storageKey, CHECKLIST_NOTE_ID);

                assert.ok(storedRecords, "storage snapshot should be available");
                assert.equal(storedRecords.duplicates, 1, "only one checklist record should persist after reload");
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
        lastActivityIso: timestamp,
        pinned: false
    };
}

async function preparePage(browser, { records, duplicateOnSave }) {
    const page = await browser.newPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload, shouldDuplicate) => {
        const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
        const hasSeeded = window.sessionStorage.getItem("__gravityChecklistSeeded") === "true";
        if (!hasSeeded) {
            window.localStorage.clear();
            window.localStorage.setItem(storageKey, payload);
            window.sessionStorage.setItem("__gravityChecklistSeeded", "true");
        }
        if (shouldDuplicate) {
            let hasDuplicated = window.sessionStorage.getItem("__gravityChecklistDuplicated") === "true";
            window.localStorage.setItem = (key, value) => {
                if (!hasDuplicated && key === storageKey) {
                    try {
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            const duplicate = [...parsed, { ...parsed[0], updatedAtIso: new Date().toISOString() }];
                            hasDuplicated = true;
                            window.sessionStorage.setItem("__gravityChecklistDuplicated", "true");
                            return originalSetItem(key, JSON.stringify(duplicate));
                        }
                    } catch {
                        return originalSetItem(key, value);
                    }
                }
                return originalSetItem(key, value);
            };
        }
    }, appConfig.storageKey, serialized, Boolean(duplicateOnSave));

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor");
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return page;
}
