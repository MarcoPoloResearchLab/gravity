// @ts-check

import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { APP_BUILD_ID } from "../../js/constants.js";
import { DEVELOPMENT_ENVIRONMENT_CONFIG } from "../../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";

import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./puppeteerEnvironment.js";
import { readRuntimeContext } from "./runtimeContext.js";

let sharedLaunchContext = null;
const CURRENT_FILE = fileURLToPath(import.meta.url);
const HELPERS_ROOT = path.dirname(CURRENT_FILE);
const TESTS_ROOT = path.resolve(HELPERS_ROOT, "..");
const REPO_ROOT = path.resolve(TESTS_ROOT, "..", "..");
const CDN_FIXTURES_ROOT = path.resolve(TESTS_ROOT, "fixtures", "cdn");
const CONFIG_ROUTE_PATTERN = /\/data\/runtime\.config\.(development|production)\.json$/u;
const EMPTY_STRING = "";
const CDN_RESPONSE_HEADERS = Object.freeze({ "Access-Control-Allow-Origin": "*" });
const CDN_LOG_PREFIX = "[cdn mirror] missing";
const GOOGLE_GSI_STUB = "window.google=window.google||{accounts:{id:{initialize(){},prompt(){},renderButton(){}}}};";
const AVATAR_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
const AVATAR_PNG_BYTES = Buffer.from(AVATAR_PNG_BASE64, "base64");
const DEFAULT_TEST_TENANT_ID = "gravity";
const DEFAULT_GOOGLE_CLIENT_ID = "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com";
const CDN_MIRRORS = Object.freeze([
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
    },
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/MarcoPoloResearchLab\/mpr-ui@latest\/mpr-ui\.js$/u,
        filePath: path.join(REPO_ROOT, "tools", "mpr-ui", "mpr-ui.js"),
        contentType: "application/javascript"
    },
    {
        pattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/MarcoPoloResearchLab\/mpr-ui@latest\/mpr-ui\.css$/u,
        filePath: path.join(REPO_ROOT, "tools", "mpr-ui", "mpr-ui.css"),
        contentType: "text/css"
    }
]);
const CDN_STUBS = Object.freeze([
    {
        pattern: /^https:\/\/accounts\.google\.com\/gsi\/client$/u,
        contentType: "application/javascript",
        body: GOOGLE_GSI_STUB
    },
    {
        pattern: /^https:\/\/loopaware\.mprlab\.com\/widget\.js(?:\?.*)?$/u,
        contentType: "application/javascript",
        body: EMPTY_STRING
    },
    {
        pattern: /^https:\/\/example\.com\/avatar\.png$/u,
        contentType: "image/png",
        body: AVATAR_PNG_BYTES
    }
]);
const RUNTIME_CONFIG_KEYS = Object.freeze({
    ENVIRONMENT: "environment",
    BACKEND_BASE_URL: "backendBaseUrl",
    LLM_PROXY_URL: "llmProxyUrl",
    AUTH_BASE_URL: "authBaseUrl",
    TAUTH_SCRIPT_URL: "tauthScriptUrl",
    MPR_UI_SCRIPT_URL: "mprUiScriptUrl",
    AUTH_TENANT_ID: "authTenantId",
    GOOGLE_CLIENT_ID: "googleClientId"
});
const TEST_RUNTIME_CONFIG = Object.freeze({
    backendBaseUrl: DEVELOPMENT_ENVIRONMENT_CONFIG.backendBaseUrl,
    llmProxyUrl: EMPTY_STRING,
    authBaseUrl: DEVELOPMENT_ENVIRONMENT_CONFIG.authBaseUrl,
    tauthScriptUrl: DEVELOPMENT_ENVIRONMENT_CONFIG.tauthScriptUrl,
    mprUiScriptUrl: DEVELOPMENT_ENVIRONMENT_CONFIG.mprUiScriptUrl,
    authTenantId: DEFAULT_TEST_TENANT_ID,
    googleClientId: DEFAULT_GOOGLE_CLIENT_ID
});
const CDN_INTERCEPTOR_SYMBOL = Symbol("gravityCdnInterceptor");
const RUNTIME_CONFIG_SYMBOL = Symbol("gravityRuntimeConfigOverrides");
const RUNTIME_CONFIG_HANDLER_SYMBOL = Symbol("gravityRuntimeConfigHandler");
const REQUEST_HANDLERS_SYMBOL = Symbol("gravityRequestHandlers");
const REQUEST_INTERCEPTION_READY_SYMBOL = Symbol("gravityRequestInterceptionReady");
const REQUEST_HANDLER_REGISTRY_SYMBOL = Symbol("gravityRequestHandlerRegistry");
const TAUTH_STUB_NONCE = "tauth-stub-nonce";
const TAUTH_SCRIPT_PATTERN = /\/tauth\.js(?:\?.*)?$/u;
const TAUTH_STUB_KEYS = Object.freeze({
    OPTIONS: "__tauthStubOptions",
    PROFILE: "__tauthStubProfile",
    INIT: "initAuthClient",
    REQUEST_NONCE: "requestNonce",
    EXCHANGE_CREDENTIAL: "exchangeGoogleCredential",
    LOGOUT: "logout",
    GET_CURRENT_USER: "getCurrentUser",
    ON_AUTHENTICATED: "onAuthenticated",
    ON_UNAUTHENTICATED: "onUnauthenticated"
});
const TAUTH_STUB_SCRIPT = [
    "(() => {",
    `  const OPTIONS_KEY = "${TAUTH_STUB_KEYS.OPTIONS}";`,
    `  const PROFILE_KEY = "${TAUTH_STUB_KEYS.PROFILE}";`,
    "  const PROFILE_STORAGE_KEY = \"__gravityTestAuthProfile\";",
    `  const NONCE = "${TAUTH_STUB_NONCE}";`,
    "  const win = window;",
    "  const loadStoredProfile = () => {",
    "    try {",
    "      const raw = win.sessionStorage?.getItem(PROFILE_STORAGE_KEY);",
    "      if (!raw) return null;",
    "      return JSON.parse(raw);",
    "    } catch {",
    "      return null;",
    "    }",
    "  };",
    "  const persistProfile = (profile) => {",
    "    try {",
    "      if (!win.sessionStorage) return;",
    "      if (!profile) {",
    "        win.sessionStorage.removeItem(PROFILE_STORAGE_KEY);",
    "        return;",
    "      }",
    "      win.sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));",
    "    } catch {",
    "      // ignore storage errors",
    "    }",
    "  };",
    "  const storedProfile = loadStoredProfile();",
    "  if (storedProfile) {",
    "    win[PROFILE_KEY] = storedProfile;",
    "  }",
    "  win.initAuthClient = async (options) => {",
    "    win[OPTIONS_KEY] = options ?? null;",
    "    const profile = win[PROFILE_KEY] ?? null;",
    "    if (profile) {",
    "      persistProfile(profile);",
    "    }",
    "    const authenticated = profile && options && typeof options.onAuthenticated === \"function\" ? options.onAuthenticated : null;",
    "    const handler = options && typeof options.onUnauthenticated === \"function\" ? options.onUnauthenticated : null;",
    "    if (authenticated) {",
    "      authenticated(profile);",
    "      return;",
    "    }",
    "    if (handler) {",
    "      handler();",
    "    }",
    "  };",
    "  win.getCurrentUser = async () => win[PROFILE_KEY] ?? null;",
    "  win.requestNonce = async () => NONCE;",
    "  win.exchangeGoogleCredential = async () => {};",
    "  win.logout = async () => {",
    "    win[PROFILE_KEY] = null;",
    "    persistProfile(null);",
    "    const options = win[OPTIONS_KEY];",
    "    const handler = options && typeof options.onUnauthenticated === \"function\" ? options.onUnauthenticated : null;",
    "    if (handler) {",
    "      handler();",
    "    }",
    "  };",
    "})();"
].join("\n");

