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

const CHECKLIST_NOTE_ID = "preview-checklist-primary";
const CHECKLIST_MARKDOWN = [
    "# Checklist regression guard",
    "",
    "- [ ] Track first task",
    "- [x] Track second task"
].join("\n");
const SECOND_NOTE_ID = "preview-checklist-secondary";
const SECOND_MARKDOWN = [
    "# Secondary checklist",
    "",
    "- [ ] Mirror task"
].join("\n");
const RAPID_TOGGLE_ITERATIONS = 4;

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

        test("preview checkbox toggle keeps a single persisted note", async () => {
            if (skipIfNoBrowser()) return;

            const initialRecords = [
                buildNoteRecord({
                    noteId: CHECKLIST_NOTE_ID,
                    markdownText: CHECKLIST_MARKDOWN,
                    attachments: {}
                })
            ];

            const page = await preparePage(browser, { records: initialRecords });
            try {
                const cardSelector = `.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"]`;
                await page.waitForSelector(cardSelector);

                const checkboxSelector = `${cardSelector} .note-preview input[data-task-index="0"]`;
                await page.click(checkboxSelector);

                await waitForTaskState(page, appConfig.storageKey, CHECKLIST_NOTE_ID, "- [x] Track first task");

                const summary = await snapshotStorage(page, appConfig.storageKey);
                assert.equal(summary.totalRecords, 1, "exactly one record persists after toggling");
                assert.equal(summary.noteOccurrences[CHECKLIST_NOTE_ID], 1, "note identifier remains unique");

                await page.reload({ waitUntil: "networkidle0" });
                await page.waitForSelector(cardSelector);
                const renderedCount = await page.$$eval(cardSelector, (nodes) => nodes.length);
                assert.equal(renderedCount, 1, "only one card renders after reload");
            } finally {
                await page.close();
            }
        });

        test("rapid preview toggles keep records unique across notes", async () => {
            if (skipIfNoBrowser()) return;

            const seededRecords = [
                buildNoteRecord({
                    noteId: CHECKLIST_NOTE_ID,
                    markdownText: CHECKLIST_MARKDOWN,
                    attachments: {}
                }),
                buildNoteRecord({
                    noteId: SECOND_NOTE_ID,
                    markdownText: SECOND_MARKDOWN,
                    attachments: {}
                })
            ];

            const page = await preparePage(browser, { records: seededRecords });
            try {
                const firstSelector = `.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"] .note-preview input[data-task-index="0"]`;
                const secondSelector = `.markdown-block[data-note-id="${SECOND_NOTE_ID}"] .note-preview input[data-task-index="0"]`;

                await Promise.all([
                    page.waitForSelector(`.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"]`),
                    page.waitForSelector(`.markdown-block[data-note-id="${SECOND_NOTE_ID}"]`)
                ]);

                for (let iteration = 0; iteration < RAPID_TOGGLE_ITERATIONS; iteration += 1) {
                    await page.click(firstSelector);
                    await page.click(secondSelector);
                }

                await waitForUniqueNotes(page, appConfig.storageKey, [CHECKLIST_NOTE_ID, SECOND_NOTE_ID]);

                const summary = await snapshotStorage(page, appConfig.storageKey);
                assert.equal(summary.totalRecords, 2, "two records remain after rapid toggles");
                assert.equal(summary.noteOccurrences[CHECKLIST_NOTE_ID], 1, "primary note stays unique");
                assert.equal(summary.noteOccurrences[SECOND_NOTE_ID], 1, "secondary note stays unique");

                const renderedOrder = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll(".markdown-block[data-note-id]"))
                        .map((node) => node.getAttribute("data-note-id"))
                        .filter((value) => typeof value === "string");
                });
                assert.deepEqual(
                    renderedOrder,
                    [CHECKLIST_NOTE_ID, SECOND_NOTE_ID],
                    "DOM order preserves unique cards"
                );
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

async function preparePage(browser, { records }) {
    const page = await browser.newPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.sessionStorage.clear();
        window.localStorage.clear();
        if (typeof payload === "string" && payload.length > 0) {
            window.localStorage.setItem(storageKey, payload);
        }
    }, appConfig.storageKey, serialized);

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor");
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return page;
}

async function waitForTaskState(page, storageKey, noteId, expectedLine) {
    await page.waitForFunction((storageKeyKey, targetNoteId, line) => {
        const raw = window.localStorage.getItem(storageKeyKey);
        if (!raw) return false;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return false;
            const matches = parsed.filter((record) => record?.noteId === targetNoteId);
            if (matches.length !== 1) return false;
            return typeof matches[0]?.markdownText === "string" && matches[0].markdownText.includes(line);
        } catch {
            return false;
        }
    }, {}, storageKey, noteId, expectedLine);
}

async function waitForUniqueNotes(page, storageKey, noteIds) {
    await page.waitForFunction((storageKeyKey, ids) => {
        const raw = window.localStorage.getItem(storageKeyKey);
        if (!raw) return false;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return false;
            for (const id of ids) {
                const occurrences = parsed.filter((record) => record?.noteId === id);
                if (occurrences.length !== 1) {
                    return false;
                }
            }
            return true;
        } catch {
            return false;
        }
    }, {}, storageKey, noteIds);
}

async function snapshotStorage(page, storageKey) {
    return page.evaluate((storageKeyKey) => {
        const raw = window.localStorage.getItem(storageKeyKey);
        if (!raw) {
            return { totalRecords: 0, noteOccurrences: {} };
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return { totalRecords: 0, noteOccurrences: {} };
            }
            const occurrences = {};
            for (const record of parsed) {
                const noteId = record?.noteId;
                if (typeof noteId !== "string" || noteId.length === 0) {
                    continue;
                }
                occurrences[noteId] = (occurrences[noteId] || 0) + 1;
            }
            return {
                totalRecords: parsed.length,
                noteOccurrences: occurrences
            };
        } catch {
            return { totalRecords: 0, noteOccurrences: {} };
        }
    }, storageKey);
}
