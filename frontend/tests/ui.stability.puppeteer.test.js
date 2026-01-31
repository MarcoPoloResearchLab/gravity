// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_SYNC_SNAPSHOT_APPLIED } from "../js/constants.js";
import { connectSharedBrowser, flushAlpineQueues } from "./helpers/browserHarness.js";
import { startTestBackend } from "./helpers/backendHarness.js";
import { seedNotes, signInTestUser, attachBackendSessionCookie, prepareFrontendPage } from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "app.html")}`;
// Use "test-user" to match the default profile set by injectTAuthStub
const TEST_USER_ID = "test-user";

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
    const backend = await startTestBackend();
    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    const records = [buildNoteRecord({ noteId: NOTE_ID, markdownText: NOTE_MARKDOWN })];
    const page = await prepareFrontendPage(context, PAGE_URL, {
        backendBaseUrl: backend.baseUrl,
        llmProxyUrl: "",
        beforeNavigate: async (targetPage) => {
            await targetPage.evaluateOnNewDocument(() => {
                window.sessionStorage.setItem("__gravityTestInitialized", "true");
                window.localStorage.clear();
                window.__gravityForceMarkdownEditor = true;
            });
            // Set up session cookie BEFORE navigation to prevent redirect to landing page
            await attachBackendSessionCookie(targetPage, backend, TEST_USER_ID);
        }
    });
    await signInTestUser(page, backend, TEST_USER_ID);
    await seedNotes(page, records, TEST_USER_ID);
    return {
        page,
        teardown: async () => {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
            await backend.close();
        },
        records
    };
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
