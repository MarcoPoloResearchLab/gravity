// @ts-check

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolvePageUrl } from "./helpers/syncTestUtils.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.dirname(CURRENT_FILE);
const PROJECT_ROOT = path.resolve(TESTS_ROOT, "..");
const REPO_ROOT = path.resolve(PROJECT_ROOT, "..");
const LANDING_FILE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const MPR_UI_JS_PATH = path.join(REPO_ROOT, "tools", "mpr-ui", "mpr-ui.js");
const MPR_UI_CONFIG_PATH = path.join(REPO_ROOT, "tools", "mpr-ui", "mpr-ui-config.js");
const MPR_UI_CSS_PATH = path.join(REPO_ROOT, "tools", "mpr-ui", "mpr-ui.css");

const TAUTH_SCRIPT_URL = "https://tauth.mprlab.com/tauth.js";
const GOOGLE_GSI_URL = "https://accounts.google.com/gsi/client";
const LOOPAWARE_URL = "https://loopaware.mprlab.com/widget.js";
const MPR_UI_SCRIPT_URL = "https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.6.2/mpr-ui.js";
const MPR_UI_CONFIG_URL = "https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.6.2/mpr-ui-config.js";
const MPR_UI_CSS_URL = "https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.6.2/mpr-ui.css";

const TEST_USER_ID = "playwright-user";
const TEST_USER_EMAIL = "playwright-user@example.com";
const TEST_USER_DISPLAY = "Playwright User";
const TEST_USER_AVATAR_URL = "https://example.com/avatar.png";
const TEST_GOOGLE_CLIENT_ID = "playwright-client-id";
const TEST_TENANT_ID = "gravity";

const NOTES_RESPONSE = JSON.stringify({ notes: [] });
const SYNC_RESPONSE = JSON.stringify({ results: [] });

const TEST_TIMEOUT_MS = 45000;
const WAIT_TIMEOUT_MS = 15000;
const AUTH_READY_DELAY_MS = 75;

