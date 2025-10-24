import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    extractSyncDebugState,
    dispatchNoteCreate
} from "./helpers/syncTestUtils.js";
import {
    startTestBackend,
    waitForBackendNote
} from "./helpers/backendHarness.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PAGE_URL = `file://${path.join(REPO_ROOT, "index.html")}`;

const TEST_USER_ID = "integration-sync-user";
const GLOBAL_TIMEOUT_MS = 30000;
const BACKEND_SYNC_TEST_TIMEOUT_MS = GLOBAL_TIMEOUT_MS;
const PUPPETEER_WAIT_TIMEOUT_MS = Math.max(4000, Math.min(15000, Math.floor(GLOBAL_TIMEOUT_MS / 2)));

test.describe("Backend sync integration", () => {
    /** @type {{ close: () => Promise<void>, baseUrl: string, tokenFactory: (userId: string) => string }|null} */
    let backendContext = null;

    test.before(async () => {
        backendContext = await startTestBackend({
            logLevel: "info"
        });
    });

    test.after(async () => {
        await backendContext?.close();
    });

    test("flushes notes to the backend over HTTP", async (t) => {
        assert.ok(backendContext, "backend must be initialised");

        const deadline = createTestDeadline(t, BACKEND_SYNC_TEST_TIMEOUT_MS);
        const deadlineSignal = deadline.signal;
        let page = null;
        let context = null;
        let browserConnection = null;

        const abortHandler = () => {
            if (page) {
                page.close().catch(() => {});
            }
            if (context) {
                context.close().catch(() => {});
            }
            if (browserConnection) {
                browserConnection.disconnect();
            }
        };
        deadlineSignal.addEventListener("abort", abortHandler, { once: true });

        const backendUrl = backendContext.baseUrl;
        browserConnection = await connectSharedBrowser();
        context = await browserConnection.createBrowserContext();
        page = await raceWithSignal(deadlineSignal, prepareFrontendPage(context, PAGE_URL, {
            backendBaseUrl: backendUrl,
            llmProxyUrl: backendUrl
        }));
        page.on("console", (message) => {
            if (message.type() === "error") {
                console.error(message.text());
            }
        });
        try {
                const credential = backendContext.tokenFactory(TEST_USER_ID);
                await raceWithSignal(deadlineSignal, dispatchSignIn(page, credential, TEST_USER_ID));
                await page.evaluate(async ({ userId, token }) => {
                    const root = document.querySelector("[x-data]");
                    if (!root) {
                        throw new Error("root component not found");
                    }
                    const alpineComponent = (() => {
                        const legacy = /** @type {{ $data?: Record<string, any> }} */ (/** @type {any} */ (root).__x ?? null);
                        if (legacy && typeof legacy.$data === "object") {
                            return legacy.$data;
                        }
                        const alpine = typeof window !== "undefined" ? /** @type {{ $data?: (el: Element) => any }} */ (window.Alpine ?? null) : null;
                        if (alpine && typeof alpine.$data === "function") {
                            const scoped = alpine.$data(root);
                            if (scoped && typeof scoped === "object") {
                                return scoped;
                            }
                        }
                        const stack = /** @type {Array<Record<string, any>>|undefined} */ (/** @type {any} */ (root)._x_dataStack);
                        if (Array.isArray(stack) && stack.length > 0) {
                            const candidate = stack[stack.length - 1];
                            if (candidate && typeof candidate === "object") {
                                return candidate;
                            }
                        }
                        return null;
                    })();
                    const syncManager = alpineComponent?.syncManager;
                    if (!syncManager || typeof syncManager.handleSignIn !== "function") {
                        throw new Error("sync manager not ready");
                    }
                    await syncManager.handleSignIn({ userId, credential: token });
                }, { userId: TEST_USER_ID, token: credential });
                const debugStateBeforeWait = await extractSyncDebugState(page);
                try {
                    await raceWithSignal(
                        deadlineSignal,
                        waitForSyncManagerUser(page, TEST_USER_ID)
                    );
                } catch (error) {
                    const diagnostics = await page.evaluate(() => {
                        const root = document.querySelector("[x-data]");
                        const alpine = root ? /** @type {{ $data?: Record<string, unknown> }} */ (root.__x ?? null) : null;
                        const dataKeys = alpine && typeof alpine.$data === "object"
                            ? Object.keys(alpine.$data)
                            : null;
                        return {
                            hasRoot: Boolean(root),
                            hasAlpine: Boolean(alpine),
                            dataKeys,
                            htmlSnippet: root ? root.outerHTML.slice(0, 200) : null
                        };
                    });
                    console.error("sync manager user wait failed", diagnostics);
                    throw error;
                }
                const noteId = "backend-sync-note";
                const timestampIso = new Date().toISOString();
                await raceWithSignal(deadlineSignal, dispatchNoteCreate(page, {
                    record: {
                        noteId,
                        markdownText: "Integration test note",
                        createdAtIso: timestampIso,
                        updatedAtIso: timestampIso,
                        lastActivityIso: timestampIso
                    },
                    storeUpdated: false,
                    shouldRender: false
                }));
                const debugState = await raceWithSignal(deadlineSignal, extractSyncDebugState(page));
                assert.ok(debugState, "sync manager debug state available");
                assert.ok(debugState.backendToken && debugState.backendToken.accessToken, "backend token captured");

                const backendNotes = await raceWithSignal(
                    deadlineSignal,
                    waitForBackendNote({
                        backendUrl,
                        token: debugState.backendToken.accessToken,
                        noteId,
                        timeoutMs: PUPPETEER_WAIT_TIMEOUT_MS
                    })
                );
                assert.ok(backendNotes, "backend returned payload with notes");
        } finally {
            deadlineSignal.removeEventListener("abort", abortHandler);
            deadline.cancel();
            if (page) {
                await page.close().catch(() => {});
            }
            if (context) {
                await context.close().catch(() => {});
            }
            if (browserConnection) {
                browserConnection.disconnect();
            }
        }
    });
});

function createTestDeadline(testContext, timeoutMs) {
    const controller = new AbortController();
    const handleAbort = () => {
        if (!controller.signal.aborted) {
            controller.abort(new Error("Test aborted"));
        }
    };
    testContext.signal.addEventListener("abort", handleAbort, { once: true });
    const timer = setTimeout(() => {
        if (!controller.signal.aborted) {
            controller.abort(new Error(`Test exceeded ${timeoutMs}ms deadline`));
        }
    }, timeoutMs);
    return {
        signal: controller.signal,
        cancel() {
            clearTimeout(timer);
            testContext.signal.removeEventListener?.("abort", handleAbort);
        }
    };
}

function raceWithSignal(signal, candidate) {
    if (!signal) {
        return Promise.resolve(candidate);
    }
    if (signal.aborted) {
        const reason = signal.reason instanceof Error
            ? signal.reason
            : new Error(String(signal.reason ?? "Aborted"));
        return Promise.reject(reason);
    }
    const promise = Promise.resolve(candidate);
    return new Promise((resolve, reject) => {
        const handleAbort = () => {
            cleanup();
            const reason = signal.reason instanceof Error
                ? signal.reason
                : new Error(String(signal.reason ?? "Aborted"));
            reject(reason);
        };
        const cleanup = () => {
            signal.removeEventListener?.("abort", handleAbort);
        };
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            }
        );
        signal.addEventListener("abort", handleAbort, { once: true });
    });
}
