import { randomBytes } from "node:crypto";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
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
    registerRequestInterceptor,
    waitForAppHydration,
    flushAlpineQueues,
    attachImportAppModule
} from "./browserHarness.js";

const APP_BOOTSTRAP_SELECTOR = "#top-editor .markdown-editor";
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TESTS_DIR, "..", "..");
const DEFAULT_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const DEFAULT_JWT_ISSUER = "https://accounts.google.com";
const DEFAULT_JWT_AUDIENCE = appConfig.googleClientId;
const STATIC_SERVER_HOST = "127.0.0.1";
const CDN_FIXTURES_ROOT = path.resolve(TESTS_DIR, "..", "fixtures", "cdn");
const CDN_MIRRORS = [
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs@3\.13\.5\/dist\/module\.esm\.js$/u,
        filePath: path.join(CDN_FIXTURES_ROOT, "jsdelivr", "npm", "alpinejs@3.13.5", "dist", "module.esm.js"),
        contentType: "application/javascript"
    },
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/marked@12\.0\.2\/marked\.min\.js$/u,
        filePath: path.join(CDN_FIXTURES_ROOT, "jsdelivr", "npm", "marked@12.0.2", "marked.min.js"),
        contentType: "application/javascript"
    },
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@3\.1\.7\/dist\/purify\.min\.js$/u,
        filePath: path.join(CDN_FIXTURES_ROOT, "jsdelivr", "npm", "dompurify@3.1.7", "dist", "purify.min.js"),
        contentType: "application/javascript"
    },
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/easymde@2\.19\.0\/dist\/easymde\.min\.js$/u,
        filePath: path.join(CDN_FIXTURES_ROOT, "jsdelivr", "npm", "easymde@2.19.0", "dist", "easymde.min.js"),
        contentType: "application/javascript"
    },
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/easymde@2\.19\.0\/dist\/easymde\.min\.css$/u,
        filePath: path.join(CDN_FIXTURES_ROOT, "jsdelivr", "npm", "easymde@2.19.0", "dist", "easymde.min.css"),
        contentType: "text/css"
    }
];
const CDN_STUBS = [
    {
        pattern: /^https:\/\/accounts\.google\.com\/gsi\/client$/u,
        contentType: "application/javascript",
        body: "window.google=window.google||{accounts:{id:{initialize(){},prompt(){},renderButton(){}}}};"
    },
    {
        pattern: /^https:\/\/loopaware\.mprlab\.com\/widget\.js(?:\?.*)?$/u,
        contentType: "application/javascript",
        body: ""
    }
];
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

/**
 * Prepare a new browser page configured for backend synchronization tests.
 * @param {import('puppeteer').Browser | import('puppeteer').BrowserContext} browser
 * @param {string} pageUrl
 * @param {{ backendBaseUrl: string, llmProxyUrl?: string, authBaseUrl?: string, preserveLocalStorage?: boolean }} options
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function prepareFrontendPage(browser, pageUrl, options) {
    const {
        backendBaseUrl,
        llmProxyUrl = "",
        authBaseUrl = "",
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
    await injectRuntimeConfig(page, {
        development: {
            backendBaseUrl,
            llmProxyUrl,
            authBaseUrl
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
                    authBaseUrl: config.authBaseUrl
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
        authBaseUrl
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
    await attachImportAppModule(page);
    const baseRuntimeOverrides = {
        development: {
            backendBaseUrl: backend.baseUrl,
            llmProxyUrl: "",
            authBaseUrl: ""
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
 * Attach a backend session cookie to the provided page using the shared backend harness.
 * @param {import("puppeteer").Page} page
 * @param {{ baseUrl: string, cookieName: string, createSessionToken: (userId: string, expiresInSeconds?: number) => string }} backend
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function attachBackendSessionCookie(page, backend, userId) {
    if (!backend || typeof backend.baseUrl !== "string") {
        throw new Error("attachBackendSessionCookie requires a backend handle.");
    }
    const sessionToken = backend.createSessionToken(userId);
    try {
        await page.setCookie({
            name: backend.cookieName,
            value: sessionToken,
            url: backend.baseUrl
        });
    } catch {
        // ignore failures; some browsers disallow setting cookies for file:// origins in automation
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
        return Boolean(alpineComponent?.tauthSession);
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

async function installCdnMirrors(page) {
    await registerRequestInterceptor(page, (request) => {
        const url = request.url();
        const mirror = CDN_MIRRORS.find((entry) => entry.pattern.test(url));
        if (mirror) {
            const headers = { "Access-Control-Allow-Origin": "*" };
            fs.readFile(mirror.filePath)
                .then((body) => request.respond({ status: 200, contentType: mirror.contentType, body, headers }).catch(() => {}))
                .catch((error) => {
                    if (process.env.GRAVITY_TEST_STREAM_LOGS === "1") {
                        // eslint-disable-next-line no-console
                        console.error(`[cdn mirror] missing ${mirror.filePath}: ${error?.message ?? error}`);
                    }
                    request.respond({ status: 404, contentType: mirror.contentType, body: "", headers }).catch(() => {});
                });
            return true;
        }
        const stub = CDN_STUBS.find((entry) => entry.pattern.test(url));
        if (stub) {
            request.respond({ status: 200, contentType: stub.contentType, body: stub.body, headers: { "Access-Control-Allow-Origin": "*" } }).catch(() => {});
            return true;
        }
        return false;
    });
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
