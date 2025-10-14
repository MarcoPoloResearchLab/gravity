import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    EVENT_NOTE_CREATE
} from "../js/constants.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    waitForPendingOperations,
    extractSyncDebugState
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

    test.describe("Full stack integration", () => {
        /** @type {import('puppeteer').Browser | null} */
        let browser = null;
        /** @type {{ baseUrl: string, tokenFactory: (userId: string) => string, close: () => Promise<void> } | null} */
        let backendContext = null;
        /** @type {Error | null} */
        let initializationError = null;

        test.before(async () => {
            try {
                backendContext = await startTestBackend();
            } catch (error) {
                initializationError = error instanceof Error ? error : new Error(String(error));
                return;
            }

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
            await backendContext?.close();
            if (browser) {
                await browser.close();
            }
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("persists notes through the real backend", { timeout: 60000 }, async (t) => {
            if (initializationError) {
                if (/** @type {{ code?: string }} */ (initializationError).code === "ENOENT") {
                    test.skip("Go toolchain is not available for backend integration test.");
                    return;
                }
                throw initializationError;
            }
            assert.ok(browser, "browser must be initialised");
            assert.ok(backendContext, "backend harness must be initialised");

            const userId = "fullstack-sync-user";
            const credential = backendContext.tokenFactory(userId);

            const page = await prepareFrontendPage(browser, PAGE_URL, {
                backendBaseUrl: backendContext.baseUrl,
                llmProxyClassifyUrl: ""
            });
            try {
                await dispatchSignIn(page, credential, userId);
                await waitForSyncManagerUser(page, userId);

                const noteId = "fullstack-sync-note";
                const timestampIso = new Date().toISOString();
                await dispatchNoteCreate(page, {
                    noteId,
                    markdownText: "Persisted via backend harness",
                    timestampIso
                });

                await waitForPendingOperations(page);
                const debugState = await extractSyncDebugState(page);
                const backendToken = debugState?.backendToken?.accessToken;
                assert.ok(backendToken, "expected backend token after sync");

                await waitForBackendNote({
                    backendUrl: backendContext.baseUrl,
                    token: backendToken,
                    noteId,
                    timeoutMs: 5000
                });
            } finally {
                await page.close();
            }
        });
    });
}

/**
 * @param {import('puppeteer').Browser} browser
 * @param {string} backendBaseUrl
 * @returns {Promise<import('puppeteer').Page>}
 */
/**
 * @param {import('puppeteer').Page} page
 * @param {{ noteId: string, markdownText: string, timestampIso: string }} params
 * @returns {Promise<void>}
 */
async function dispatchNoteCreate(page, params) {
    await page.evaluate((eventName, detail) => {
        const root = document.querySelector("body");
        if (!root) {
            return;
        }
        root.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true
        }));
    }, EVENT_NOTE_CREATE, {
        record: {
            noteId: params.noteId,
            markdownText: params.markdownText,
            createdAtIso: params.timestampIso,
            updatedAtIso: params.timestampIso,
            lastActivityIso: params.timestampIso
        },
        storeUpdated: false,
        shouldRender: false
    });
}
