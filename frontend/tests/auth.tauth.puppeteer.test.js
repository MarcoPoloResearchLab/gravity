import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_AUTH_CREDENTIAL_RECEIVED } from "../js/constants.js";
import {
    composeTestCredential,
    prepareFrontendPage,
    waitForPendingOperations,
    waitForSyncManagerUser,
    dispatchNoteCreate,
    waitForTAuthSession
} from "./helpers/syncTestUtils.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import { connectSharedBrowser } from "./helpers/browserHarness.js";
import { installTAuthHarness } from "./helpers/tauthHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const DEFAULT_USER = Object.freeze({
    id: "tauth-user",
    email: "tauth-user@example.com",
    name: "TAuth Harness User"
});

test.describe("TAuth integration", () => {
    test("signs in via TAuth harness and syncs notes", { timeout: 60000 }, async () => {
        const env = await bootstrapTAuthEnvironment();
        const noteId = "tauth-note";
        const timestamp = new Date().toISOString();
        try {
            await dispatchCredential(env.page, DEFAULT_USER);
            await waitForSyncManagerUser(env.page, DEFAULT_USER.id);
            await pageWaitForAuthenticatedEvents(env.page, 1);

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

            await env.page.waitForSelector(".auth-avatar:not([hidden])", { timeout: 5000 });

            const requests = env.tauthHarnessHandle.getRequestLog();
            const paths = requests.map((entry) => entry.path);
            assert.ok(paths.includes("/auth/nonce"), "TAuth harness should receive /auth/nonce");
            assert.ok(paths.includes("/auth/google"), "TAuth harness should receive /auth/google exchange");
            assert.ok(paths.includes("/me") || paths.includes("/auth/refresh"), "TAuth harness should attempt to hydrate /me or refresh");
        } finally {
            await cleanupTAuthEnvironment(env);
        }
    });

    test("surfaces authentication errors when nonce mismatches", { timeout: 45000 }, async () => {
        const env = await bootstrapTAuthEnvironment();
        try {
            env.tauthHarnessHandle.triggerNonceMismatch();
            await dispatchCredential(env.page, DEFAULT_USER);
            const errorSelector = ".auth-status[data-status=\"error\"]";
            await env.page.waitForSelector(errorSelector, { timeout: 10000 });
            const errorMessage = await env.page.$eval(errorSelector, (element) => element.textContent?.trim() ?? "");
            assert.equal(errorMessage, "Authentication error");
            await env.page.waitForSelector(".auth-avatar[hidden]", { timeout: 5000 });
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
                const button = document.querySelector("[x-ref='authSignOutButton']");
                if (button instanceof HTMLButtonElement) {
                    button.click();
                }
            });
            await env.page.waitForSelector(".auth-avatar[hidden]", { timeout: 5000 });
            const paths = env.tauthHarnessHandle.getRequestLog().map((entry) => entry.path);
            assert.ok(paths.includes("/auth/logout"), "expected /auth/logout request");
        } finally {
            await cleanupTAuthEnvironment(env);
        }
    });
});

async function bootstrapTAuthEnvironment() {
    const backend = await startTestBackend();
    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    let tauthHarnessHandle = null;
    const page = await prepareFrontendPage(context, PAGE_URL, {
        backendBaseUrl: backend.baseUrl,
        authBaseUrl: backend.baseUrl,
        beforeNavigate: async (targetPage) => {
            tauthHarnessHandle = await installTAuthHarness(targetPage, {
                baseUrl: backend.baseUrl,
                cookieName: backend.cookieName,
                mintSessionToken: backend.createSessionToken
            });
        }
    });
    await waitForTAuthSession(page);
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
            id: user.id,
            email: user.email,
            name: user.name,
            pictureUrl: "https://example.com/avatar.png"
        }
    });
}

async function pageWaitForAuthenticatedEvents(page, minimumCount) {
    await page.waitForFunction((count) => {
        return Boolean(window.__tauthHarnessEvents && window.__tauthHarnessEvents.authenticatedCount >= count);
    }, { timeout: 10000 }, minimumCount);
}
