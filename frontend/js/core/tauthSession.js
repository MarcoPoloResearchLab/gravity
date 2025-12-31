// @ts-check

import { appConfig } from "./config.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";
import { encodeUrlBlanks } from "../utils/url.js?build=2024-10-05T12:00:00Z";
import {
    EVENT_AUTH_SIGN_IN,
    EVENT_AUTH_SIGN_OUT,
    EVENT_AUTH_ERROR
} from "../constants.js?build=2024-10-05T12:00:00Z";

const DEFAULT_HEADERS = Object.freeze({
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest"
});

/**
 * Create a controller that bridges TAuth's auth-client to the Gravity UI.
 * @param {{
 *   baseUrl?: string,
 *   eventTarget?: EventTarget|null,
 *   fetchImplementation?: typeof fetch,
 *   tenantId?: string,
 *   windowRef?: typeof window
 * }} [options]
 */
export function createTAuthSession(options = {}) {
    const win = options.windowRef ?? (typeof window !== "undefined" ? window : null);
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? appConfig.authBaseUrl);
    const fetchImplementation = resolveFetchImplementation(options.fetchImplementation, win);
    const events = options.eventTarget ?? (typeof document !== "undefined" ? document : null);
    const tenantId = normalizeTenantId(options.tenantId);

    if (!fetchImplementation) {
        throw new Error("TAuth session requires a fetch implementation.");
    }

    const state = {
        initialized: false,
        initializing: null,
        baseUrl,
        fetch: fetchImplementation,
        initOptions: /** @type {{ baseUrl: string, tenantId?: string, onAuthenticated(profile: unknown): void, onUnauthenticated(): void }|null} */ (null)
    };

    const handleAuthenticated = (profile) => {
        dispatch(events, EVENT_AUTH_SIGN_IN, {
            user: normalizeProfile(profile)
        });
    };
    const handleUnauthenticated = () => {
        dispatch(events, EVENT_AUTH_SIGN_OUT, { reason: "session-ended" });
    };

    return Object.freeze({
        async initialize() {
            await ensureInitialized(false);
        },

        async signOut() {
            if (win && typeof win.logout === "function") {
                await win.logout();
                return;
            }
            const logoutUrl = resolveLogoutEndpoint(win, baseUrl);
            try {
                await state.fetch(logoutUrl, {
                    method: "POST",
                    headers: DEFAULT_HEADERS,
                    credentials: "include"
                });
            } catch (error) {
                logging.error("TAuth logout failed", error);
            }
        },

        async requestNonce() {
            const initialized = await ensureInitialized(false);
            if (!initialized || !win || typeof win.requestNonce !== "function") {
                throw new Error("tauth.nonce_unavailable");
            }
            return win.requestNonce();
        },

        async exchangeGoogleCredential({ credential, nonceToken }) {
            const initialized = await ensureInitialized(false);
            if (!initialized || !win || typeof win.exchangeGoogleCredential !== "function") {
                const reason = "tauth.exchange_unavailable";
                dispatch(events, EVENT_AUTH_ERROR, { reason });
                throw new Error(reason);
            }
            try {
                await win.exchangeGoogleCredential({ credential, nonceToken });
            } catch (error) {
                const reason = error instanceof Error ? error.message : "tauth.exchange_failed";
                dispatch(events, EVENT_AUTH_ERROR, { reason });
                if (error instanceof Error) {
                    throw error;
                }
                throw new Error(reason);
            }
        }
    });

    async function ensureInitialized(forceReload) {
        if (state.initializing) {
            await state.initializing;
            if (!forceReload) {
                return state.initialized;
            }
        }
        if (state.initialized && !forceReload) {
            return true;
        }
        state.initializing = (async () => {
            if (!win || typeof win.initAuthClient !== "function") {
                logging.warn("TAuth auth-client unavailable; skipping session initialization.");
                return false;
            }
            if (!state.initOptions) {
                state.initOptions = {
                    baseUrl,
                    ...(tenantId ? { tenantId } : {}),
                    onAuthenticated: handleAuthenticated,
                    onUnauthenticated: handleUnauthenticated
                };
            }
            try {
                await win.initAuthClient(state.initOptions);
                return true;
            } catch (error) {
                logging.error("TAuth client initialization failed", error);
                return false;
            }
        })();
        try {
            const result = await state.initializing;
            state.initialized = Boolean(result);
            return state.initialized;
        } finally {
            state.initializing = null;
        }
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
    const encoded = encodeUrlBlanks(trimmed);
    return encoded.replace(/\/+$/u, "");
}

/**
 * Normalize a tenant identifier.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTenantId(value) {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed;
}

/**
 * Resolve the logout endpoint from the auth-client when available.
 * @param {typeof window|null} windowRef
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveLogoutEndpoint(windowRef, baseUrl) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const fallback = `${normalizedBaseUrl}/auth/logout`;
    if (!windowRef || typeof windowRef.getAuthEndpoints !== "function") {
        return fallback;
    }
    try {
        const endpoints = windowRef.getAuthEndpoints();
        const logoutUrl = normalizeEndpoint(endpoints?.logoutUrl) || fallback;
        return logoutUrl;
    } catch (error) {
        logging.warn("Failed to resolve TAuth logout endpoint from auth-client", error);
        return fallback;
    }
}

/**
 * Normalize endpoint URLs while ensuring blanks are percent-encoded.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeEndpoint(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return encodeUrlBlanks(trimmed);
}

function resolveFetchImplementation(customFetch, windowRef) {
    if (typeof customFetch === "function") {
        return customFetch;
    }
    if (typeof fetch === "function") {
        const scope = resolveGlobalScope(windowRef);
        if (typeof fetch.bind === "function") {
            return fetch.bind(scope);
        }
        return (...args) => fetch.apply(scope, args);
    }
    return null;
}

function resolveGlobalScope(windowRef) {
    if (windowRef && typeof windowRef === "object") {
        return windowRef;
    }
    if (typeof globalThis === "object" && globalThis !== null) {
        return globalThis;
    }
    return undefined;
}

function dispatch(target, type, detail) {
    if (!target) {
        return;
    }
    try {
        target.dispatchEvent(new CustomEvent(type, { detail }));
    } catch (error) {
        logging.error(error);
    }
}

function normalizeProfile(profile) {
    if (!profile || typeof profile !== "object") {
        return null;
    }
    return {
        id: typeof profile.user_id === "string" ? profile.user_id : null,
        email: typeof profile.user_email === "string" ? profile.user_email : null,
        name: selectString(profile, ["display", "user_display", "user_display_name"]),
        pictureUrl: selectString(profile, ["avatar_url", "user_avatar_url"]),
        raw: profile
    };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string[]} keys
 * @returns {string|null}
 */
function selectString(profile, keys) {
    for (const key of keys) {
        const value = profile[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}
