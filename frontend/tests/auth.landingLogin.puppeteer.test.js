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
    attachImportAppModule,
    registerRequestInterceptor
} from "./helpers/browserHarness.js";
import { startTestBackend } from "./helpers/backendHarness.js";
import { resolvePageUrl } from "./helpers/syncTestUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const LANDING_PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const CUSTOM_AUTH_BASE_URL = "http://localhost:58081";
const MPR_UI_SCRIPT_PATTERN = /\/mpr-ui\.js(?:\?.*)?$/u;
const MPR_UI_STUB_SCRIPT = [
    "(() => {",
    "  class MprLoginButton extends HTMLElement {}",
    "  class MprUser extends HTMLElement {}",
    "  if (window.customElements && !window.customElements.get(\"mpr-login-button\")) {",
    "    window.customElements.define(\"mpr-login-button\", MprLoginButton);",
    "  }",
    "  if (window.customElements && !window.customElements.get(\"mpr-user\")) {",
    "    window.customElements.define(\"mpr-user\", MprUser);",
    "  }",
    "})();"
].join("\n");

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

            // Force sign-out so the landing page doesn't redirect to app.html
            await page.evaluateOnNewDocument(() => {
                try {
                    window.sessionStorage?.setItem("__gravityTestForceSignOut", "true");
                } catch {
                    // Ignore storage errors
                }
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
            const attributesHandle = await page.waitForFunction((selector, expectedUrl) => {
                const element = document.querySelector(selector);
                if (!element) {
                    return null;
                }
                const tauthUrl = element.getAttribute("tauth-url");
                const loginPath = element.getAttribute("tauth-login-path");
                const logoutPath = element.getAttribute("tauth-logout-path");
                const noncePath = element.getAttribute("tauth-nonce-path");
                if (!tauthUrl || !loginPath || !logoutPath || !noncePath) {
                    return null;
                }
                if (tauthUrl !== expectedUrl) {
                    return null;
                }
                return {
                    tauthUrl,
                    loginPath,
                    logoutPath,
                    noncePath
                };
            }, { timeout: 10000 }, "[data-test=\"landing-login\"]", CUSTOM_AUTH_BASE_URL);

            const teardown = async () => {
                await page.close().catch(() => {});
                await context.close().catch(() => {});
                browser.disconnect();
                await backend.close();
            };

            try {
                const attributes = await attributesHandle.jsonValue();
                assert.equal(attributes.tauthUrl, CUSTOM_AUTH_BASE_URL);
                assert.equal(attributes.loginPath, "/auth/google");
                assert.equal(attributes.logoutPath, "/auth/logout");
                assert.equal(attributes.noncePath, "/auth/nonce");
            } finally {
                await teardown();
            }
        });

        test("redirects to app when session exists without relying on mpr-ui auth events", async () => {
            const backend = await startTestBackend();
            const browser = await connectSharedBrowser();
            const context = await browser.createBrowserContext();
            const page = await context.newPage();

            await page.evaluateOnNewDocument(() => {
                window.__gravityForceLocalStorage = true;
            });
            await installCdnMirrors(page);
            await attachImportAppModule(page);
            await injectTAuthStub(page);
            await injectRuntimeConfig(page, {
                development: {
                    backendBaseUrl: backend.baseUrl,
                    authBaseUrl: CUSTOM_AUTH_BASE_URL,
                    authTenantId: "gravity",
                    googleClientId: "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com"
                }
            });

            const removeInterceptor = await registerRequestInterceptor(page, (request) => {
                if (!MPR_UI_SCRIPT_PATTERN.test(request.url())) {
                    return false;
                }
                request.respond({
                    status: 200,
                    contentType: "application/javascript",
                    body: MPR_UI_STUB_SCRIPT,
                    headers: { "Access-Control-Allow-Origin": "*" }
                }).catch(() => {});
                return true;
            });

            const teardown = async () => {
                removeInterceptor();
                await page.close().catch(() => {});
                await context.close().catch(() => {});
                browser.disconnect();
                await backend.close();
            };

            try {
                const resolvedUrl = await resolvePageUrl(LANDING_PAGE_URL);
                await page.goto(resolvedUrl, { waitUntil: "domcontentloaded" });
                await page.waitForFunction(() => window.location.pathname.endsWith("/app.html"), { timeout: 10000 });
                assert.match(page.url(), /app\.html/u);
            } finally {
                await teardown();
            }
        });
    });
}
