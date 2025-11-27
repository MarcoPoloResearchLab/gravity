// @ts-check

import { Buffer } from "node:buffer";

import { createRequestInterceptorController } from "./browserHarness.js";

const DEFAULT_TAUTH_BASE_URL = "http://localhost:58081";
const DEFAULT_SESSION_COOKIE = "app_session";
const DEFAULT_REFRESH_COOKIE = "app_refresh";

/**
 * Install a stub TAuth service for Puppeteer tests by intercepting the auth-client
 * script load plus `/auth/*` HTTP requests.
 * @param {import("puppeteer").Page} page
 * @param {{
 *   baseUrl?: string,
 *   cookieName?: string,
 *   refreshCookieName?: string,
 *   mintSessionToken: (userId: string) => string,
 *   initialProfile?: TAuthProfile|null
 * }} options
 * @returns {Promise<{
 *   baseUrl: string,
 *   getProfile(): TAuthProfile | null,
 *   getRequestLog(): Array<{ method: string, path: string }>,
 *   getPendingNonce(): string | null,
 *   triggerNonceMismatch(): void
 * }>}
 */
export async function installTAuthHarness(page, options) {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_TAUTH_BASE_URL);
    if (!baseUrl) {
        throw new Error("installTAuthHarness requires a baseUrl.");
    }
    const cookieName = options.cookieName ?? DEFAULT_SESSION_COOKIE;
    const refreshCookieName = options.refreshCookieName ?? DEFAULT_REFRESH_COOKIE;
    const mintSessionToken = typeof options.mintSessionToken === "function"
        ? options.mintSessionToken
        : () => "";
    const initialProfile = options.initialProfile ?? null;

    const state = {
        baseUrl,
        profile: initialProfile,
        pendingNonce: null,
        nonceCounter: 0,
        requests: /** @type {Array<{ method: string, path: string }>} */ ([]),
        behavior: {
            failNextNonceExchange: false
        }
    };

    const controller = await createRequestInterceptorController(page);
    controller.add(async (request) => {
        if (!request.url().startsWith(baseUrl)) {
            return false;
        }
        const method = request.method().toUpperCase();
        const path = resolvePath(request.url(), baseUrl);
        state.requests.push({ method, path });
        const corsHeaders = buildCorsHeaders(request);
        if (method === "OPTIONS") {
            request.respond({
                status: 204,
                contentType: "application/json",
                headers: {
                    ...corsHeaders,
                    "Access-Control-Allow-Headers": "content-type,x-requested-with,x-client",
                    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
                },
                body: ""
            }).catch(() => {});
            return true;
        }
        if (method === "GET" && path === "/static/auth-client.js") {
            const scriptBody = buildAuthClientStub(state.profile);
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
            if (state.behavior.failNextNonceExchange) {
                state.behavior.failNextNonceExchange = false;
                respondJson(request, 400, { error: "nonce_mismatch" }, corsHeaders);
                state.pendingNonce = null;
                return true;
            }
            state.pendingNonce = null;
            const profile = deriveProfileFromCredential(credential);
            state.profile = profile;
            const sessionToken = mintSessionToken(profile.user_id);
            respondJson(
                request,
                200,
                profile,
                {
                    ...corsHeaders,
                    "Set-Cookie": buildSetCookieHeaders([
                        { name: cookieName, value: sessionToken, path: "/", httpOnly: true },
                        { name: refreshCookieName, value: `refresh-${Date.now()}`, path: "/auth", httpOnly: true }
                    ])
                }
            );
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
                const sessionToken = mintSessionToken(state.profile.user_id);
                respondJson(
                    request,
                    204,
                    {},
                    {
                        ...corsHeaders,
                        "Set-Cookie": buildSetCookieHeaders([
                            { name: cookieName, value: sessionToken, path: "/", httpOnly: true },
                            { name: refreshCookieName, value: `refresh-${Date.now()}`, path: "/auth", httpOnly: true }
                        ])
                    }
                );
                notifyAuthenticated(page, state.profile);
            } else {
                respondJson(request, 401, { error: "unauthorized" }, corsHeaders);
            }
            return true;
        }
        if (method === "POST" && path === "/auth/logout") {
            state.profile = null;
            respondJson(
                request,
                204,
                {},
                {
                    ...corsHeaders,
                    "Set-Cookie": buildSetCookieHeaders([
                        { name: cookieName, value: "", path: "/", httpOnly: true, maxAge: 0 },
                        { name: refreshCookieName, value: "", path: "/auth", httpOnly: true, maxAge: 0 }
                    ])
                }
            );
            notifyUnauthenticated(page, "logout");
            return true;
        }
        return false;
    });

    page.once("close", () => {
        controller.dispose();
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
        },
        triggerNonceMismatch() {
            state.behavior.failNextNonceExchange = true;
        },
        dispose() {
            controller.dispose();
        }
    };
}

