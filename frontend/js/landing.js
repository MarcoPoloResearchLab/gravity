// @ts-check

import {
    ERROR_AUTHENTICATION_GENERIC,
    EVENT_MPR_AUTH_AUTHENTICATED,
    EVENT_MPR_AUTH_ERROR
} from "./constants.js?build=2026-01-01T22:43:21Z";
import {
    canNavigate,
    ensureAuthReady,
    bootstrapTauthSession
} from "./core/authBootstrap.js?build=2026-01-01T22:43:21Z";
import { initializeRuntimeConfig } from "./core/runtimeConfig.js?build=2026-01-01T22:43:21Z";
import { logging } from "./utils/logging.js?build=2026-01-01T22:43:21Z";

/**
 * Landing page auth handler.
 * Redirects to /app.html on successful authentication.
 * Checks for existing session on load and redirects if already authenticated.
 */

const AUTHENTICATED_REDIRECT = "/app.html";

/**
 * Initialize the landing page auth handling.
 * @returns {void}
 */
function initializeLandingAuth() {
    document.body.addEventListener(EVENT_MPR_AUTH_AUTHENTICATED, handleAuthenticated);
    document.body.addEventListener(EVENT_MPR_AUTH_ERROR, handleAuthError);
    void bootstrapExistingSession();
}

/**
 * Handle successful authentication event.
 * @param {Event} event
 * @returns {void}
 */
function handleAuthenticated(event) {
    const detail = /** @type {{ profile?: unknown }} */ (event?.detail ?? {});
    const profile = detail.profile;

    if (!profile || typeof profile !== "object") {
        showError(ERROR_AUTHENTICATION_GENERIC);
        return;
    }

    const record = /** @type {Record<string, unknown>} */ (profile);
    const userId = record.user_id ?? record.id ?? record.sub ?? null;

    if (!userId) {
        showError(ERROR_AUTHENTICATION_GENERIC);
        return;
    }

    redirectToApp();
}

/**
 * Handle auth error event.
 * @param {Event} event
 * @returns {void}
 */
function handleAuthError(event) {
    const detail = /** @type {{ message?: string, code?: string }} */ (event?.detail ?? {});
    if (detail?.code) {
        logging.warn("Auth error reported by mpr-ui", detail);
    }
    showError(ERROR_AUTHENTICATION_GENERIC);
}

/**
 * Check for existing session after mpr-ui + tauth are ready.
 * @returns {Promise<void>}
 */
async function bootstrapExistingSession() {
    try {
        await ensureAuthReady();
        const appConfig = await initializeRuntimeConfig();
        const session = await bootstrapTauthSession(appConfig);
        if (session?.profile) {
            dispatchMprAuthEvent(EVENT_MPR_AUTH_AUTHENTICATED, { profile: session.profile });
        }
    } catch (error) {
        logging.warn("Landing auth bootstrap failed", error);
    }
}

/**
 * Redirect to the authenticated app page.
 * Only redirects on HTTP/HTTPS URLs (not file:// URLs used in tests).
 * @returns {void}
 */
function redirectToApp() {
    if (typeof window !== "undefined" && canNavigate(window.location)) {
        window.location.href = AUTHENTICATED_REDIRECT;
    }
}

/**
 * Dispatch an mpr-ui auth event to the document body.
 * @param {string} eventName
 * @param {Record<string, unknown>} detail
 * @returns {void}
 */
function dispatchMprAuthEvent(eventName, detail) {
    if (typeof document === "undefined") {
        return;
    }
    const target = document.body ?? document;
    if (!target || typeof target.dispatchEvent !== "function") {
        return;
    }
    target.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
}

/**
 * Display an error message in the landing status element.
 * @param {string} message
 * @returns {void}
 */
function showError(message) {
    const statusElement = document.querySelector("[data-test=\"landing-status\"]");
    if (statusElement instanceof HTMLElement) {
        statusElement.hidden = false;
        statusElement.textContent = message;
        statusElement.dataset.status = "error";
        statusElement.setAttribute("aria-hidden", "false");
    }
}

// Initialize on DOM ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLandingAuth, { once: true });
} else {
    initializeLandingAuth();
}
