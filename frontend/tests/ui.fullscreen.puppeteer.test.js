// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LABEL_ENTER_FULL_SCREEN, LABEL_EXIT_FULL_SCREEN } from "../js/constants.js";
import { createSharedPage } from "./helpers/browserHarness.js";
import { startTestBackend } from "./helpers/backendHarness.js";
import { signInTestUser } from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const FULLSCREEN_TOGGLE_SELECTOR = '[data-test="fullscreen-toggle"]';
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

            await page.goto(PAGE_URL);
            await signInTestUser(page, backend, TEST_USER_ID);
            await page.waitForSelector(FULLSCREEN_TOGGLE_SELECTOR, { timeout: 3000 });
            await page.evaluate((selector) => {
                const button = document.querySelector(selector);
                if (!(button instanceof HTMLElement)) {
                    return;
                }
                button.hidden = false;
                button.removeAttribute("hidden");
                let ancestor = button.parentElement;
                while (ancestor instanceof HTMLElement) {
                    if (ancestor.hasAttribute("hidden")) {
                        ancestor.removeAttribute("hidden");
                    }
                    if ("dataset" in ancestor && ancestor.dataset) {
                        ancestor.dataset.open = "true";
                    }
                    ancestor = ancestor.parentElement;
                }
            }, FULLSCREEN_TOGGLE_SELECTOR);

            const initialState = await page.$eval(FULLSCREEN_TOGGLE_SELECTOR, (button) => ({
                label: button.getAttribute("aria-label"),
                state: button.getAttribute("data-fullscreen-state")
            }));
            assert.deepEqual(initialState, { label: LABEL_ENTER_FULL_SCREEN, state: "enter" });

            await page.click(FULLSCREEN_TOGGLE_SELECTOR);
            await page.waitForSelector(`${FULLSCREEN_TOGGLE_SELECTOR}[data-fullscreen-state="exit"]`, { timeout: 3000 });
            const afterEnter = await page.$eval(FULLSCREEN_TOGGLE_SELECTOR, (button) => ({
                label: button.getAttribute("aria-label"),
                state: button.getAttribute("data-fullscreen-state")
            }));
            assert.deepEqual(afterEnter, { label: LABEL_EXIT_FULL_SCREEN, state: "exit" });

            const countersAfterEnter = await page.evaluate(() => window.__fullscreenTestCounters);
            assert.equal(
                countersAfterEnter.requestFullscreenCalls,
                1,
                "requestFullscreen should be invoked once after entering full screen"
            );

            await page.click(FULLSCREEN_TOGGLE_SELECTOR);
            await page.waitForSelector(`${FULLSCREEN_TOGGLE_SELECTOR}[data-fullscreen-state="enter"]`, { timeout: 3000 });
            const afterExit = await page.$eval(FULLSCREEN_TOGGLE_SELECTOR, (button) => ({
                label: button.getAttribute("aria-label"),
                state: button.getAttribute("data-fullscreen-state")
            }));
            assert.deepEqual(afterExit, { label: LABEL_ENTER_FULL_SCREEN, state: "enter" });

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
