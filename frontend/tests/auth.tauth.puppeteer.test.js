// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    composeTestCredential,
    prepareFrontendPage,
    waitForPendingOperations,
    waitForSyncManagerUser,
    dispatchNoteCreate,
    waitForTAuthSession,
    exchangeTAuthCredential,
    attachBackendSessionCookie
} from "./helpers/syncTestUtils.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";
import { installTAuthHarness } from "./helpers/tauthHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
// In the new page-separation architecture:
// - app.html is for authenticated app functionality
// - index.html is the landing page for unauthenticated users
const APP_PAGE_URL = `file://${path.join(PROJECT_ROOT, "app.html")}`;
const LANDING_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const PAGE_URL = APP_PAGE_URL;
const DEFAULT_USER = Object.freeze({
    id: "tauth-user",
    email: "tauth-user@example.com",
    name: "TAuth Harness User"
});

if (process.env.DEBUG_TAUTH_HARNESS === "1") {
    // eslint-disable-next-line no-console
    console.log("[auth.tauth] Test file loaded");
}

test.describe("TAuth integration", () => {
    if (process.env.DEBUG_TAUTH_HARNESS === "1") {
        // eslint-disable-next-line no-console
        console.log("[auth.tauth] Describe block executing");
    }
    test("signs in via TAuth harness and syncs notes", { timeout: 60000 }, async () => {
        if (process.env.DEBUG_TAUTH_HARNESS === "1") {
            // eslint-disable-next-line no-console
            console.log("[auth.tauth] Test 1 starting");
        }
        const env = await bootstrapTAuthEnvironment();
        const noteId = "tauth-note";
        const timestamp = new Date().toISOString();
        try {
            await dispatchCredential(env.page, DEFAULT_USER);
            await waitForSyncManagerUser(env.page, DEFAULT_USER.id);
            // Note: pageWaitForAuthenticatedEvents removed - sync manager user check
            // and mpr-user status check already verify authentication

            await dispatchNoteCreate(env.page, {
                record: {
                    noteId,
                    markdownText: "Synced via TAuth harness",
                    createdAtIso: timestamp,
                    updatedAtIso: timestamp,
                    lastActivityIso: timestamp
                },
                storeUpdated: false,
                shouldRender: false
            });
            await waitForPendingOperations(env.page);

            await waitForBackendNote({
                backendUrl: env.backend.baseUrl,
                sessionToken: env.backend.createSessionToken(DEFAULT_USER.id),
                cookieName: env.backend.cookieName,
                noteId
            });

            await env.page.waitForSelector("mpr-user[data-mpr-user-status=\"authenticated\"]", { timeout: 5000 });

            const requests = env.tauthHarnessHandle.getRequestLog();
            const paths = requests.map((entry) => entry.path);
            assert.ok(paths.includes("/auth/nonce"), "TAuth harness should receive /auth/nonce");
            assert.ok(paths.includes("/auth/google"), "TAuth harness should receive /auth/google exchange");
            // Note: /me and /auth/refresh are NOT required when initialProfile is pre-set
            // because the harness auto-authenticates without needing to hydrate
        } finally {
            await cleanupTAuthEnvironment(env);
        }
    });

    test("surfaces authentication errors when nonce mismatches", { timeout: 45000 }, async () => {
        // This test uses landing.html because error messages display on the landing page
        const env = await bootstrapTAuthEnvironment({ pageUrl: LANDING_PAGE_URL });
        try {
            env.tauthHarnessHandle.triggerNonceMismatch();
            let exchangeError = null;
            try {
                await dispatchCredential(env.page, DEFAULT_USER);
            } catch (error) {
                exchangeError = error;
            }
            assert.ok(exchangeError instanceof Error);
            assert.ok(exchangeError.message.startsWith("nonce_mismatch"));
            const errorSelector = "[data-test=\"landing-status\"][data-status=\"error\"]";
            await env.page.waitForSelector(errorSelector, { timeout: 10000 });
            const errorMessage = await env.page.$eval(errorSelector, (element) => element.textContent?.trim() ?? "");
            assert.equal(errorMessage, "Authentication error");
        } finally {
            await cleanupTAuthEnvironment(env);
        }
    });

    test("refreshes the session after backend cookies expire", { timeout: 60000 }, async () => {
        const env = await bootstrapTAuthEnvironment();
        try {
            await dispatchCredential(env.page, DEFAULT_USER);
            await waitForSyncManagerUser(env.page, DEFAULT_USER.id);
            await env.page.deleteCookie({
                name: env.backend.cookieName,
                url: env.backend.baseUrl
            });
            await env.page.evaluate((notesUrl) => window.apiFetch(notesUrl, { method: "GET" }), `${env.backend.baseUrl}/notes`);
            await waitForSyncManagerUser(env.page, DEFAULT_USER.id);
            const refreshCount = env.tauthHarnessHandle.getRequestLog().filter((entry) => entry.path === "/auth/refresh").length;
            assert.ok(refreshCount >= 1, "expected /auth/refresh to be invoked after cookie deletion");
        } finally {
            await cleanupTAuthEnvironment(env);
        }
    });

    test("signing out calls /auth/logout and clears the profile", { timeout: 45000 }, async () => {
        const env = await bootstrapTAuthEnvironment();
        try {
            await dispatchCredential(env.page, DEFAULT_USER);
            await waitForSyncManagerUser(env.page, DEFAULT_USER.id);
            await env.page.evaluate(() => {
                if (typeof window.logout === "function") {
                    return window.logout();
                }
                throw new Error("logout helper unavailable");
            });
            await env.page.waitForSelector("mpr-user[data-mpr-user-status=\"unauthenticated\"]", { timeout: 5000 });
            const paths = env.tauthHarnessHandle.getRequestLog().map((entry) => entry.path);
            assert.ok(paths.includes("/auth/logout"), "expected /auth/logout request");
        } finally {
            await cleanupTAuthEnvironment(env);
        }
    });
});

