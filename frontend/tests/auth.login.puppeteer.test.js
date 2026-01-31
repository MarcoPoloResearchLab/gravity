// @ts-check

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { LABEL_ENTER_FULL_SCREEN, LABEL_EXIT_FULL_SCREEN } from "../js/constants.js";
import { resolvePageUrl } from "./helpers/syncTestUtils.js";
import { connectSharedBrowser, createRequestInterceptorController } from "./helpers/browserHarness.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.dirname(CURRENT_FILE);
const PROJECT_ROOT = path.resolve(TESTS_ROOT, "..");
const LANDING_FILE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const TAUTH_SCRIPT_URL = "https://tauth.mprlab.com/tauth.js";
const GOOGLE_GSI_URL = "https://accounts.google.com/gsi/client";
const LOOPAWARE_URL = "https://loopaware.mprlab.com/widget.js";
const MPR_UI_SCRIPT_URL = "https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.6.2/mpr-ui.js";

const TEST_USER_ID = "puppeteer-user";
const TEST_USER_EMAIL = "puppeteer-user@example.com";
const TEST_USER_DISPLAY = "Puppeteer User";
const TEST_USER_AVATAR_URL = "https://example.com/avatar.png";
const TEST_GOOGLE_CLIENT_ID = "puppeteer-client-id";
const TEST_TENANT_ID = "gravity";

const NOTES_RESPONSE = JSON.stringify({ notes: [] });
const SYNC_RESPONSE = JSON.stringify({ results: [] });

const TEST_TIMEOUT_MS = 45000;
const WAIT_TIMEOUT_MS = 20000;
const AUTH_READY_DELAY_MS = 75;
const REDIRECT_SETTLE_DELAY_MS = 750;

