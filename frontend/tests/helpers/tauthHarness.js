// @ts-check

import { Buffer } from "node:buffer";

import { registerRequestInterceptor } from "./browserHarness.js";

const DEFAULT_TAUTH_BASE_URL = "http://localhost:58081";

/**
 * Install a stub TAuth service for Puppeteer tests by intercepting the auth-client
 * script load plus `/auth/*` HTTP requests.
 * @param {import("puppeteer").Page} page
 * @param {{
 *   baseUrl?: string,
 *   initialProfile?: TAuthProfile|null
 * }} [options]
 * @returns {Promise<{
 *   baseUrl: string,
 *   getProfile(): TAuthProfile | null,
 *   getRequestLog(): Array<{ method: string, path: string }>,
 *   getPendingNonce(): string | null
 * }>}
 */
export async function installTAuthHarness(page, options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_TAUTH_BASE_URL);
    if (!baseUrl) {
        throw new Error("installTAuthHarness requires a baseUrl.");
    }
    const initialProfile = options.initialProfile ?? null;

    const state = {
        baseUrl,
        profile: initialProfile,
        pendingNonce: null,
        nonceCounter: 0,
        requests: /** @type {Array<{ method: string, path: string }>} */ ([])
    };

    await registerRequestInterceptor(page, (request) => {
        if (!request.url().startsWith(baseUrl)) {
            return false;
        }
        const method = request.method().toUpperCase();
        const path = resolvePath(request.url(), baseUrl);
        console.log("[tauthHarness] intercept", method, path);
        state.requests.push({ method, path });
        const corsHeaders = buildCorsHeaders(request);
        if (method === "OPTIONS") {
            request.respond({
                status: 204,
                contentType: "application/json",
                headers: {
                    ...corsHeaders,
                    "Access-Control-Allow-Headers": "content-type,x-requested-with",
                    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
                },
                body: ""
            }).catch(() => {});
            return true;
        }
        if (method === "GET" && path === "/static/auth-client.js") {
            const scriptBody = buildAuthClientStub(state.profile);
            console.log("[tauthHarness] serving auth-client.js");
            request.respond({
                status: 200,
                contentType: "application/javascript",
                headers: {
                    "Access-Control-Allow-Origin": "*"
                },
                body: scriptBody
            }).catch(() => {});
            return true;
        }
        if (method === "POST" && path === "/auth/nonce") {
            state.pendingNonce = `tauth-nonce-${++state.nonceCounter}`;
            respondJson(request, 200, { nonce: state.pendingNonce }, corsHeaders);
            return true;
        }
        if (method === "POST" && path === "/auth/google") {
            const payload = safeParseRequestBody(request);
            const credential = typeof payload.google_id_token === "string" ? payload.google_id_token : "";
            const nonceToken = typeof payload.nonce_token === "string" ? payload.nonce_token : "";
            if (!credential || !nonceToken || nonceToken !== state.pendingNonce) {
                respondJson(request, 400, { error: "invalid_nonce" }, corsHeaders);
                state.pendingNonce = null;
                return true;
            }
            state.pendingNonce = null;
            const profile = deriveProfileFromCredential(credential);
            state.profile = profile;
            respondJson(request, 200, profile, corsHeaders);
            console.log("[tauthHarness] notifying authenticated");
            notifyAuthenticated(page, profile);
            return true;
        }
        if (method === "GET" && path === "/me") {
            if (state.profile) {
                respondJson(request, 200, state.profile, corsHeaders);
            } else {
                respondJson(request, 401, { error: "unauthorized" }, corsHeaders);
            }
            return true;
        }
        if (method === "POST" && path === "/auth/refresh") {
            if (state.profile) {
                respondJson(request, 204, {}, corsHeaders);
                notifyAuthenticated(page, state.profile);
            } else {
                respondJson(request, 401, { error: "unauthorized" }, corsHeaders);
            }
            return true;
        }
        if (method === "POST" && path === "/auth/logout") {
            state.profile = null;
            respondJson(request, 204, {}, corsHeaders);
            notifyUnauthenticated(page, "logout");
            return true;
        }
        return false;
    });

    return {
        baseUrl,
        getProfile() {
            return state.profile;
        },
        getRequestLog() {
            return [...state.requests];
        },
        getPendingNonce() {
            return state.pendingNonce;
        }
    };
}

/**
 * @typedef {{ user_id: string, user_email: string | null, user_display: string | null, user_avatar_url: string | null }} TAuthProfile
 */

/**
 * @param {import("puppeteer").Page} page
 * @param {TAuthProfile|null} profile
 * @returns {void}
 */
function notifyAuthenticated(page, profile) {
    void page.evaluate((value) => {
        if (typeof window === "undefined" || !window.__tauthHarness) {
            return;
        }
        window.__tauthHarness.emitAuthenticated(value);
    }, profile).catch((error) => {
        console.error("[tauthHarness] emitAuthenticated failed", error);
    });
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string} reason
 * @returns {void}
 */