/**
 * Launch the shared Puppeteer browser for the entire test run.
 * @returns {Promise<{ browser: import("puppeteer").Browser, sandbox: Awaited<ReturnType<typeof ensurePuppeteerSandbox>>, wsEndpoint: string }>}
 */
export async function launchSharedBrowser() {
    if (sharedLaunchContext) {
        return sharedLaunchContext;
    }
    const sandbox = await ensurePuppeteerSandbox();
    const puppeteer = await import("puppeteer").then((module) => module.default);
    const browser = await puppeteer.launch(createSandboxedLaunchOptions(sandbox));
    const wsEndpoint = browser.wsEndpoint();
    sharedLaunchContext = { browser, sandbox, wsEndpoint };
    return sharedLaunchContext;
}

/**
 * Close the shared Puppeteer browser and clean associated sandbox directories.
 * @returns {Promise<void>}
 */
export async function closeSharedBrowser() {
    if (!sharedLaunchContext) {
        return;
    }
    const { browser, sandbox } = sharedLaunchContext;
    sharedLaunchContext = null;
    await browser.close().catch(() => {});
    await cleanupPuppeteerSandbox(sandbox);
}

/**
 * Resolve the shared browser websocket endpoint from the environment.
 * @returns {string}
 */
export function getSharedBrowserEndpoint() {
    const context = readRuntimeContext();
    const endpoint = context?.browser?.wsEndpoint;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
        throw new Error("Shared browser endpoint not provided. Ensure run-tests launched the shared browser.");
    }
    return endpoint;
}

