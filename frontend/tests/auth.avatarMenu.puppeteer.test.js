// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    EVENT_MPR_AUTH_UNAUTHENTICATED,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_SIGN_OUT
} from "../js/constants.js";
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
const USER_MENU_TIMEOUT_MS = 8000;

/**
 * @param {import("puppeteer").Page} page
 */
async function readUserMenuState(page) {
    return page.evaluate(() => {
        const menu = document.querySelector("mpr-user");
        return {
            authState: document.body?.dataset?.authState ?? null,
            status: menu?.getAttribute("data-mpr-user-status") ?? null,
            mode: menu?.getAttribute("data-mpr-user-mode") ?? null,
            error: menu?.getAttribute("data-mpr-user-error") ?? null
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
    test.describe("Auth avatar menu", () => {
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

        test("shows landing sign-in and reveals user menu after authentication", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page, backend } = harness;

            await resetToSignedOut(page);

            assert.equal(LABEL_EXPORT_NOTES, "Export Notes");
            assert.equal(LABEL_IMPORT_NOTES, "Import Notes");

            await page.waitForSelector("[data-test=\"landing-login\"]");
            const landingVisible = await page.evaluate(() => {
                const landing = document.querySelector("[data-test=\"landing\"]");
                return Boolean(landing && !landing.hasAttribute("hidden"));
            });
            assert.equal(landingVisible, true);

            await attachBackendSessionCookie(page, backend, "avatar-menu-user");
            const credential = backend.tokenFactory("avatar-menu-user");
            await dispatchSignIn(page, credential, "avatar-menu-user");
            await waitForSyncManagerUser(page, "avatar-menu-user", USER_MENU_TIMEOUT_MS);

            await page.waitForSelector("[data-test=\"app-shell\"]:not([hidden])");
            try {
                await page.waitForSelector("mpr-user[data-mpr-user-status=\"authenticated\"]", { timeout: USER_MENU_TIMEOUT_MS });
            } catch (error) {
                const menuState = await readUserMenuState(page);
                throw new Error(`User menu did not authenticate: ${JSON.stringify(menuState)}`, { cause: error });
            }

            await page.click("mpr-user [data-mpr-user=\"trigger\"]");
            await page.waitForSelector("mpr-user[data-mpr-user-open=\"true\"] [data-mpr-user=\"menu\"]");

            const visibleItems = await page.$$eval("mpr-user [data-mpr-user=\"menu-item\"]", (elements) => {
                return elements.map((element) => element.textContent?.trim() ?? "").filter((text) => text.length > 0);
            });

            assert.deepEqual(visibleItems, [
                LABEL_EXPORT_NOTES,
                LABEL_IMPORT_NOTES
            ]);

            const logoutLabel = await page.$eval("mpr-user [data-mpr-user=\"logout\"]", (element) => element.textContent?.trim() ?? "");
            assert.equal(logoutLabel, LABEL_SIGN_OUT);

            await page.evaluate((eventName) => {
                const root = document.querySelector("body");
                if (!root) return;
                root.dispatchEvent(new CustomEvent(eventName, {
                    detail: { profile: null },
                    bubbles: true
                }));
            }, EVENT_MPR_AUTH_UNAUTHENTICATED);

            await page.waitForSelector("[data-test=\"landing\"]:not([hidden])");
        });
    });
}