function notifyUnauthenticated(page, reason) {
    void page.evaluate((value) => {
        if (typeof window === "undefined" || !window.__tauthHarness) {
            return;
        }
        window.__tauthHarness.emitUnauthenticated(value);
    }, reason).catch((error) => {
        console.error("[tauthHarness] emitUnauthenticated failed", error);
    });
}

/**
 * @param {string} requestUrl
 * @param {string} baseUrl
 * @returns {string}
 */
function resolvePath(requestUrl, baseUrl) {
    try {
        const parsed = new URL(requestUrl, baseUrl);
        return parsed.pathname || "/";
    } catch {
        return "/";
    }
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    return trimmed.replace(/\/+$/u, "");
}

/**
 * @param {import("puppeteer").HTTPRequest} request
 * @returns {Record<string, any>}
 */
function safeParseRequestBody(request) {
    try {
        const raw = request.postData() ?? "";
        if (!raw) {
            return {};
        }
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * @param {string} credential
 * @returns {TAuthProfile}
 */
function deriveProfileFromCredential(credential) {
    const payload = decodeJwtPayload(credential);
    const userId = typeof payload.sub === "string" && payload.sub.trim().length > 0
        ? payload.sub.trim()
        : "tauth-user";
    const userEmail = typeof payload.email === "string" && payload.email.trim().length > 0
        ? payload.email.trim()
        : null;
    const userDisplay = typeof payload.name === "string" && payload.name.trim().length > 0
        ? payload.name.trim()
        : userEmail ?? userId;
    const userAvatarUrl = typeof payload.picture === "string" && payload.picture.trim().length > 0
        ? payload.picture.trim()
        : null;
    return {
        user_id: userId,
        user_email: userEmail,
        user_display: userDisplay,
        user_avatar_url: userAvatarUrl
    };
}

/**
 * @param {string} token
 * @returns {Record<string, any>}
 */
function decodeJwtPayload(token) {
    const segments = typeof token === "string" ? token.split(".") : [];
    if (segments.length < 2) {
        return {};
    }
    const payloadSegment = segments[1];
    try {
        const normalized = payloadSegment.replace(/-/gu, "+").replace(/_/gu, "/");
        const paddingNeeded = (4 - (normalized.length % 4)) % 4;
        const padded = normalized + "=".repeat(paddingNeeded);
        const buffer = Buffer.from(padded, "base64");
        const json = buffer.toString("utf8");
        const parsed = JSON.parse(json);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * @param {import("puppeteer").HTTPRequest} request
 * @param {number} status
 * @param {Record<string, any>} body
 * @returns {void}
 */
function respondJson(request, status, body, headers) {
    const payload = body && Object.keys(body).length > 0 ? JSON.stringify(body) : "";
    request.respond({
        status,
        contentType: "application/json",
        headers,
        body: payload
    }).catch(() => {});
}

/**
 * @param {import("puppeteer").HTTPRequest} request
 * @returns {Record<string, string>}
 */
function buildCorsHeaders(request) {
    const headers = request.headers();
    const origin = typeof headers?.origin === "string" && headers.origin.length > 0
        ? headers.origin
        : "file://";
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true"
    };
}

/**
 * Build a stub auth-client script that exposes initAuthClient/logout hooks.
 * @param {TAuthProfile|null} profile
 * @returns {string}
 */
function buildAuthClientStub(profile) {
    const serializedProfile = JSON.stringify(profile ?? null);
    return `
        (function() {
            if (!window.__tauthHarnessEvents) {
                window.__tauthHarnessEvents = { initCount: 0, authenticatedCount: 0 };
            }
            const harness = {
                profile: ${serializedProfile},
                options: null,
                emitAuthenticated(value) {
                    this.profile = value;
                    if (this.options && typeof this.options.onAuthenticated === "function") {
                        window.__tauthHarnessEvents.authenticatedCount += 1;
                        this.options.onAuthenticated(value);
                    }
                },
                emitUnauthenticated(reason) {
                    this.profile = null;
                    if (this.options && typeof this.options.onUnauthenticated === "function") {
                        this.options.onUnauthenticated({ reason });
                    }
                }
            };
            window.__tauthHarness = harness;
            window.initAuthClient = async function initAuthClient(options) {
                window.__tauthHarnessEvents.initCount += 1;
                harness.options = options || {};
                const baseUrl = typeof harness.options.baseUrl === "string"
                    ? harness.options.baseUrl.replace(/\\/+$/u, "")
                    : "";
                if (harness.profile) {
                    harness.emitAuthenticated(harness.profile);
                    return;
                }
                if (!baseUrl) {
                    harness.emitUnauthenticated("missing-base-url");
                    return;
                }
                try {
                    const response = await fetch(baseUrl + "/me", {
                        method: "GET",
                        credentials: "include",
                        headers: { "X-Client": "gravity-tests" }
                    });
                    if (response.ok) {
                        const profile = await response.json();
                        harness.emitAuthenticated(profile);
                        return;
                    }
                } catch (error) {
                    console.warn("tauth harness me() failed", error);
                }
                if (typeof harness.options.onUnauthenticated === "function") {
                    harness.options.onUnauthenticated();
                }
            };
            window.logout = async function logout() {
                harness.emitUnauthenticated("logout");
            };
        })();
    `;
}
