import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import {
    EVENT_AUTH_SIGN_IN,
    EVENT_NOTE_CREATE
} from "../js/constants.js";
import { createBackendHarness } from "./helpers/backendHarness.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

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
        /** @type {{ baseUrl: string, createCredential: (userId: string) => string, close: () => Promise<void> } | null} */
        let backendHarness = null;
        /** @type {Error | null} */
        let initializationError = null;

        test.before(async () => {
            try {
                backendHarness = await createBackendHarness();
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
            if (browser) {
                await browser.close();
            }
            if (backendHarness) {
                await backendHarness.close();
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
            assert.ok(backendHarness, "backend harness must be initialised");

            const userId = "fullstack-sync-user";
            const credential = backendHarness.createCredential(userId);

            const page = await preparePage(browser, backendHarness.baseUrl);
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
                assert.ok(debugState?.backendToken?.accessToken, "expected backend token after sync");

                const verifyResponse = await fetch(`${backendHarness.baseUrl}/notes`, {
                    headers: {
                        Authorization: `Bearer ${debugState.backendToken.accessToken}`
                    }
                });
                assert.equal(verifyResponse.status, 200, "backend snapshot request should succeed");
                const payload = await verifyResponse.json();
                const noteIds = Array.isArray(payload?.notes) ? payload.notes.map((entry) => entry?.payload?.noteId) : [];
                assert.ok(noteIds.includes(noteId), "backend snapshot should include newly persisted note");
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
async function preparePage(browser, backendBaseUrl) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((storageKey) => {
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, "[]");
    }, appConfig.storageKey);
    await page.evaluateOnNewDocument((backendUrl) => {
        window.GRAVITY_CONFIG = {
            backendBaseUrl: backendUrl,
            llmProxyBaseUrl: backendUrl
        };
    }, backendBaseUrl);

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor", { timeout: 5000 });
    return page;
}

/**
 * @param {import('puppeteer').Page} page
 * @param {string} credential
 * @param {string} userId
 * @returns {Promise<void>}
 */
async function dispatchSignIn(page, credential, userId) {
    await page.evaluate((eventName, token, id) => {
        const root = document.querySelector("body");
        if (!root) {
            return;
        }
        root.dispatchEvent(new CustomEvent(eventName, {
            detail: {
                user: {
                    id,
                    email: `${id}@example.com`,
                    name: "Fullstack Integration User",
                    pictureUrl: "https://example.com/avatar.png"
                },
                credential: token
            },
            bubbles: true
        }));
    }, EVENT_AUTH_SIGN_IN, credential, userId);
}

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

/**
 * @param {import('puppeteer').Page} page
 * @param {string} expectedUserId
 * @returns {Promise<void>}
 */
async function waitForSyncManagerUser(page, expectedUserId) {
    await page.waitForFunction((userId) => {
        const root = document.querySelector("[x-data]");
        if (!root) {
            return false;
        }
        const alpineComponent = (() => {
            const legacy = /** @type {{ $data?: Record<string, any> }} */ (/** @type {any} */ (root).__x ?? null);
            if (legacy && typeof legacy.$data === "object") {
                return legacy.$data;
            }
            const alpine = typeof window !== "undefined" ? /** @type {{ $data?: (el: Element) => any }} */ (window.Alpine ?? null) : null;
            if (alpine && typeof alpine.$data === "function") {
                const scoped = alpine.$data(root);
                if (scoped && typeof scoped === "object") {
                    return scoped;
                }
            }
            const stack = /** @type {Array<Record<string, any>>|undefined} */ (/** @type {any} */ (root)._x_dataStack);
            if (Array.isArray(stack) && stack.length > 0) {
                const candidate = stack[stack.length - 1];
                if (candidate && typeof candidate === "object") {
                    return candidate;
                }
            }
            return null;
        })();
        const syncManager = alpineComponent?.syncManager;
        if (!syncManager || typeof syncManager.getDebugState !== "function") {
            return false;
        }
        const debugState = syncManager.getDebugState();
        return debugState?.activeUserId === userId;
    }, {}, expectedUserId);
}

/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function waitForPendingOperations(page) {
    await page.waitForFunction(() => {
        const root = document.querySelector("[x-data]");
        if (!root) {
            return false;
        }
        const alpineComponent = (() => {
            const legacy = /** @type {{ $data?: Record<string, any> }} */ (/** @type {any} */ (root).__x ?? null);
            if (legacy && typeof legacy.$data === "object") {
                return legacy.$data;
            }
            const alpine = typeof window !== "undefined" ? /** @type {{ $data?: (el: Element) => any }} */ (window.Alpine ?? null) : null;
            if (alpine && typeof alpine.$data === "function") {
                const scoped = alpine.$data(root);
                if (scoped && typeof scoped === "object") {
                    return scoped;
                }
            }
            const stack = /** @type {Array<Record<string, any>>|undefined} */ (/** @type {any} */ (root)._x_dataStack);
            if (Array.isArray(stack) && stack.length > 0) {
                const candidate = stack[stack.length - 1];
                if (candidate && typeof candidate === "object") {
                    return candidate;
                }
            }
            return null;
        })();
        const syncManager = alpineComponent?.syncManager;
        if (!syncManager || typeof syncManager.getDebugState !== "function") {
            return false;
        }
        const debugState = syncManager.getDebugState();
        return Array.isArray(debugState?.pendingOperations) && debugState.pendingOperations.length === 0;
    }, { timeout: 5000 });
}

/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<any>}
 */
async function extractSyncDebugState(page) {
    return page.evaluate(() => {
        const root = document.querySelector("[x-data]");
        if (!root) {
            return null;
        }
        const alpineComponent = (() => {
            const legacy = /** @type {{ $data?: Record<string, any> }} */ (/** @type {any} */ (root).__x ?? null);
            if (legacy && typeof legacy.$data === "object") {
                return legacy.$data;
            }
            const alpine = typeof window !== "undefined" ? /** @type {{ $data?: (el: Element) => any }} */ (window.Alpine ?? null) : null;
            if (alpine && typeof alpine.$data === "function") {
                const scoped = alpine.$data(root);
                if (scoped && typeof scoped === "object") {
                    return scoped;
                }
            }
            const stack = /** @type {Array<Record<string, any>>|undefined} */ (/** @type {any} */ (root)._x_dataStack);
            if (Array.isArray(stack) && stack.length > 0) {
                const candidate = stack[stack.length - 1];
                if (candidate && typeof candidate === "object") {
                    return candidate;
                }
            }
            return null;
        })();
        const syncManager = alpineComponent?.syncManager;
        if (!syncManager || typeof syncManager.getDebugState !== "function") {
            return null;
        }
        return syncManager.getDebugState();
    });
}
