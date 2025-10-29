import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

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
const GN310_LEADING_NOTE_ID = "gn310-leading";
const GN310_TARGET_NOTE_ID = "gn310-target";
const GN310_TRAILING_NOTE_ID = "gn310-trailing";
const GN310_LEADING_MARKDOWN = [
    "# Leading checklist note",
    "",
    "- [ ] Primary task"
].join("\n");
const GN310_TARGET_MARKDOWN = [
    "# Anchored checklist note",
    "",
    "- [ ] Keep track of anchor",
    "- [x] Secondary item"
].join("\n");
const GN310_TRAILING_MARKDOWN = [
    "# Trailing checklist note",
    "",
    "- [ ] Downstream task"
].join("\n");

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

            await page.evaluate((delayMs) => new Promise((resolve) => {
                setTimeout(resolve, typeof delayMs === "number" ? delayMs : 0);
            }), 160);

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
        const now = Date.now();
        const newerIso = new Date(now + 2 * 60 * 1000).toISOString();
        const anchorIso = new Date(now - 30 * 1000).toISOString();
        const olderIso = new Date(now - 5 * 60 * 1000).toISOString();
        const seededRecords = [
            buildNoteRecord({
                noteId: GN310_LEADING_NOTE_ID,
                markdownText: GN310_LEADING_MARKDOWN,
                createdAtIso: newerIso,
                updatedAtIso: newerIso,
                lastActivityIso: newerIso
            }),
            buildNoteRecord({
                noteId: GN310_TARGET_NOTE_ID,
                markdownText: GN310_TARGET_MARKDOWN,
                createdAtIso: anchorIso,
                updatedAtIso: anchorIso,
                lastActivityIso: anchorIso
            }),
            buildNoteRecord({
                noteId: GN310_TRAILING_NOTE_ID,
                markdownText: GN310_TRAILING_MARKDOWN,
                createdAtIso: olderIso,
                updatedAtIso: olderIso,
                lastActivityIso: olderIso
            })
        ];

        const { page, teardown } = await openChecklistPage(seededRecords);
        const targetCardSelector = `.markdown-block[data-note-id="${GN310_TARGET_NOTE_ID}"]`;
        const targetHtmlViewSelector = `${targetCardSelector} .note-html-view`;
        const checkboxSelector = `${targetCardSelector} .note-html-view input[data-task-index="0"]`;

        try {
            await page.waitForSelector(targetHtmlViewSelector);
            const initialOrder = await page.$$eval(".markdown-block[data-note-id]", (nodes) => {
                return nodes
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            const initialIndex = initialOrder.indexOf(GN310_TARGET_NOTE_ID);
            assert.ok(initialIndex > 0, "anchored note should render after at least one other card");

            await page.click(`${targetCardSelector} .note-expand-toggle`);
            await page.waitForSelector(`${targetHtmlViewSelector}.note-html-view--expanded`);

            const expandedOrder = await page.$$eval(".markdown-block[data-note-id]", (nodes) => {
                return nodes
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            assert.deepEqual(expandedOrder, initialOrder, "expanding the htmlView should not reorder cards");

            const preToggleTop = await page.$eval(targetCardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return Number.NaN;
                }
                const rect = element.getBoundingClientRect();
                return rect.top;
            });
            assert.ok(Number.isFinite(preToggleTop), "pre-toggle viewport position should be measurable");

            await page.waitForSelector(checkboxSelector);
            await page.click(checkboxSelector);

            await page.evaluate((delayMs) => new Promise((resolve) => {
                setTimeout(resolve, typeof delayMs === "number" ? delayMs : 0);
            }), 1100);

            const postOrder = await page.$$eval(".markdown-block[data-note-id]", (nodes) => {
                return nodes
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            assert.deepEqual(postOrder, expandedOrder, "checkbox toggle should not reorder cards");

            const postToggleTop = await page.$eval(targetCardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return Number.NaN;
                }
                const rect = element.getBoundingClientRect();
                return rect.top;
            });
            assert.ok(Number.isFinite(postToggleTop), "post-toggle viewport position should be measurable");
            const viewportTolerancePx = 16;
            const delta = Math.abs(postToggleTop - preToggleTop);
            assert.ok(
                delta <= viewportTolerancePx,
                `card top offset should remain stable (delta=${delta}, tolerance=${viewportTolerancePx})`
            );

            const htmlViewExpanded = await page.$eval(targetHtmlViewSelector, (element) => {
                return element instanceof HTMLElement && element.classList.contains("note-html-view--expanded");
            });
            assert.equal(htmlViewExpanded, true, "expanded htmlView should remain expanded after toggling a checkbox");
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

function buildNoteRecord({
    noteId,
    markdownText,
    attachments = {},
    createdAtIso,
    updatedAtIso,
    lastActivityIso,
    pinned = false
}) {
    const timestamp = new Date().toISOString();
    const createdIso = typeof createdAtIso === "string" ? createdAtIso : timestamp;
    const updatedIso = typeof updatedAtIso === "string" ? updatedAtIso : timestamp;
    const activityIso = typeof lastActivityIso === "string" ? lastActivityIso : timestamp;
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: createdIso,
        updatedAtIso: updatedIso,
        lastActivityIso: activityIso,
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
