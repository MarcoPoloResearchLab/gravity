import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js?build=2024-10-05T12:00:00Z";
import { EVENT_SYNC_SNAPSHOT_APPLIED } from "../js/constants.js";
import { createSharedPage, waitForAppHydration, flushAlpineQueues } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const NOTE_ID = "flicker-fixture";
const NOTE_MARKDOWN = [
    "# Flicker Regression",
    "",
    "This note ensures that rendered cards remain stable while idle."
].join("\n");

test("snapshot events without changes do not churn rendered cards", async () => {
    const { page, teardown, records } = await preparePage();
    try {
        const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;
        await page.waitForSelector(cardSelector);
        await page.waitForSelector(`#notes-container .markdown-block:not(.top-editor)`);

        await page.evaluate(() => {
            const container = document.getElementById("notes-container");
            if (!(container instanceof HTMLElement)) {
                return;
            }
            if (window.__flickerObserver instanceof MutationObserver) {
                window.__flickerObserver.disconnect();
            }
            window.__flickerRecords = [];
            const observer = new MutationObserver((mutations) => {
                const meaningful = mutations.some((mutation) => {
                    if (mutation.type !== "childList") {
                        return false;
                    }
                    const removals = mutation.removedNodes.length;
                    const additions = mutation.addedNodes.length;
                    return removals > 0 || additions > 0;
                });
                if (meaningful) {
                    window.__flickerRecords.push(Date.now());
                }
            });
            observer.observe(container, { childList: true });
            window.__flickerObserver = observer;
        });

        await flushAlpineQueues(page);
        await page.evaluate(() => {
            window.__flickerRecords = [];
        });

        const eventsObserved = await page.evaluate(async (eventName, record) => {
            const root = document.querySelector("[x-data]") ?? document.body;
            if (!(root instanceof HTMLElement) || !record) {
                return -1;
            }
            const detail = { records: [record], source: "test" };
            const dispatch = () => {
                root.dispatchEvent(new CustomEvent(eventName, {
                    detail,
                    bubbles: true
                }));
            };
            dispatch();
            dispatch();
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
            return Array.isArray(window.__flickerRecords) ? window.__flickerRecords.length : -1;
        }, EVENT_SYNC_SNAPSHOT_APPLIED, records[0]);

        const stableCount = await page.evaluate(() => {
            const observer = window.__flickerObserver;
            if (observer instanceof MutationObserver) {
                observer.disconnect();
            }
            const records = Array.isArray(window.__flickerRecords) ? window.__flickerRecords : [];
            window.__flickerObserver = undefined;
            window.__flickerRecords = undefined;
            return records.length;
        });

        assert.equal(eventsObserved, stableCount);
        assert.equal(eventsObserved, 0, `Expected no DOM churn when snapshot is unchanged, but observed ${eventsObserved} mutation burst(s).`);
    } finally {
        await teardown();
    }
});

async function preparePage() {
    const { page, teardown } = await createSharedPage();
    const records = [buildNoteRecord({ noteId: NOTE_ID, markdownText: NOTE_MARKDOWN })];
    const serialized = JSON.stringify(records);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.setItem(storageKey, payload);
        window.__gravityForceMarkdownEditor = true;
    }, appConfig.storageKey, serialized);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppHydration(page);
    return { page, teardown, records };
}

function buildNoteRecord({ noteId, markdownText, attachments = {} }) {
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
