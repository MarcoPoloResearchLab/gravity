// @ts-check

import { randomBytes } from "node:crypto";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createAppConfig } from "../../js/core/config.js?build=2026-01-01T22:43:21Z";
import { ENVIRONMENT_DEVELOPMENT } from "../../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";
import { DEVELOPMENT_ENVIRONMENT_CONFIG } from "../../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";
import {
    EVENT_MPR_AUTH_AUTHENTICATED,
    EVENT_MPR_AUTH_ERROR,
    EVENT_NOTE_CREATE,
    EVENT_NOTE_UPDATE
} from "../../js/constants.js";
import { startTestBackend } from "./backendHarness.js";
import {
    connectSharedBrowser,
    installCdnMirrors,
    injectRuntimeConfig,
    registerRequestInterceptor,
    injectTAuthStub,
    waitForAppHydration,
    flushAlpineQueues,
    attachImportAppModule
} from "./browserHarness.js";

const APP_BOOTSTRAP_SELECTOR = "#top-editor .markdown-editor";
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TESTS_DIR, "..", "..");
const DEFAULT_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const DEFAULT_JWT_ISSUER = "https://accounts.google.com";
const appConfig = createAppConfig({ environment: ENVIRONMENT_DEVELOPMENT });
const DEFAULT_JWT_AUDIENCE = appConfig.googleClientId;
const EMPTY_STRING = "";
const DEVELOPMENT_AUTH_BASE_URL = DEVELOPMENT_ENVIRONMENT_CONFIG.authBaseUrl;
const DEFAULT_AUTH_TENANT_ID = DEVELOPMENT_ENVIRONMENT_CONFIG.authTenantId || "gravity";
const TAUTH_PROFILE_STORAGE_KEY = "__gravityTestAuthProfile";
const STATIC_SERVER_HOST = "127.0.0.1";
let staticServerOriginPromise = null;
let staticServerHandle = null;
const MIME_TYPES = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "application/javascript; charset=utf-8"],
    [".mjs", "application/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".ico", "image/x-icon"]
]);
const STORAGE_USER_PREFIX = (() => {
    const configured = typeof appConfig.storageKeyUserPrefix === "string"
        ? appConfig.storageKeyUserPrefix.trim()
        : "";
    const prefix = configured.length > 0 ? configured : appConfig.storageKey;
    return prefix.endsWith(":") ? prefix : `${prefix}:`;
})();

/**
 * Build the user-scoped storage key used by GravityStore.
 * @param {string} userId
 * @returns {string}
 */
export function buildUserStorageKey(userId) {
    if (typeof userId !== "string" || userId.trim().length === 0) {
        throw new Error("buildUserStorageKey requires a userId.");
    }
    const encoded = encodeURIComponent(userId.trim());
    return `${STORAGE_USER_PREFIX}${encoded}`;
}

