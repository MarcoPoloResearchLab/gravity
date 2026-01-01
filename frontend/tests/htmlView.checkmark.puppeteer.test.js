import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js?build=2024-10-05T12:00:00Z";
import { createSharedPage, waitForAppHydration, flushAlpineQueues } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const CHECKLIST_NOTE_ID = "htmlView-checklist-primary";
const CHECKLIST_MARKDOWN = [
    "# Checklist regression guard",
    "",
    "- [ ] Track first task",
    "- [x] Track second task"
].join("\n");
const SECOND_NOTE_ID = "htmlView-checklist-secondary";
const SECOND_MARKDOWN = [
    "# Secondary checklist",
    "",
    "- [ ] Mirror task"
].join("\n");
const RAPID_TOGGLE_ITERATIONS = 4;

test.describe("Checklist htmlView interactions", () => {
    test("htmlView checkbox toggle keeps a single persisted note", async () => {
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

            const checkboxSelector = `${cardSelector} .note-html-view input[data-task-index="0"]`;
            await page.click(checkboxSelector);

            await page.waitForFunction((config) => {
                const raw = window.localStorage.getItem(config.storageKey);
                if (!raw) {
                    return false;
                }
                try {
                    const records = JSON.parse(raw);
                    if (!Array.isArray(records)) {
                        return false;
                    }
                    const record = records.find((entry) => entry?.noteId === config.noteId);
                    if (!record || typeof record.markdownText !== "string") {
                        return false;
                    }
                    return record.markdownText.includes("- [x] Track first task");
                } catch {
                    return false;
                }
            }, { timeout: 2000 }, { storageKey: appConfig.storageKey, noteId: CHECKLIST_NOTE_ID });
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

    test("rapid htmlView toggles keep records unique across notes", async () => {
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
            const firstSelector = `.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"] .note-html-view input[data-task-index="0"]`;
            const secondSelector = `.markdown-block[data-note-id="${SECOND_NOTE_ID}"] .note-html-view input[data-task-index="0"]`;

            await Promise.all([
                page.waitForSelector(`.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"]`),
                page.waitForSelector(`.markdown-block[data-note-id="${SECOND_NOTE_ID}"]`)
            ]);

            for (let iteration = 0; iteration < RAPID_TOGGLE_ITERATIONS; iteration += 1) {
                await page.click(firstSelector);
                await page.click(secondSelector);
            }

            await page.waitForFunction((config) => {
                const raw = window.localStorage.getItem(config.storageKey);
                if (!raw) {
                    return false;
                }
                try {
                    const records = JSON.parse(raw);
                    if (!Array.isArray(records)) {
                        return false;
                    }
                    const firstCount = records.filter((entry) => entry?.noteId === config.firstId).length;
                    const secondCount = records.filter((entry) => entry?.noteId === config.secondId).length;
                    return firstCount === 1 && secondCount === 1;
                } catch {
                    return false;
                }
            }, { timeout: 2000 }, {
                storageKey: appConfig.storageKey,
                firstId: CHECKLIST_NOTE_ID,
                secondId: SECOND_NOTE_ID
            });
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

    test("htmlView checkbox toggle resists duplicate cards when the grid re-renders mid-bubble", async () => {
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
            const checkboxSelector = `${cardSelector} .note-html-view input[data-task-index="0"]`;
            await page.waitForSelector(checkboxSelector);

            await page.evaluate(() => {
                window.__gravityHtmlViewBubbleDelayMs = 80;
            });

            await page.click(checkboxSelector);

            await page.evaluate(({ storageKey, noteId }) => {
                const root = document.body;
                if (!(root instanceof HTMLElement)) {
                    return;
                }
                const raw = window.localStorage.getItem(storageKey);
                if (!raw) {
                    return;
                }
                let records;
                try {
                    records = JSON.parse(raw);
                } catch {
                    return;
                }
                if (!Array.isArray(records)) {
                    return;
                }
                const record = records.find((entry) => entry?.noteId === noteId);
                if (!record) {
                    return;
                }
                const event = new CustomEvent("gravity:note-update", {
                    bubbles: true,
                    detail: {
                        record,
                        noteId,
                        storeUpdated: true,
                        shouldRender: true
                    }
                });
                root.dispatchEvent(event);
            }, { storageKey: appConfig.storageKey, noteId: CHECKLIST_NOTE_ID });

            await page.waitForFunction((selector) => {
                return document.querySelectorAll(selector).length === 1;
            }, { timeout: 2000 }, cardSelector);

            const renderedCardCount = await page.$$eval(cardSelector, (nodes) => nodes.length);
            assert.equal(renderedCardCount, 1, "only one card remains rendered after forced re-render");

            const renderedIds = await page.$$eval(".markdown-block[data-note-id]", (nodes) => {
                return nodes
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            const duplicateMatches = renderedIds.filter((value) => value === CHECKLIST_NOTE_ID);
            assert.equal(duplicateMatches.length, 1, "duplicate cards do not appear for the toggled note");
        } finally {
            await teardown();
        }
    });

    test("expanded htmlView checkbox toggle keeps the card anchored in place", async () => {
        const newerTimestamp = new Date().toISOString();
        const olderTimestamp = new Date(Date.now() - 60000).toISOString();
        const referenceRecord = buildNoteRecord({
            noteId: SECOND_NOTE_ID,
            markdownText: SECOND_MARKDOWN,
            attachments: {},
            createdAtIso: newerTimestamp,
            updatedAtIso: newerTimestamp,
            lastActivityIso: newerTimestamp
        });
        const anchoredRecord = buildNoteRecord({
            noteId: CHECKLIST_NOTE_ID,
            markdownText: CHECKLIST_MARKDOWN,
            attachments: {},
            createdAtIso: olderTimestamp,
            updatedAtIso: olderTimestamp,
            lastActivityIso: olderTimestamp
        });

        const { page, teardown } = await openChecklistPage([referenceRecord, anchoredRecord]);
        const anchorCardSelector = `.markdown-block[data-note-id="${CHECKLIST_NOTE_ID}"]`;
        const referenceCardSelector = `.markdown-block[data-note-id="${SECOND_NOTE_ID}"]`;
        const anchorCheckboxSelector = `${anchorCardSelector} .note-html-view input[data-task-index="0"]`;
        const anchorExpandedSelector = `${anchorCardSelector} .note-html-view.note-html-view--expanded`;

        try {
            await Promise.all([
                page.waitForSelector(anchorCardSelector),
                page.waitForSelector(referenceCardSelector)
            ]);

            const initialOrder = await getRenderedNoteOrder(page);
            const initialAnchorIndex = initialOrder.indexOf(CHECKLIST_NOTE_ID);
            assert.ok(initialAnchorIndex > 0, "anchored card should start after the reference card");

            await page.click(`${anchorCardSelector} .note-expand-toggle`);
            await page.waitForSelector(anchorExpandedSelector);
            const initialTop = await getElementTop(page, anchorCardSelector);

            await page.evaluate(() => {
                window.__gravityHtmlViewBubbleDelayMs = 50;
            });

            await page.click(anchorCheckboxSelector);
            await page.waitForSelector(`${anchorCardSelector} .note-html-view input[data-task-index="0"]:checked`);

            await waitForDelay(page, 200);

            const postOrder = await getRenderedNoteOrder(page);
            assert.deepEqual(postOrder, initialOrder, "card order should remain unchanged after the checkbox toggle");

            const postExpanded = await page.$eval(anchorCardSelector, (element) => {
                const htmlView = element.querySelector(".note-html-view");
                return htmlView instanceof HTMLElement && htmlView.classList.contains("note-html-view--expanded");
            });
            assert.equal(postExpanded, true, "htmlView should remain expanded after toggling the checkbox");

            const postTop = await getElementTop(page, anchorCardSelector);
            const topDifference = Math.abs(postTop - initialTop);
            assert.ok(topDifference <= 4, `card should remain visually anchored (difference ${topDifference}px)`);
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
    await waitForAppHydration(page);
    await flushAlpineQueues(page);
    await page.waitForSelector("#top-editor .markdown-editor");
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return { page, teardown };
}

function buildNoteRecord({
    noteId,
    markdownText,
    attachments = {},
    createdAtIso,
    updatedAtIso,
    lastActivityIso,
    pinned = false
}) {
    const createdTimestamp = typeof createdAtIso === "string" && createdAtIso.length > 0
        ? createdAtIso
        : new Date().toISOString();
    const updatedTimestamp = typeof updatedAtIso === "string" && updatedAtIso.length > 0
        ? updatedAtIso
        : createdTimestamp;
    const activityTimestamp = typeof lastActivityIso === "string" && lastActivityIso.length > 0
        ? lastActivityIso
        : updatedTimestamp;
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: createdTimestamp,
        updatedAtIso: updatedTimestamp,
        lastActivityIso: activityTimestamp,
        pinned
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

async function getRenderedNoteOrder(page) {
    return page.evaluate(() => {
        return Array.from(document.querySelectorAll(".markdown-block[data-note-id]"))
            .map((element) => element.getAttribute("data-note-id"))
            .filter((value) => typeof value === "string");
    });
}

async function getElementTop(page, selector) {
    return page.$eval(selector, (element) => {
        if (!(element instanceof HTMLElement)) {
            return Number.NaN;
        }
        const rect = element.getBoundingClientRect();
        return rect.top;
    });
}

async function waitForDelay(page, delayMs) {
    const boundedDelay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
    await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), boundedDelay);
}
