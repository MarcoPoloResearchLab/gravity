import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    initializePuppeteerTest,
    dispatchSignIn,
    waitForSyncManagerUser,
    resetToSignedOut
} from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test.describe("Auth session persistence (backend)", () => {
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

    test("session survives refresh", async () => {
        if (!harness) {
            test.skip(launchError ? launchError.message : "Puppeteer harness unavailable");
            return;
        }

        const { page, backend } = harness;
        await resetToSignedOut(page);

        const userId = "session-persist-user";
        const credential = backend.tokenFactory(userId);
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
    });
});
