import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

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
} catch {
    puppeteerModule = null;
}

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

    test.describe("Auth session persistence", () => {
        /** @type {import('puppeteer').Browser | null} */
        let browser = null;

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
        });

        test.after(async () => {
            if (browser) {
                await browser.close();
            }
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("session survives refresh", async () => {
            assert.ok(browser, "browser must be initialised");

            const userId = "session-persist-user";
            const credential = "session-test-credential";

            const page = await prepareFrontendPage(browser, PAGE_URL, {
                backendBaseUrl: "http://localhost:8080",
                llmProxyClassifyUrl: ""
            });
            try {
                await dispatchSignIn(page, credential, userId);
                await waitForSyncManagerUser(page, userId);

                const activeKeyBefore = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.ok(typeof activeKeyBefore === "string" && activeKeyBefore.includes(encodeURIComponent(userId)));

                await page.reload({ waitUntil: "networkidle0" });
                await waitForSyncManagerUser(page, userId);

                const activeKeyAfter = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.equal(activeKeyAfter, activeKeyBefore, "user scope should persist after reload");

                const authStatePersisted = await page.evaluate(() => window.localStorage.getItem("gravityAuthState"));
                assert.ok(authStatePersisted, "auth state should remain stored");
            } finally {
                await page.close();
            }
        });
    });
}
