import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test.describe("UI sync integration", () => {
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

    test("user-created notes synchronize to the backend", { timeout: 60000 }, async () => {
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

        const userId = "ui-sync-user";
        const credential = backendContext.tokenFactory(userId);

        const page = await prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: ""
        });
        try {
            await dispatchSignIn(page, credential, userId);
            await waitForSyncManagerUser(page, userId);

            const editorSelector = "#top-editor .markdown-editor";
            const noteContent = "End-to-end synced note";
            await page.focus(editorSelector);
            await page.type(editorSelector, noteContent);
            await page.keyboard.down("Control");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Control");
            await page.keyboard.down("Meta");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Meta");
            await page.keyboard.press("Tab");
            await new Promise((resolve) => {
                setTimeout(resolve, 250);
            });

            await page.waitForSelector(".markdown-block:not(.top-editor)[data-note-id]");

            const noteId = await page.$eval(
                ".markdown-block:not(.top-editor)[data-note-id]",
                (node) => node.getAttribute("data-note-id")
            );

            const createdNote = await page.evaluate(async (id) => {
                if (typeof id !== "string" || id.length === 0) {
                    return null;
                }
                const module = await import("./js/core/store.js");
                return module.GravityStore.getById(id);
            }, noteId);

            assert.ok(createdNote, "expected newly created note in local storage");
            assert.ok(typeof createdNote.noteId === "string" && createdNote.noteId.length > 0, "note id should be set");

            await waitForPendingOperations(page);
            const debugState = await extractSyncDebugState(page);
            const backendToken = debugState?.backendToken?.accessToken;
            assert.ok(backendToken, "expected backend token after sync");

            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: backendToken,
                noteId: createdNote.noteId
            });
        } finally {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
        }
    });
});
