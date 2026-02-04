// @ts-check

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    composeTestCredential,
    dispatchNoteCreate,
    dispatchNoteUpdate,
    prepareFrontendPage,
    waitForPendingOperations,
    waitForSyncManagerUser,
    waitForTAuthSession,
    exchangeTAuthCredential,
    attachBackendSessionCookie
} from "./syncTestUtils.js";
import { installTAuthHarness } from "./tauthHarness.js";
import { connectSharedBrowser, registerRequestInterceptor } from "./browserHarness.js";
import { startTestBackend, waitForBackendNote } from "./backendHarness.js";

const HELPERS_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HELPERS_ROOT, "..", "..");
const DEFAULT_PAGE_URL = `file://${path.join(PROJECT_ROOT, "app.html")}`;

/**
 * @typedef {{ page: import("puppeteer").Page, context: import("puppeteer").BrowserContext, userId: string, signIn: () => Promise<void>, close: () => Promise<void> }} SyncScenarioSession
 */

/**
 * @typedef {{ note_id: string, snapshot_b64?: string, snapshot_update_id?: number, payload: import("../../js/types.d.js").NoteRecord|null }} BackendNoteEntry
 */

/**
 * Create a harness for synchronization scenario tests.
 * @param {{ pageUrl?: string }} [options]
 * @returns {Promise<{
 *   backend: Awaited<ReturnType<typeof startTestBackend>>,
 *   createSession(options?: { userId?: string, preserveLocalStorage?: boolean, autoSignIn?: boolean, beforeNavigate?: (page: import("puppeteer").Page) => Promise<void>|void }): Promise<SyncScenarioSession>,
 *   createNoteDraft(overrides?: Partial<import("../../js/types.d.js").NoteRecord>): import("../../js/types.d.js").NoteRecord,
 *   createUpdatedRecord(base: import("../../js/types.d.js").NoteRecord, overrides?: Partial<import("../../js/types.d.js").NoteRecord>): import("../../js/types.d.js").NoteRecord,
 *   recordLocalCreate(page: import("puppeteer").Page, record: import("../../js/types.d.js").NoteRecord, detailOverrides?: Partial<Parameters<typeof dispatchNoteCreate>[1]>): Promise<void>,
 *   recordLocalUpdate(page: import("puppeteer").Page, noteId: string, record: import("../../js/types.d.js").NoteRecord, detailOverrides?: Partial<Parameters<typeof dispatchNoteUpdate>[1]>): Promise<void>,
 *   waitForQueueLength(page: import("puppeteer").Page, expectedLength: number, timeoutMs?: number): Promise<void>,
 *   waitForRenderedMarkdown(page: import("puppeteer").Page, noteId: string, expectedSnippet: string, timeoutMs?: number): Promise<void>,
 *   synchronize(page: import("puppeteer").Page, options?: { flushQueue?: boolean }): Promise<void>,
 *   waitForPendingOperations(page: import("puppeteer").Page): Promise<void>,
 *   waitForBackendNote(userId: string, noteId: string, timeoutMs?: number): Promise<BackendNoteEntry>,
 *   hasLocalNote(page: import("puppeteer").Page, noteId: string, userId?: string): Promise<boolean>,
 *   getStoreRecord(page: import("puppeteer").Page, noteId: string, userId?: string): Promise<import("../../js/types.d.js").NoteRecord|null>,
 *   createSyncInterceptor(page: import("puppeteer").Page, options: { mode: "fail-once"|"always-fail" }): Promise<{ getAttempts(): number, dispose(): Promise<void> }>,
 *   createUserId(prefix?: string): string,
 *   createNoteId(prefix?: string): string,
 *   createBrowserContext(): Promise<import("puppeteer").BrowserContext>,
 *   dispose(): Promise<void>
 * }>}
 */