/**
 * Prepare a new browser page configured for backend synchronization tests.
 * @param {import('puppeteer').Browser | import('puppeteer').BrowserContext} browser
 * @param {string} pageUrl
 * @param {{ backendBaseUrl: string, llmProxyUrl?: string, authBaseUrl?: string, authTenantId?: string, preserveLocalStorage?: boolean }} options
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function prepareFrontendPage(browser, pageUrl, options) {
    const {
        backendBaseUrl,
        llmProxyUrl = EMPTY_STRING,
        authBaseUrl = DEVELOPMENT_AUTH_BASE_URL,
        authTenantId = DEFAULT_AUTH_TENANT_ID,
        beforeNavigate,
        preserveLocalStorage = false
    } = options;
    const page = await browser.newPage();
    if (process.env.GRAVITY_TEST_STREAM_LOGS === "1") {
        page.on("console", (message) => {
            const type = message.type?.().toUpperCase?.() ?? "LOG";
            // eslint-disable-next-line no-console
            console.log(`[page ${type}] ${message.text?.() ?? message}`);
        });
        page.on("pageerror", (error) => {
            // eslint-disable-next-line no-console
            console.error(`[page error] ${error?.message ?? error}`);
        });
        page.on("requestfailed", (request) => {
            // eslint-disable-next-line no-console
            console.error(`[request failed] ${request.url?.() ?? "unknown"}: ${request.failure?.()?.errorText ?? "unknown"}`);
        });
        page.on("request", (request) => {
            try {
                const url = new URL(request.url?.() ?? "");
                if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
                    // eslint-disable-next-line no-console
                    console.log(`[request] ${request.method?.() ?? "GET"} ${request.url?.()}`);
                }
            } catch {
                // ignore malformed URLs
            }
        });
    }
    await installCdnMirrors(page);
    if (typeof beforeNavigate === "function") {
        await beforeNavigate(page);
    }
    await attachImportAppModule(page);
    await injectTAuthStub(page);
    await injectRuntimeConfig(page, {
        development: {
            backendBaseUrl,
            llmProxyUrl,
            authBaseUrl,
            authTenantId
        }
    });
    await page.evaluateOnNewDocument((config) => {
        const targetPattern = /\/data\/runtime\.config\.(development|production)\.json$/;
        const originalFetch = window.fetch;
        window.fetch = async (input, init = {}) => {
            const requestUrl = typeof input === "string"
                ? input
                : typeof input?.url === "string"
                    ? input.url
                    : "";
            if (typeof requestUrl === "string" && targetPattern.test(requestUrl)) {
                const payload = {
                    environment: config.environment ?? "development",
                    backendBaseUrl: config.backendBaseUrl,
                    llmProxyUrl: config.llmProxyUrl,
                    authBaseUrl: config.authBaseUrl,
                    authTenantId: config.authTenantId
                };
                return new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            return originalFetch.call(window, input, init);
        };
    }, {
        environment: "development",
        backendBaseUrl,
        llmProxyUrl,
        authBaseUrl,
        authTenantId
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
    const resolvedUrl = await resolvePageUrl(pageUrl);
    await page.goto(resolvedUrl, { waitUntil: "domcontentloaded" });
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
 * @param {string} [pageUrl]
 * @param {{ runtimeConfig?: Record<string, any>, beforeNavigate?: (page: import("puppeteer").Page) => (Promise<void>|void) }} [setupOptions]
 * @returns {Promise<{
 *   browser: import('puppeteer').Browser,
 *   page: import('puppeteer').Page,
 *   backend: { baseUrl: string, tokenFactory: (userId: string) => string, createSessionToken: (userId: string) => string, cookieName: string, close: () => Promise<void> },
 *   teardown: () => Promise<void>
 * }>}
 */
export async function initializePuppeteerTest(pageUrl = DEFAULT_PAGE_URL, setupOptions = {}) {
    const backend = await startTestBackend();
    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await installCdnMirrors(page);
    await attachImportAppModule(page);
    await injectTAuthStub(page);
    const baseRuntimeOverrides = {
        development: {
            backendBaseUrl: backend.baseUrl,
            llmProxyUrl: EMPTY_STRING,
            authBaseUrl: DEVELOPMENT_AUTH_BASE_URL,
            authTenantId: DEFAULT_AUTH_TENANT_ID
        }
    };
    const mergedRuntimeOverrides = mergeRuntimeOverrides(baseRuntimeOverrides, setupOptions.runtimeConfig);
    await injectRuntimeConfig(page, mergedRuntimeOverrides);
    if (typeof setupOptions.beforeNavigate === "function") {
        await setupOptions.beforeNavigate(page);
    }
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

function mergeRuntimeOverrides(base, overrides) {
    const merged = {};
    if (base && typeof base === "object") {
        for (const [environment, value] of Object.entries(base)) {
            if (value && typeof value === "object") {
                merged[environment] = { ...value };
            } else {
                merged[environment] = value;
            }
        }
    }
    if (!overrides || typeof overrides !== "object") {
        return merged;
    }
    for (const [environment, value] of Object.entries(overrides)) {
        if (value && typeof value === "object") {
            const existing = merged[environment] && typeof merged[environment] === "object"
                ? merged[environment]
                : {};
            merged[environment] = { ...existing, ...value };
        } else {
            merged[environment] = value;
        }
    }
    return merged;
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
    await waitForMprUiReady(page);
    await waitForUserMenuReady(page);
    await page.evaluate((eventName, token, id, storageKey) => {
        void token;
        const fullName = "Fullstack Integration User";
        const profile = {
            user_id: id,
            user_email: `${id}@example.com`,
            display: fullName,
            name: fullName,
            given_name: "Fullstack",
            avatar_url: "https://example.com/avatar.png"
        };
        if (typeof window !== "undefined") {
            window.__tauthStubProfile = profile;
            try {
                window.sessionStorage?.setItem(storageKey, JSON.stringify(profile));
            } catch {
                // ignore storage failures
            }
        }
        const targets = [];
        const body = document.body;
        if (body && typeof body.dispatchEvent === "function") {
            targets.push(body);
        }
        if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
            if (!targets.includes(document)) {
                targets.push(document);
            }
        }
        if (targets.length === 0) {
            return;
        }
        const event = new CustomEvent(eventName, {
            detail: { profile },
            bubbles: true
        });
        targets.forEach((target) => {
            target.dispatchEvent(event);
        });
    }, EVENT_MPR_AUTH_AUTHENTICATED, credential, userId, TAUTH_PROFILE_STORAGE_KEY);
}

