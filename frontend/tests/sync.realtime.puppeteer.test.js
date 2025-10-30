import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { startTestBackend } from "./helpers/backendHarness.js";
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

test.describe("Realtime synchronization", () => {
    test("note updates propagate across sessions", { timeout: 60000 }, async () => {
        const backend = await startTestBackend();
        const browser = await connectSharedBrowser();
        const contextA = await browser.createBrowserContext();
        const contextB = await browser.createBrowserContext();

        const userId = "realtime-user";
        const credential = backend.tokenFactory(userId);

        const pageA = await prepareFrontendPage(contextA, PAGE_URL, {
            backendBaseUrl: backend.baseUrl,
            llmProxyUrl: ""
        });
        const pageB = await prepareFrontendPage(contextB, PAGE_URL, {
            backendBaseUrl: backend.baseUrl,
            llmProxyUrl: ""
        });

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
            await pageB.evaluate(() => {
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

            await dispatchSignIn(pageA, credential, userId);
            await dispatchSignIn(pageB, credential, userId);
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
            const runtimeConfig = await pageB.evaluate(async () => {
                const importer = typeof window.importAppModule === "function"
                    ? window.importAppModule
                    : (specifier) => import(specifier);
                const module = await importer("./js/core/config.js");
                return module.appConfig.backendBaseUrl;
            });
            console.log("[Realtime][Debug] backend base URL:", runtimeConfig);
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

            await pageB.evaluate(async () => {
                const root = document.querySelector("[x-data]");
                const alpine = window.Alpine;
                if (!root || !alpine) {
                    return;
                }
                const appInstance = alpine.$data(root);
                if (!appInstance?.syncManager || typeof appInstance.syncManager.synchronize !== "function") {
                    return;
                }
                await appInstance.syncManager.synchronize({ flushQueue: false });
            });

            const debugStateA = await extractSyncDebugState(pageA);
            const backendToken = debugStateA?.backendToken?.accessToken ?? null;
            if (backendToken) {
                const snapshotResponse = await fetch(`${backend.baseUrl}/notes`, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${backendToken}`
                    }
                });
                const snapshotJson = await snapshotResponse.json();
                console.log("[Realtime][Debug] backend snapshot", snapshotJson);

                const controller = new AbortController();
                const abortTimer = setTimeout(() => {
                    controller.abort();
                }, 500);
                try {
                    const streamResponse = await fetch(`${backend.baseUrl}/notes/stream`, {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${backendToken}`
                        },
                        signal: controller.signal
                    });
                    console.log("[Realtime][Debug] stream response", streamResponse.status, streamResponse.headers.get("content-type"));
                } catch (error) {
                    console.log("[Realtime][Debug] stream fetch error", String(error));
                } finally {
                    clearTimeout(abortTimer);
                }
            } else {
                console.error("[Realtime][Debug] missing backend token", debugStateA);
            }

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

            const { receivedContent, pageDebug } = await pageB.evaluate(() => {
                const card = document.querySelector('.markdown-block:not(.top-editor)[data-note-id]');
                const content = card ? card.textContent ?? "" : "";
                const storedNotes = typeof GravityStore !== "undefined" ? GravityStore.loadAllNotes() : [];
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
