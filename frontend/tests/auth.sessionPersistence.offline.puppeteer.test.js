import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    composeTestCredential,
    dispatchSignIn,
    prepareFrontendPage,
    waitForAppReady,
    waitForSyncManagerUser
} from "./helpers/syncTestUtils.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";
import { GravityStore } from "../js/core/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const STUB_BACKEND_BASE_URL = "http://localhost:58080";

let puppeteerAvailable = true;
try {
    await import("puppeteer");
} catch {
    puppeteerAvailable = false;
}

if (!puppeteerAvailable) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    test.describe("Auth session persistence (offline)", () => {
        test("restores session when credential remains valid", async () => {
            const browser = await connectSharedBrowser();
            const context = await browser.createBrowserContext();
            /** @type {import('puppeteer').Page|null} */
            let page = null;
            const requestLog = [];
            try {
                page = await prepareFrontendPage(context, PAGE_URL, {
                    backendBaseUrl: STUB_BACKEND_BASE_URL,
                    beforeNavigate: async (targetPage) => {
                        await setupBackendStubs(targetPage, STUB_BACKEND_BASE_URL, requestLog);
                    }
                });
                await waitForAppReady(page);

                const userId = "offline-session-user";
                const credential = composeTestCredential({
                    userId,
                    email: "offline@example.com",
                    name: "Offline Session",
                    expiresInSeconds: 10 * 60
                });

                await dispatchSignIn(page, credential, userId);
                await waitForSyncManagerUser(page, userId);

                const activeKeyBefore = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.ok(typeof activeKeyBefore === "string" && activeKeyBefore.includes(encodeURIComponent(userId)));

                await page.reload({ waitUntil: "domcontentloaded" });
                await waitForAppReady(page);
                await waitForSyncManagerUser(page, userId);

                const activeKeyAfter = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.equal(activeKeyAfter, activeKeyBefore);

                const authStateStored = await page.evaluate(() => window.localStorage.getItem("gravityAuthState"));
                assert.ok(authStateStored, "auth state should remain persisted after reload");
                assert.ok(requestLog.filter((entry) => entry === "auth/google").length >= 1, "backend credential exchange should be invoked");
            } finally {
                if (page) {
                    await page.close().catch(() => {});
                }
                await context.close().catch(() => {});
                browser.disconnect();
            }
        });

        test("clears expired persisted credential before hydration", async () => {
            const browser = await connectSharedBrowser();
            const context = await browser.createBrowserContext();
            /** @type {import('puppeteer').Page|null} */
            let page = null;
            const requestLog = [];
            try {
                const expiredCredential = composeTestCredential({
                    userId: "expired-user",
                    email: "expired@example.com",
                    name: "Expired Session",
                    issuedAtSeconds: Math.floor(Date.now() / 1000) - 600,
                    expiresInSeconds: -120
                });
                page = await prepareFrontendPage(context, PAGE_URL, {
                    backendBaseUrl: STUB_BACKEND_BASE_URL,
                    beforeNavigate: async (targetPage) => {
                        await setupBackendStubs(targetPage, STUB_BACKEND_BASE_URL, requestLog);
                    }
                });

                const persistedState = JSON.stringify({
                    user: {
                        id: "expired-user",
                        email: "expired@example.com",
                        name: "Expired Session",
                        pictureUrl: null
                    },
                    credential: expiredCredential
                });

                await page.evaluate((state) => {
                    window.localStorage.setItem("gravityAuthState", state);
                }, persistedState);

                await page.reload({ waitUntil: "domcontentloaded" });
                await waitForAppReady(page);

                const activeKey = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.equal(activeKey, GravityStore.getActiveStorageKey());

                const authStateAfter = await page.evaluate(() => window.localStorage.getItem("gravityAuthState"));
                assert.equal(authStateAfter, null, "expired credential should be removed from storage");

                assert.deepEqual(requestLog, [], "backend should not receive requests for expired credential");
            } finally {
                if (page) {
                    await page.close().catch(() => {});
                }
                await context.close().catch(() => {});
                browser.disconnect();
            }
        });

        test("removes persisted session when credential subject mismatches stored user", async () => {
            const browser = await connectSharedBrowser();
            const context = await browser.createBrowserContext();
            /** @type {import('puppeteer').Page|null} */
            let page = null;
            const requestLog = [];
            try {
                const mismatchedCredential = composeTestCredential({
                    userId: "actual-user",
                    email: "actual@example.com",
                    name: "Actual User"
                });
                page = await prepareFrontendPage(context, PAGE_URL, {
                    backendBaseUrl: STUB_BACKEND_BASE_URL,
                    beforeNavigate: async (targetPage) => {
                        await setupBackendStubs(targetPage, STUB_BACKEND_BASE_URL, requestLog);
                    }
                });

                const persistedState = JSON.stringify({
                    user: {
                        id: "persisted-user",
                        email: "persisted@example.com",
                        name: "Persisted User",
                        pictureUrl: null
                    },
                    credential: mismatchedCredential
                });

                await page.evaluate((state) => {
                    window.localStorage.setItem("gravityAuthState", state);
                }, persistedState);

                await page.reload({ waitUntil: "domcontentloaded" });
                await waitForAppReady(page);

                const activeKey = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.equal(activeKey, GravityStore.getActiveStorageKey(), "storage scope should remain default");

                const persistedAfter = await page.evaluate(() => window.localStorage.getItem("gravityAuthState"));
                assert.equal(persistedAfter, null, "mismatched credential should be cleared");

                assert.deepEqual(requestLog, [], "backend should not receive requests for mismatched credential");
            } finally {
                if (page) {
                    await page.close().catch(() => {});
                }
                await context.close().catch(() => {});
                browser.disconnect();
            }
        });
    });
}

/**
 * @param {import('puppeteer').Page} page
 * @param {string} backendBaseUrl
 * @param {Array<string>} [requestLog]
 * @returns {Promise<void>}
 */
async function setupBackendStubs(page, backendBaseUrl, requestLog = []) {
    await page.exposeFunction("__gravityLogBackendRequest", (entry) => {
        requestLog.push(entry);
    });

    await page.evaluateOnNewDocument((baseUrl) => {
        const handlers = {
            "/auth/google": () => ({
                status: 200,
                body: {
                    access_token: "offline-access-token",
                    expires_in: 10 * 60
                }
            }),
            "/notes": () => ({
                status: 200,
                body: { notes: [] }
            }),
            "/notes/sync": () => ({
                status: 200,
                body: { results: [] }
            })
        };

        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init = {}) => {
            const targetUrl = typeof input === "string"
                ? input
                : typeof input?.url === "string"
                    ? input.url
                    : "";
            if (targetUrl && targetUrl.startsWith(baseUrl)) {
                try {
                    const parsed = new URL(targetUrl);
                    const handler = handlers[parsed.pathname];
                    if (handler) {
                        try {
                            if (typeof window.__gravityLogBackendRequest === "function") {
                                const entry = parsed.pathname.replace(/^\//u, "");
                                void window.__gravityLogBackendRequest(entry).catch(() => {});
                            }
                        } catch {
                            // ignore logging errors
                        }
                        const response = handler();
                        return new Response(JSON.stringify(response.body), {
                            status: response.status,
                            headers: { "Content-Type": "application/json" }
                        });
                    }
                } catch {
                    // fall through to original fetch
                }
            }
            return originalFetch(input, init);
        };
    }, backendBaseUrl);
}
