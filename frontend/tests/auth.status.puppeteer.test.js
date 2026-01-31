// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    EVENT_MPR_AUTH_AUTHENTICATED
} from "../js/constants.js";
import {
    initializePuppeteerTest,
    attachBackendSessionCookie,
    waitForSyncManagerUser,
    resetToSignedOut
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
// Auth status tests use index.html (landing page) since that's where the landing-status element exists
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const AUTH_STATUS_TIMEOUT_MS = 8000;

/**
 * @param {import("puppeteer").Page} page
 */
async function readLandingStatus(page) {
    return page.evaluate(() => {
        const status = document.querySelector("[data-test=\"landing-status\"]");
        return {
            authState: document.body?.dataset?.authState ?? null,
            hidden: status instanceof HTMLElement ? status.hidden : null,
            ariaHidden: status instanceof HTMLElement ? status.getAttribute("aria-hidden") : null,
            text: status instanceof HTMLElement ? status.textContent?.trim() ?? "" : null
        };
    });
}

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
    test.describe("Auth status messaging", () => {
        /** @type {{ browser: import('puppeteer').Browser, page: import('puppeteer').Page, backend: { baseUrl: string, tokenFactory: (userId: string, expiresInSeconds?: number) => string, close: () => Promise<void> }, teardown: () => Promise<void> }|null} */
        let harness = null;
        /** @type {Error|null} */
        let launchError = null;

        test.before(async () => {
            try {
                harness = await initializePuppeteerTest(PAGE_URL);
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            if (harness) {
                await harness.teardown();
            }
            harness = null;
        });

        test("signed-out view omits landing status banner", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page } = harness;
            await resetToSignedOut(page);

            await page.waitForSelector("[data-test=\"landing-status\"]");
            try {
                await page.waitForFunction(() => {
                    const status = document.querySelector("[data-test=\"landing-status\"]");
                    return Boolean(status && status.hasAttribute("hidden"));
                }, { timeout: AUTH_STATUS_TIMEOUT_MS });
            } catch (error) {
                const statusState = await readLandingStatus(page);
                throw new Error(`Landing status did not hide: ${JSON.stringify(statusState)}`, { cause: error });
            }
            const statusContent = await page.$eval("[data-test=\"landing-status\"]", (element) => element.textContent?.trim() ?? "");
            assert.equal(statusContent.length, 0);
        });

        test("sign-in redirects from landing to app page", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page, backend } = harness;
            await resetToSignedOut(page);

            // Verify we're on landing page before sign-in
            await page.waitForSelector("[data-test=\"landing\"]");
            const initialUrl = page.url();
            assert.ok(initialUrl.includes("index.html"), "Should start on landing page");

            await attachBackendSessionCookie(page, backend, "status-user");

            // Sign in - in the new architecture, this should redirect to app.html
            // On landing page, dispatch auth event directly (landing page has mpr-login-button, not mpr-user)
            const navigationPromise = page.waitForNavigation({ waitUntil: "domcontentloaded" });
            await page.evaluate((eventName) => {
                const profile = {
                    user_id: "status-user",
                    user_email: "status-user@example.com",
                    display: "Status User",
                    name: "Status User",
                    given_name: "Status",
                    avatar_url: null
                };
                // Store profile in sessionStorage for mpr-ui
                try {
                    window.sessionStorage.setItem("__gravityTestAuthProfile", JSON.stringify(profile));
                } catch {
                    // ignore storage errors
                }
                const event = new CustomEvent(eventName, {
                    detail: { profile },
                    bubbles: true
                });
                document.body.dispatchEvent(event);
            }, EVENT_MPR_AUTH_AUTHENTICATED);
            await navigationPromise;

            // Verify we've been redirected to app.html
            const finalUrl = page.url();
            assert.ok(finalUrl.includes("app.html"), "Should redirect to app page after sign-in");

            // Verify app-shell is visible on the app page
            await page.waitForSelector("[data-test=\"app-shell\"]");
            await waitForSyncManagerUser(page, "status-user", AUTH_STATUS_TIMEOUT_MS);
        });
    });
}