/**
 * Sign in a test user by attaching a backend cookie and dispatching the auth event.
 * @param {import('puppeteer').Page} page
 * @param {{ baseUrl: string, cookieName: string, tokenFactory: (userId: string) => string, createSessionToken: (userId: string, expiresInSeconds?: number) => string }} backend
 * @param {string} userId
 * @param {{ waitForAppShell?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function signInTestUser(page, backend, userId, options = {}) {
    if (!backend || typeof backend.tokenFactory !== "function") {
        throw new Error("signInTestUser requires a backend handle.");
    }
    const shouldWaitForSyncManager = options.waitForSyncManager !== false;
    const syncTimeoutMs = typeof options.syncTimeoutMs === "number" && Number.isFinite(options.syncTimeoutMs)
        ? options.syncTimeoutMs
        : undefined;
    await waitForAppReady(page);
    await waitForMprUiReady(page);
    await attachBackendSessionCookie(page, backend, userId);
    const credential = backend.tokenFactory(userId);
    await dispatchSignIn(page, credential, userId);
    if (shouldWaitForSyncManager) {
        await waitForSyncManagerUser(page, userId, syncTimeoutMs);
    }
    if (options.waitForAppShell !== false) {
        await page.waitForSelector("[data-test=\"app-shell\"]:not([hidden])");
    }
}

/**
 * Wait for the mpr-ui custom elements to be defined.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
async function waitForMprUiReady(page) {
    await page.waitForFunction(() => {
        if (typeof window === "undefined") {
            return false;
        }
        const registry = window.customElements;
        if (!registry || typeof registry.get !== "function") {
            return false;
        }
        return Boolean(registry.get("mpr-user") && registry.get("mpr-login-button"));
    }, { timeout: 10000 });
}

/**
 * Wait for the mpr-user element to finish its initial render.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
async function waitForUserMenuReady(page) {
    await page.waitForFunction(() => {
        const menu = document.querySelector("mpr-user");
        return Boolean(menu && menu.hasAttribute("data-mpr-user-status"));
    }, { timeout: 10000 });
}

/**
 * Exchange a Google credential through the TAuth helper.
 * @param {import('puppeteer').Page} page
 * @param {string} credential
 * @returns {Promise<void>}
 */