/**
 * Connect to the shared Puppeteer browser.
 * @returns {Promise<import("puppeteer").Browser>}
 */
export async function connectSharedBrowser() {
    const endpoint = getSharedBrowserEndpoint();
    const puppeteer = await import("puppeteer").then((module) => module.default);
    return puppeteer.connect({ browserWSEndpoint: endpoint });
}

/**
 * Create an isolated page scoped to its own incognito browser context.
 * @returns {Promise<{ browser: import("puppeteer").Browser, context: import("puppeteer").BrowserContext, page: import("puppeteer").Page, teardown: () => Promise<void> }>}
 */
export async function createSharedPage(runtimeConfigOverrides = {}) {
    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
        window.__gravityForceLocalStorage = true;
    });
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
    }
    await installCdnMirrors(page);
    await attachImportAppModule(page);
    await injectTAuthStub(page);
    const resolvedOverrides = applyRuntimeContextOverrides(runtimeConfigOverrides);
    await injectRuntimeConfig(page, resolvedOverrides);
    const teardown = async () => {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        browser.disconnect();
    };
    return { browser, context, page, teardown };
}

/**
 * Install deterministic CDN mirrors and external stubs for test pages.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
export async function installCdnMirrors(page) {
    if (page[CDN_INTERCEPTOR_SYMBOL]) {
        return;
    }
    const controller = await createRequestInterceptorController(page);
    page[CDN_INTERCEPTOR_SYMBOL] = controller;
    controller.add((request) => {
        const url = request.url();
        const mirror = CDN_MIRRORS.find((entry) => entry.pattern.test(url));
        if (mirror) {
            fs.readFile(mirror.filePath)
                .then((body) => request.respond({
                    status: 200,
                    contentType: mirror.contentType,
                    body,
                    headers: CDN_RESPONSE_HEADERS
                }).catch(() => {}))
                .catch((error) => {
                    if (process.env.GRAVITY_TEST_STREAM_LOGS === "1") {
                        // eslint-disable-next-line no-console
                        console.error(`${CDN_LOG_PREFIX} ${mirror.filePath}: ${error?.message ?? error}`);
                    }
                    request.respond({
                        status: 404,
                        contentType: mirror.contentType,
                        body: EMPTY_STRING,
                        headers: CDN_RESPONSE_HEADERS
                    }).catch(() => {});
                });
            return true;
        }
        const stub = CDN_STUBS.find((entry) => entry.pattern.test(url));
        if (stub) {
            request.respond({
                status: 200,
                contentType: stub.contentType,
                body: stub.body,
                headers: CDN_RESPONSE_HEADERS
            }).catch(() => {});
            return true;
        }
        return false;
    });
    page.once("close", () => {
        controller.dispose();
        delete page[CDN_INTERCEPTOR_SYMBOL];
    });
}

/**
 * Install a minimal TAuth client stub so app initialization can proceed in tests.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
export async function injectTAuthStub(page) {
    await page.evaluateOnNewDocument((stubConfig) => {
        const windowRef = /** @type {any} */ (window);
        if (typeof windowRef[stubConfig.INIT] !== "function") {
            windowRef[stubConfig.INIT] = async (options) => {
                windowRef[stubConfig.OPTIONS] = options ?? null;
                const handler = options && typeof options[stubConfig.ON_UNAUTHENTICATED] === "function"
                    ? options[stubConfig.ON_UNAUTHENTICATED]
                    : null;
                if (handler) {
                    handler();
                }
            };
        }
        if (typeof windowRef[stubConfig.REQUEST_NONCE] !== "function") {
            windowRef[stubConfig.REQUEST_NONCE] = async () => stubConfig.NONCE;
        }
        if (typeof windowRef[stubConfig.EXCHANGE_CREDENTIAL] !== "function") {
            windowRef[stubConfig.EXCHANGE_CREDENTIAL] = async () => {};
        }
        if (typeof windowRef[stubConfig.GET_CURRENT_USER] !== "function") {
            windowRef[stubConfig.GET_CURRENT_USER] = async () => windowRef[stubConfig.PROFILE] ?? null;
        }
        if (typeof windowRef[stubConfig.LOGOUT] !== "function") {
            windowRef[stubConfig.LOGOUT] = async () => {
                windowRef[stubConfig.PROFILE] = null;
                const options = windowRef[stubConfig.OPTIONS];
                const handler = options && typeof options[stubConfig.ON_UNAUTHENTICATED] === "function"
                    ? options[stubConfig.ON_UNAUTHENTICATED]
                    : null;
                if (handler) {
                    handler();
                }
            };
        }
    }, {
        ...TAUTH_STUB_KEYS,
        NONCE: TAUTH_STUB_NONCE
    });
}

