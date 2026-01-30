// @ts-check

const READY_POLL_INTERVAL_MS = 25;
const READY_TIMEOUT_MS = 5000;
const TAUTH_SESSION_TIMEOUT_MS = READY_TIMEOUT_MS;
const DOCUMENT_READY_STATE_LOADING = "loading";
const NAVIGATION_PROTOCOL_HTTP = "http:";
const NAVIGATION_PROTOCOL_HTTPS = "https:";
const TAUTH_INIT_ENDPOINT_DEFAULT = "/me";

export const AUTH_BOOTSTRAP_ERRORS = Object.freeze({
    MISSING_INIT: "tauth.initAuthClient_missing",
    MISSING_REQUEST_NONCE: "tauth.requestNonce_missing",
    MISSING_EXCHANGE: "tauth.exchangeGoogleCredential_missing",
    MISSING_CURRENT_USER: "tauth.getCurrentUser_missing",
    MISSING_LOGOUT: "tauth.logout_missing",
    MPR_LOGIN_MISSING: "mpr_ui.login_button_missing",
    MPR_USER_MISSING: "mpr_ui.user_menu_missing",
    MPR_UI_CONFIG_MISSING: "mpr_ui.config_missing",
    UNSUPPORTED: "gravity.unsupported_environment"
});

let authReadyPromise = null;
let authSessionPromise = null;

/**
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
function waitFor(durationMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });
}

/**
 * @returns {Promise<void>}
 */
function waitForDocumentReady() {
    if (typeof document === "undefined") {
        return Promise.resolve();
    }
    if (document.readyState !== DOCUMENT_READY_STATE_LOADING) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
}

/**
 * @param {unknown} candidate
 * @param {string} errorMessage
 * @returns {Function}
 */
export function requireFunction(candidate, errorMessage) {
    if (typeof candidate !== "function") {
        throw new Error(errorMessage);
    }
    return candidate;
}

/**
 * @returns {boolean}
 */
function areTAuthHelpersAvailable() {
    if (typeof window === "undefined") {
        return false;
    }
    return typeof window.initAuthClient === "function"
        && typeof window.requestNonce === "function"
        && typeof window.exchangeGoogleCredential === "function"
        && typeof window.getCurrentUser === "function"
        && typeof window.logout === "function";
}

/**
 * Ensure required TAuth helpers exist before mpr-ui boots.
 * @returns {void}
 */
function assertTAuthHelpersAvailable() {
    if (typeof window === "undefined") {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
    }
    requireFunction(window.initAuthClient, AUTH_BOOTSTRAP_ERRORS.MISSING_INIT);
    requireFunction(window.requestNonce, AUTH_BOOTSTRAP_ERRORS.MISSING_REQUEST_NONCE);
    requireFunction(window.exchangeGoogleCredential, AUTH_BOOTSTRAP_ERRORS.MISSING_EXCHANGE);
    requireFunction(window.getCurrentUser, AUTH_BOOTSTRAP_ERRORS.MISSING_CURRENT_USER);
    requireFunction(window.logout, AUTH_BOOTSTRAP_ERRORS.MISSING_LOGOUT);
}

/**
 * Ensure mpr-ui custom elements are registered before use.
 * @returns {void}
 */
function assertAuthComponentsAvailable() {
    if (typeof window === "undefined" || typeof window.customElements === "undefined") {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
    }
    if (!window.customElements.get("mpr-login-button")) {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.MPR_LOGIN_MISSING);
    }
    if (!window.customElements.get("mpr-user")) {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.MPR_USER_MISSING);
    }
}

/**
 * @returns {Promise<void>}
 */
async function waitForAuthComponents() {
    if (typeof window === "undefined" || typeof window.customElements === "undefined") {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
    }
    if (window.customElements.get("mpr-login-button") && window.customElements.get("mpr-user")) {
        return;
    }
    const promises = [];
    if (typeof window.customElements.whenDefined === "function") {
        promises.push(window.customElements.whenDefined("mpr-login-button"));
        promises.push(window.customElements.whenDefined("mpr-user"));
    }
    if (promises.length > 0) {
        await Promise.race([
            Promise.all(promises),
            waitFor(READY_TIMEOUT_MS)
        ]);
    }
    assertAuthComponentsAvailable();
}

/**
 * @returns {Promise<void>}
 */
