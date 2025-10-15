import path from "node:path";
import { fileURLToPath } from "node:url";

import { appConfig } from "../../js/core/config.js";
import { ATTRIBUTE_APP_READY, EVENT_AUTH_SIGN_IN } from "../../js/constants.js";
import { startTestBackend } from "./backendHarness.js";
import { connectSharedBrowser } from "./browserHarness.js";

const APP_READY_SELECTOR = `[${ATTRIBUTE_APP_READY}="true"]`;
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TESTS_DIR, "..", "..");
const DEFAULT_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

/**
 * Prepare a new browser page configured for backend synchronization tests.
 * @param {import('puppeteer').Browser | import('puppeteer').BrowserContext} browser
 * @param {string} pageUrl
 * @param {{ backendBaseUrl: string, llmProxyClassifyUrl?: string }} options
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function prepareFrontendPage(browser, pageUrl, options) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((storageKey) => {
        const initialized = window.sessionStorage.getItem("__gravityTestInitialized") === "true";
        if (!initialized) {
            window.localStorage.clear();
            window.sessionStorage.setItem("__gravityTestInitialized", "true");
        }
        if (!window.localStorage.getItem(storageKey)) {
            window.localStorage.setItem(storageKey, "[]");
        }
    }, appConfig.storageKey);
    await page.evaluateOnNewDocument((config) => {
        window.GRAVITY_CONFIG = config;
    }, {
        backendBaseUrl: options.backendBaseUrl,
        llmProxyClassifyUrl: options.llmProxyClassifyUrl ?? ""
    });

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(APP_READY_SELECTOR);
    await page.waitForSelector("#top-editor .markdown-editor");
    return page;
}

/**
 * Initialize a standard Puppeteer test harness.
 * @returns {Promise<{
 *   browser: import('puppeteer').Browser,
 *   page: import('puppeteer').Page,
 *   backend: { baseUrl: string, tokenFactory: (userId: string) => string, close: () => Promise<void> },
 *   teardown: () => Promise<void>
 * }>}
 */
export async function initializePuppeteerTest(pageUrl = DEFAULT_PAGE_URL) {
    const backend = await startTestBackend();
    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.evaluateOnNewDocument(({ config }) => {
        window.GRAVITY_CONFIG = config;
    }, { config: { backendBaseUrl: backend.baseUrl, llmProxyClassifyUrl: "" } });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(APP_READY_SELECTOR);
    await page.waitForSelector("#top-editor .markdown-editor");

    const teardown = async () => {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        browser.disconnect();
        await backend.close().catch(() => {});
    };

    return { browser, context, page, backend, teardown };
}

/**
 * Dispatch a synthetic sign-in event to Alpine's composition root.
 * @param {import('puppeteer').Page} page
 * @param {string} credential
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function dispatchSignIn(page, credential, userId) {
    if (typeof userId !== "string" || userId.length === 0) {
        throw new Error("dispatchSignIn requires a userId.");
    }
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
 * Wait until the sync manager reports the specified active user.
 * @param {import('puppeteer').Page} page
 * @param {string} expectedUserId
 * @returns {Promise<void>}
 */
export async function waitForSyncManagerUser(page, expectedUserId, timeoutMs) {
    const options = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? { timeout: timeoutMs }
        : undefined;
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
    }, options, expectedUserId);
}

/**
 * Wait for the application ready signal on the provided page.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
export async function waitForAppReady(page) {
    await page.waitForSelector(APP_READY_SELECTOR);
}

/**
 * Reset the application state to a signed-out view and wait for readiness.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
export async function resetToSignedOut(page) {
    await page.evaluate(() => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.setItem("gravityNotesData", "[]");
        window.localStorage.removeItem("gravityAuthState");
        window.location.reload();
    });
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await page.waitForSelector("#top-editor .markdown-editor");
    await page.waitForSelector(".auth-button-host");
}

/**
 * Wait until the sync queue has no pending operations.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
export async function waitForPendingOperations(page) {
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
    });
}

/**
 * Extract the sync manager debug state from the page.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<any>}
 */
export async function extractSyncDebugState(page) {
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

export async function waitForSyncManagerBootstrap(page, timeoutMs) {
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
        return Boolean(syncManager && typeof syncManager.handleSignIn === "function");
    }, typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? { timeout: timeoutMs } : {});
}