const TAUTH_STUB_SCRIPT = [
    "(() => {",
    "  const PROFILE_KEY = \"__gravityPlaywrightProfile\";",
    "  const OPTIONS_KEY = \"__gravityPlaywrightAuthOptions\";",
    "  const READY_KEY = \"__gravityPlaywrightAuthReady\";",
    `  const READY_DELAY_MS = ${AUTH_READY_DELAY_MS};`,
    `  const DEFAULT_PROFILE = ${JSON.stringify({
        user_id: TEST_USER_ID,
        user_email: TEST_USER_EMAIL,
        display: TEST_USER_DISPLAY,
        name: TEST_USER_DISPLAY,
        given_name: "Playwright",
        avatar_url: TEST_USER_AVATAR_URL,
        user_display: TEST_USER_DISPLAY,
        user_avatar_url: TEST_USER_AVATAR_URL
    })};`,
    "  const hasSessionCookie = () => {",
    "    try {",
    "      return document.cookie.includes(\"app_session=\");",
    "    } catch {",
    "      return false;",
    "    }",
    "  };",
    "  const getRuntimeProfile = () => window[PROFILE_KEY] ?? null;",
    "  const restoreProfileFromCookie = () => (hasSessionCookie() ? DEFAULT_PROFILE : null);",
    "  const setProfile = (profile) => {",
    "    window[PROFILE_KEY] = profile;",
    "    try {",
    "      if (profile) {",
    "        document.cookie = \"app_session=playwright-session; path=/\";",
    "      } else {",
    "        document.cookie = \"app_session=; path=/; max-age=0\";",
    "      }",
    "    } catch {}",
    "  };",
    "  let readyTimer = null;",
    "  const scheduleReady = (profile) => {",
    "    if (readyTimer) {",
    "      clearTimeout(readyTimer);",
    "    }",
    "    readyTimer = setTimeout(() => {",
    "      window[READY_KEY] = true;",
    "      const options = window[OPTIONS_KEY];",
    "      if (profile) {",
    "        if (options && typeof options.onAuthenticated === \"function\") {",
    "          options.onAuthenticated(profile);",
    "        }",
    "      } else if (options && typeof options.onUnauthenticated === \"function\") {",
    "        options.onUnauthenticated();",
    "      }",
    "    }, READY_DELAY_MS);",
    "  };",
    "  const originalFetch = typeof window.fetch === \"function\" ? window.fetch.bind(window) : null;",
    "  if (originalFetch) {",
    "    window.fetch = async (...args) => {",
    "      const response = await originalFetch(...args);",
    "      try {",
    "        const requestInput = args[0];",
    "        const requestUrl = typeof requestInput === \"string\"",
    "          ? requestInput",
    "          : requestInput && typeof requestInput.url === \"string\"",
    "            ? requestInput.url",
    "            : \"\";",
    "        if (requestUrl.includes(\"/auth/google\")) {",
    "          const clone = response.clone();",
    "          const payload = await clone.json().catch(() => null);",
    "          if (payload && typeof payload === \"object\") {",
    "            const profile = Object.assign({}, DEFAULT_PROFILE, payload);",
    "            setProfile(profile);",
    "            scheduleReady(profile);",
    "          }",
    "        }",
    "        if (requestUrl.includes(\"/auth/logout\")) {",
    "          setProfile(null);",
    "          scheduleReady(null);",
    "        }",
    "      } catch {}",
    "      return response;",
    "    };",
    "  }",
    "  window.initAuthClient = async (options) => {",
    "    window[OPTIONS_KEY] = options ?? null;",
    "    window[READY_KEY] = false;",
    "    const runtimeProfile = getRuntimeProfile();",
    "    const profile = runtimeProfile ?? restoreProfileFromCookie();",
    "    if (profile) {",
    "      if (!runtimeProfile) {",
    "        setProfile(profile);",
    "      }",
    "      scheduleReady(profile);",
    "      return;",
    "    }",
    "    setProfile(null);",
    "    scheduleReady(null);",
    "  };",
    "  window.requestNonce = async () => \"playwright-nonce\";",
    "  window.exchangeGoogleCredential = async () => {",
    "    const profile = DEFAULT_PROFILE;",
    "    setProfile(profile);",
    "    scheduleReady(profile);",
    "    return profile;",
    "  };",
    "  window.getCurrentUser = async () => (window[READY_KEY] ? getRuntimeProfile() : null);",
    "  window.logout = async () => {",
    "    setProfile(null);",
    "    scheduleReady(null);",
    "    const options = window[OPTIONS_KEY];",
    "    if (options && typeof options.onUnauthenticated === \"function\") {",
    "      options.onUnauthenticated();",
    "    }",
    "  };",
    "})();"
].join("\n");

const GOOGLE_GSI_STUB_SCRIPT = [
    "(() => {",
    "  const global = window;",
    "  if (!global.google) {",
    "    global.google = { accounts: { id: {} } };",
    "  }",
    "  if (!global.google.accounts) {",
    "    global.google.accounts = { id: {} };",
    "  }",
    "  if (!global.google.accounts.id) {",
    "    global.google.accounts.id = {};",
    "  }",
    "  global.google.accounts.id.initialize = (config) => {",
    "    global.__googleInitConfig = config;",
    "  };",
    "  global.google.accounts.id.renderButton = (containerElement) => {",
    "    if (!containerElement || !containerElement.ownerDocument) {",
    "      return;",
    "    }",
    "    const button = containerElement.ownerDocument.createElement(\"div\");",
    "    button.setAttribute(\"role\", \"button\");",
    "    button.textContent = \"Sign in\";",
    "    button.setAttribute(\"data-test\", \"google-signin\");",
    "    containerElement.innerHTML = \"\";",
    "    containerElement.appendChild(button);",
    "    const clickTarget = containerElement.parentElement || containerElement;",
    "    if (!clickTarget.hasAttribute(\"data-playwright-google-bound\")) {",
    "      clickTarget.setAttribute(\"data-playwright-google-bound\", \"true\");",
    "      clickTarget.addEventListener(\"click\", () => {",
    "        const initConfig = global.__googleInitConfig;",
    "        if (initConfig && typeof initConfig.callback === \"function\") {",
    "          initConfig.callback({ credential: \"playwright-credential\" });",
    "        }",
    "      });",
    "    }",
    "  };",
    "  global.google.accounts.id.prompt = () => {};",
    "  global.google.accounts.id.disableAutoSelect = () => {};",
    "})();"
].join("\n");

