import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appConfig } from "../../js/core/config.js";
import {
    EVENT_AUTH_SIGN_IN,
    EVENT_NOTE_CREATE,
    EVENT_NOTE_UPDATE
} from "../../js/constants.js";
import { startTestBackend } from "./backendHarness.js";
import {
    connectSharedBrowser,
    injectRuntimeConfig,
    waitForAppHydration,
    flushAlpineQueues
} from "./browserHarness.js";

const APP_BOOTSTRAP_SELECTOR = "#top-editor .markdown-editor";
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TESTS_DIR, "..", "..");
const DEFAULT_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const DEFAULT_JWT_ISSUER = "https://accounts.google.com";
const DEFAULT_JWT_AUDIENCE = appConfig.googleClientId;

/**
 * Prepare a new browser page configured for backend synchronization tests.
 * @param {import('puppeteer').Browser | import('puppeteer').BrowserContext} browser
 * @param {string} pageUrl
 * @param {{ backendBaseUrl: string, llmProxyUrl?: string, preserveLocalStorage?: boolean }} options
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function prepareFrontendPage(browser, pageUrl, options) {
    const {
        backendBaseUrl,
        llmProxyUrl = "",
        beforeNavigate,
        preserveLocalStorage = false
    } = options;
    const page = await browser.newPage();
    if (typeof beforeNavigate === "function") {
        await beforeNavigate(page);
    }
    await injectRuntimeConfig(page, {
        development: {
            backendBaseUrl,
            llmProxyUrl
        }
    });
    await page.evaluateOnNewDocument((storageKey, shouldPreserve) => {
        const initialized = window.sessionStorage.getItem("__gravityTestInitialized") === "true";
        if (!initialized) {
            if (!shouldPreserve) {
                window.localStorage.clear();
            }
            window.sessionStorage.setItem("__gravityTestInitialized", "true");
        }
        if (!window.localStorage.getItem(storageKey)) {
            window.localStorage.setItem(storageKey, "[]");
        }
    }, appConfig.storageKey, preserveLocalStorage === true);

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    return page;
}

/**
 * Compose an unsigned Google credential for UI integration tests.
 * @param {{
 *   userId: string,
 *   email?: string|null,
 *   name?: string|null,
 *   pictureUrl?: string|null,
 *   issuedAtSeconds?: number,
 *   expiresInSeconds?: number
 * }} options
 * @returns {string}
 */
export function composeTestCredential(options) {
    const issuedAtSeconds = typeof options.issuedAtSeconds === "number"
        ? options.issuedAtSeconds
        : Math.floor(Date.now() / 1000);
    const expiresInSeconds = typeof options.expiresInSeconds === "number" && Number.isFinite(options.expiresInSeconds)
        ? options.expiresInSeconds
        : 60 * 60;
    const payload = {
        iss: DEFAULT_JWT_ISSUER,
        aud: DEFAULT_JWT_AUDIENCE,
        sub: options.userId,
        email: options.email ?? null,
        name: options.name ?? null,
        picture: options.pictureUrl ?? null,
        iat: issuedAtSeconds,
        exp: issuedAtSeconds + expiresInSeconds,
        jti: generateJwtIdentifier()
    };
    const header = {
        alg: "none",
        typ: "JWT"
    };
    return `${encodeSegment(header)}.${encodeSegment(payload)}.signature`;
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
    await injectRuntimeConfig(page, {
        development: {
            backendBaseUrl: backend.baseUrl,
            llmProxyUrl: ""
        }
    });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);

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
    await waitForAppHydration(page);
    await flushAlpineQueues(page);
    await page.waitForSelector(APP_BOOTSTRAP_SELECTOR);
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

/**
 * Dispatch a note creation event to the application root.
 * @param {import('puppeteer').Page} page
 * @param {{ record: import("../../js/types.d.js").NoteRecord, storeUpdated?: boolean, shouldRender?: boolean }} detail
 * @returns {Promise<void>}
 */
export async function dispatchNoteCreate(page, detail) {
    if (!detail?.record || typeof detail.record.noteId !== "string") {
        throw new Error("dispatchNoteCreate requires a record with noteId.");
    }
    await dispatchNoteEvent(page, EVENT_NOTE_CREATE, detail);
}

/**
 * Dispatch a note update event to the application root.
 * @param {import('puppeteer').Page} page
 * @param {{ noteId: string, record: import("../../js/types.d.js").NoteRecord, storeUpdated?: boolean, shouldRender?: boolean }} detail
 * @returns {Promise<void>}
 */
export async function dispatchNoteUpdate(page, detail) {
    if (!detail || typeof detail.noteId !== "string" || !detail.record) {
        throw new Error("dispatchNoteUpdate requires noteId and record.");
    }
    await dispatchNoteEvent(page, EVENT_NOTE_UPDATE, detail);
}

/**
 * Dispatch a custom event against the application root element.
 * @param {import('puppeteer').Page} page
 * @param {string} eventName
 * @param {Record<string, unknown>} detail
 * @returns {Promise<void>}
 */
async function dispatchNoteEvent(page, eventName, detail) {
    await page.evaluate((name, payload) => {
        const root = document.querySelector("body");
        if (!root) {
            throw new Error("Application root not found.");
        }
        root.dispatchEvent(new CustomEvent(name, {
            detail: payload,
            bubbles: true
        }));
    }, eventName, detail);
}

/**
 * @param {Record<string, unknown>} value
 * @returns {string}
 */
function encodeSegment(value) {
    return Buffer.from(JSON.stringify(value))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/u, "");
}

/**
 * Generate a pseudo-random JWT identifier.
 * @returns {string}
 */
function generateJwtIdentifier() {
    return randomBytes(16).toString("hex");
}
