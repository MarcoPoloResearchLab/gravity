import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    EVENT_AUTH_SIGN_IN,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_SIGN_OUT
} from "../js/constants.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

const SANDBOX = await ensurePuppeteerSandbox();
const {
    homeDir: SANDBOX_HOME_DIR,
    userDataDir: SANDBOX_USER_DATA_DIR,
    cacheDir: SANDBOX_CACHE_DIR,
    configDir: SANDBOX_CONFIG_DIR,
    crashDumpsDir: SANDBOX_CRASH_DUMPS_DIR
} = SANDBOX;

let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch (error) {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    const executablePath = typeof puppeteerModule.executablePath === "function"
        ? puppeteerModule.executablePath()
        : undefined;
    if (typeof executablePath === "string" && executablePath.length > 0) {
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    }

    test.describe("Auth avatar menu", () => {
        /** @type {import("puppeteer").Browser | null} */
        let browser = null;
        /** @type {Error|null} */
        let launchError = null;

        const skipIfNoBrowser = () => {
            if (!browser) {
                test.skip(launchError ? launchError.message : "Puppeteer launch unavailable in sandbox.");
                return true;
            }
            return false;
        };

        test.before(async () => {
            const launchArgs = [
                "--allow-file-access-from-files",
                "--disable-crashpad",
                "--disable-features=Crashpad",
                "--noerrdialogs",
                "--no-crash-upload",
                "--enable-crash-reporter=0",
                `--crash-dumps-dir=${SANDBOX_CRASH_DUMPS_DIR}`
            ];
            if (process.env.CI) {
                launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
            }
            try {
                browser = await puppeteerModule.launch({
                    headless: "new",
                    args: launchArgs,
                    userDataDir: SANDBOX_USER_DATA_DIR,
                    env: {
                        ...process.env,
                        HOME: SANDBOX_HOME_DIR,
                        XDG_CACHE_HOME: SANDBOX_CACHE_DIR,
                        XDG_CONFIG_HOME: SANDBOX_CONFIG_DIR
                    }
                });
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            if (browser) {
                await browser.close();
            }
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("hides Google button after sign-in and reveals stacked avatar menu", async () => {
            if (skipIfNoBrowser()) return;

            const page = await browser.newPage();
            try {
                await page.goto(PAGE_URL, { waitUntil: "load" });

                await page.waitForSelector(".auth-button-host", { timeout: 2000 });

                await page.evaluate((eventName) => {
                    const root = document.querySelector("body");
                    if (!root) return;
                    const userDetail = {
                        id: "integration-user",
                        email: "integration.user@example.com",
                        name: "Integration User",
                        pictureUrl: "https://example.com/avatar.png"
                    };
                    root.dispatchEvent(new CustomEvent(eventName, {
                        detail: { user: userDetail },
                        bubbles: true
                    }));
                }, EVENT_AUTH_SIGN_IN);

                await page.waitForFunction(() => {
                    const host = document.querySelector(".auth-button-host");
                    return Boolean(host && host.hasAttribute("hidden"));
                }, { timeout: 2000 });

                const ariaHidden = await page.$eval(".auth-button-host", (element) => element.getAttribute("aria-hidden"));
                assert.equal(ariaHidden, "true");

                await page.waitForSelector(".auth-avatar:not([hidden])", { timeout: 2000 });

                await page.click(".auth-avatar-trigger");

                await page.waitForSelector("[data-test='auth-menu'][data-open='true']", { timeout: 2000 });

                const visibleItems = await page.$$eval("[data-test='auth-menu'] [data-test='auth-menu-item']", (elements) => {
                    return elements.map((element) => element.textContent?.trim() ?? "").filter((text) => text.length > 0);
                });

                assert.deepEqual(visibleItems, [
                    LABEL_EXPORT_NOTES,
                    LABEL_IMPORT_NOTES,
                    LABEL_SIGN_OUT
                ]);
            } finally {
                await page.close();
            }
        });
    });
}
