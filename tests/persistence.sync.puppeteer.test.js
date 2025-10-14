import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_NOTE_CREATE } from "../js/constants.js";
import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./helpers/puppeteerEnvironment.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    waitForPendingOperations,
    extractSyncDebugState
} from "./helpers/syncTestUtils.js";
import { startTestBackend, waitForBackendNote } from "./helpers/backendHarness.js";

const SANDBOX = await ensurePuppeteerSandbox();
let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const TEST_USER_ID = "sync-user";
const NOTE_IDENTIFIER = "sync-note";
const NOTE_MARKDOWN = "Backend persisted note";
const SYNC_POLL_TIMEOUT_MS = 10000;

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

    test.describe("Backend persistence", () => {
        /** @type {import('puppeteer').Browser | null} */
        let browser = null;
        /** @type {{ baseUrl: string, tokenFactory: (userId: string) => string, close: () => Promise<void> }|null} */
        let backendContext = null;

        test.before(async () => {
            backendContext = await startTestBackend();
            const launchOptions = createSandboxedLaunchOptions(SANDBOX);
            browser = await puppeteerModule.launch(launchOptions);
        });

        test.after(async () => {
            if (browser) {
                await browser.close();
            }
            await backendContext?.close();
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("notes persist across clients via backend sync", async () => {
            if (!browser) {
                throw new Error("browser not initialised");
            }
            if (!backendContext) {
                throw new Error("backend harness not initialised");
            }

            const credentialA = backendContext.tokenFactory(TEST_USER_ID);
            const pageA = await prepareFrontendPage(browser, PAGE_URL, {
                backendBaseUrl: backendContext.baseUrl,
                llmProxyClassifyUrl: ""
            });

            /** @type {import('puppeteer').Page|null} */
            let pageB = null;
            /** @type {import('puppeteer').BrowserContext|null} */
            let contextB = null;

            try {
                await dispatchSignIn(pageA, credentialA, TEST_USER_ID);
                await waitForSyncManagerUser(pageA, TEST_USER_ID, 5000);
                await waitForPendingOperations(pageA);

                await dispatchNoteCreate(pageA, {
                    noteId: NOTE_IDENTIFIER,
                    markdownText: NOTE_MARKDOWN,
                    timestampIso: new Date().toISOString()
                });
                await waitForPendingOperations(pageA);

                const debugState = await extractSyncDebugState(pageA);
                const backendToken = debugState?.backendToken?.accessToken;
                assert.ok(backendToken, "backend token should be available after sign-in");

                await waitForBackendNote({
                    backendUrl: backendContext.baseUrl,
                    token: backendToken,
                    noteId: NOTE_IDENTIFIER,
                    timeoutMs: SYNC_POLL_TIMEOUT_MS
                });

                contextB = await browser.createBrowserContext();
                const credentialB = backendContext.tokenFactory(TEST_USER_ID);
                pageB = await prepareFrontendPage(contextB, PAGE_URL, {
                    backendBaseUrl: backendContext.baseUrl,
                    llmProxyClassifyUrl: ""
                });

                await dispatchSignIn(pageB, credentialB, TEST_USER_ID);
                await waitForSyncManagerUser(pageB, TEST_USER_ID, 5000);
                await waitForPendingOperations(pageB);
                await pageB.waitForSelector(".auth-avatar:not([hidden])");
                await pageB.waitForSelector(`.markdown-block[data-note-id="${NOTE_IDENTIFIER}"]`);

                const renderedMarkdown = await pageB.$eval(
                    `.markdown-block[data-note-id="${NOTE_IDENTIFIER}"] .markdown-content`,
                    (element) => element.textContent?.trim() ?? ""
                );
                assert.match(renderedMarkdown, /Backend persisted note/);
            } finally {
                await pageA.close().catch(() => {});
                await pageB?.close().catch(() => {});
                await contextB?.close().catch(() => {});
            }
        });
    });
}

async function dispatchNoteCreate(page, { noteId, markdownText, timestampIso }) {
    await page.evaluate((eventName, detail) => {
        const root = document.querySelector("body");
        if (!root) return;
        root.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true
        }));
    }, EVENT_NOTE_CREATE, {
        record: {
            noteId,
            markdownText,
            createdAtIso: timestampIso,
            updatedAtIso: timestampIso,
            lastActivityIso: timestampIso
        },
        storeUpdated: false,
        shouldRender: false
    });
}
