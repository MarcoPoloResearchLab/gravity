// @ts-check

import { pathToFileURL } from "node:url";

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
    llmProxyUrl: ""
});
const RUNTIME_CONFIG_SYMBOL = Symbol("gravityRuntimeConfigOverrides");

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
    if (!page[RUNTIME_CONFIG_SYMBOL]) {
        page[RUNTIME_CONFIG_SYMBOL] = overrides;
        await page.setRequestInterception(true);
        page.on("request", (request) => {
            const url = request.url();
            if (CONFIG_ROUTE_PATTERN.test(url)) {
                const match = url.match(CONFIG_ROUTE_PATTERN);
                const environment = match && match[1] ? match[1] : "development";
                const resolvedOverrides = resolveRuntimeConfigOverrides(page[RUNTIME_CONFIG_SYMBOL], environment);
                const body = JSON.stringify({
                    environment,
                    backendBaseUrl: resolvedOverrides.backendBaseUrl,
                    llmProxyUrl: resolvedOverrides.llmProxyUrl
                });
                request.respond({ status: 200, contentType: "application/json", body }).catch(() => {});
                return;
            }
            request.continue().catch(() => {});
        });
        return;
    }
    page[RUNTIME_CONFIG_SYMBOL] = overrides;
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
    return { backendBaseUrl, llmProxyUrl };
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