async function bootstrapTAuthEnvironment(options = {}) {
    if (process.env.DEBUG_TAUTH_HARNESS === "1") {
        // eslint-disable-next-line no-console
        console.log("[bootstrap] Starting bootstrapTAuthEnvironment");
    }
    const pageUrl = options.pageUrl ?? PAGE_URL;
    const isAppPage = pageUrl.includes("app.html");
    if (process.env.DEBUG_TAUTH_HARNESS === "1") {
        // eslint-disable-next-line no-console
        console.log(`[bootstrap] pageUrl=${pageUrl}, isAppPage=${isAppPage}`);
    }
    const backend = await startTestBackend();
    if (process.env.DEBUG_TAUTH_HARNESS === "1") {
        // eslint-disable-next-line no-console
        console.log(`[bootstrap] backend started at ${backend.baseUrl}`);
    }
    const browser = await connectSharedBrowser();
    if (process.env.DEBUG_TAUTH_HARNESS === "1") {
        // eslint-disable-next-line no-console
        console.log("[bootstrap] connected to shared browser");
    }
    const context = await browser.createBrowserContext();
    let tauthHarnessHandle = null;
    const tauthScriptUrl = new URL("/tauth.js", backend.baseUrl).toString();
    const page = await prepareFrontendPage(context, pageUrl, {
        backendBaseUrl: backend.baseUrl,
        authBaseUrl: backend.baseUrl,
        tauthScriptUrl,
        // Skip waitForAppReady for landing page - it waits for app-specific selectors
        skipAppReady: !isAppPage,
        beforeNavigate: async (targetPage) => {
            // Install TAuth harness FIRST so it has priority over session cookie interceptor.
            // The harness intercepts /tauth.js and auth endpoints.
            // For app.html tests, set initialProfile to match DEFAULT_USER so that:
            // 1. /me returns the correct user, preventing redirect to landing
            // 2. Bootstrap authenticates with the expected user
            // For landing page tests, use null so the test controls authentication
            const harnessProfile = isAppPage ? {
                user_id: DEFAULT_USER.id,
                user_email: DEFAULT_USER.email,
                display: DEFAULT_USER.name,
                name: DEFAULT_USER.name,
                given_name: DEFAULT_USER.name.split(" ")[0],
                avatar_url: "https://example.com/avatar.png",
                user_display: DEFAULT_USER.name,
                user_avatar_url: "https://example.com/avatar.png"
            } : null;
            if (process.env.DEBUG_TAUTH_HARNESS === "1") {
                // eslint-disable-next-line no-console
                console.log(`[bootstrap] harnessProfile: ${harnessProfile ? harnessProfile.user_id : 'null'}`);
            }
            tauthHarnessHandle = await installTAuthHarness(targetPage, {
                baseUrl: backend.baseUrl,
                cookieName: backend.cookieName,
                mintSessionToken: backend.createSessionToken,
                initialProfile: harnessProfile
            });
            // For app.html, attach session cookie to prevent redirect to landing page.
            // This handler runs AFTER the harness, so auth endpoints go to the harness.
            if (isAppPage) {
                await attachBackendSessionCookie(targetPage, backend, DEFAULT_USER.id);
            }
        }
    });
    // Wait for TAuth harness to be initialized (functions available)
    await page.waitForFunction(() => {
        // Check for TAuth harness events - indicates harness script has run
        const harnessEvents = window.__tauthHarnessEvents;
        if (harnessEvents) {
            return true;
        }
        // Fallback: check for stub options being set
        const stubOptions = window.__tauthStubOptions;
        return Boolean(stubOptions && typeof stubOptions === "object");
    }, { timeout: 30000 });
    if (!tauthHarnessHandle) {
        throw new Error("TAuth harness failed to initialize");
    }
    return { backend, browser, context, page, tauthHarnessHandle };
}

async function cleanupTAuthEnvironment(env) {
    await env.page.close().catch(() => {});
    await env.context.close().catch(() => {});
    env.browser.disconnect();
    await env.backend.close();
}

async function dispatchCredential(page, user) {
    const credential = composeTestCredential({
        userId: user.id,
        email: user.email,
        name: user.name,
        pictureUrl: "https://example.com/avatar.png"
    });
    await exchangeTAuthCredential(page, credential);
}

async function pageWaitForAuthenticatedEvents(page, minimumCount) {
    await page.waitForFunction((count) => {
        return Boolean(window.__tauthHarnessEvents && window.__tauthHarnessEvents.authenticatedCount >= count);
    }, { timeout: 10000 }, minimumCount);
}
