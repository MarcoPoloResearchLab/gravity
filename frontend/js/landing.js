// @ts-check

/**
 * Landing page auth handler.
 * Redirects to /app.html on successful authentication.
 * Checks for existing session on load and redirects if already authenticated.
 */

const EVENT_MPR_AUTH_AUTHENTICATED = "mpr-ui:auth:authenticated";
const EVENT_MPR_AUTH_ERROR = "mpr-ui:auth:error";
const AUTH_CHECK_ENDPOINT = "/me";
const AUTHENTICATED_REDIRECT = "/app.html";
const ERROR_AUTHENTICATION_GENERIC = "Authentication error";

/**
 * Initialize the landing page auth handling.
 * @returns {void}
 */
function initializeLandingAuth() {
    // Listen for successful authentication from mpr-ui
    document.body.addEventListener(EVENT_MPR_AUTH_AUTHENTICATED, handleAuthenticated);
    document.body.addEventListener(EVENT_MPR_AUTH_ERROR, handleAuthError);

    // Check for existing session on page load
    checkExistingSession();
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

    // Successfully authenticated, redirect to app
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
        // eslint-disable-next-line no-console
        console.warn("Auth error reported by mpr-ui", detail);
    }
    showError(ERROR_AUTHENTICATION_GENERIC);
}

/**
 * Check for existing session and redirect if authenticated.
 * @returns {Promise<void>}
 */
async function checkExistingSession() {
    try {
        const response = await fetch(AUTH_CHECK_ENDPOINT, { credentials: "include" });
        if (response.ok) {
            redirectToApp();
        }
    } catch (error) {
        // Stay on landing page if check fails
        // eslint-disable-next-line no-console
        console.warn("Session check failed", error);
    }
}

/**
 * Redirect to the authenticated app page.
 * Only redirects on HTTP/HTTPS URLs (not file:// URLs used in tests).
 * @returns {void}
 */
function redirectToApp() {
    if (typeof window !== "undefined") {
        const protocol = window.location.protocol;
        // Only redirect on HTTP/HTTPS, not file:// URLs (used in tests)
        if (protocol === "http:" || protocol === "https:") {
            window.location.href = AUTHENTICATED_REDIRECT;
        }
    }
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
