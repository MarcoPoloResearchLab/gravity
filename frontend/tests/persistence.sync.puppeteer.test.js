// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    waitForPendingOperations,
    dispatchNoteCreate,
    attachBackendSessionCookie
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
    /** @type {{ baseUrl: string, tokenFactory: (userId: string) => string, createSessionToken: (userId: string) => string, cookieName: string, close: () => Promise<void> }|null} */
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
            llmProxyUrl: ""
        });

        let pageB = null;
        let contextB = null;

        try {
            await attachBackendSessionCookie(pageA, backendContext, TEST_USER_ID);
            await dispatchSignIn(pageA, credentialA, TEST_USER_ID);
            await waitForSyncManagerUser(pageA, TEST_USER_ID);
            await waitForPendingOperations(pageA);

            const timestampIso = new Date().toISOString();
            await dispatchNoteCreate(pageA, {
                record: {
                    noteId: NOTE_IDENTIFIER,
                    markdownText: NOTE_MARKDOWN,
                    createdAtIso: timestampIso,
                    updatedAtIso: timestampIso,
                    lastActivityIso: timestampIso
                },
                storeUpdated: false,
                shouldRender: false
            });
            await waitForPendingOperations(pageA);

            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                sessionToken: backendContext.createSessionToken(TEST_USER_ID),
                cookieName: backendContext.cookieName,
                noteId: NOTE_IDENTIFIER
            });

            contextB = await browser.createBrowserContext();
            const credentialB = backendContext.tokenFactory(TEST_USER_ID);
            pageB = await prepareFrontendPage(contextB, PAGE_URL, {
                backendBaseUrl: backendContext.baseUrl,
                llmProxyUrl: ""
            });

            await attachBackendSessionCookie(pageB, backendContext, TEST_USER_ID);
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