export async function exchangeTAuthCredential(page, credential) {
    if (typeof credential !== "string" || credential.length === 0) {
        throw new Error("exchangeTAuthCredential requires a credential.");
    }
    try {
        await page.evaluate(async (token) => {
            if (typeof window.requestNonce !== "function") {
                throw new Error("requestNonce helper unavailable");
            }
            if (typeof window.exchangeGoogleCredential !== "function") {
                throw new Error("exchangeGoogleCredential helper unavailable");
            }
            const nonceToken = await window.requestNonce();
            await window.exchangeGoogleCredential({ credential: token, nonceToken });
        }, credential);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await page.evaluate((eventName, payload) => {
            const detail = { code: payload };
            const event = new CustomEvent(eventName, { detail, bubbles: true });
            const targets = [];
            if (document?.body) {
                targets.push(document.body);
            }
            if (typeof document !== "undefined") {
                targets.push(document);
            }
            targets.forEach((target) => target.dispatchEvent(event));
        }, EVENT_MPR_AUTH_ERROR, message);
        throw error;
    }
}

/**
 * Attach a backend session cookie to the provided page using the shared backend harness.
 * @param {import("puppeteer").Page} page
 * @param {{ baseUrl: string, cookieName: string, createSessionToken: (userId: string, expiresInSeconds?: number) => string }} backend
 * @param {string} userId
 * @returns {Promise<string>}
 */
export async function attachBackendSessionCookie(page, backend, userId) {
    if (!backend || typeof backend.baseUrl !== "string") {
        throw new Error("attachBackendSessionCookie requires a backend handle.");
    }
    const sessionToken = backend.createSessionToken(userId);
    const cookieName = backend.cookieName;
    let cookieAttached = false;
    try {
        await page.setCookie({
            name: cookieName,
            value: sessionToken,
            url: backend.baseUrl
        });
        const cookies = await page.cookies(backend.baseUrl);
        cookieAttached = cookies.some((cookie) => cookie.name === cookieName && cookie.value === sessionToken);
    } catch {
        cookieAttached = false;
        // ignore failures; some browsers disallow setting cookies for file:// origins in automation
    }
    const pageUrl = page.url();
    const shouldForceCookieHeader = typeof pageUrl === "string" && pageUrl.startsWith("file:");
    if (!cookieAttached || shouldForceCookieHeader) {
        // Ensure session cookies are present for file:// origins.
        const dispose = await registerRequestInterceptor(page, (request) => {
            const url = request.url();
            if (!url.startsWith(backend.baseUrl)) {
                return false;
            }
            const headers = request.headers();
            const existingCookie = headers.cookie ?? "";
            const filtered = existingCookie
                .split(";")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0 && !entry.startsWith(`${cookieName}=`))
                .join("; ");
            const cookieHeader = filtered.length > 0
                ? `${filtered}; ${cookieName}=${sessionToken}`
                : `${cookieName}=${sessionToken}`;
            request.continue({
                headers: {
                    ...headers,
                    cookie: cookieHeader
                }
            }).catch(() => {});
            return true;
        });
        page.once("close", () => {
            dispose();
        });
    }
    return sessionToken;
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
 * Wait until the TAuth session bridge has been initialised.
 * @param {import('puppeteer').Page} page
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export async function waitForTAuthSession(page, timeoutMs) {
    const options = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? { timeout: timeoutMs }
        : undefined;
    await page.waitForFunction(() => {
        const harnessEvents = window.__tauthHarnessEvents;
        if (harnessEvents && typeof harnessEvents.initCount === "number" && harnessEvents.initCount >= 1) {
            return true;
        }
        const stubOptions = window.__tauthStubOptions;
        return Boolean(stubOptions && typeof stubOptions === "object");
    }, options);
}

/**
 * Wait until the sync manager instance has been initialised.
 * @param {import('puppeteer').Page} page
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export async function waitForSyncManagerReady(page, timeoutMs) {
    const options = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? { timeout: timeoutMs }
        : undefined;
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
        return Boolean(alpineComponent?.syncManager);
    }, options);
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
        window.location.reload();
    });
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await page.waitForSelector("[data-test=\"landing-login\"]");
    await page.waitForFunction(() => {
        const landing = document.querySelector("[data-test=\"landing\"]");
        const shell = document.querySelector("[data-test=\"app-shell\"]");
        if (!landing || !shell) {
            return false;
        }
        return !landing.hasAttribute("hidden") && shell.hasAttribute("hidden");
    });
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
 * Seed notes in the UI by dispatching note-create events.
 * @param {import('puppeteer').Page} page
 * @param {import("../../js/types.d.js").NoteRecord[]} records
 * @returns {Promise<void>}
 */
