// @ts-check

import {
    EVENT_AUTH_ERROR,
    EVENT_AUTH_SIGN_IN,
    EVENT_AUTH_SIGN_OUT
} from "../constants.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";

/**
 * @typedef {{
 *   clientId: string,
 *   google?: typeof globalThis.google,
 *   buttonElement?: Element | null,
 *   eventTarget?: EventTarget,
 *   autoPrompt?: boolean,
 *   location?: Location | null
 * }} GoogleIdentityOptions
 */

/**
 * Create a controller that wires Google Identity Services to the application.
 * @param {GoogleIdentityOptions} options
 * @returns {{ signOut(reason?: string): void, dispose(): void }}
 */
export function createGoogleIdentityController(options) {
    const {
        clientId,
        google = typeof globalThis !== "undefined" ? /** @type {any} */ (globalThis.google) : undefined,
        buttonElement = null,
        eventTarget = typeof document !== "undefined" ? document : undefined,
        autoPrompt = true,
        location = typeof window !== "undefined" ? window.location : undefined
    } = options || {};

    if (!isNonEmptyString(clientId)) {
        throw new Error("Google Identity Services requires a clientId.");
    }

    if (!google || !google.accounts || !google.accounts.id) {
        logging.warn("Google Identity Services unavailable; skipping initialization.");
        return createNoopController(eventTarget);
    }

    const identity = google.accounts.id;

    if (!isGoogleIdentitySupportedOrigin(location ?? undefined)) {
        if (isElementLike(buttonElement)) {
            buttonElement.dataset.googleSignIn = "unavailable";
        }
        return createNoopController(eventTarget);
    }

    let disposed = false;
    let currentUser = null;

    const handleCredentialResponse = (response) => {
        if (!response || typeof response.credential !== "string" || response.credential.length === 0) {
            dispatch(EVENT_AUTH_ERROR, { reason: "empty-credential" });
            return;
        }

        try {
            const payload = decodeGoogleCredential(response.credential);
            const user = normalizeUser(payload);
            currentUser = user;
            dispatch(EVENT_AUTH_SIGN_IN, {
                user,
                credential: response.credential
            });
        } catch (error) {
            logging.error(error);
            dispatch(EVENT_AUTH_ERROR, {
                reason: "credential-parse",
                error: error instanceof Error ? error.message : "Unknown error"
            });
        }
    };

    try {
        identity.initialize({
            client_id: clientId,
            callback: handleCredentialResponse,
            auto_select: autoPrompt !== false
        });
    } catch (error) {
        logging.error(error);
        dispatch(EVENT_AUTH_ERROR, {
            reason: "initialize-failed",
            error: error instanceof Error ? error.message : "Unknown error"
        });
        return createNoopController(eventTarget);
    }

    if (buttonElement && typeof identity.renderButton === "function") {
        try {
        identity.renderButton(buttonElement, {
            theme: "outline",
            size: "small",
            shape: "pill",
            text: "signin_with"
        });
        } catch (error) {
            logging.error(error);
        }
    }

    if (autoPrompt !== false && typeof identity.prompt === "function") {
        queueMicrotask(() => {
            try {
                identity.prompt();
            } catch (error) {
                logging.error(error);
            }
        });
    }

    function signOut(reason = "manual") {
        currentUser = null;
        if (typeof identity.disableAutoSelect === "function") {
            try {
                identity.disableAutoSelect();
            } catch (error) {
                logging.error(error);
            }
        }
        dispatch(EVENT_AUTH_SIGN_OUT, { reason });
    }

    function disposeController() {
        disposed = true;
        currentUser = null;
    }

    function dispatch(eventName, detail) {
        if (!eventTarget || disposed) {
            return;
        }
        try {
            const event = new CustomEvent(eventName, {
                bubbles: true,
                detail
            });
            eventTarget.dispatchEvent(event);
        } catch (error) {
            logging.error(error);
            const fallbackEvent = new Event(eventName);
            /** @type {any} */ (fallbackEvent).detail = detail;
            eventTarget.dispatchEvent(fallbackEvent);
        }
    }

    return Object.freeze({
        signOut,
        dispose: disposeController
    });
}

