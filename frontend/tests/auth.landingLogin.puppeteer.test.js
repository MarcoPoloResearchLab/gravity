// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    connectSharedBrowser,
    installCdnMirrors,
    injectTAuthStub,
    injectRuntimeConfig,
    attachImportAppModule
} from "./helpers/browserHarness.js";
import { startTestBackend } from "./helpers/backendHarness.js";
import { resolvePageUrl } from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const LANDING_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const CUSTOM_AUTH_BASE_URL = "http://localhost:58081";

let puppeteerAvailable = true;
try {
    await import("puppeteer");
} catch {
    puppeteerAvailable = false;
}

if (!puppeteerAvailable) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    test.describe("Landing login button", () => {
        test("uses runtime auth base url and nonce/login/logout paths", async () => {
            const backend = await startTestBackend();
            const browser = await connectSharedBrowser();
            const context = await browser.createBrowserContext();
            const page = await context.newPage();

            // Set up all interceptors (same as initializePuppeteerTest but for landing page)
            await page.evaluateOnNewDocument(() => {
                window.__gravityForceLocalStorage = true;
            });
            await installCdnMirrors(page);
            await attachImportAppModule(page);

            // Clear the default test profile so landing page doesn't redirect to app.html
            await page.evaluateOnNewDocument(() => {
                window.__tauthStubProfile = null;
            });
            await injectTAuthStub(page);

            // Inject runtime config with custom auth URL
            await injectRuntimeConfig(page, {
                development: {
                    backendBaseUrl: backend.baseUrl,
                    authBaseUrl: CUSTOM_AUTH_BASE_URL,
                    authTenantId: "gravity",
                    googleClientId: "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com"
                }
            });

            // Navigate to landing page (convert file:// to HTTP via static server)
            const resolvedUrl = await resolvePageUrl(LANDING_PAGE_URL);
            await page.goto(resolvedUrl, { waitUntil: "domcontentloaded" });

            // Wait for mpr-login-button to be defined (landing page doesn't have Alpine)
            await page.waitForFunction(() => {
                const registry = window.customElements;
                if (!registry || typeof registry.get !== "function") {
                    return false;
                }
                return Boolean(registry.get("mpr-login-button"));
            }, { timeout: 10000 });

            const teardown = async () => {
                await page.close().catch(() => {});
                await context.close().catch(() => {});
                browser.disconnect();
                await backend.close();
            };

            try {
                await page.waitForSelector("[data-test=\"landing-login\"]");
                const attributes = await page.$eval("[data-test=\"landing-login\"]", (element) => {
                    return {
                        tauthUrl: element.getAttribute("tauth-url"),
                        loginPath: element.getAttribute("tauth-login-path"),
                        logoutPath: element.getAttribute("tauth-logout-path"),
                        noncePath: element.getAttribute("tauth-nonce-path")
                    };
                });

                assert.equal(attributes.tauthUrl, CUSTOM_AUTH_BASE_URL);
                assert.equal(attributes.loginPath, "/auth/google");
                assert.equal(attributes.logoutPath, "/auth/logout");
                assert.equal(attributes.noncePath, "/auth/nonce");
            } finally {
                await teardown();
            }
        });
    });
}