export async function seedNotes(page, records, userId) {
    if (!Array.isArray(records) || records.length === 0) {
        return;
    }
    const storageKey = typeof userId === "string" && userId.trim().length > 0
        ? buildUserStorageKey(userId)
        : null;
    const payload = JSON.stringify(records);
    await page.evaluate((key, serialized) => {
        if (key) {
            window.localStorage.setItem(key, serialized);
        }
        const root = document.querySelector("[x-data]");
        const alpineData = (() => {
            if (!root) {
                return null;
            }
            const alpine = window.Alpine;
            if (alpine && typeof alpine.$data === "function") {
                return alpine.$data(root);
            }
            return root.__x?.$data ?? null;
        })();
        if (!alpineData || typeof alpineData.initializeNotes !== "function") {
            throw new Error("seedNotes missing initializeNotes");
        }
        alpineData.initializeNotes();
    }, storageKey, payload);
    await page.waitForFunction((count) => {
        return document.querySelectorAll(".markdown-block[data-note-id]").length >= count;
    }, {}, records.length);
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

async function resolvePageUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "file:") {
            return parsed.toString();
        }
        const origin = await ensureStaticServerOrigin();
        const absolutePath = fileURLToPath(parsed);
        const relativePath = path.relative(PROJECT_ROOT, absolutePath);
        if (relativePath.startsWith("..")) {
            throw new Error(`Cannot serve path outside project root: ${absolutePath}`);
        }
        const normalized = relativePath.split(path.sep).join("/");
        return `${origin}/${normalized}`;
    } catch {
        return rawUrl;
    }
}

async function ensureStaticServerOrigin() {
    if (staticServerOriginPromise) {
        return staticServerOriginPromise;
    }
    staticServerOriginPromise = new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                await handleStaticRequest(req?.url ?? "/", res);
            } catch {
                res.statusCode = 500;
                res.end("Internal Server Error");
            }
        });
        server.on("error", (error) => {
            server.close().catch(() => {});
            reject(error);
        });
        server.listen(0, STATIC_SERVER_HOST, () => {
            server.off("error", reject);
            staticServerHandle = server;
            const address = server.address();
            if (!address || typeof address !== "object") {
                reject(new Error("Static server missing address"));
                return;
            }
            const origin = `http://${STATIC_SERVER_HOST}:${address.port}`;
            if (process.env.GRAVITY_TEST_STREAM_LOGS === "1") {
                // eslint-disable-next-line no-console
                console.log(`[static server] listening on ${origin}`);
            }
            resolve(origin);
        });
        server.unref();
    }).catch((error) => {
        staticServerOriginPromise = null;
        throw error;
    });
    return staticServerOriginPromise;
}

async function handleStaticRequest(requestUrl, res) {
    const url = new URL(requestUrl, "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) {
        pathname += "index.html";
    }
    const absolutePath = path.resolve(PROJECT_ROOT, pathname.replace(/^\/+/u, ""));
    if (!absolutePath.startsWith(PROJECT_ROOT)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
    }
    if (process.env.GRAVITY_TEST_STREAM_LOGS === "1") {
        // eslint-disable-next-line no-console
        console.log(`[static server] request ${pathname}`);
    }
    let filePath = absolutePath;
    let stats;
    try {
        stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            filePath = path.join(filePath, "index.html");
            stats = await fs.stat(filePath);
        }
    } catch {
        res.statusCode = 404;
        res.end("Not Found");
        return;
    }
    try {
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader("Content-Type", MIME_TYPES.get(ext) ?? "application/octet-stream");
        res.end(data);
    } catch {
        res.statusCode = 500;
        res.end("Internal Server Error");
    }
}
