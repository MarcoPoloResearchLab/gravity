import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_NOTE_CREATE } from "../js/constants.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    waitForPendingOperations,
    extractSyncDebugState
} from "./helpers/syncTestUtils.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const TEST_USER_ID = "sync-user";
const NOTE_IDENTIFIER = "sync-note";
const NOTE_MARKDOWN = "Backend persisted note";
const SYNC_POLL_TIMEOUT_MS = 10000;

test.describe("Backend persistence", () => {
    /** @type {{ baseUrl: string, tokenFactory: (userId: string) => string, close: () => Promise<void> }|null} */
    let backendContext = null;

    test.before(async () => {
        backendContext = await startTestBackend();
    });

    test.after(async () => {
        await backendContext?.close();
    });

    test("notes persist across clients via backend sync", async () => {
        if (!backendContext) {
            throw new Error("backend harness not initialised");
        }

        const browser = await connectSharedBrowser();
        const contextA = await browser.createBrowserContext();
        const credentialA = backendContext.tokenFactory(TEST_USER_ID);
        const pageA = await prepareFrontendPage(contextA, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyClassifyUrl: ""
        });

        let pageB = null;
        let contextB = null;

        try {
            await dispatchSignIn(pageA, credentialA, TEST_USER_ID);
            await waitForSyncManagerUser(pageA, TEST_USER_ID);
            await waitForPendingOperations(pageA);

            await dispatchNoteCreate(pageA, {
                noteId: NOTE_IDENTIFIER,
                markdownText: NOTE_MARKDOWN,
                timestampIso: new Date().toISOString()
            });
            await waitForPendingOperations(pageA);

            const debugState = await extractSyncDebugState(pageA);
            const backendToken = debugState?.backendToken?.accessToken;
            assert.ok(backendToken, "backend token should be available after sign-in");

            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: backendToken,
                noteId: NOTE_IDENTIFIER
            });

            contextB = await browser.createBrowserContext();
            const credentialB = backendContext.tokenFactory(TEST_USER_ID);
            pageB = await prepareFrontendPage(contextB, PAGE_URL, {
                backendBaseUrl: backendContext.baseUrl,
                llmProxyClassifyUrl: ""
            });

            await dispatchSignIn(pageB, credentialB, TEST_USER_ID);
            await waitForSyncManagerUser(pageB, TEST_USER_ID);
            await waitForPendingOperations(pageB);
            await pageB.waitForSelector(".auth-avatar:not([hidden])");
            await pageB.waitForSelector(`.markdown-block[data-note-id="${NOTE_IDENTIFIER}"]`);

            const renderedMarkdown = await pageB.$eval(
                `.markdown-block[data-note-id="${NOTE_IDENTIFIER}"] .markdown-content`,
                (element) => element.textContent?.trim() ?? ""
            );
            assert.match(renderedMarkdown, /Backend persisted note/);
        } finally {
            await pageA.close().catch(() => {});
            await contextA.close().catch(() => {});
            await pageB?.close().catch(() => {});
            await contextB?.close().catch(() => {});
            browser.disconnect();
        }
    });
});

async function dispatchNoteCreate(page, { noteId, markdownText, timestampIso }) {
    await page.evaluate((eventName, detail) => {
        const root = document.querySelector("body");
        if (!root) return;
        root.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true
        }));
    }, EVENT_NOTE_CREATE, {
        record: {
            noteId,
            markdownText,
            createdAtIso: timestampIso,
            updatedAtIso: timestampIso,
            lastActivityIso: timestampIso
        },
        storeUpdated: false,
        shouldRender: false
    });
}