const TAUTH_STUB_SCRIPT = [
    "(() => {",
    "  const PROFILE_KEY = \"__gravityPuppeteerProfile\";",
    "  const OPTIONS_KEY = \"__gravityPuppeteerAuthOptions\";",
    "  const READY_KEY = \"__gravityPuppeteerAuthReady\";",
    `  const READY_DELAY_MS = ${AUTH_READY_DELAY_MS};`,
    `  const DEFAULT_PROFILE = ${JSON.stringify({
        user_id: TEST_USER_ID,
        user_email: TEST_USER_EMAIL,
        display: TEST_USER_DISPLAY,
        name: TEST_USER_DISPLAY,
        given_name: "Puppeteer",
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
    "        document.cookie = \"app_session=puppeteer-session; path=/\";",
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
    "  window.requestNonce = async () => \"puppeteer-nonce\";",
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
    "    const triggerLogin = () => {",
    "      const initConfig = global.__googleInitConfig;",
    "      if (initConfig && typeof initConfig.callback === \"function\") {",
    "        initConfig.callback({ credential: \"puppeteer-credential\" });",
    "      }",
    "    };",
    "    button.addEventListener(\"click\", triggerLogin);",
    "    const rootNode = typeof containerElement.getRootNode === \"function\"",
    "      ? containerElement.getRootNode()",
    "      : null;",
    "    const host = rootNode && rootNode.host ? rootNode.host : null;",
    "    const clickTarget = (host && typeof host.addEventListener === \"function\")",
    "      ? host",
    "      : (containerElement.parentElement || containerElement);",
    "    if (!clickTarget.hasAttribute(\"data-puppeteer-google-bound\")) {",
    "      clickTarget.setAttribute(\"data-puppeteer-google-bound\", \"true\");",
    "      clickTarget.addEventListener(\"click\", triggerLogin);",
    "    }",
    "  };",
    "  global.google.accounts.id.prompt = () => {};",
    "  global.google.accounts.id.disableAutoSelect = () => {};",
    "})();"
].join("\n");

const FULLSCREEN_STUB_SCRIPT = [
    "(() => {",
    "  const counters = { enterCalls: 0, exitCalls: 0, lastMethod: \"\", requestOverride: false, exitOverride: false };",
    "  let fullscreenElement = null;",
    "  const update = (element, method) => {",
    "    fullscreenElement = element;",
    "    try {",
    "      document.webkitFullscreenElement = element;",
    "    } catch {}",
    "    try {",
    "      document.mozFullScreenElement = element;",
    "    } catch {}",
    "    try {",
    "      document.msFullscreenElement = element;",
    "    } catch {}",
    "    if (element) {",
    "      counters.enterCalls += 1;",
    "    } else {",
    "      counters.exitCalls += 1;",
    "    }",
    "    counters.lastMethod = method;",
    "    const eventName = method === \"webkit\" ? \"webkitfullscreenchange\" : \"fullscreenchange\";",
    "    document.dispatchEvent(new Event(eventName));",
    "  };",
    "  const defineElementGetter = (target, prop) => {",
    "    try {",
    "      Object.defineProperty(target, prop, { configurable: true, get: () => fullscreenElement });",
    "      return true;",
    "    } catch {",
    "      return false;",
    "    }",
    "  };",
    "  defineElementGetter(document, \"fullscreenElement\");",
    "  defineElementGetter(document, \"webkitFullscreenElement\");",
    "  defineElementGetter(Document.prototype, \"fullscreenElement\");",
    "  defineElementGetter(Document.prototype, \"webkitFullscreenElement\");",
    "  const elementProto = Element.prototype;",
    "  try {",
    "    Object.defineProperty(elementProto, \"requestFullscreen\", { configurable: true, value: undefined });",
    "    counters.requestOverride = true;",
    "  } catch {}",
    "  if (!counters.requestOverride) {",
    "    elementProto.requestFullscreen = async function requestFullscreen() {",
    "      update(this, \"standard\");",
    "    };",
    "  }",
    "  elementProto.webkitRequestFullscreen = async function webkitRequestFullscreen() {",
    "    update(this, \"webkit\");",
    "  };",
    "  try {",
    "    Object.defineProperty(document, \"exitFullscreen\", { configurable: true, value: undefined });",
    "    counters.exitOverride = true;",
    "  } catch {}",
    "  if (!counters.exitOverride) {",
    "    document.exitFullscreen = async function exitFullscreen() {",
    "      update(null, \"standard\");",
    "    };",
    "  }",
    "  document.webkitExitFullscreen = async function webkitExitFullscreen() {",
    "    update(null, \"webkit\");",
    "  };",
    "  window.__gravityFullscreenCounters = counters;",
    "})();"
].join("\n");

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
        "  - description: \"Puppeteer Auth Test\"",
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

function buildRuntimeConfig(origin, environment) {
    return {
        environment,
        backendBaseUrl: origin,
        llmProxyUrl: "",
        authBaseUrl: origin,
        tauthScriptUrl: TAUTH_SCRIPT_URL,
        mprUiScriptUrl: MPR_UI_SCRIPT_URL,
        authTenantId: TEST_TENANT_ID,
        googleClientId: TEST_GOOGLE_CLIENT_ID
    };
}

/**
 * @param {import("puppeteer").Page} page
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

/**
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
function delay(durationMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });
}

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<void>}
 */
async function assertStaysOnApp(page) {
    await delay(REDIRECT_SETTLE_DELAY_MS);
    assert.ok(page.url().includes("/app.html"), "Expected to remain on app.html after login");
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string} landingUrl
 * @returns {Promise<void>}
 */
async function loginToApp(page, landingUrl) {
    await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("mpr-login-button", { timeout: WAIT_TIMEOUT_MS });
    await page.waitForFunction(() => {
        const registry = window.customElements;
        return Boolean(registry && typeof registry.get === "function" && registry.get("mpr-login-button"));
    }, { timeout: WAIT_TIMEOUT_MS });
    await page.waitForFunction(() => {
        const button = document.querySelector("mpr-login-button");
        if (!button) {
            return false;
        }
        const tauthUrl = button.getAttribute("tauth-url");
        const tenantId = button.getAttribute("tauth-tenant-id");
        return Boolean(tauthUrl && tenantId);
    }, { timeout: WAIT_TIMEOUT_MS });
    await page.waitForFunction(() => {
        const initConfig = window.__googleInitConfig;
        return Boolean(initConfig && typeof initConfig.callback === "function");
    }, { timeout: WAIT_TIMEOUT_MS });
    await page.waitForSelector("[data-test=\"google-signin\"]", { timeout: WAIT_TIMEOUT_MS });
    const navigationPromise = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: WAIT_TIMEOUT_MS });
    const clicked = await page.evaluate(() => {
        const googleButton = document.querySelector("[data-test=\"google-signin\"]");
        if (googleButton instanceof HTMLElement) {
            googleButton.click();
            return true;
        }
        const hostButton = document.querySelector("[data-test=\"landing-login\"]");
        if (hostButton instanceof HTMLElement) {
            hostButton.click();
            return true;
        }
        return false;
    });
    if (!clicked) {
        await navigationPromise.catch(() => {});
        throw new Error("Landing login button not ready for click.");
    }
    await navigationPromise;
    await page.waitForSelector("[data-test=app-shell]", { timeout: WAIT_TIMEOUT_MS });
    await page.waitForSelector("mpr-user[data-mpr-user-status=\"authenticated\"]", { timeout: WAIT_TIMEOUT_MS });
    await page.waitForSelector("mpr-user [data-mpr-user=\"trigger\"]", { timeout: WAIT_TIMEOUT_MS });
}

/**
 * @param {{ initScript?: string }} options
 * @returns {Promise<{ page: import("puppeteer").Page, landingUrl: string, state: { invalidMeRequest: boolean }, teardown: () => Promise<void> }>}
 */
async function createPuppeteerHarness(options = {}) {
    const landingUrl = await resolvePageUrl(LANDING_FILE_URL);
    const origin = new URL(landingUrl).origin;
    const runtimeConfigDevelopment = buildRuntimeConfig(origin, "development");
    const runtimeConfigProduction = buildRuntimeConfig(origin, "production");
    const configYamlBody = buildConfigYaml(origin);
    const loopawarePattern = new RegExp(`^${escapeForRegExp(LOOPAWARE_URL)}(\\\\?.*)?$`, "u");

    const browser = await connectSharedBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
        window.__gravityForceLocalStorage = true;
    });
    if (options.initScript) {
        await page.evaluateOnNewDocument((scriptText) => {
            // eslint-disable-next-line no-eval
            eval(scriptText);
        }, options.initScript);
    }

    const state = { invalidMeRequest: false };
    const controller = await createRequestInterceptorController(page);
    const disposeInterceptor = controller.add((request) => {
        const url = request.url();
        if (url === `${origin}/data/runtime.config.development.json`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(runtimeConfigDevelopment)
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/data/runtime.config.production.json`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(runtimeConfigProduction)
            }).catch(() => {});
            return true;
        }
        if (url.startsWith(`${origin}/config.yaml`)) {
            request.respond({
                status: 200,
                contentType: "text/yaml",
                body: configYamlBody
            }).catch(() => {});
            return true;
        }
        if (url === TAUTH_SCRIPT_URL) {
            request.respond({
                status: 200,
                contentType: "application/javascript",
                body: TAUTH_STUB_SCRIPT
            }).catch(() => {});
            return true;
        }
        if (url === GOOGLE_GSI_URL) {
            request.respond({
                status: 200,
                contentType: "application/javascript",
                body: GOOGLE_GSI_STUB_SCRIPT
            }).catch(() => {});
            return true;
        }
        if (loopawarePattern.test(url)) {
            request.respond({
                status: 200,
                contentType: "application/javascript",
                body: ""
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/me`) {
            const headers = request.headers();
            const tenantHeader = headers["x-tauth-tenant"] ?? headers["X-TAuth-Tenant"];
            if (!tenantHeader) {
                state.invalidMeRequest = true;
            }
            const cookieHeader = headers.cookie ?? "";
            const authenticated = cookieHeader.includes("app_session=");
            request.respond({
                status: authenticated ? 200 : 403,
                contentType: "application/json",
                body: authenticated ? JSON.stringify({ userId: TEST_USER_ID }) : JSON.stringify({ error: "unauthorized" })
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/notes`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: NOTES_RESPONSE
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/notes/sync`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: SYNC_RESPONSE
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/auth/nonce`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ nonce: "puppeteer-nonce" })
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/auth/google`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    user_id: TEST_USER_ID,
                    user_email: TEST_USER_EMAIL,
                    display: TEST_USER_DISPLAY,
                    avatar_url: TEST_USER_AVATAR_URL
                })
            }).catch(() => {});
            return true;
        }
        if (url === `${origin}/auth/logout`) {
            request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true })
            }).catch(() => {});
            return true;
        }
        return false;
    });

    const teardown = async () => {
        disposeInterceptor();
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        browser.disconnect();
    };

    return { page, landingUrl, state, teardown };
}

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
    test.describe("Landing login E2E (Puppeteer)", { timeout: TEST_TIMEOUT_MS }, () => {
        test("clicking login renders user menu without redirect loop", async () => {
            const { page, landingUrl, state, teardown } = await createPuppeteerHarness();
            try {
                await loginToApp(page, landingUrl);
                await assertStaysOnApp(page);
                assert.equal(state.invalidMeRequest, false, "Expected /me requests to include X-TAuth-Tenant header");
            } catch (error) {
                const debugState = await readAuthState(page).catch(() => null);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Puppeteer auth flow failed: ${errorMessage}; state=${JSON.stringify(debugState)}`, { cause: error });
            } finally {
                await teardown();
            }
        });

        test("fullscreen menu item replaces standalone button and toggles state", async () => {
            const { page, landingUrl, teardown } = await createPuppeteerHarness({ initScript: FULLSCREEN_STUB_SCRIPT });
            try {
                await loginToApp(page, landingUrl);
                await assertStaysOnApp(page);
                const standaloneButton = await page.$("[data-test=\"fullscreen-toggle\"]");
                assert.equal(standaloneButton, null, "Standalone fullscreen button should be removed");

                await page.click("mpr-user [data-mpr-user=\"trigger\"]");
                await page.waitForSelector("mpr-user [data-mpr-user=\"menu-item\"][data-mpr-user-action=\"toggle-fullscreen\"]", {
                    timeout: WAIT_TIMEOUT_MS
                });
                const enterLabel = await page.$eval(
                    "mpr-user [data-mpr-user=\"menu-item\"][data-mpr-user-action=\"toggle-fullscreen\"]",
                    (element) => element.textContent?.trim() ?? ""
                );
                assert.equal(enterLabel, LABEL_ENTER_FULL_SCREEN);

                await page.click("mpr-user [data-mpr-user=\"menu-item\"][data-mpr-user-action=\"toggle-fullscreen\"]");
                await page.click("mpr-user [data-mpr-user=\"trigger\"]");
                await page.waitForFunction((selector, label) => {
                    const element = document.querySelector(selector);
                    return element && element.textContent?.trim() === label;
                }, { timeout: WAIT_TIMEOUT_MS },
                "mpr-user [data-mpr-user=\"menu-item\"][data-mpr-user-action=\"toggle-fullscreen\"]",
                LABEL_EXIT_FULL_SCREEN);

                const countersAfterEnter = await page.evaluate(() => window.__gravityFullscreenCounters ?? null);
                assert.ok(countersAfterEnter && countersAfterEnter.enterCalls >= 1, "Expected fullscreen enter to be invoked");
                if (countersAfterEnter && countersAfterEnter.requestOverride) {
                    assert.equal(
                        countersAfterEnter.lastMethod,
                        "webkit",
                        "Expected webkit fullscreen enter when standard API is unavailable"
                    );
                }

                await page.click("mpr-user [data-mpr-user=\"menu-item\"][data-mpr-user-action=\"toggle-fullscreen\"]");
                await page.click("mpr-user [data-mpr-user=\"trigger\"]");
                await page.waitForFunction((selector, label) => {
                    const element = document.querySelector(selector);
                    return element && element.textContent?.trim() === label;
                }, { timeout: WAIT_TIMEOUT_MS },
                "mpr-user [data-mpr-user=\"menu-item\"][data-mpr-user-action=\"toggle-fullscreen\"]",
                LABEL_ENTER_FULL_SCREEN);

                const countersAfterExit = await page.evaluate(() => window.__gravityFullscreenCounters ?? null);
                assert.ok(countersAfterExit && countersAfterExit.exitCalls >= 1, "Expected fullscreen exit to be invoked");
                if (countersAfterExit && countersAfterExit.exitOverride) {
                    assert.equal(
                        countersAfterExit.lastMethod,
                        "webkit",
                        "Expected webkit fullscreen exit when standard API is unavailable"
                    );
                }
            } catch (error) {
                const debugState = await readAuthState(page).catch(() => null);
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Puppeteer fullscreen menu failed: ${errorMessage}; state=${JSON.stringify(debugState)}`, { cause: error });
            } finally {
                await teardown();
            }
        });
    });
}