/**
 * Decode the payload portion of a Google Identity credential.
 * @param {string} credential
 * @returns {Record<string, unknown>}
 */
export function decodeGoogleCredential(credential) {
    if (!isNonEmptyString(credential)) {
        throw new Error("Credential must be a non-empty string.");
    }
    const segments = credential.split(".");
    if (segments.length < 2) {
        throw new Error("Credential is not a valid JWT.");
    }
    const payload = segments[1];
    const json = decodeBase64Url(payload);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Credential payload is not an object.");
    }
    return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Normalize raw credential payload into the user object exposed to consumers.
 * @param {Record<string, unknown>} payload
 * @returns {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }}
 */
function normalizeUser(payload) {
    const id = typeof payload.sub === "string" ? payload.sub : null;
    if (!isNonEmptyString(id)) {
        throw new Error("Credential payload missing `sub`.");
    }
    const email = typeof payload.email === "string" ? payload.email : null;
    const name = typeof payload.name === "string" ? payload.name : (email ?? null);
    const pictureUrl = typeof payload.picture === "string" ? payload.picture : null;
    return {
        id,
        email,
        name,
        pictureUrl
    };
}

/**
 * Decode a base64url string into JSON text.
 * @param {string} value
 * @returns {string}
 */
function decodeBase64Url(value) {
    const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
    const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof globalThis.atob === "function") {
        return decodeWithAtob(normalized);
    }
    return Buffer.from(normalized, "base64").toString("utf8");
}

/**
 * @param {string} normalized
 * @returns {string}
 */
function decodeWithAtob(normalized) {
    const binary = globalThis.atob(normalized);
    let result = "";
    for (let index = 0; index < binary.length; index += 1) {
        const code = binary.charCodeAt(index);
        result += String.fromCharCode(code);
    }
    return decodeURIComponent(escapeString(result));
}

/**
 * Escape helper for percent-encoding characters.
 * @param {string} value
 * @returns {string}
 */
function escapeString(value) {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
        const charCode = value.charCodeAt(index);
        result += `%${charCode.toString(16).padStart(2, "0")}`;
    }
    return result;
}

/**
 * @param {EventTarget|undefined} eventTarget
 * @returns {{ signOut(reason?: string): void, dispose(): void }}
 */
function createNoopController(eventTarget) {
    return Object.freeze({
        signOut(reason = "noop") {
            if (!eventTarget) {
                return;
            }
            try {
                const event = new CustomEvent(EVENT_AUTH_SIGN_OUT, {
                    bubbles: true,
                    detail: { reason }
                });
                eventTarget.dispatchEvent(event);
            } catch {
                const fallbackEvent = new Event(EVENT_AUTH_SIGN_OUT);
                /** @type {any} */ (fallbackEvent).detail = { reason };
                eventTarget.dispatchEvent(fallbackEvent);
            }
        },
        dispose() {
            // no-op
        }
    });
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} candidate
 * @returns {candidate is { dataset: Record<string, string> }}
 */
function isElementLike(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(candidate, "dataset") && typeof /** @type {any} */ (candidate).dataset === "object";
}

/**
 * Determine whether Google Identity Services should initialize for the provided location.
 * @param {Location|undefined|null} runtimeLocation
 * @returns {boolean}
 */
export function isGoogleIdentitySupportedOrigin(runtimeLocation) {
    if (!runtimeLocation) {
        return true;
    }
    const protocol = typeof runtimeLocation.protocol === "string" ? runtimeLocation.protocol.toLowerCase() : "";
    const hostname = typeof runtimeLocation.hostname === "string" ? runtimeLocation.hostname.toLowerCase() : "";
    if (!protocol) {
        return false;
    }
    if (protocol === "file:" || protocol === "about:") {
        return false;
    }
    if (protocol === "https:") {
        return true;
    }
    if (protocol === "http:" && hostname) {
        if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
            return true;
        }
        if (hostname.endsWith(".local") || hostname.endsWith(".test")) {
            return true;
        }
    }
    return false;
}