/**
 * Intercept runtime config fetches and respond with deterministic payloads.
 * @param {import('puppeteer').Page} page
 * @param {Record<string, any>} overrides
 * @returns {Promise<void>}
 */
export async function injectRuntimeConfig(page, overrides = {}) {
    page[RUNTIME_CONFIG_SYMBOL] = overrides;
    if (page[RUNTIME_CONFIG_HANDLER_SYMBOL]) {
        return;
    }
    page[RUNTIME_CONFIG_HANDLER_SYMBOL] = true;
    const overridesByEnvironment = {
        development: resolveRuntimeConfigOverrides(page[RUNTIME_CONFIG_SYMBOL], "development"),
        production: resolveRuntimeConfigOverrides(page[RUNTIME_CONFIG_SYMBOL], "production")
    };
    await page.evaluateOnNewDocument((config) => {
        const configPattern = /\/data\/runtime\.config\.(development|production)\.json$/u;
        const originalFetch = window.fetch;
        window.fetch = async (input, init = {}) => {
            const requestUrl = typeof input === "string"
                ? input
                : typeof input?.url === "string"
                    ? input.url
                    : "";
            if (typeof requestUrl === "string" && configPattern.test(requestUrl)) {
                const match = requestUrl.match(configPattern);
                const environment = match && match[1] ? match[1] : "development";
                const payload = environment === "production" ? config.production : config.development;
                return new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }
            return originalFetch.call(window, input, init);
        };
    }, {
        development: {
            [RUNTIME_CONFIG_KEYS.ENVIRONMENT]: "development",
            [RUNTIME_CONFIG_KEYS.BACKEND_BASE_URL]: overridesByEnvironment.development.backendBaseUrl,
            [RUNTIME_CONFIG_KEYS.LLM_PROXY_URL]: overridesByEnvironment.development.llmProxyUrl,
            [RUNTIME_CONFIG_KEYS.AUTH_BASE_URL]: overridesByEnvironment.development.authBaseUrl,
            [RUNTIME_CONFIG_KEYS.TAUTH_SCRIPT_URL]: overridesByEnvironment.development.tauthScriptUrl,
            [RUNTIME_CONFIG_KEYS.MPR_UI_SCRIPT_URL]: overridesByEnvironment.development.mprUiScriptUrl,
            [RUNTIME_CONFIG_KEYS.AUTH_TENANT_ID]: overridesByEnvironment.development.authTenantId,
            [RUNTIME_CONFIG_KEYS.GOOGLE_CLIENT_ID]: overridesByEnvironment.development.googleClientId
        },
        production: {
            [RUNTIME_CONFIG_KEYS.ENVIRONMENT]: "production",
            [RUNTIME_CONFIG_KEYS.BACKEND_BASE_URL]: overridesByEnvironment.production.backendBaseUrl,
            [RUNTIME_CONFIG_KEYS.LLM_PROXY_URL]: overridesByEnvironment.production.llmProxyUrl,
            [RUNTIME_CONFIG_KEYS.AUTH_BASE_URL]: overridesByEnvironment.production.authBaseUrl,
            [RUNTIME_CONFIG_KEYS.TAUTH_SCRIPT_URL]: overridesByEnvironment.production.tauthScriptUrl,
            [RUNTIME_CONFIG_KEYS.MPR_UI_SCRIPT_URL]: overridesByEnvironment.production.mprUiScriptUrl,
            [RUNTIME_CONFIG_KEYS.AUTH_TENANT_ID]: overridesByEnvironment.production.authTenantId,
            [RUNTIME_CONFIG_KEYS.GOOGLE_CLIENT_ID]: overridesByEnvironment.production.googleClientId
        }
    });
    await registerRequestInterceptor(page, (request) => {
        const url = request.url();
        if (TAUTH_SCRIPT_PATTERN.test(url)) {
            request.respond({
                status: 200,
                contentType: "application/javascript",
                body: TAUTH_STUB_SCRIPT
            }).catch(() => {});
            return true;
        }
        if (!CONFIG_ROUTE_PATTERN.test(url)) {
            return false;
        }
        const match = url.match(CONFIG_ROUTE_PATTERN);
        const environment = match && match[1] ? match[1] : "development";
        const resolvedOverrides = resolveRuntimeConfigOverrides(page[RUNTIME_CONFIG_SYMBOL], environment);
        const body = JSON.stringify({
            [RUNTIME_CONFIG_KEYS.ENVIRONMENT]: environment,
            [RUNTIME_CONFIG_KEYS.BACKEND_BASE_URL]: resolvedOverrides.backendBaseUrl,
            [RUNTIME_CONFIG_KEYS.LLM_PROXY_URL]: resolvedOverrides.llmProxyUrl,
            [RUNTIME_CONFIG_KEYS.AUTH_BASE_URL]: resolvedOverrides.authBaseUrl,
            [RUNTIME_CONFIG_KEYS.TAUTH_SCRIPT_URL]: resolvedOverrides.tauthScriptUrl,
            [RUNTIME_CONFIG_KEYS.MPR_UI_SCRIPT_URL]: resolvedOverrides.mprUiScriptUrl,
            [RUNTIME_CONFIG_KEYS.AUTH_TENANT_ID]: resolvedOverrides.authTenantId,
            [RUNTIME_CONFIG_KEYS.GOOGLE_CLIENT_ID]: resolvedOverrides.googleClientId
        });
        request.respond({ status: 200, contentType: "application/json", body }).catch(() => {});
        return true;
    });
}

