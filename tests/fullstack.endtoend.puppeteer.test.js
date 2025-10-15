import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    EVENT_NOTE_CREATE
} from "../js/constants.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    waitForPendingOperations,
    extractSyncDebugState
} from "./helpers/syncTestUtils.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test.describe("Full stack integration", () => {
    /** @type {{ baseUrl: string, tokenFactory: (userId: string) => string, close: () => Promise<void> } | null} */
    let backendContext = null;
    /** @type {Error | null} */
    let initializationError = null;

    test.before(async () => {
        try {
            backendContext = await startTestBackend();
        } catch (error) {
            initializationError = error instanceof Error ? error : new Error(String(error));
        }
    });

    test.after(async () => {
        await backendContext?.close();
    });

    test("persists notes through the real backend", { timeout: 60000 }, async () => {
        if (initializationError) {
            if (/** @type {{ code?: string }} */ (initializationError).code === "ENOENT") {
                test.skip("Go toolchain is not available for backend integration test.");
                return;
            }
            throw initializationError;
        }
        assert.ok(backendContext, "backend harness must be initialised");

        const browser = await connectSharedBrowser();
        const context = await browser.createBrowserContext();

        const userId = "fullstack-sync-user";
        const credential = backendContext.tokenFactory(userId);

        const page = await prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyClassifyUrl: ""
        });
        try {
            await dispatchSignIn(page, credential, userId);
            await waitForSyncManagerUser(page, userId);

            const noteId = "fullstack-sync-note";
            const timestampIso = new Date().toISOString();
            await dispatchNoteCreate(page, {
                noteId,
                markdownText: "Persisted via backend harness",
                timestampIso
            });

            await waitForPendingOperations(page);
            const debugState = await extractSyncDebugState(page);
            const backendToken = debugState?.backendToken?.accessToken;
            assert.ok(backendToken, "expected backend token after sync");

            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: backendToken,
                noteId
            });
        } finally {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
        }
    });
});

/**
 * @param {import('puppeteer').Browser} browser
 * @param {string} backendBaseUrl
 * @returns {Promise<import('puppeteer').Page>}
 */
/**
 * @param {import('puppeteer').Page} page
 * @param {{ noteId: string, markdownText: string, timestampIso: string }} params
 * @returns {Promise<void>}
 */
async function dispatchNoteCreate(page, params) {
    await page.evaluate((eventName, detail) => {
        const root = document.querySelector("body");
        if (!root) {
            return;
        }
        root.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true
        }));
    }, EVENT_NOTE_CREATE, {
        record: {
            noteId: params.noteId,
            markdownText: params.markdownText,
            createdAtIso: params.timestampIso,
            updatedAtIso: params.timestampIso,
            lastActivityIso: params.timestampIso
        },
        storeUpdated: false,
        shouldRender: false
    });
}