/**
 * @typedef {{ user_id: string, user_email: string | null, display: string | null, avatar_url: string | null, user_display?: string | null, user_avatar_url?: string | null }} TAuthProfile
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

function resolvePath(requestUrl, baseUrl) {
    try {
        const parsed = new URL(requestUrl, baseUrl);
        return parsed.pathname || "/";
    } catch {
        return "/";
    }
}

function normalizeBaseUrl(value) {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed.replace(/\/+$/u, "");
}

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
        display: userDisplay,
        avatar_url: userAvatarUrl,
        user_display: userDisplay,
        user_avatar_url: userAvatarUrl
    };
}

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

function respondJson(request, status, body, headers) {
    const payload = body && Object.keys(body).length > 0 ? JSON.stringify(body) : "";
    request.respond({
        status,
        contentType: "application/json",
        headers,
        body: payload
    }).catch(() => {});
}

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

function buildSetCookieHeaders(entries) {
    return entries.map((entry) => {
        const attributes = [`${entry.name}=${entry.value ?? ""}`];
        attributes.push(`Path=${entry.path ?? "/"}`);
        if (entry.httpOnly) {
            attributes.push("HttpOnly");
        }
        if (typeof entry.maxAge === "number") {
            attributes.push(`Max-Age=${entry.maxAge}`);
        }
        attributes.push("SameSite=Lax");
        return attributes.join("; ");
    });
}

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
                const baseUrl = typeof harness.options?.baseUrl === "string"
                    ? harness.options.baseUrl.replace(/\\/+$/u, "")
                    : "";
                if (baseUrl) {
                    try {
                        await fetch(baseUrl + "/auth/logout", {
                            method: "POST",
                            credentials: "include",
                            headers: { "X-Requested-With": "XMLHttpRequest" }
                        });
                    } catch (error) {
                        console.warn("tauth harness logout failed", error);
                    }
                }
                harness.emitUnauthenticated("logout");
            };
            window.apiFetch = async function apiFetch(resource, init) {
                const requestInit = Object.assign({ credentials: "include" }, init || {});
                const response = await fetch(resource, requestInit);
                const baseUrl = typeof harness.options?.baseUrl === "string"
                    ? harness.options.baseUrl.replace(/\\/+$/u, "")
                    : "";
                if (response.status !== 401 || !baseUrl) {
                    return response;
                }
                try {
                    const refreshResponse = await fetch(baseUrl + "/auth/refresh", {
                        method: "POST",
                        credentials: "include",
                        headers: { "X-Requested-With": "XMLHttpRequest" }
                    });
                    if (!refreshResponse.ok) {
                        if (typeof harness.options?.onUnauthenticated === "function") {
                            harness.options.onUnauthenticated({ reason: "refresh_failed" });
                        }
                        return response;
                    }
                    return fetch(resource, requestInit);
                } catch (error) {
                    console.warn("tauth harness refresh failed", error);
                    return response;
                }
            };
        })();
    `;
}
