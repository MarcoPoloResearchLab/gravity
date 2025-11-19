import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    initializePuppeteerTest,
    waitForSyncManagerUser,
    waitForPendingOperations,
    dispatchNoteCreate,
    extractSyncDebugState,
    composeTestCredential,
    waitForAppReady,
    waitForTAuthSession,
    waitForSyncManagerReady
} from "./helpers/syncTestUtils.js";
import { waitForBackendNote } from "./helpers/backendHarness.js";
import { installTAuthHarness } from "./helpers/tauthHarness.js";
import { EVENT_AUTH_CREDENTIAL_RECEIVED } from "../js/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const TAUTH_BASE_URL = "http://localhost:58081";

test("TAuth sign-in exchanges nonce and syncs backend notes", async () => {
    /** @type {{ browser: import("puppeteer").Browser, page: import("puppeteer").Page, backend: { baseUrl: string, close: () => Promise<void> }, teardown: () => Promise<void> }|null} */
    let harness = null;
    /** @type {Awaited<ReturnType<typeof installTAuthHarness>>|undefined} */
    let tauthHarness = undefined;
    try {
        harness = await initializePuppeteerTest(PAGE_URL, {
            runtimeConfig: {
                development: {
                    authBaseUrl: TAUTH_BASE_URL
                }
            },
            beforeNavigate: async (page) => {
                tauthHarness = await installTAuthHarness(page, { baseUrl: TAUTH_BASE_URL });
            }
        });
        assert.ok(harness && tauthHarness, "harness initialisation failed");
        const { page, backend } = harness;
        const resolvedAuthBaseUrl = await page.evaluate(async () => {
            const importer = typeof window.importAppModule === "function"
                ? window.importAppModule
                : (specifier) => import(specifier);
            const module = await importer("./js/core/config.js");
            return module.appConfig.authBaseUrl;
        });
        assert.equal(resolvedAuthBaseUrl, TAUTH_BASE_URL, "runtime config did not override authBaseUrl");
        const userId = `tauth-user-${Date.now()}`;
        const credential = composeTestCredential({
            userId,
            email: `${userId}@example.com`,
            name: "TAuth Integration User",
            pictureUrl: "https://example.com/avatar.png"
        });

        page.on("console", (message) => {
            if (message.type() === "error") {
                console.error("[tauthFlow page]", message.text());
            }
        });

        await waitForTAuthSession(page, 10000);
        await waitForSyncManagerReady(page, 10000);
        const tauthScriptState = await page.evaluate(() => {
            const script = document.getElementById("gravity-tauth-client-script");
            const allScripts = Array.from(document.getElementsByTagName("script")).map((element) => ({
                id: element.id || null,
                src: element.getAttribute("src") || null
            }));
            return script
                ? { present: true, src: script.getAttribute("src"), readyState: script.readyState ?? null, allScripts }
                : { present: false, allScripts };
        });
        console.log("[tauthFlow debug] tauth script", tauthScriptState);
        const initAuthClientType = await page.evaluate(() => typeof window.initAuthClient);
        console.log("[tauthFlow debug] initAuthClient type", initAuthClientType);
        const harnessDefined = await page.evaluate(() => Boolean(window.__tauthHarness));
        console.log("[tauthFlow debug] harness defined", harnessDefined);
        await page.evaluate(() => {
            const root = document.querySelector("[x-data]");
            if (!root) {
                return;
            }
            const probeKey = "__gravityAuthSignInProbe";
            if (!root[probeKey]) {
                root[probeKey] = { count: 0 };
                root.addEventListener("gravity:auth-sign-in", () => {
                    root[probeKey].count += 1;
                });
            }
        });
        const harnessEventsBefore = await page.evaluate(() => window.__tauthHarnessEvents ?? null);
        console.log("[tauthFlow debug] harness events before", harnessEventsBefore);
        await dispatchCredentialEvent(page, credential);
        const signInCount = await page.evaluate(() => {
            const root = document.querySelector("[x-data]");
            if (!root) {
                return 0;
            }
            const probe = root["__gravityAuthSignInProbe"];
            return probe ? probe.count : 0;
        });
        console.log("[tauthFlow debug] sign-in events", signInCount);
        const harnessEventsAfter = await page.evaluate(() => window.__tauthHarnessEvents ?? null);
        console.log("[tauthFlow debug] harness events after", harnessEventsAfter);
        await page.waitForFunction(() => {
            return window.__tauthHarnessEvents && window.__tauthHarnessEvents.authenticatedCount > 0;
        }, { timeout: 5000 }).catch(() => {
            console.warn("[tauthFlow debug] authenticated event not observed within timeout");
        });
        const harnessEventsPostAuth = await page.evaluate(() => window.__tauthHarnessEvents ?? null);
        console.log("[tauthFlow debug] harness events post auth", harnessEventsPostAuth);
        const authDebugState = await page.evaluate(() => {
            const root = document.querySelector("[x-data]");
            if (!root) {
                return null;
            }
            const extract = () => {
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
            };
            const component = extract();
            if (!component) {
                return null;
            }
            return {
                hasAuthUser: Boolean(component.authUser),
                latestCredentialLength: typeof component.latestCredential === "string" ? component.latestCredential.length : null,
                backendAccessToken: component.backendAccessToken,
                authControlsState: component.authControls ? component.authControls.getState?.() ?? null : null
            };
        });
        console.log("[tauthFlow debug]", authDebugState);
        await waitForSyncManagerUser(page, userId);

        const requestLog = tauthHarness.getRequestLog();
        assert.ok(requestLog.some((entry) => entry.method === "POST" && entry.path === "/auth/nonce"), "nonce request missing");
        assert.ok(requestLog.some((entry) => entry.method === "POST" && entry.path === "/auth/google"), "credential exchange missing");

        const noteId = `tauth-note-${Date.now()}`;
        const timestampIso = new Date().toISOString();
        await dispatchNoteCreate(page, {
            record: {
                noteId,
                markdownText: "TAuth integration note",
                createdAtIso: timestampIso,
                updatedAtIso: timestampIso,
                lastActivityIso: timestampIso
            },
            storeUpdated: false,
            shouldRender: false
        });
        await waitForPendingOperations(page);
        const debugState = await extractSyncDebugState(page);
        assert.ok(debugState?.backendToken?.accessToken, "backend token missing after TAuth sign-in");
        await waitForBackendNote({
            backendUrl: backend.baseUrl,
            token: debugState.backendToken.accessToken,
            noteId,
            timeoutMs: 10000
        });
        assert.equal(tauthHarness.getProfile()?.user_id, userId, "TAuth harness profile mismatch");
    } finally {
        await harness?.teardown();
    }
});

