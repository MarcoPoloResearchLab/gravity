// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LABEL_ENTER_FULL_SCREEN, LABEL_EXIT_FULL_SCREEN } from "../js/constants.js";
import { createSharedPage } from "./helpers/browserHarness.js";
import { startTestBackend } from "./helpers/backendHarness.js";
import { attachBackendSessionCookie, resolvePageUrl, signInTestUser } from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "app.html")}`;
const USER_MENU_TRIGGER_SELECTOR = 'mpr-user [data-mpr-user="trigger"]';
const FULLSCREEN_MENU_SELECTOR = 'mpr-user [data-mpr-user="menu-item"][data-mpr-user-action="toggle-fullscreen"]';
const TEST_USER_ID = "fullscreen-user";

test.describe("GN-204 header full-screen toggle", () => {
    test("enters and exits full screen while updating icon state", async () => {
        const backend = await startTestBackend();
        const { page, teardown } = await createSharedPage();
        try {
            await page.evaluateOnNewDocument(() => {
                const counters = { requestFullscreenCalls: 0, exitFullscreenCalls: 0 };
                let fullscreenElement = null;
                const updateFullscreenElement = (element) => {
                    fullscreenElement = element;
                };

                Object.defineProperty(window, "__fullscreenTestCounters", {
                    configurable: true,
                    get() {
                        return counters;
                    }
                });

                try {
                    Object.defineProperty(Document.prototype, "fullscreenElement", {
                        configurable: true,
                        get() {
                            return fullscreenElement;
                        }
                    });
                } catch {
                    // ignore when the property cannot be redefined
                }
                try {
                    Object.defineProperty(document, "fullscreenElement", {
                        configurable: true,
                        get() {
                            return fullscreenElement;
                        }
                    });
                } catch {
                    // ignore when the property cannot be redefined
                }

                document.exitFullscreen = async function exitFullscreen() {
                    counters.exitFullscreenCalls += 1;
                    updateFullscreenElement(null);
                    document.dispatchEvent(new Event("fullscreenchange"));
                };
                Element.prototype.requestFullscreen = async function requestFullscreen() {
                    counters.requestFullscreenCalls += 1;
                    updateFullscreenElement(this);
                    document.dispatchEvent(new Event("fullscreenchange"));
                };
            });

            // Set session cookie BEFORE navigation to prevent redirect to landing page
            await attachBackendSessionCookie(page, backend, TEST_USER_ID);
            const resolvedUrl = await resolvePageUrl(PAGE_URL);
            await page.goto(resolvedUrl, { waitUntil: "domcontentloaded" });
            await signInTestUser(page, backend, TEST_USER_ID);
            await page.waitForSelector(USER_MENU_TRIGGER_SELECTOR, { timeout: 3000 });
            await page.click(USER_MENU_TRIGGER_SELECTOR);
            await page.waitForSelector(FULLSCREEN_MENU_SELECTOR, { timeout: 3000 });

            const initialLabel = await page.$eval(FULLSCREEN_MENU_SELECTOR, (button) => button.textContent?.trim() ?? "");
            assert.equal(initialLabel, LABEL_ENTER_FULL_SCREEN);

            await page.click(FULLSCREEN_MENU_SELECTOR);
            await page.waitForFunction((selector, label) => {
                const element = document.querySelector(selector);
                return element && element.textContent?.trim() === label;
            }, {}, FULLSCREEN_MENU_SELECTOR, LABEL_EXIT_FULL_SCREEN);
            const afterEnterLabel = await page.$eval(FULLSCREEN_MENU_SELECTOR, (button) => button.textContent?.trim() ?? "");
            assert.equal(afterEnterLabel, LABEL_EXIT_FULL_SCREEN);

            const countersAfterEnter = await page.evaluate(() => window.__fullscreenTestCounters);
            assert.equal(
                countersAfterEnter.requestFullscreenCalls,
                1,
                "requestFullscreen should be invoked once after entering full screen"
            );

            await page.click(USER_MENU_TRIGGER_SELECTOR);
            await page.waitForSelector(FULLSCREEN_MENU_SELECTOR, { timeout: 3000 });
            await page.click(FULLSCREEN_MENU_SELECTOR);
            await page.waitForFunction((selector, label) => {
                const element = document.querySelector(selector);
                return element && element.textContent?.trim() === label;
            }, {}, FULLSCREEN_MENU_SELECTOR, LABEL_ENTER_FULL_SCREEN);
            const afterExitLabel = await page.$eval(FULLSCREEN_MENU_SELECTOR, (button) => button.textContent?.trim() ?? "");
            assert.equal(afterExitLabel, LABEL_ENTER_FULL_SCREEN);

            const countersAfterExit = await page.evaluate(() => window.__fullscreenTestCounters);
            assert.equal(
                countersAfterExit.exitFullscreenCalls,
                1,
                "exitFullscreen should be invoked once after leaving full screen"
            );
        } finally {
            await teardown();
            await backend.close();
        }
    });
});
