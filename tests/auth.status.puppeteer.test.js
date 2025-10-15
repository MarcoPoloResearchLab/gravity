import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    initializePuppeteerTest,
    dispatchSignIn,
    waitForSyncManagerUser
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

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

        test("signed-out view omits status banner", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page } = harness;
            await resetAppToSignedOut(page);

            await page.waitForSelector(".auth-status");
            const statusContent = await page.$eval(".auth-status", (element) => element.textContent?.trim() ?? "");
            assert.equal(statusContent.length, 0);
        });

        test("signed-in view keeps status hidden", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page, backend } = harness;
            await resetAppToSignedOut(page);

            const credential = backend.tokenFactory("status-user");
            await dispatchSignIn(page, credential, "status-user");
            await waitForSyncManagerUser(page, "status-user", 5000);

            await page.waitForSelector(".auth-status");
            const statusMetrics = await page.$eval(".auth-status", (element) => ({
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

async function resetAppToSignedOut(page) {
    await page.evaluate(() => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.setItem("gravityNotesData", "[]");
        window.localStorage.removeItem("gravityAuthState");
        window.location.reload();
    });
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#top-editor .markdown-editor");
    await page.waitForSelector(".auth-button-host");
}