async function waitForTAuthHelpers() {
    if (typeof window === "undefined") {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
    }
    const startTime = Date.now();
    while (Date.now() - startTime < READY_TIMEOUT_MS) {
        if (areTAuthHelpersAvailable()) {
            return;
        }
        await waitFor(READY_POLL_INTERVAL_MS);
    }
    assertTAuthHelpersAvailable();
}

/**
 * @returns {Promise<Promise<void>>}
 */
export async function waitForMprUiReadyPromise() {
    if (typeof window === "undefined") {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
    }
    const immediateReady = window.__mprUiReady;
    if (immediateReady && typeof immediateReady.then === "function") {
        return immediateReady;
    }
    await waitForDocumentReady();
    const startTime = Date.now();
    while (Date.now() - startTime < READY_TIMEOUT_MS) {
        const pendingReady = window.__mprUiReady;
        if (pendingReady && typeof pendingReady.then === "function") {
            return pendingReady;
        }
        await waitFor(READY_POLL_INTERVAL_MS);
    }
    throw new Error(AUTH_BOOTSTRAP_ERRORS.MPR_UI_CONFIG_MISSING);
}

/**
 * Ensure the mpr-ui config loader applied config and loaded the bundle.
 * @returns {Promise<void>}
 */
async function ensureMprUiReady() {
    if (typeof window === "undefined") {
        throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
    }
    const ready = await waitForMprUiReadyPromise();
    await ready;
}

/**
 * @returns {Promise<void>}
 */
export async function ensureAuthReady() {
    if (authReadyPromise) {
        return authReadyPromise;
    }
    authReadyPromise = (async () => {
        await ensureMprUiReady();
        await waitForTAuthHelpers();
        await waitForAuthComponents();
    })();
    return authReadyPromise;
}

/**
 * @param {import("./config.js").AppConfig} appConfig
 * @returns {Promise<{ status: "authenticated" | "unauthenticated", profile: unknown|null }>}
 */
export async function bootstrapTauthSession(appConfig) {
    if (authSessionPromise) {
        return authSessionPromise;
    }
    authSessionPromise = (async () => {
        if (typeof window === "undefined") {
            throw new Error(AUTH_BOOTSTRAP_ERRORS.UNSUPPORTED);
        }
        const initAuthClient = requireFunction(window.initAuthClient, AUTH_BOOTSTRAP_ERRORS.MISSING_INIT);
        const getCurrentUser = requireFunction(window.getCurrentUser, AUTH_BOOTSTRAP_ERRORS.MISSING_CURRENT_USER);
        /** @type {(value: { status: "authenticated" | "unauthenticated", profile: unknown|null }) => void} */
        let resolveSession;
        /** @type {(reason?: unknown) => void} */
        let rejectSession;
        let settled = false;
        const sessionPromise = new Promise((resolve, reject) => {
            resolveSession = resolve;
            rejectSession = reject;
        });
        const resolveOnce = (status, profile) => {
            if (settled) {
                return;
            }
            settled = true;
            resolveSession({ status, profile });
        };
        const onAuthenticated = (profile) => {
            resolveOnce("authenticated", profile ?? null);
        };
        const onUnauthenticated = () => {
            resolveOnce("unauthenticated", null);
        };

        const baseUrl = appConfig.authBaseUrl;
        const tenantId = appConfig.authTenantId;
        await Promise.resolve(initAuthClient({
            baseUrl,
            meEndpoint: TAUTH_INIT_ENDPOINT_DEFAULT,
            tenantId,
            onAuthenticated,
            onUnauthenticated
        })).catch((error) => {
            rejectSession(error);
            throw error;
        });

        const resolvedSession = await Promise.race([
            sessionPromise,
            waitFor(TAUTH_SESSION_TIMEOUT_MS).then(() => null)
        ]);
        if (resolvedSession) {
            return resolvedSession;
        }
        const fallbackProfile = await getCurrentUser().catch(() => null);
        return fallbackProfile
            ? { status: "authenticated", profile: fallbackProfile }
            : { status: "unauthenticated", profile: null };
    })();
    authSessionPromise.catch(() => {
        authSessionPromise = null;
    });
    return authSessionPromise;
}

/**
 * @param {Location|undefined} runtimeLocation
 * @returns {boolean}
 */
export function canNavigate(runtimeLocation) {
    if (!runtimeLocation) {
        return false;
    }
    return runtimeLocation.protocol === NAVIGATION_PROTOCOL_HTTP
        || runtimeLocation.protocol === NAVIGATION_PROTOCOL_HTTPS;
}
