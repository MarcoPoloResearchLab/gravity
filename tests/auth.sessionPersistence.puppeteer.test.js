import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./helpers/puppeteerEnvironment.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const SANDBOX = await ensurePuppeteerSandbox();
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
            const launchOptions = createSandboxedLaunchOptions(SANDBOX);
            browser = await puppeteerModule.launch(launchOptions);
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
                llmProxyClassifyUrl: "",
                mockBackend: true
            });
            try {
                await dispatchSignIn(page, credential, userId);
                await waitForSyncManagerUser(page, userId);

                const activeKeyBefore = await page.evaluate(async () => {
                    const module = await import("./js/core/store.js");
                    return module.GravityStore.getActiveStorageKey();
                });
                assert.ok(typeof activeKeyBefore === "string" && activeKeyBefore.includes(encodeURIComponent(userId)));

                await page.reload({ waitUntil: "domcontentloaded" });
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
