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

test.describe("TAuth integration", () => {
    test("signs in via TAuth harness and syncs notes", { timeout: 60000 }, async () => {
        const backend = await startTestBackend();
        const browser = await connectSharedBrowser();
        const context = await browser.createBrowserContext();

        const userId = "tauth-user";
        const noteId = "tauth-note";
        const timestamp = new Date().toISOString();

        /** @type {{ getRequestLog(): Array<{ method: string, path: string }>}|null} */
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

        try {
            await waitForTAuthSession(page);
            const credential = composeTestCredential({
                userId,
                email: "tauth-user@example.com",
                name: "TAuth Harness User",
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
                    email: "tauth-user@example.com",
                    name: "TAuth Harness User",
                    pictureUrl: "https://example.com/avatar.png"
                }
            });

            await waitForSyncManagerUser(page, userId);
            await page.waitForFunction(() => {
                return Boolean(window.__tauthHarnessEvents && window.__tauthHarnessEvents.authenticatedCount >= 1);
            }, { timeout: 10000 });

            await dispatchNoteCreate(page, {
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
            await waitForPendingOperations(page);

            await waitForBackendNote({
                backendUrl: backend.baseUrl,
                sessionToken: backend.createSessionToken(userId),
                cookieName: backend.cookieName,
                noteId
            });

            await page.waitForSelector(".auth-avatar:not([hidden])", { timeout: 5000 });

            const requests = tauthHarnessHandle ? tauthHarnessHandle.getRequestLog() : [];
            const paths = requests.map((entry) => entry.path);
            assert.ok(paths.includes("/auth/nonce"), "TAuth harness should receive /auth/nonce");
            assert.ok(paths.includes("/auth/google"), "TAuth harness should receive /auth/google exchange");
            assert.ok(paths.includes("/me") || paths.includes("/auth/refresh"), "TAuth harness should attempt to hydrate /me or refresh");
        } finally {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            browser.disconnect();
            await backend.close();
        }
    });
});
