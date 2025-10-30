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
const ANCHORED_CHECKLIST_NOTE_ID = "htmlView-checklist-anchored";
const LEADING_NOTE_ID = "htmlView-checklist-leading";
const TRAILING_NOTE_ID = "htmlView-checklist-trailing";
const LONG_CHECKLIST_MARKDOWN = [
    "# Anchored checklist stability",
    "",
    "- [ ] Confirm first task toggles",
    "- [ ] Confirm second task toggles",
    "- [ ] Confirm third task toggles",
    "- [ ] Confirm fourth task toggles",
    "- [ ] Confirm fifth task toggles",
    "",
    "Paragraph one ensures the rendered htmlView overflows the bounded height and exposes the expand toggle control.",
    "Paragraph two continues describing the checklist anchoring expectations for Gravity Notes when checkboxes change.",
    "Paragraph three provides additional content so the htmlView requires expansion to show all lines without scrolling.",
    "",
    "Further narrative keeps the htmlView tall enough to exercise the expand affordance and anchoring logic."
].join("\n");
const LEADING_NOTE_MARKDOWN = [
    "# Leading note in feed",
    "",
    "This record keeps the seeded order predictable so the checklist card starts in the second position."
].join("\n");
const TRAILING_NOTE_MARKDOWN = [
    "# Trailing note in feed",
    "",
    "This record remains after the checklist so the test can detect unintended bubbling to the top."
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
        const withOffset = (offsetMs) => new Date(now + offsetMs).toISOString();
        const seededRecords = [
            buildNoteRecord({
                noteId: LEADING_NOTE_ID,
                markdownText: LEADING_NOTE_MARKDOWN,
                attachments: {},
                createdAtIso: withOffset(2000),
                updatedAtIso: withOffset(2000),
                lastActivityIso: withOffset(2000)
            }),
            buildNoteRecord({
                noteId: ANCHORED_CHECKLIST_NOTE_ID,
                markdownText: LONG_CHECKLIST_MARKDOWN,
                attachments: {},
                createdAtIso: withOffset(1000),
                updatedAtIso: withOffset(1000),
                lastActivityIso: withOffset(1000)
            }),
            buildNoteRecord({
                noteId: TRAILING_NOTE_ID,
                markdownText: TRAILING_NOTE_MARKDOWN,
                attachments: {},
                createdAtIso: withOffset(0),
                updatedAtIso: withOffset(0),
                lastActivityIso: withOffset(0)
            })
        ];

        const { page, teardown } = await openChecklistPage(seededRecords);
        const anchoredCardSelector = `.markdown-block[data-note-id="${ANCHORED_CHECKLIST_NOTE_ID}"]`;
        const htmlViewSelector = `${anchoredCardSelector} .note-html-view`;
        const checkboxSelector = `${htmlViewSelector} input[data-task-index="0"]`;
        const expandToggleSelector = `${anchoredCardSelector} .note-expand-toggle`;

        try {
            await page.waitForSelector(anchoredCardSelector);
            await page.waitForSelector(checkboxSelector);
            await page.waitForFunction((selector) => {
                const button = document.querySelector(selector);
                if (!(button instanceof HTMLElement)) {
                    return false;
                }
                const computed = window.getComputedStyle(button);
                const visible = computed.display !== "none" && computed.visibility !== "hidden";
                return !button.hidden && visible;
            }, {}, expandToggleSelector);

            await page.click(expandToggleSelector);
            await page.waitForSelector(`${htmlViewSelector}.note-html-view--expanded`);

            const initialOrder = await page.evaluate(() => {
                return Array.from(document.querySelectorAll(".markdown-block[data-note-id]"))
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            assert.deepEqual(
                initialOrder,
                [LEADING_NOTE_ID, ANCHORED_CHECKLIST_NOTE_ID, TRAILING_NOTE_ID],
                "seeded records should render in the expected initial order"
            );

            const expandedBeforeToggle = await page.$eval(htmlViewSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                return element.classList.contains("note-html-view--expanded");
            });
            assert.equal(expandedBeforeToggle, true, "htmlView must be expanded before toggling the checkbox");

            await page.click(checkboxSelector);

            await page.evaluate((delayMs) => new Promise((resolve) => {
                const duration = typeof delayMs === "number" ? delayMs : 0;
                setTimeout(resolve, duration);
            }), 1200);

            const postToggleOrder = await page.evaluate(() => {
                return Array.from(document.querySelectorAll(".markdown-block[data-note-id]"))
                    .map((node) => node.getAttribute("data-note-id"))
                    .filter((value) => typeof value === "string");
            });
            assert.deepEqual(
                postToggleOrder,
                initialOrder,
                "anchored checklist card should retain its relative order after toggling a checkbox"
            );

            const expandedAfterToggle = await page.$eval(htmlViewSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                return element.classList.contains("note-html-view--expanded");
            });
            assert.equal(expandedAfterToggle, true, "expanded htmlView should remain expanded after the checkbox toggle");

            const datasetExpandedState = await page.$eval(anchoredCardSelector, (card) => {
                if (!(card instanceof HTMLElement)) {
                    return "";
                }
                return card.dataset.htmlViewExpanded ?? "";
            });
            assert.equal(datasetExpandedState, "true", "card dataset should continue marking the htmlView as expanded");
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
    const updatedIso = typeof updatedAtIso === "string" ? updatedAtIso : createdIso;
    const activityIso = typeof lastActivityIso === "string" ? lastActivityIso : updatedIso;
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