export async function createSyncScenarioHarness(options = {}) {
    const pageUrl = options.pageUrl ?? DEFAULT_PAGE_URL;
    const backend = await startTestBackend();
    const browser = await connectSharedBrowser();
    const sessions = new Set();
    const timestampBase = Date.now();
    let timestampCounter = 0;
    const createUserId = createIdFactory("sync-user");
    const createNoteId = createIdFactory("sync-note");

    async function createSession(sessionOptions = {}) {
        const userId = sessionOptions.userId ?? createUserId();
        const context = sessionOptions.context ?? await browser.createBrowserContext();
        const ownsContext = !sessionOptions.context;
        let harnessHandle = null;
        const tauthScriptUrl = new URL("/tauth.js", backend.baseUrl).toString();
        const page = await prepareFrontendPage(context, pageUrl, {
            backendBaseUrl: backend.baseUrl,
            llmProxyUrl: "",
            authBaseUrl: backend.baseUrl,
            tauthScriptUrl,
            preserveLocalStorage: sessionOptions.preserveLocalStorage === true,
            beforeNavigate: async (targetPage) => {
                // Install TAuth harness FIRST so it has priority over session cookie interceptor.
                harnessHandle = await installTAuthHarness(targetPage, {
                    baseUrl: backend.baseUrl,
                    cookieName: backend.cookieName,
                    mintSessionToken: backend.createSessionToken
                });
                // Attach session cookie to prevent redirect to landing page.
                await attachBackendSessionCookie(targetPage, backend, userId);
                if (typeof sessionOptions.beforeNavigate === "function") {
                    await sessionOptions.beforeNavigate(targetPage);
                }
            }
        });
        if (process.env.DEBUG_SYNC_SCENARIOS === "1") {
            await page.evaluate(() => {
                globalThis.__debugSyncScenarios = true;
            });
        }
        await waitForTAuthSession(page);

        const sessionHandle = {
            userId,
            page,
            context,
            async signIn() {
                await signInViaTAuth(page, userId);
            },
            async close(closeOptions = {}) {
                if (sessions.has(sessionHandle)) {
                    sessions.delete(sessionHandle);
                }
                try {
                    harnessHandle?.dispose?.();
                } catch {
                    // ignore harness disposal failures
                }
                await page.close().catch(() => {});
                if (ownsContext && closeOptions.keepContext !== true) {
                    await context.close().catch(() => {});
                }
            }
        };

        if (sessionOptions.autoSignIn !== false) {
            await sessionHandle.signIn();
        }

        sessions.add(sessionHandle);
        return sessionHandle;
    }

    function createNoteDraft(overrides = {}) {
        const createdAtIso = overrides.createdAtIso ?? nextTimestamp();
        return {
            noteId: overrides.noteId ?? createNoteId(),
            markdownText: overrides.markdownText ?? "Scenario note",
            createdAtIso,
            updatedAtIso: overrides.updatedAtIso ?? createdAtIso,
            lastActivityIso: overrides.lastActivityIso ?? createdAtIso,
            ...overrides
        };
    }

    function createUpdatedRecord(baseRecord, overrides = {}) {
        const updatedAtIso = overrides.updatedAtIso ?? nextTimestamp();
        const lastActivityIso = overrides.lastActivityIso ?? updatedAtIso;
        return {
            ...cloneRecord(baseRecord),
            ...overrides,
            updatedAtIso,
            lastActivityIso
        };
    }

    async function recordLocalCreate(page, record, detailOverrides = {}) {
        await dispatchNoteCreate(page, {
            record,
            storeUpdated: false,
            shouldRender: false,
            ...detailOverrides
        });
    }

    async function recordLocalUpdate(page, noteId, record, detailOverrides = {}) {
        await dispatchNoteUpdate(page, {
            noteId,
            record,
            storeUpdated: false,
            shouldRender: false,
            ...detailOverrides
        });
    }

    async function waitForQueueLength(page, expectedLength, timeoutMs = 5000) {
        await page.waitForFunction((length) => {
            const root = document.querySelector("[x-data]");
            if (!root) {
                return false;
            }
            const alpine = window.Alpine;
            if (!alpine || typeof alpine.$data !== "function") {
                return false;
            }
            const component = alpine.$data(root);
            const syncManager = component?.syncManager;
            if (!syncManager || typeof syncManager.getDebugState !== "function") {
                return false;
            }
            const debugState = syncManager.getDebugState();
            return Array.isArray(debugState?.pendingOperations) && debugState.pendingOperations.length === length;
        }, { timeout: timeoutMs }, expectedLength);
    }

    async function waitForRenderedMarkdown(page, noteId, expectedSnippet, timeoutMs = 5000) {
        await page.waitForFunction((id, snippet) => {
            const card = document.querySelector(`.markdown-block[data-note-id="${id}"] .markdown-content`);
            return typeof card?.textContent === "string" && card.textContent.includes(snippet);
        }, { timeout: timeoutMs }, noteId, expectedSnippet);
    }

    async function synchronize(page, options = {}) {
        const shouldFlush = options.flushQueue !== false;
        await page.evaluate(async (flushQueue) => {
            const root = document.querySelector("[x-data]");
            if (!root) {
                throw new Error("application root not found");
            }
            const alpine = window.Alpine;
            if (!alpine || typeof alpine.$data !== "function") {
                throw new Error("Alpine data accessor unavailable");
            }
            const component = alpine.$data(root);
            if (!component?.syncManager || typeof component.syncManager.synchronize !== "function") {
                throw new Error("sync manager not initialised");
            }
            await component.syncManager.synchronize({ flushQueue });
        }, shouldFlush);
    }

    async function waitForBackendEntry(userId, noteId, timeoutMs) {
        const noteEntry = await waitForBackendNote({
            backendUrl: backend.baseUrl,
            sessionToken: backend.createSessionToken(userId),
            cookieName: backend.cookieName,
            noteId,
            timeoutMs
        });
        if (!noteEntry) {
            throw new Error(`Backend entry for ${noteId} not found`);
        }
        return noteEntry;
    }

    async function hasLocalNote(page, noteId, userId) {
        const record = await getStoreRecord(page, noteId, userId);
        return Boolean(record);
    }

    async function getStoreRecord(page, noteId, userId) {
        return page.evaluate(async (id, scopedUserId) => {
            const importer = typeof window.importAppModule === "function"
                ? window.importAppModule
                : (specifier) => import(specifier);
            const { STORAGE_KEY, STORAGE_KEY_USER_PREFIX } = await importer("./js/core/config.js?build=2026-01-01T22:43:21Z");
            const baseKey = STORAGE_KEY;
            const configuredPrefix = typeof STORAGE_KEY_USER_PREFIX === "string"
                ? STORAGE_KEY_USER_PREFIX.trim()
                : "";
            const prefixBase = configuredPrefix.length > 0 ? configuredPrefix : `${baseKey}:user`;
            const userPrefix = prefixBase.endsWith(":") ? prefixBase : `${prefixBase}:`;
            const resolveKey = (userIdCandidate) => {
                if (typeof userIdCandidate === "string" && userIdCandidate.trim().length > 0) {
                    return `${userPrefix}${encodeURIComponent(userIdCandidate.trim())}`;
                }
                return baseKey;
            };
            const parseRecords = (storageKey) => {
                try {
                    const raw = window.localStorage.getItem(storageKey);
                    if (!raw) {
                        return [];
                    }
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed : [];
                } catch {
                    return [];
                }
            };

            const candidateKeys = [];
            if (typeof scopedUserId === "string" && scopedUserId.trim().length > 0) {
                candidateKeys.push(resolveKey(scopedUserId));
            }
            candidateKeys.push(baseKey);

            for (const storageKey of candidateKeys) {
                const records = parseRecords(storageKey);
                if (!Array.isArray(records)) {
                    continue;
                }
                const match = records.find((record) => record && record.noteId === id);
                if (match) {
                    return match;
                }
            }
            return null;
        }, noteId, userId ?? null);
    }

    async function createSyncInterceptor(page, { mode }) {
        let attempts = 0;
        let disposed = false;
        const detach = await registerRequestInterceptor(page, (request) => {
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
        const dispose = async () => {
            if (disposed) {
                return;
            }
            disposed = true;
            detach();
        };
        page.once("close", dispose);
        return {
            getAttempts: () => attempts,
            dispose
        };
    }

    function nextTimestamp() {
        timestampCounter += 1;
        return new Date(timestampBase + timestampCounter * 1000).toISOString();
    }

    return {
        backend,
        createSession,
        createNoteDraft,
        createUpdatedRecord,
        recordLocalCreate,
        recordLocalUpdate,
        waitForQueueLength,
        waitForRenderedMarkdown,
        synchronize,
        waitForPendingOperations,
        waitForBackendNote: waitForBackendEntry,
        hasLocalNote,
        getStoreRecord,
        createSyncInterceptor,
        createUserId,
        createNoteId,
        createBrowserContext: () => browser.createBrowserContext(),
        async dispose() {
            const active = Array.from(sessions);
            sessions.clear();
            await Promise.allSettled(active.map((session) => session.close()));
            await backend.close().catch(() => {});
            browser.disconnect();
        }
    };
}

async function signInViaTAuth(page, userId) {
    const credential = composeTestCredential({
        userId,
        email: `${userId}@example.com`,
        name: `Gravity User ${userId}`,
        pictureUrl: "https://example.com/avatar.png"
    });
    await exchangeTAuthCredential(page, credential);
    // Note: We don't wait for authenticatedCount because mpr-ui's callback
    // may not fire when using dynamic userId. waitForSyncManagerUser verifies
    // the authentication completed by checking the sync manager state.
    await waitForSyncManagerUser(page, userId, 5000);
}

function createIdFactory(defaultPrefix) {
    let counter = 0;
    return (prefix = defaultPrefix) => {
        counter += 1;
        return `${prefix}-${Date.now()}-${counter}`;
    };
}

function cloneRecord(record) {
    return JSON.parse(JSON.stringify(record));
}
