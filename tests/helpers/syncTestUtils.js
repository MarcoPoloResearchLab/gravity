import { appConfig } from "../../js/core/config.js";
import { ATTRIBUTE_APP_READY, EVENT_AUTH_SIGN_IN } from "../../js/constants.js";

const APP_READY_SELECTOR = `[${ATTRIBUTE_APP_READY}="true"]`;

/**
 * Prepare a new browser page configured for backend synchronization tests.
 * @param {import('puppeteer').Browser} browser
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
