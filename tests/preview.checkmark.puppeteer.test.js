import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

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

test.describe("Checklist preview interactions", () => {
    test("preview checkbox toggle keeps a single persisted note", async () => {
        const initialRecords = [
            buildNoteRecord({
                noteId: CHECKLIST_NOTE_ID,
                markdownText: CHECKLIST_MARKDOWN,
                attachments: {}
            })
        ];

        const { page, teardown } = await openChecklistPage(initialRecords);
        try {
            const cardSelector = `.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"]`;
            await page.waitForSelector(cardSelector);

            const checkboxSelector = `${cardSelector} .note-preview input[data-task-index="0"]`;
            await page.click(checkboxSelector);

            await page.evaluate((delayMs) => new Promise((resolve) => {
                setTimeout(resolve, typeof delayMs === "number" ? delayMs : 0);
            }), 500);
            const interimMarkdown = await page.evaluate((config) => {
                const raw = window.localStorage.getItem(config.storageKey);
                if (!raw) {
                    return null;
                }
                try {
                    const records = JSON.parse(raw);
                    const record = Array.isArray(records)
                        ? records.find((entry) => entry?.noteId === config.noteId)
                        : null;
                    return record?.markdownText ?? null;
                } catch {
                    return null;
                }
            }, { storageKey: appConfig.storageKey, noteId: CHECKLIST_NOTE_ID });
            assert.ok(typeof interimMarkdown === "string" && interimMarkdown.includes("- [x] Track first task"));

            const summary = await snapshotStorage(page, appConfig.storageKey);
            assert.equal(summary.totalRecords, 1, "exactly one record persists after toggling");
            assert.equal(summary.noteOccurrences[CHECKLIST_NOTE_ID], 1, "note identifier remains unique");

            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForSelector(cardSelector);
            const renderedCount = await page.$$eval(cardSelector, (nodes) => nodes.length);
            assert.equal(renderedCount, 1, "only one card renders after reload");
        } finally {
            await teardown();
        }
    });

    test("rapid preview toggles keep records unique across notes", async () => {
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

        const { page, teardown } = await openChecklistPage(seededRecords);
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

            await page.evaluate((delayMs) => new Promise((resolve) => {
                setTimeout(resolve, typeof delayMs === "number" ? delayMs : 0);
            }), 500);

            const interimSummary = await snapshotStorage(page, appConfig.storageKey);

            const summary = await snapshotStorage(page, appConfig.storageKey);
            assert.equal(summary.totalRecords, 2, "two records remain after rapid toggles");
            assert.equal(summary.noteOccurrences[CHECKLIST_NOTE_ID], 1, "primary note stays unique");
            assert.equal(summary.noteOccurrences[SECOND_NOTE_ID], 1, "secondary note stays unique");

            const renderedOrder = await page.evaluate(() => {
                return Array.from(document.querySelectorAll(".markdown-block[data-note-id]"))
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            assert.equal(renderedOrder.length, 2, "two cards render after toggles");
            const sortedActual = [...renderedOrder].sort();
            const sortedExpected = [CHECKLIST_NOTE_ID, SECOND_NOTE_ID].sort();
            assert.deepEqual(sortedActual, sortedExpected, "unique cards remain present after toggles");
        } finally {
            await teardown();
        }
    });
});

async function openChecklistPage(records) {
    const { page, teardown } = await createSharedPage({
        development: {
            llmProxyUrl: ""
        }
    });
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.clear();
        if (typeof payload === "string" && payload.length > 0) {
            window.localStorage.setItem(storageKey, payload);
        }
    }, appConfig.storageKey, serialized);

    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#top-editor .markdown-editor");
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return { page, teardown };
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

async function snapshotStorage(page, storageKey) {
    return page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return { totalRecords: 0, noteOccurrences: {} };
        }
        try {
            const records = JSON.parse(raw);
            if (!Array.isArray(records)) {
                return { totalRecords: 0, noteOccurrences: {} };
            }
            const noteOccurrences = {};
            for (const entry of records) {
                const id = entry?.noteId;
                if (typeof id !== "string") continue;
                noteOccurrences[id] = (noteOccurrences[id] ?? 0) + 1;
            }
            return { totalRecords: records.length, noteOccurrences };
        } catch {
            return { totalRecords: 0, noteOccurrences: {} };
        }
    }, storageKey);
}