/**
 * Register a request interceptor that may respond to intercepted requests.
 * Returns a disposer that removes the handler when invoked.
 * @param {import("puppeteer").Page} page
 * @param {(request: import("puppeteer").HTTPRequest) => boolean} handler
 * @returns {Promise<() => void>}
 */
export async function registerRequestInterceptor(page, handler) {
    const controller = await createRequestInterceptorController(page);
    return controller.add(handler);
}

/**
 * Create a scoped request-interceptor controller that can register handlers and dispose them later.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ add(handler: (request: import("puppeteer").HTTPRequest) => boolean): () => void, dispose(): void }>}
 */
export async function createRequestInterceptorController(page) {
    await ensureRequestInterception(page);
    const registry = page[REQUEST_HANDLER_REGISTRY_SYMBOL];
    const attachedEntries = new Set();
    return {
        add(handler) {
            if (typeof handler !== "function") {
                throw new TypeError("Request interceptor handler must be a function.");
            }
            const entry = registry.add(handler);
            attachedEntries.add(entry);
            return () => {
                if (!attachedEntries.has(entry)) {
                    return;
                }
                attachedEntries.delete(entry);
                registry.remove(entry);
            };
        },
        dispose() {
            for (const entry of attachedEntries) {
                registry.remove(entry);
            }
            attachedEntries.clear();
        }
    };
}

