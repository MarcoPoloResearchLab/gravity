// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { startTestBackend } from "./helpers/backendHarness.js";
import {
    prepareFrontendPage,
    waitForSyncManagerUser,
    waitForPendingOperations,
    extractSyncDebugState,
    waitForTAuthSession,
    composeTestCredential,
    exchangeTAuthCredential,
    attachBackendSessionCookie
} from "./helpers/syncTestUtils.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";
import { installTAuthHarness } from "./helpers/tauthHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "app.html")}`;

test.describe("Realtime synchronization", () => {
    test("note updates propagate across sessions", { timeout: 60000 }, async () => {
        const backend = await startTestBackend();
        const browser = await connectSharedBrowser();
        const contextA = await browser.createBrowserContext();
        const contextB = await browser.createBrowserContext();

        const userId = "realtime-user";
        const instrumentRealtimeDebug = async (targetPage) => {
            await targetPage.evaluate(() => {
                const OriginalEventSource = window.EventSource;
                if (!OriginalEventSource) {
                    return;
                }
                const connectCalls = [];
                const realtimeEvents = [];

                function recordEvent(event, url) {
                    const entry = { type: event?.type ?? "message", url };
                    if (typeof event?.data === "string" && event.data.length > 0) {
                        try {
                            entry.data = JSON.parse(event.data);
                        } catch {
                            entry.data = event.data;
                        }
                    }
                    realtimeEvents.push(entry);
                }

                function InstrumentedEventSource(url, init) {
                    const instance = new OriginalEventSource(url, init);
                    connectCalls.push({
                        url,
                        withCredentials: Boolean(init?.withCredentials)
                    });
                    instance.addEventListener("open", (event) => {
                        realtimeEvents.push({ type: "open", url, readyState: instance.readyState ?? null });
                    });
                    instance.addEventListener("error", (event) => {
                        realtimeEvents.push({ type: "error", url, readyState: instance.readyState ?? null });
                    });
                    instance.addEventListener("note-change", (event) => recordEvent(event, url));
                    instance.addEventListener("heartbeat", (event) => recordEvent(event, url));
                    window.__GRAVITY_REALTIME_DEBUG__ = {
                        connects: connectCalls,
                        events: realtimeEvents
                    };
                    return instance;
                }

                InstrumentedEventSource.prototype = OriginalEventSource.prototype;
                Object.setPrototypeOf(InstrumentedEventSource, OriginalEventSource);
                window.EventSource = InstrumentedEventSource;
                window.__GRAVITY_REALTIME_DEBUG__ = {
                    connects: connectCalls,
                    events: realtimeEvents
                };
            });
        };

        const sessionA = await bootstrapRealtimeSession(contextA, backend, userId);
        const sessionB = await bootstrapRealtimeSession(contextB, backend, userId, {
            beforeAuth: instrumentRealtimeDebug
        });
        const { page: pageA } = sessionA;
        const { page: pageB } = sessionB;

        pageA.on("console", (message) => {
            if (message.type() === "error") {
                console.error("[Realtime][A]", message.text());
            }
        });
        pageB.on("console", (message) => {
            const args = message.args().map((arg) => {
                try {
                    return arg.jsonValue();
                } catch {
                    return null;
                }
            });
            Promise.all(args).then((resolved) => {
                console.log("[Realtime][B]", message.type(), message.text(), resolved);
            }).catch(() => {
                console.log("[Realtime][B]", message.type(), message.text());
            });
        });

        try {
            await waitForSyncManagerUser(pageA, userId);
            await waitForSyncManagerUser(pageB, userId);

            const realtimeState = await pageB.evaluate(() => {
                const root = document.querySelector("[x-data]");
                const alpine = typeof window !== "undefined" ? window.Alpine : null;
                let component = null;
                if (root && alpine && typeof alpine.$data === "function") {
                    component = alpine.$data(root);
                }
                const realtime = component?.realtimeSync ?? null;
                return {
                    hasRealtime: Boolean(realtime),
                    hasConnect: realtime ? typeof realtime.connect === "function" : false,
                    hasDisconnect: realtime ? typeof realtime.disconnect === "function" : false
                };
            });
            console.log("[Realtime][Debug] state:", realtimeState);
            const debugState = await extractSyncDebugState(pageB);
            console.log("[Realtime][Debug] sync state:", debugState);
            await pageB.waitForFunction(() => {
                const debug = window.__GRAVITY_REALTIME_DEBUG__;
                return Array.isArray(debug?.connects) && debug.connects.length >= 1;
            }, { timeout: 10000 });

            const connectCalls = await pageB.evaluate(() => window.__GRAVITY_REALTIME_DEBUG__?.connects ?? []);
            console.log("[Realtime][Debug] connect calls:", connectCalls);
            const realtimeEvents = await pageB.evaluate(() => window.__GRAVITY_REALTIME_DEBUG__?.events ?? []);
            console.log("[Realtime][Debug] events captured:", realtimeEvents);

            const editorSelector = "#top-editor .markdown-editor";
            const noteContent = "Realtime propagated note";
            await pageA.focus(editorSelector);
            await pageA.type(editorSelector, noteContent);
            await pageA.keyboard.down("Control");
            await pageA.keyboard.press("Enter");
            await pageA.keyboard.up("Control");
           await pageA.keyboard.down("Meta");
           await pageA.keyboard.press("Enter");
           await pageA.keyboard.up("Meta");
           await waitForPendingOperations(pageA);

            await synchronizeOnce(pageB, false);

            await pageB.evaluate(() => {
                console.error("[Realtime][Debug] events after create", window.__GRAVITY_REALTIME_DEBUG__?.events ?? []);
                const entries = [];
                for (let index = 0; index < localStorage.length; index += 1) {
                    const key = localStorage.key(index);
                    if (!key) continue;
                    entries.push([key, localStorage.getItem(key)]);
                }
                console.error("[Realtime][Debug] localStorage entries", entries);
            });

            let waitError = null;
            try {
                await pageB.waitForFunction((expected) => {
                    const cards = Array.from(document.querySelectorAll('.markdown-block:not(.top-editor)[data-note-id]'));
                    return cards.some((card) => card.textContent && card.textContent.includes(expected));
                }, { timeout: 20000 }, noteContent);
            } catch (error) {
                waitError = error;
            }

            const { receivedContent, pageDebug } = await pageB.evaluate(async () => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const storeModule = await importer("./js/core/store.js");
                const GravityStore = storeModule.GravityStore;
                const card = document.querySelector('.markdown-block:not(.top-editor)[data-note-id]');
                const content = card ? card.textContent ?? "" : "";
                const storedNotes = GravityStore.loadAllNotes();
                const events = Array.isArray(window.__GRAVITY_REALTIME_DEBUG__?.events) ? window.__GRAVITY_REALTIME_DEBUG__?.events ?? [] : [];
                return { receivedContent: content, pageDebug: { storedNotes, events } };
            });
            console.log("[Realtime][Debug] page B state", JSON.stringify(pageDebug));

            if (waitError) {
                throw new Error(`realtime propagation failed: ${waitError.message}; state=${JSON.stringify(pageDebug)}`);
            }

            assert.ok(receivedContent.includes(noteContent), "expected remote note content on secondary session");
        } finally {
            await pageA.close().catch(() => {});
            await pageB.close().catch(() => {});
            await contextA.close().catch(() => {});
            await contextB.close().catch(() => {});
            browser.disconnect();
            await backend.close().catch(() => {});
        }
    });
});

