// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    initializePuppeteerTest,
    dispatchSignIn,
    attachBackendSessionCookie,
    waitForSyncManagerUser,
    resetToSignedOut
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
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

        test("signed-in view keeps landing status hidden", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page, backend } = harness;
            await resetToSignedOut(page);

            await attachBackendSessionCookie(page, backend, "status-user");
            const credential = backend.tokenFactory("status-user");
            await dispatchSignIn(page, credential, "status-user");
            await waitForSyncManagerUser(page, "status-user", AUTH_STATUS_TIMEOUT_MS);

            await page.waitForSelector("[data-test=\"landing-status\"]");
            const statusMetrics = await page.$eval("[data-test=\"landing-status\"]", (element) => ({
                hidden: element.hidden,
                ariaHidden: element.getAttribute("aria-hidden"),
                text: element.textContent?.trim() ?? ""
            }));
            assert.equal(statusMetrics.hidden, true);
            assert.equal(statusMetrics.ariaHidden, "true");
            assert.equal(statusMetrics.text.length, 0);
        });
    });
}
