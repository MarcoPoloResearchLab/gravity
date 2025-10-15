import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    EVENT_AUTH_SIGN_OUT,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_SIGN_OUT
} from "../js/constants.js";
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

        test("hides Google button after sign-in and reveals stacked avatar menu", async () => {
            if (!harness) {
                test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
                return;
            }

            const { page, backend } = harness;

            await resetAppToSignedOut(page);

            assert.equal(LABEL_EXPORT_NOTES, "Export Notes");
            assert.equal(LABEL_IMPORT_NOTES, "Import Notes");

            await page.waitForSelector(".auth-button-host");
            await page.waitForSelector("#guest-export-button:not([hidden])");

            await page.evaluate(() => {
                window.__guestExports = [];
                window.__guestExportOriginalCreate = URL.createObjectURL;
                window.__guestExportOriginalRevoke = URL.revokeObjectURL;
                URL.createObjectURL = (blob) => {
                    if (blob && typeof blob.text === "function") {
                        blob.text().then((text) => {
                            window.__guestExports.push(text);
                        });
                    }
                    return "blob:mock";
                };
                URL.revokeObjectURL = () => {};
            });

            await page.click("#guest-export-button");
            await page.waitForFunction(() => Array.isArray(window.__guestExports) && window.__guestExports.length > 0);
            const exportedPayload = await page.evaluate(() => window.__guestExports[0]);
            assert.equal(exportedPayload, "[]");

            await page.evaluate(() => {
                if (window.__guestExportOriginalCreate) {
                    URL.createObjectURL = window.__guestExportOriginalCreate;
                    delete window.__guestExportOriginalCreate;
                }
                if (window.__guestExportOriginalRevoke) {
                    URL.revokeObjectURL = window.__guestExportOriginalRevoke;
                    delete window.__guestExportOriginalRevoke;
                }
                delete window.__guestExports;
            });

            const hostBeforeSignIn = await page.$(".auth-button-host");
            assert.ok(hostBeforeSignIn, "auth button host should render while signed out");

            const credential = backend.tokenFactory("avatar-menu-user");
            await dispatchSignIn(page, credential, "avatar-menu-user");
            await waitForSyncManagerUser(page, "avatar-menu-user", 5000);

            await page.waitForFunction(() => !document.querySelector(".auth-button-host"));

            const hostAfterSignIn = await page.$(".auth-button-host");
            assert.equal(hostAfterSignIn, null);

            await page.waitForSelector(".auth-avatar:not([hidden])");

            const guestHiddenAfterSignIn = await page.evaluate(() => {
                const button = document.querySelector("#guest-export-button");
                return button ? button.hasAttribute("hidden") : false;
            });
            assert.equal(guestHiddenAfterSignIn, true);

            await page.click(".auth-avatar-trigger");
            await page.waitForSelector("[data-test='auth-menu'][data-open='true']");

            const visibleItems = await page.$$eval("[data-test='auth-menu'] [data-test='auth-menu-item']", (elements) => {
                return elements.map((element) => element.textContent?.trim() ?? "").filter((text) => text.length > 0);
            });

            assert.deepEqual(visibleItems, [
                LABEL_EXPORT_NOTES,
                LABEL_IMPORT_NOTES,
                LABEL_SIGN_OUT
            ]);

            await page.evaluate((eventName) => {
                const root = document.querySelector("body");
                if (!root) return;
                root.dispatchEvent(new CustomEvent(eventName, {
                    detail: { reason: "test" },
                    bubbles: true
                }));
            }, EVENT_AUTH_SIGN_OUT);

            await page.waitForSelector(".auth-button-host");
            await page.waitForSelector("#guest-export-button:not([hidden])");
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
