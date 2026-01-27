// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import {
    prepareFrontendPage,
    waitForSyncManagerUser,
    waitForPendingOperations,
    waitForTAuthSession,
    composeTestCredential,
    exchangeTAuthCredential
} from "./helpers/syncTestUtils.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";
import { installTAuthHarness } from "./helpers/tauthHarness.js";
import { readRuntimeContext } from "./helpers/runtimeContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const APP_SHELL_SELECTOR = "[data-test=\"app-shell\"]:not([hidden])";
const TOP_EDITOR_INPUT_SELECTOR = "#top-editor .CodeMirror [contenteditable=\"true\"], #top-editor .CodeMirror textarea";

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

        let iterationSuffix = 1;
        try {
            const runtimeContext = readRuntimeContext();
            const runtimeIteration = runtimeContext?.test?.iteration;
            if (Number.isInteger(runtimeIteration) && runtimeIteration > 0) {
                iterationSuffix = runtimeIteration;
            }
        } catch {
            iterationSuffix = 1;
        }
        const userId = `ui-sync-user-${iterationSuffix}`;
        const tauthScriptUrl = new URL("/tauth.js", backendContext.baseUrl).toString();
        const page = await prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: "",
            authBaseUrl: backendContext.baseUrl,
            tauthScriptUrl,
            beforeNavigate: async (targetPage) => {
                await installTAuthHarness(targetPage, {
                    baseUrl: backendContext.baseUrl,
                    cookieName: backendContext.cookieName,
                    mintSessionToken: backendContext.createSessionToken
                });
            }
        });
        try {
            await waitForTAuthSession(page);
            const credential = composeTestCredential({
                userId,
                email: `${userId}@example.com`,
                name: "UI Sync User",
                pictureUrl: "https://example.com/avatar.png"
            });
            await exchangeTAuthCredential(page, credential);
            await waitForSyncManagerUser(page, userId);

            await page.waitForSelector(APP_SHELL_SELECTOR);
            await page.waitForSelector(TOP_EDITOR_INPUT_SELECTOR, { visible: true });

            const editorSelector = TOP_EDITOR_INPUT_SELECTOR;
            const noteContent = "End-to-end synced note";
            await page.focus(editorSelector);
            await page.keyboard.type(noteContent);
            await page.keyboard.down("Control");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Control");
            await page.keyboard.down("Meta");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Meta");
            await page.keyboard.press("Tab");

            await page.waitForSelector(".markdown-block:not(.top-editor)[data-note-id]");

            const noteId = await page.$eval(
                ".markdown-block:not(.top-editor)[data-note-id]",
                (node) => node.getAttribute("data-note-id")
            );

            const createdNote = await page.evaluate(async (id) => {
                if (typeof id !== "string" || id.length === 0) {
                    return null;
                }
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/store.js");
                return module.GravityStore.getById(id);
            }, noteId);

            assert.ok(createdNote, "expected newly created note in local storage");
            assert.ok(typeof createdNote.noteId === "string" && createdNote.noteId.length > 0, "note id should be set");

            await waitForPendingOperations(page);
            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                sessionToken: backendContext.createSessionToken(userId),
                cookieName: backendContext.cookieName,
                noteId: createdNote.noteId
            });
        } finally {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
        }
    });
});
