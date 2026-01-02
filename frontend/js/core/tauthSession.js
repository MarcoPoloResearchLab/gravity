// @ts-check

import {
    EVENT_AUTH_SIGN_IN,
    EVENT_AUTH_SIGN_OUT,
    EVENT_AUTH_ERROR
} from "../constants.js?build=2026-01-01T22:43:21Z";

const TYPE_FUNCTION = "function";
const TYPE_OBJECT = "object";
const TYPE_STRING = "string";
const TYPE_UNDEFINED = "undefined";

const ERROR_MESSAGES = Object.freeze({
    MISSING_WINDOW: "tauth_session.missing_window",
    MISSING_EVENT_TARGET: "tauth_session.missing_event_target",
    MISSING_BASE_URL: "tauth_session.missing_base_url",
    INVALID_TENANT_ID: "tauth_session.invalid_tenant_id",
    MISSING_INIT: "tauth_session.missing_init_auth_client",
    MISSING_LOGOUT: "tauth_session.missing_logout",
    NONCE_UNAVAILABLE: "tauth.nonce_unavailable",
    EXCHANGE_UNAVAILABLE: "tauth.exchange_unavailable",
    EXCHANGE_FAILED: "tauth.exchange_failed"
});

const UNAUTHENTICATED_REASON = "session-ended";

const PROFILE_KEYS = Object.freeze({
    USER_ID: "user_id",
    USER_EMAIL: "user_email",
    DISPLAY: "display",
    USER_DISPLAY: "user_display",
    USER_DISPLAY_NAME: "user_display_name",
    AVATAR_URL: "avatar_url",
    USER_AVATAR_URL: "user_avatar_url"
});

const PROFILE_NAME_KEYS = Object.freeze([
    PROFILE_KEYS.DISPLAY,
    PROFILE_KEYS.USER_DISPLAY,
    PROFILE_KEYS.USER_DISPLAY_NAME
]);

const PROFILE_AVATAR_KEYS = Object.freeze([
    PROFILE_KEYS.AVATAR_URL,
    PROFILE_KEYS.USER_AVATAR_URL
]);

/**
 * Create a controller that bridges TAuth's auth-client to the Gravity UI.
 * @param {{
 *   baseUrl: string,
 *   eventTarget?: EventTarget|null,
 *   tenantId?: string,
 *   windowRef?: typeof window
 * }} [options]
 */
export function createTAuthSession(options = {}) {
    const win = options.windowRef ?? (typeof window !== TYPE_UNDEFINED ? window : null);
    if (!win) {
        throw new Error(ERROR_MESSAGES.MISSING_WINDOW);
    }
    if (typeof win.initAuthClient !== TYPE_FUNCTION) {
        throw new Error(ERROR_MESSAGES.MISSING_INIT);
    }
    const baseUrl = options.baseUrl;
    if (typeof baseUrl !== TYPE_STRING || baseUrl.length === 0) {
        throw new Error(ERROR_MESSAGES.MISSING_BASE_URL);
    }
    const events = options.eventTarget ?? (typeof document !== TYPE_UNDEFINED ? document : null);
    if (!events || typeof events.dispatchEvent !== TYPE_FUNCTION) {
        throw new Error(ERROR_MESSAGES.MISSING_EVENT_TARGET);
    }
    const tenantId = options.tenantId ?? null;
    if (tenantId !== null && tenantId !== undefined && typeof tenantId !== TYPE_STRING) {
        throw new Error(ERROR_MESSAGES.INVALID_TENANT_ID);
    }

    const state = {
        initialized: false,
        initializing: null,
        baseUrl,
        initOptions: /** @type {{ baseUrl: string, tenantId?: string, onAuthenticated(profile: unknown): void, onUnauthenticated(): void }|null} */ (null)
    };

    const handleAuthenticated = (profile) => {
        dispatch(events, EVENT_AUTH_SIGN_IN, {
            user: normalizeProfile(profile)
        });
    };
    const handleUnauthenticated = () => {
        dispatch(events, EVENT_AUTH_SIGN_OUT, { reason: UNAUTHENTICATED_REASON });
    };

    return Object.freeze({
        async initialize() {
            await ensureInitialized(false);
        },

        async signOut() {
            await ensureInitialized(false);
            if (typeof win.logout !== TYPE_FUNCTION) {
                throw new Error(ERROR_MESSAGES.MISSING_LOGOUT);
            }
            await win.logout();
        },

        async requestNonce() {
            await ensureInitialized(false);
            if (typeof win.requestNonce !== TYPE_FUNCTION) {
                throw new Error(ERROR_MESSAGES.NONCE_UNAVAILABLE);
            }
            return win.requestNonce();
        },

        async exchangeGoogleCredential({ credential, nonceToken }) {
            await ensureInitialized(false);
            if (typeof win.exchangeGoogleCredential !== TYPE_FUNCTION) {
                const reason = ERROR_MESSAGES.EXCHANGE_UNAVAILABLE;
                dispatch(events, EVENT_AUTH_ERROR, { reason });
                throw new Error(reason);
            }
            try {
                await win.exchangeGoogleCredential({ credential, nonceToken });
            } catch (error) {
                const reason = error instanceof Error ? error.message : ERROR_MESSAGES.EXCHANGE_FAILED;
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
            if (!state.initOptions) {
                const initOptions = {
                    baseUrl,
                    onAuthenticated: handleAuthenticated,
                    onUnauthenticated: handleUnauthenticated
                };
                if (tenantId !== null && tenantId !== undefined) {
                    initOptions.tenantId = tenantId;
                }
                state.initOptions = initOptions;
            }
            await win.initAuthClient(state.initOptions);
            return true;
        })();
        try {
            const result = await state.initializing;
            state.initialized = Boolean(result);
            return state.initialized;
        } catch (error) {
            state.initialized = false;
            throw error;
        } finally {
            state.initializing = null;
        }
    }
}

function dispatch(target, type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
}

function normalizeProfile(profile) {
    if (!profile || typeof profile !== TYPE_OBJECT) {
        return null;
    }
    return {
        id: typeof profile[PROFILE_KEYS.USER_ID] === TYPE_STRING ? profile[PROFILE_KEYS.USER_ID] : null,
        email: typeof profile[PROFILE_KEYS.USER_EMAIL] === TYPE_STRING ? profile[PROFILE_KEYS.USER_EMAIL] : null,
        name: selectString(profile, PROFILE_NAME_KEYS),
        pictureUrl: selectString(profile, PROFILE_AVATAR_KEYS),
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
        if (typeof value === TYPE_STRING && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}