async function bootstrapRealtimeSession(context, backend, userId, options = {}) {
    const beforeAuth = typeof options?.beforeAuth === "function" ? options.beforeAuth : null;
    let harnessHandle = null;
    const tauthScriptUrl = new URL("/tauth.js", backend.baseUrl).toString();
    const page = await prepareFrontendPage(context, PAGE_URL, {
        backendBaseUrl: backend.baseUrl,
        llmProxyUrl: "",
        authBaseUrl: backend.baseUrl,
        tauthScriptUrl,
        beforeNavigate: async (targetPage) => {
            // Install TAuth harness FIRST so it has priority over session cookie interceptor.
            harnessHandle = await installTAuthHarness(targetPage, {
                baseUrl: backend.baseUrl,
                cookieName: backend.cookieName,
                mintSessionToken: backend.createSessionToken
            });
            // Attach session cookie to prevent redirect to landing page.
            await attachBackendSessionCookie(targetPage, backend, userId);
        }
    });
    if (beforeAuth) {
        await beforeAuth(page);
    }
    await waitForTAuthSession(page);
    const credential = composeTestCredential({
        userId,
        email: `${userId}@example.com`,
        name: `Realtime User ${userId}`,
        pictureUrl: "https://example.com/avatar.png"
    });
    await exchangeTAuthCredential(page, credential);
    if (harnessHandle) {
        await waitForHarnessRequest(harnessHandle, "/auth/google", 5000);
    }
    // Note: We don't wait for authenticatedCount because mpr-ui's callback
    // may not fire when using dynamic userId. waitForSyncManagerUser verifies
    // the authentication completed by checking the sync manager state.
    await waitForSyncManagerUser(page, userId, 5000);
    return { page, harnessHandle };
}

async function synchronizeOnce(page, flushQueue) {
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
        await component.syncManager.synchronize({ flushQueue: shouldFlush === true });
    }, flushQueue);
}

async function waitForHarnessRequest(harnessHandle, expectedPath, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const paths = harnessHandle.getRequestLog().map((entry) => entry.path);
        if (paths.includes(expectedPath)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const log = harnessHandle.getRequestLog();
    throw new Error(`TAuth harness did not observe ${expectedPath} within ${timeoutMs}ms (seen: ${JSON.stringify(log)})`);
}