async function readFixture(filePath) {
    return fs.readFile(filePath, "utf-8");
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildConfigYaml(origin) {
    return [
        "environments:",
        "  - description: \"Playwright Auth Test\"",
        "    origins:",
        `      - \"${origin}\"`,
        "    auth:",
        `      tauthUrl: \"${origin}\"`,
        `      googleClientId: \"${TEST_GOOGLE_CLIENT_ID}\"`,
        `      tenantId: \"${TEST_TENANT_ID}\"`,
        "      loginPath: \"/auth/google\"",
        "      logoutPath: \"/auth/logout\"",
        "      noncePath: \"/auth/nonce\"",
        "    authButton:",
        "      text: \"signin_with\"",
        "      size: \"small\"",
        "      theme: \"outline\"",
        "      shape: \"circle\""
    ].join("\n");
}

function buildRuntimeConfig(origin) {
    return JSON.stringify({
        environment: "development",
        backendBaseUrl: origin,
        llmProxyUrl: "",
        authBaseUrl: origin,
        tauthScriptUrl: TAUTH_SCRIPT_URL,
        mprUiScriptUrl: MPR_UI_SCRIPT_URL,
        authTenantId: TEST_TENANT_ID,
        googleClientId: TEST_GOOGLE_CLIENT_ID
    });
}

/**
 * @param {import("playwright").Page} page
 * @returns {Promise<{ url: string, hasLoginButton: boolean, hasGoogleButton: boolean, authState: string|null, userStatus: string|null }>}
 */
async function readAuthState(page) {
    return page.evaluate(() => {
        const loginButton = document.querySelector("mpr-login-button");
        const googleButton = document.querySelector("[data-test=google-signin]");
        const userMenu = document.querySelector("mpr-user");
        return {
            url: window.location.href,
            hasLoginButton: Boolean(loginButton),
            hasGoogleButton: Boolean(googleButton),
            authState: document.body?.dataset?.authState ?? null,
            userStatus: userMenu?.getAttribute("data-mpr-user-status") ?? null
        };
    });
}

let playwrightAvailable = true;
let chromiumBrowser = null;
try {
    const playwrightModule = await import("playwright");
    chromiumBrowser = playwrightModule.chromium;
} catch {
    playwrightAvailable = false;
}

if (!playwrightAvailable) {
    test("playwright unavailable", () => {
        test.skip("Playwright is not installed in this environment.");
    });
} else {
    test.describe("Landing login E2E (Playwright)", { timeout: TEST_TIMEOUT_MS }, () => {
        test("clicking login renders user menu without redirect loop", async () => {
            const landingUrl = await resolvePageUrl(LANDING_FILE_URL);
            const origin = new URL(landingUrl).origin;
            const runtimeConfigBody = buildRuntimeConfig(origin);
            const configYamlBody = buildConfigYaml(origin);

            const [mprUiSource, mprUiConfigSource, mprUiCssSource] = await Promise.all([
                readFixture(MPR_UI_JS_PATH),
                readFixture(MPR_UI_CONFIG_PATH),
                readFixture(MPR_UI_CSS_PATH)
            ]);

            const browser = await chromiumBrowser.launch();
            const context = await browser.newContext();
            const page = await context.newPage();

            const registerRoute = async (urlPattern, handler) => {
                await page.route(urlPattern, handler);
            };
            let invalidMeRequest = false;

            await registerRoute(`${origin}/data/runtime.config.development.json`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: runtimeConfigBody
                }).catch(() => {});
            });
            await registerRoute(`${origin}/config.yaml`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "text/yaml",
                    body: configYamlBody
                }).catch(() => {});
            });
            await registerRoute(MPR_UI_CONFIG_URL, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/javascript",
                    body: mprUiConfigSource
                }).catch(() => {});
            });
            await registerRoute(MPR_UI_SCRIPT_URL, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/javascript",
                    body: mprUiSource
                }).catch(() => {});
            });
            await registerRoute(MPR_UI_CSS_URL, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "text/css",
                    body: mprUiCssSource
                }).catch(() => {});
            });
            await registerRoute(TAUTH_SCRIPT_URL, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/javascript",
                    body: TAUTH_STUB_SCRIPT
                }).catch(() => {});
            });
            await registerRoute(GOOGLE_GSI_URL, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/javascript",
                    body: GOOGLE_GSI_STUB_SCRIPT
                }).catch(() => {});
            });
            await registerRoute(new RegExp(`^${escapeForRegExp(LOOPAWARE_URL)}(\\?.*)?$`, "u"), (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/javascript",
                    body: ""
                }).catch(() => {});
            });
            await registerRoute(`${origin}/me`, (route) => {
                const headers = route.request().headers();
                const tenantHeader = headers["x-tauth-tenant"];
                if (!tenantHeader) {
                    invalidMeRequest = true;
                }
                const cookieHeader = headers["cookie"] ?? "";
                const authenticated = cookieHeader.includes("app_session=");
                route.fulfill({
                    status: authenticated ? 200 : 403,
                    contentType: "application/json",
                    body: authenticated ? JSON.stringify({ userId: TEST_USER_ID }) : JSON.stringify({ error: "unauthorized" })
                }).catch(() => {});
            });
            await registerRoute(`${origin}/notes`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: NOTES_RESPONSE
                }).catch(() => {});
            });
            await registerRoute(`${origin}/notes/sync`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: SYNC_RESPONSE
                }).catch(() => {});
            });
            await registerRoute(`${origin}/auth/nonce`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ nonce: "playwright-nonce" })
                }).catch(() => {});
            });
            await registerRoute(`${origin}/auth/google`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        user_id: TEST_USER_ID,
                        user_email: TEST_USER_EMAIL,
                        display: TEST_USER_DISPLAY,
                        avatar_url: TEST_USER_AVATAR_URL
                    })
                }).catch(() => {});
            });
            await registerRoute(`${origin}/auth/logout`, (route) => {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ ok: true })
                }).catch(() => {});
            });

            try {
                await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
                await page.waitForSelector("mpr-login-button", { timeout: WAIT_TIMEOUT_MS });
                await page.waitForSelector("[data-test=google-signin]", { timeout: WAIT_TIMEOUT_MS });

                const navigationPromise = page.waitForURL(/\/app\.html$/, { timeout: WAIT_TIMEOUT_MS });
                await page.click("[data-test=google-signin]");
                await navigationPromise;

                await page.waitForSelector("[data-test=app-shell]", { timeout: WAIT_TIMEOUT_MS });
                await page.waitForSelector("mpr-user[data-mpr-user-status=\"authenticated\"]", { timeout: WAIT_TIMEOUT_MS });
                await page.waitForSelector("mpr-user [data-mpr-user=\"trigger\"]", { timeout: WAIT_TIMEOUT_MS });

                await page.waitForTimeout(750);
                assert.equal(invalidMeRequest, false, "Expected /me requests to include X-TAuth-Tenant header");
                assert.ok(page.url().includes("/app.html"), "Expected to remain on app.html after login");
            } catch (error) {
                const debugState = await readAuthState(page).catch(() => null);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Playwright auth flow failed: ${errorMessage}; state=${JSON.stringify(debugState)}`, { cause: error });
            } finally {
                await context.close().catch(() => {});
                await browser.close().catch(() => {});
            }
        });
    });
}
