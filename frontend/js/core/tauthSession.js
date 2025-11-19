// @ts-check

import { appConfig } from "./config.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";
import {
    EVENT_AUTH_SIGN_IN,
    EVENT_AUTH_SIGN_OUT,
    EVENT_AUTH_ERROR,
    EVENT_AUTH_CREDENTIAL_RECEIVED
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
 *   windowRef?: typeof window
 * }} [options]
 */
export function createTAuthSession(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? appConfig.authBaseUrl);
    const fetchImplementation = options.fetchImplementation ?? (typeof fetch === "function" ? fetch : null);
    const win = options.windowRef ?? (typeof window !== "undefined" ? window : null);
    const events = options.eventTarget ?? (typeof document !== "undefined" ? document : null);

    if (!fetchImplementation) {
        throw new Error("TAuth session requires a fetch implementation.");
    }

    const state = {
        initialized: false,
        initializing: null,
        baseUrl,
        fetch: fetchImplementation
    };

    return Object.freeze({
        async initialize(googleController) {
            if (state.initialized || state.initializing) {
                await state.initializing;
                return;
            }
            state.initializing = (async () => {
                if (!win || typeof win.initAuthClient !== "function") {
                    logging.warn("TAuth auth-client unavailable; skipping session initialization.");
                    return;
                }
                await win.initAuthClient({
                    baseUrl,
                    onAuthenticated(profile) {
                        dispatch(events, EVENT_AUTH_SIGN_IN, { user: normalizeProfile(profile) });
                    },
                    onUnauthenticated() {
                        dispatch(events, EVENT_AUTH_SIGN_OUT, { reason: "session-ended" });
                    }
                });
                if (googleController) {
                    googleController.setCredentialCallback(async (credential) => {
                        try {
                            const nonce = await controller.requestNonce();
                            await controller.exchangeGoogleCredential({ credential, nonceToken: nonce });
                        } catch (error) {
                            logging.error("TAuth credential exchange failed", error);
                            dispatch(events, EVENT_AUTH_ERROR, { reason: error instanceof Error ? error.message : "exchange_failed" });
                        }
                    });
                }
                state.initialized = true;
            })();
            await state.initializing;
        },

        async signOut() {
            if (win && typeof win.logout === "function") {
                await win.logout();
                return;
            }
            try {
                await state.fetch(`${baseUrl}/auth/logout`, {
                    method: "POST",
                    headers: DEFAULT_HEADERS,
                    credentials: "include"
                });
            } catch (error) {
                logging.error("TAuth logout failed", error);
            }
        },

        async requestNonce() {
            const response = await state.fetch(`${baseUrl}/auth/nonce`, {
                method: "POST",
                headers: DEFAULT_HEADERS,
                credentials: "include"
            });
            if (!response.ok) {
                throw new Error("tauth.nonce_failed");
            }
            const payload = await response.json();
            if (!payload || typeof payload.nonce !== "string" || payload.nonce.length === 0) {
                throw new Error("tauth.nonce_invalid");
            }
            return payload.nonce;
        },

        async exchangeGoogleCredential({ credential, nonceToken }) {
            if (!credential) {
                throw new Error("tauth.missing_credential");
            }
            const body = JSON.stringify({ google_id_token: credential, nonce_token: nonceToken ?? null });
            const response = await state.fetch(`${baseUrl}/auth/google`, {
                method: "POST",
                headers: DEFAULT_HEADERS,
                credentials: "include",
                body
            });
            if (!response.ok) {
                const payload = await safeJson(response);
                const reason = payload?.error ?? "tauth.exchange_failed";
                dispatch(events, EVENT_AUTH_ERROR, { reason });
                throw new Error(reason);
            }
        }
    });
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

async function safeJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function normalizeProfile(profile) {
    if (!profile || typeof profile !== "object") {
        return null;
    }
    return {
        id: typeof profile.user_id === "string" ? profile.user_id : null,
        email: typeof profile.user_email === "string" ? profile.user_email : null,
        name: typeof profile.user_display === "string" ? profile.user_display : null,
        pictureUrl: typeof profile.user_avatar_url === "string" ? profile.user_avatar_url : null,
        raw: profile
    };
}
