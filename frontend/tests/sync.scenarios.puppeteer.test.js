import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_AUTH_CREDENTIAL_RECEIVED } from "../js/constants.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import { connectSharedBrowser, registerRequestInterceptor } from "./helpers/browserHarness.js";
import {
    composeTestCredential,
    prepareFrontendPage,
    waitForSyncManagerUser,
    waitForPendingOperations,
    waitForTAuthSession,
    dispatchNoteCreate,
    dispatchNoteUpdate
} from "./helpers/syncTestUtils.js";
import { installTAuthHarness } from "./helpers/tauthHarness.js";

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
        const { page } = await bootstrapSession(context, backendContext, userId);
        const syncInterceptor = await interceptSyncRequests(page, { mode: "fail-once" });

        try {
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
            assert.equal(syncInterceptor.getAttempts(), 1, "initial sync attempt should fail exactly once");

            await forceSync(page, true);
            await waitForPendingOperations(page);
            assert.ok(syncInterceptor.getAttempts() >= 2, "sync queue should retry after connectivity returns");

            const snapshot = await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                sessionToken: backendContext.createSessionToken(userId),
                cookieName: backendContext.cookieName,
                noteId
            });
            const noteEntry = Array.isArray(snapshot?.notes)
                ? snapshot.notes.find((entry) => entry?.payload?.noteId === noteId)
                : null;
            assert.ok(noteEntry, "backend snapshot should contain the queued note");
            assert.equal(noteEntry?.payload?.markdownText, noteMarkdown);
        } finally {
            await syncInterceptor.clear();
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
        const { page } = await bootstrapSession(context, backendContext, userId);
        const offlineInterceptor = await interceptSyncRequests(page, { mode: "always-fail" });

        const createdAtIso = new Date().toISOString();
        const queuedNoteId = `queued-note-${Date.now()}`;
        const queuedMarkdown = "Queued while offline";

        try {
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

        await offlineInterceptor.clear();

        const { page: pageReload } = await bootstrapSession(context, backendContext, userId, {
            preserveLocalStorage: true,
            autoSignIn: false
        });
        try {
            const hasOfflineNote = await pageReload.evaluate(async (noteId, scopedUserId) => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/store.js");
                if (typeof module.GravityStore?.setUserScope === "function") {
                    module.GravityStore.setUserScope(scopedUserId);
                }
                const records = module.GravityStore.loadAllNotes();
                return Array.isArray(records) && records.some((record) => record?.noteId === noteId);
            }, queuedNoteId, userId);
            assert.ok(hasOfflineNote, "offline note should persist locally before replay");

            await signInViaTAuth(pageReload, userId);
            await waitForPendingOperations(pageReload);

            await pageReload.waitForSelector(`.markdown-block[data-note-id="${queuedNoteId}"]`);
            const renderedMarkdown = await pageReload.$eval(
                `.markdown-block[data-note-id="${queuedNoteId}"] .markdown-content`,
                (element) => element?.textContent?.trim() ?? ""
            );
            assert.ok(renderedMarkdown.includes("Queued while offline"), "rendered markdown should match queued content");

            const snapshot = await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                sessionToken: backendContext.createSessionToken(userId),
                cookieName: backendContext.cookieName,
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
        const { page: pageA } = await bootstrapSession(contextA, backendContext, userId);
        const { page: pageB } = await bootstrapSession(contextB, backendContext, userId);

        try {
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

            await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                sessionToken: backendContext.createSessionToken(userId),
                cookieName: backendContext.cookieName,
                noteId
            });

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

            const snapshot = await waitForBackendNote({
                backendUrl: backendContext.baseUrl,
                sessionToken: backendContext.createSessionToken(userId),
                cookieName: backendContext.cookieName,
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

async function bootstrapSession(context, backend, userId, options = {}) {
    const {
        preserveLocalStorage = false,
        autoSignIn = true,
        beforeNavigate
    } = options;
    let harnessHandle = null;
    const page = await prepareFrontendPage(context, PAGE_URL, {
        backendBaseUrl: backend.baseUrl,
        llmProxyUrl: "",
        authBaseUrl: backend.baseUrl,
        preserveLocalStorage,
        beforeNavigate: async (targetPage) => {
            harnessHandle = await installTAuthHarness(targetPage, {
                baseUrl: backend.baseUrl,
                cookieName: backend.cookieName,
                mintSessionToken: backend.createSessionToken
            });
            if (typeof beforeNavigate === "function") {
                await beforeNavigate(targetPage);
            }
        }
    });
    await waitForTAuthSession(page);
    if (autoSignIn) {
        await signInViaTAuth(page, userId);
    }
    return { page, harnessHandle };
}

async function signInViaTAuth(page, userId) {
    const credential = composeTestCredential({
        userId,
        email: `${userId}@example.com`,
        name: `Gravity User ${userId}`,
        pictureUrl: "https://example.com/avatar.png"
    });
    await page.evaluate((eventName, detail) => {
        const target = document.querySelector("body");
        if (!target) {
            throw new Error("Application root missing");
        }
        target.dispatchEvent(new CustomEvent(eventName, {
            bubbles: true,
            detail
        }));
    }, EVENT_AUTH_CREDENTIAL_RECEIVED, {
        credential,
        user: {
            id: userId,
            email: `${userId}@example.com`,
            name: `Gravity User ${userId}`,
            pictureUrl: "https://example.com/avatar.png"
        }
    });
    await page.waitForFunction(() => {
        return Boolean(window.__tauthHarnessEvents && window.__tauthHarnessEvents.authenticatedCount >= 1);
    }, { timeout: 10000 });
    await waitForSyncManagerUser(page, userId);
}

async function interceptSyncRequests(page, { mode }) {
    let attempts = 0;
    await registerRequestInterceptor(page, (request) => {
        const url = request.url();
        if (!url.includes("/notes/sync")) {
            return false;
        }
        const method = request.method().toUpperCase();
        if (method !== "POST") {
            request.continue().catch(() => {});
            return true;
        }
        attempts += 1;
        if (mode === "fail-once" && attempts === 1) {
            request.abort("failed").catch(() => {});
            return true;
        }
        if (mode === "always-fail") {
            request.abort("failed").catch(() => {});
            return true;
        }
        request.continue().catch(() => {});
        return true;
    });
    return {
        getAttempts: () => attempts,
        clear: async () => {}
    };
}

async function forceSync(page, flushQueue) {
    await page.evaluate(async (shouldFlush) => {
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
        await component.syncManager.synchronize({
            flushQueue: shouldFlush === true
        });
    }, flushQueue);
}
