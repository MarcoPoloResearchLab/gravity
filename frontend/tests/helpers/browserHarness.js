// @ts-check

import { pathToFileURL } from "node:url";

import { APP_BUILD_ID } from "../../js/constants.js";

import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./puppeteerEnvironment.js";
import { readRuntimeContext } from "./runtimeContext.js";

let sharedLaunchContext = null;
const CONFIG_ROUTE_PATTERN = /\/data\/runtime\.config\.(development|production)\.json$/u;
const DEFAULT_TEST_RUNTIME_CONFIG = Object.freeze({
    backendBaseUrl: "",
    llmProxyUrl: "",
    authBaseUrl: ""
});
const RUNTIME_CONFIG_SYMBOL = Symbol("gravityRuntimeConfigOverrides");
const RUNTIME_CONFIG_HANDLER_SYMBOL = Symbol("gravityRuntimeConfigHandler");
const REQUEST_HANDLERS_SYMBOL = Symbol("gravityRequestHandlers");
const REQUEST_INTERCEPTION_READY_SYMBOL = Symbol("gravityRequestInterceptionReady");
const REQUEST_HANDLER_REGISTRY_SYMBOL = Symbol("gravityRequestHandlerRegistry");

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
    await attachImportAppModule(page);
    await injectRuntimeConfig(page, runtimeConfigOverrides);
    const teardown = async () => {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        browser.disconnect();
    };
    return { browser, context, page, teardown };
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
    await registerRequestInterceptor(page, (request) => {
        const url = request.url();
        if (!CONFIG_ROUTE_PATTERN.test(url)) {
            return false;
        }
        const match = url.match(CONFIG_ROUTE_PATTERN);
        const environment = match && match[1] ? match[1] : "development";
        const resolvedOverrides = resolveRuntimeConfigOverrides(page[RUNTIME_CONFIG_SYMBOL], environment);
        const body = JSON.stringify({
            environment,
            backendBaseUrl: resolvedOverrides.backendBaseUrl,
            llmProxyUrl: resolvedOverrides.llmProxyUrl,
            authBaseUrl: resolvedOverrides.authBaseUrl
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
 * @returns {{ backendBaseUrl: string, llmProxyUrl: string }}
 */
function resolveRuntimeConfigOverrides(overrides, environment) {
    if (!overrides || typeof overrides !== "object") {
        return { ...DEFAULT_TEST_RUNTIME_CONFIG };
    }
    const scoped = typeof overrides[environment] === "object" && overrides[environment] !== null
        ? overrides[environment]
        : null;
    const backendBaseUrl = normalizeTestUrl(scoped?.backendBaseUrl ?? overrides.backendBaseUrl ?? DEFAULT_TEST_RUNTIME_CONFIG.backendBaseUrl);
    const llmProxyUrl = normalizeTestUrl(scoped?.llmProxyUrl ?? overrides.llmProxyUrl ?? DEFAULT_TEST_RUNTIME_CONFIG.llmProxyUrl, true);
    const authBaseUrl = normalizeTestUrl(scoped?.authBaseUrl ?? overrides.authBaseUrl ?? DEFAULT_TEST_RUNTIME_CONFIG.authBaseUrl, true);
    return { backendBaseUrl, llmProxyUrl, authBaseUrl };
}

/**
 * @param {unknown} value
 * @param {boolean} allowBlank
 * @returns {string}
 */
function normalizeTestUrl(value, allowBlank = false) {
    if (typeof value !== "string") {
        return allowBlank ? "" : DEFAULT_TEST_RUNTIME_CONFIG.backendBaseUrl;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return allowBlank ? "" : DEFAULT_TEST_RUNTIME_CONFIG.backendBaseUrl;
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