async function ensureRequestInterception(page) {
    if (!page[REQUEST_INTERCEPTION_READY_SYMBOL]) {
        page[REQUEST_INTERCEPTION_READY_SYMBOL] = (async () => {
            const handlers = [];
            const registry = createHandlerRegistry(handlers);
            page[REQUEST_HANDLERS_SYMBOL] = handlers;
            page[REQUEST_HANDLER_REGISTRY_SYMBOL] = registry;
            await page.setRequestInterception(true);
            page.on("request", async (request) => {
                const currentHandlers = Array.isArray(page[REQUEST_HANDLERS_SYMBOL]) ? page[REQUEST_HANDLERS_SYMBOL] : [];
                for (const entry of currentHandlers) {
                    if (!entry || entry.disabled) {
                        continue;
                    }
                    try {
                        const result = entry.fn(request);
                        if (isThenable(result)) {
                            if (await result === true) {
                                return;
                            }
                            continue;
                        }
                        if (result === true) {
                            return;
                        }
                    } catch (error) {
                        if (process.env.GRAVITY_TEST_STREAM_LOGS === "1") {
                            // eslint-disable-next-line no-console
                            console.error("[request interceptor] handler failed", error);
                        }
                    }
                }
                request.continue().catch(() => {});
            });
            page.once("close", () => {
                handlers.splice(0, handlers.length);
                registry.clear();
            });
        })();
    }
    await page[REQUEST_INTERCEPTION_READY_SYMBOL];
}

function createHandlerRegistry(storage) {
    return {
        add(fn) {
            const entry = { fn, disabled: false };
            storage.push(entry);
            return entry;
        },
        remove(entry) {
            if (!entry || entry.disabled) {
                return;
            }
            entry.disabled = true;
            const index = storage.indexOf(entry);
            if (index >= 0) {
                storage.splice(index, 1);
            }
        },
        clear() {
            const items = storage.splice(0, storage.length);
            for (const entry of items) {
                entry.disabled = true;
            }
        }
    };
}

/**
 * @param {unknown} value
 * @returns {value is Promise<unknown>}
 */
function isThenable(value) {
    if (value === null || value === undefined) {
        return false;
    }
    const candidate = /** @type {any} */ (value);
    return (typeof candidate === "object" || typeof candidate === "function") && typeof candidate.then === "function";
}

/**
 * @param {Record<string, any>} overrides
 * @param {"development" | "production"} environment
 * @returns {{ backendBaseUrl: string, llmProxyUrl: string, authBaseUrl: string, tauthScriptUrl: string, mprUiScriptUrl: string, authTenantId: string, googleClientId: string }}
 */
function resolveRuntimeConfigOverrides(overrides, environment) {
    if (!overrides || typeof overrides !== "object") {
        return { ...TEST_RUNTIME_CONFIG };
    }
    const scoped = typeof overrides[environment] === "object" && overrides[environment] !== null
        ? overrides[environment]
        : null;
    const backendBaseUrl = normalizeTestUrl(scoped?.backendBaseUrl ?? overrides.backendBaseUrl ?? TEST_RUNTIME_CONFIG.backendBaseUrl);
    const llmProxyUrl = normalizeTestUrl(scoped?.llmProxyUrl ?? overrides.llmProxyUrl ?? TEST_RUNTIME_CONFIG.llmProxyUrl, true);
    const authBaseUrl = normalizeTestUrl(scoped?.authBaseUrl ?? overrides.authBaseUrl ?? TEST_RUNTIME_CONFIG.authBaseUrl, true);
    const tauthScriptUrl = normalizeTestUrl(scoped?.tauthScriptUrl ?? overrides.tauthScriptUrl ?? TEST_RUNTIME_CONFIG.tauthScriptUrl);
    const mprUiScriptUrl = normalizeTestUrl(scoped?.mprUiScriptUrl ?? overrides.mprUiScriptUrl ?? TEST_RUNTIME_CONFIG.mprUiScriptUrl);
    const authTenantIdCandidate = scoped?.authTenantId ?? overrides.authTenantId ?? TEST_RUNTIME_CONFIG.authTenantId;
    const authTenantId = typeof authTenantIdCandidate === "string"
        ? authTenantIdCandidate
        : TEST_RUNTIME_CONFIG.authTenantId;
    const googleClientIdCandidate = scoped?.googleClientId ?? overrides.googleClientId ?? TEST_RUNTIME_CONFIG.googleClientId;
    const googleClientId = typeof googleClientIdCandidate === "string"
        ? googleClientIdCandidate
        : TEST_RUNTIME_CONFIG.googleClientId;
    return { backendBaseUrl, llmProxyUrl, authBaseUrl, tauthScriptUrl, mprUiScriptUrl, authTenantId, googleClientId };
}