test("TAuth session rehydrates automatically after reload", async () => {
    /** @type {{ browser: import("puppeteer").Browser, page: import("puppeteer").Page, backend: { baseUrl: string, close: () => Promise<void> }, teardown: () => Promise<void> }|null} */
    let harness = null;
    /** @type {Awaited<ReturnType<typeof installTAuthHarness>>|undefined} */
    let tauthHarness = undefined;
    try {
        harness = await initializePuppeteerTest(PAGE_URL, {
            runtimeConfig: {
                development: {
                    authBaseUrl: TAUTH_BASE_URL
                }
            },
            beforeNavigate: async (page) => {
                tauthHarness = await installTAuthHarness(page, { baseUrl: TAUTH_BASE_URL });
            }
        });
        assert.ok(harness && tauthHarness, "harness initialisation failed");
        const { page } = harness;
        const userId = `tauth-refresh-${Date.now()}`;
        const credential = composeTestCredential({
            userId,
            email: `${userId}@example.com`,
            name: "TAuth Refresh User"
        });

        page.on("console", (message) => {
            if (message.type() === "error") {
                console.error("[tauthRefresh page]", message.text());
            }
        });

        await waitForTAuthSession(page, 10000);
        await waitForSyncManagerReady(page, 10000);
        await dispatchCredentialEvent(page, credential);
        const refreshSignInEvents = await page.evaluate(() => {
            const root = document.querySelector("[x-data]");
            if (!root) {
                return 0;
            }
            const probe = root["__gravityAuthSignInProbe"];
            return probe ? probe.count : 0;
        });
        console.log("[tauthRefresh debug] sign-in events", refreshSignInEvents);
        const harnessEventsReload = await page.evaluate(() => window.__tauthHarnessEvents ?? null);
        console.log("[tauthRefresh debug] harness events", harnessEventsReload);
        await waitForSyncManagerUser(page, userId);
        assert.equal(tauthHarness.getProfile()?.user_id, userId, "Profile not captured before reload");

        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForAppReady(page);
        await waitForSyncManagerUser(page, userId);

        const storedAuthState = await page.evaluate(() => window.localStorage.getItem("gravityAuthState"));
        assert.ok(storedAuthState && storedAuthState.includes(userId), "auth state not persisted after reload");

        const log = tauthHarness.getRequestLog();
        assert.ok(log.some((entry) => entry.path === "/static/auth-client.js"), "auth-client script never requested");
        assert.equal(tauthHarness.getProfile()?.user_id, userId, "Profile lost after reload");
    } finally {
        await harness?.teardown();
    }
});

/**
 * Dispatch a credential received event so the UI exchanges it with TAuth.
 * @param {import("puppeteer").Page} page
 * @param {string} credential
 * @returns {Promise<void>}
 */
async function dispatchCredentialEvent(page, credential) {
    await page.evaluate((eventName, token) => {
        const target = document.body || document.documentElement;
        if (!target) {
            throw new Error("dispatch target missing");
        }
        target.dispatchEvent(new CustomEvent(eventName, {
            bubbles: true,
            detail: { credential: token }
        }));
    }, EVENT_AUTH_CREDENTIAL_RECEIVED, credential);
}
