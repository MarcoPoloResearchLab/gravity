import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    startTestBackend,
    waitForBackendNote
} from "./helpers/backendHarness.js";
import {
    connectSharedBrowser
} from "./helpers/browserHarness.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    waitForPendingOperations,
    extractSyncDebugState,
    dispatchNoteCreate,
    dispatchNoteUpdate
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test.describe("Synchronization scenarios", () => {
    /** @type {{ baseUrl: string, tokenFactory: (userId: string) => string, close: () => Promise<void> } | null} */
    let backendContext = null;

    test.before(async () => {
        backendContext = await startTestBackend();
    });

    test.after(async () => {
        await backendContext?.close();
        backendContext = null;
    });

    test("flushes queued operations after transient network failure", { timeout: 60000 }, async () => {
        assert.ok(backendContext, "backend harness must be initialised");

        const browser = await connectSharedBrowser();
        const context = await browser.createBrowserContext();
        const userId = `transient-sync-user-${Date.now()}`;
        const credential = backendContext.tokenFactory(userId);
        const page = await prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: "",
            beforeNavigate: async (targetPage) => {
                await targetPage.evaluateOnNewDocument((syncUrl) => {
                    const originalFetch = window.fetch;
                    let attempts = 0;
                    window.__gravitySyncIntercept__ = { attempts };
                    window.fetch = async (input, init = {}) => {
                        const requestUrl = typeof input === "string"
                            ? input
                            : typeof input?.url === "string"
                                ? input.url
                                : "";
                        if (typeof requestUrl === "string" && requestUrl.startsWith(syncUrl)) {
                            attempts += 1;
                            window.__gravitySyncIntercept__.attempts = attempts;
                            if (attempts === 1) {
                                throw new Error("Simulated network failure for sync");
                            }
                        }
                        return originalFetch.call(window, input, init);
                    };
                }, `${backendContext.baseUrl}/notes/sync`);
            }
        });

        try {
            await dispatchSignIn(page, credential, userId);
            await waitForSyncManagerUser(page, userId);

            const createdAtIso = new Date().toISOString();
            const noteId = `transient-note-${Date.now()}`;
            const noteMarkdown = "Transient failure note";
            await dispatchNoteCreate(page, {
                record: {
                    noteId,
                    markdownText: noteMarkdown,
                    createdAtIso,
                    updatedAtIso: createdAtIso,
                    lastActivityIso: createdAtIso
                },
                storeUpdated: false,
                shouldRender: false
            });

            await page.waitForFunction(() => {
                const root = document.querySelector("[x-data]");
                if (!root) {
                    return false;
                }
                const alpine = /** @type {{ $data?: (element: Element) => any }} */ (window.Alpine ?? null);
                if (!alpine || typeof alpine.$data !== "function") {
                    return false;
                }
                const component = alpine.$data(root);
                const debugState = component?.syncManager?.getDebugState?.();
                return Array.isArray(debugState?.pendingOperations) && debugState.pendingOperations.length === 1;
            }, { timeout: 5000 });
            const initialAttempts = await page.evaluate(() => window.__gravitySyncIntercept__?.attempts ?? 0);
            assert.equal(initialAttempts, 1, "initial sync attempt should fail exactly once");

            await page.evaluate(async () => {
                const root = document.querySelector("[x-data]");
                if (!root) {
                    throw new Error("application root not found");
                }
                const alpine = /** @type {{ $data?: (element: Element) => any }} */ (window.Alpine ?? null);
                if (!alpine || typeof alpine.$data !== "function") {
                    throw new Error("Alpine data accessor unavailable");
                }
                const component = alpine.$data(root);
                if (!component?.syncManager || typeof component.syncManager.synchronize !== "function") {
                    throw new Error("sync manager not initialised");
                }
                await component.syncManager.synchronize({ flushQueue: true });
            });

            await waitForPendingOperations(page);
            const retryAttempts = await page.evaluate(() => window.__gravitySyncIntercept__?.attempts ?? 0);
            assert.ok(retryAttempts >= 2, "sync queue should retry after connectivity returns");

            const debugState = await extractSyncDebugState(page);
            assert.ok(debugState?.backendToken?.accessToken, "backend token must be present after retry");

            const snapshot = await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: debugState.backendToken.accessToken,
                noteId
            });
            const noteEntry = Array.isArray(snapshot?.notes)
                ? snapshot.notes.find((entry) => entry?.payload?.noteId === noteId)
                : null;
            assert.ok(noteEntry, "backend snapshot should contain the queued note");
            assert.equal(noteEntry?.payload?.markdownText, noteMarkdown);
        } finally {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
        }
    });

    test("replays pending queue on subsequent session sign-in", { timeout: 60000 }, async () => {
        assert.ok(backendContext, "backend harness must be initialised");

        const browser = await connectSharedBrowser();
        const context = await browser.createBrowserContext();
        const userId = `queued-session-user-${Date.now()}`;
        const credential = backendContext.tokenFactory(userId);
        const page = await prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: "",
            beforeNavigate: async (targetPage) => {
                await targetPage.evaluateOnNewDocument((syncUrl) => {
                    const originalFetch = window.fetch;
                    window.fetch = async (input, init = {}) => {
                        const requestUrl = typeof input === "string"
                            ? input
                            : typeof input?.url === "string"
                                ? input.url
                                : "";
                        if (typeof requestUrl === "string" && requestUrl.startsWith(syncUrl)) {
                            throw new Error("Offline sync queue override");
                        }
                        return originalFetch.call(window, input, init);
                    };
                }, `${backendContext.baseUrl}/notes/sync`);
            }
        });

        const createdAtIso = new Date().toISOString();
        const queuedNoteId = `queued-note-${Date.now()}`;
        const queuedMarkdown = "Queued while offline";

        try {
            await dispatchSignIn(page, credential, userId);
            await waitForSyncManagerUser(page, userId);

            await dispatchNoteCreate(page, {
                record: {
                    noteId: queuedNoteId,
                    markdownText: queuedMarkdown,
                    createdAtIso,
                    updatedAtIso: createdAtIso,
                    lastActivityIso: createdAtIso
                },
                storeUpdated: false,
                shouldRender: false
            });

            await page.waitForFunction(() => {
                const root = document.querySelector("[x-data]");
                if (!root) {
                    return false;
                }
                const alpine = /** @type {{ $data?: (element: Element) => any }} */ (window.Alpine ?? null);
                if (!alpine || typeof alpine.$data !== "function") {
                    return false;
                }
                const component = alpine.$data(root);
                const debugState = component?.syncManager?.getDebugState?.();
                return Array.isArray(debugState?.pendingOperations) && debugState.pendingOperations.length === 1;
            }, { timeout: 5000 });
        } finally {
            await page.close().catch(() => {});
        }

        const pageReload = await prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: "",
            preserveLocalStorage: true
        });
        try {
            const hasOfflineNote = await pageReload.evaluate(async (noteId) => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/store.js");
                const records = module.GravityStore.loadAllNotes();
                return Array.isArray(records) && records.some((record) => record?.noteId === noteId);
            }, queuedNoteId);
            assert.ok(hasOfflineNote, "offline note should persist locally before replay");

            const replayCredential = backendContext.tokenFactory(userId);
            await dispatchSignIn(pageReload, replayCredential, userId);
            await waitForSyncManagerUser(pageReload, userId);
            await waitForPendingOperations(pageReload);

            await pageReload.waitForSelector(`.markdown-block[data-note-id="${queuedNoteId}"]`);
            const renderedMarkdown = await pageReload.$eval(
                `.markdown-block[data-note-id="${queuedNoteId}"] .markdown-content`,
                (element) => element?.textContent?.trim() ?? ""
            );
            assert.ok(renderedMarkdown.includes("Queued while offline"), "rendered markdown should match queued content");

            const debugState = await extractSyncDebugState(pageReload);
            assert.ok(debugState?.backendToken?.accessToken, "backend token should exist after replay");

            const snapshot = await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: debugState.backendToken.accessToken,
                noteId: queuedNoteId
            });
            const noteEntry = Array.isArray(snapshot?.notes)
                ? snapshot.notes.find((entry) => entry?.payload?.noteId === queuedNoteId)
                : null;
            assert.ok(noteEntry, "backend snapshot should contain replayed note");
            assert.equal(noteEntry?.payload?.markdownText, queuedMarkdown);
        } finally {
            await pageReload.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
        }
    });

    test("propagates edits between concurrent sessions", { timeout: 60000 }, async () => {
        assert.ok(backendContext, "backend harness must be initialised");

        const browser = await connectSharedBrowser();
        const contextA = await browser.createBrowserContext();
        const contextB = await browser.createBrowserContext();
        const userId = `multi-session-user-${Date.now()}`;
        const credentialA = backendContext.tokenFactory(userId);
        const credentialB = backendContext.tokenFactory(userId);

        const pageA = await prepareFrontendPage(contextA, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: ""
        });
        const pageB = await prepareFrontendPage(contextB, PAGE_URL, {
            backendBaseUrl: backendContext.baseUrl,
            llmProxyUrl: ""
        });

        try {
            await dispatchSignIn(pageA, credentialA, userId);
            await waitForSyncManagerUser(pageA, userId);

            const noteId = `shared-note-${Date.now()}`;
            const initialTimestamp = new Date().toISOString();
            const initialMarkdown = "Shared session note";
            await dispatchNoteCreate(pageA, {
                record: {
                    noteId,
                    markdownText: initialMarkdown,
                    createdAtIso: initialTimestamp,
                    updatedAtIso: initialTimestamp,
                    lastActivityIso: initialTimestamp
                },
                storeUpdated: false,
                shouldRender: false
            });
            await waitForPendingOperations(pageA);

            const debugStateA = await extractSyncDebugState(pageA);
            assert.ok(debugStateA?.backendToken?.accessToken, "backend token should exist after initial creation");
            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: debugStateA.backendToken.accessToken,
                noteId
            });

            await dispatchSignIn(pageB, credentialB, userId);
            await waitForSyncManagerUser(pageB, userId);
            await waitForPendingOperations(pageB);
            await pageB.waitForSelector(`.markdown-block[data-note-id="${noteId}"]`);

            const baseRecord = await pageB.evaluate(async (id) => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/store.js");
                return module.GravityStore.getById(id);
            }, noteId);
            assert.ok(baseRecord, "base record must exist on second session");

            const updatedTimestamp = new Date(Date.now() + 1000).toISOString();
            const updatedMarkdown = "Shared session note (edited in session B)";
            await dispatchNoteUpdate(pageB, {
                noteId,
                record: {
                    ...baseRecord,
                    markdownText: updatedMarkdown,
                    updatedAtIso: updatedTimestamp,
                    lastActivityIso: updatedTimestamp
                },
                storeUpdated: false,
                shouldRender: false
            });
            await waitForPendingOperations(pageB);

            await pageA.evaluate(async () => {
                const root = document.querySelector("[x-data]");
                if (!root) {
                    throw new Error("application root not found");
                }
                const alpine = /** @type {{ $data?: (element: Element) => any }} */ (window.Alpine ?? null);
                if (!alpine || typeof alpine.$data !== "function") {
                    throw new Error("Alpine data accessor unavailable");
                }
                const component = alpine.$data(root);
                if (!component?.syncManager || typeof component.syncManager.synchronize !== "function") {
                    throw new Error("sync manager not initialised");
                }
                await component.syncManager.synchronize({ flushQueue: false });
            });

            await pageA.waitForFunction((id, expectedText) => {
                const card = document.querySelector(`.markdown-block[data-note-id="${id}"] .markdown-content`);
                return typeof card?.textContent === "string" && card.textContent.includes(expectedText);
            }, {}, noteId, "edited in session B");

            const updatedRecordA = await pageA.evaluate(async (id) => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/store.js");
                return module.GravityStore.getById(id);
            }, noteId);
            const updatedRecordB = await pageB.evaluate(async (id) => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/store.js");
                return module.GravityStore.getById(id);
            }, noteId);

            assert.ok(updatedRecordA, "updated record should exist on session A");
            assert.ok(updatedRecordB, "updated record should exist on session B");
            assert.equal(updatedRecordA.markdownText, updatedMarkdown);
            assert.equal(updatedRecordB.markdownText, updatedMarkdown);

            const debugStateB = await extractSyncDebugState(pageB);
            const backendToken = debugStateB?.backendToken?.accessToken ?? debugStateA?.backendToken?.accessToken ?? null;
            assert.ok(backendToken, "backend token should be available to confirm snapshot");
            const snapshot = await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                token: backendToken,
                noteId
            });
            const noteEntry = Array.isArray(snapshot?.notes)
                ? snapshot.notes.find((entry) => entry?.payload?.noteId === noteId)
                : null;
            assert.ok(noteEntry, "backend snapshot should include the updated note");
            assert.equal(noteEntry?.payload?.markdownText, updatedMarkdown);
        } finally {
            await pageA.close().catch(() => {});
            await pageB.close().catch(() => {});
            await contextA.close().catch(() => {});
            await contextB.close().catch(() => {});
            browser.disconnect();
        }
    });
});