/**
 * Merge runtime context defaults into the provided overrides.
 * @param {Record<string, any>} overrides
 * @returns {Record<string, any>}
 */
function applyRuntimeContextOverrides(overrides) {
    const resolvedOverrides = overrides && typeof overrides === "object" ? { ...overrides } : {};
    const runtimeBackendBaseUrl = readRuntimeBackendBaseUrl();
    if (!runtimeBackendBaseUrl) {
        return resolvedOverrides;
    }
    const hasTopLevelOverride = Object.prototype.hasOwnProperty.call(resolvedOverrides, "backendBaseUrl");
    const scopedDevelopment = resolvedOverrides.development;
    const hasDevOverride = scopedDevelopment
        && typeof scopedDevelopment === "object"
        && Object.prototype.hasOwnProperty.call(scopedDevelopment, "backendBaseUrl");
    if (hasTopLevelOverride || hasDevOverride) {
        return resolvedOverrides;
    }
    return {
        ...resolvedOverrides,
        backendBaseUrl: runtimeBackendBaseUrl
    };
}

/**
 * @returns {string}
 */
function readRuntimeBackendBaseUrl() {
    try {
        const context = readRuntimeContext();
        const baseUrl = context?.backend?.baseUrl;
        return typeof baseUrl === "string" && baseUrl.length > 0 ? baseUrl : EMPTY_STRING;
    } catch (error) {
        if (error && typeof error === "object" && "message" in error) {
            const message = /** @type {{ message?: string }} */ (error).message;
            if (typeof message === "string" && message.startsWith("Runtime context unavailable")) {
                return EMPTY_STRING;
            }
        }
        throw error;
    }
}

/**
 * @param {unknown} value
 * @param {boolean} allowBlank
 * @returns {string}
 */
function normalizeTestUrl(value, allowBlank = false) {
    if (typeof value !== "string") {
        return allowBlank ? EMPTY_STRING : TEST_RUNTIME_CONFIG.backendBaseUrl;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return allowBlank ? EMPTY_STRING : TEST_RUNTIME_CONFIG.backendBaseUrl;
    }
    return trimmed.replace(/\/+$/u, "");
}

/**
 * Generate a module specifier suitable for Node's --import flag.
 * @param {string} absolutePath
 * @returns {string}
 */
export function toImportSpecifier(absolutePath) {
    return pathToFileURL(absolutePath).href;
}

/**
 * Wait for the Alpine-driven application shell to hydrate before continuing.
 * @param {import("puppeteer").Page} page
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<void>}
 */
export async function waitForAppHydration(page, options = {}) {
    const timeout = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : 10000;
    await page.waitForFunction(
        () => {
            const readyState = document.readyState === "complete" || document.readyState === "interactive";
            const alpineReady = typeof window.Alpine === "object" && typeof window.Alpine.nextTick === "function";
            const root = document.querySelector("[x-data]");
            return readyState && alpineReady && root instanceof HTMLElement;
        },
        { timeout }
    );
    await flushAlpineQueues(page);
    await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
}

/**
 * Flush Alpine.js nextTick microtasks and a rendering frame to stabilize the DOM.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
export async function flushAlpineQueues(page) {
    await page.evaluate(() => new Promise((resolve) => {
        if (!window.Alpine || typeof window.Alpine.nextTick !== "function") {
            resolve();
            return;
        }
        window.Alpine.nextTick(() => {
            requestAnimationFrame(() => resolve());
        });
    }));
}

/**
 * Attach a helper that appends the current build identifier to dynamic app module imports.
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
export async function attachImportAppModule(page) {
    const normalizedBuildId = typeof APP_BUILD_ID === "string" ? APP_BUILD_ID.trim() : "";
    await page.evaluateOnNewDocument((buildId) => {
        const normalizedId = typeof buildId === "string" ? buildId : "";
        // @ts-ignore
        window.importAppModule = (specifier) => {
            if (typeof specifier !== "string" || specifier.length === 0) {
                return import(specifier);
            }
            if (normalizedId.length === 0 || specifier.includes("build=")) {
                return import(specifier);
            }
            const delimiter = specifier.includes("?") ? "&" : "?";
            return import(`${specifier}${delimiter}build=${normalizedId}`);
        };
    }, normalizedBuildId);
}
