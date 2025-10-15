// @ts-check

import { pathToFileURL } from "node:url";

import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./puppeteerEnvironment.js";

let sharedLaunchContext = null;

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
    const endpoint = process.env.GRAVITY_TEST_BROWSER_WS_ENDPOINT;
    if (!endpoint) {
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
export async function createSharedPage() {
    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const teardown = async () => {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        browser.disconnect();
    };
    return { browser, context, page, teardown };
}

/**
 * Generate a module specifier suitable for Node's --import flag.
 * @param {string} absolutePath
 * @returns {string}
 */
export function toImportSpecifier(absolutePath) {
    return pathToFileURL(absolutePath).href;
}
