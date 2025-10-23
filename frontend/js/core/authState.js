// @ts-check

import { STORAGE_KEY_AUTH_STATE } from "../constants.js";
import { logging } from "../utils/logging.js";
import { decodeGoogleCredential } from "./auth.js";
import { appConfig } from "./config.js";

/**
 * @typedef {{
 *   user: { id: string, email: string|null, name: string|null, pictureUrl: string|null },
 *   credential: string,
 *   clientId?: string|null,
 *   backendAccessToken?: string|null,
 *   backendAccessTokenExpiresAtMs?: number|null
 * }} PersistedAuthState
 */

const GOOGLE_ISSUER_ALLOWLIST = Object.freeze([
    "https://accounts.google.com",
    "accounts.google.com"
]);

/**
 * Persist an authentication state for session restoration.
 * @param {PersistedAuthState} state
 * @returns {void}
 */
export function saveAuthState(state) {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    const sanitized = sanitizeForPersistence(state);
    if (!sanitized) {
        return;
    }
    try {
        storage.setItem(STORAGE_KEY_AUTH_STATE, JSON.stringify(sanitized));
    } catch (error) {
        logging.error(error);
    }
}

/**
 * Load persisted authentication details, if any.
 * @returns {PersistedAuthState|null}
 */
export function loadAuthState() {
    const storage = getLocalStorage();
    if (!storage) {
        return null;
    }
    try {
        const raw = storage.getItem(STORAGE_KEY_AUTH_STATE);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        const normalized = validatePersistedAuthState(parsed);
        if (normalized) {
            return normalized;
        }
        try {
            storage.removeItem(STORAGE_KEY_AUTH_STATE);
        } catch (clearError) {
            logging.error(clearError);
        }
    } catch (error) {
        logging.error(error);
    }
    return null;
}

/**
 * Determine whether the persisted auth state holds a non-expired credential.
 * @param {PersistedAuthState|null|undefined} state
 * @param {() => number} [clock]
 * @returns {state is PersistedAuthState}
 */
export function isAuthStateFresh(state, clock = () => Date.now()) {
    if (!isValidAuthState(state)) {
        return false;
    }
    try {
        const payload = decodeGoogleCredential(state.credential);
        const issuedAtSeconds = typeof payload.iat === "number" ? payload.iat : null;
        const expirationSeconds = typeof payload.exp === "number" ? payload.exp : null;
        if (expirationSeconds === null) {
            return false;
        }
        const nowSeconds = Math.floor(clock() / 1000);
        const skewAllowance = issuedAtSeconds !== null && issuedAtSeconds > expirationSeconds
            ? 0
            : 30;
        return expirationSeconds > nowSeconds + skewAllowance;
    } catch (error) {
        logging.error(error);
        return false;
    }
}

/**
 * Remove any persisted authentication state.
 * @returns {void}
 */
export function clearAuthState() {
    const storage = getLocalStorage();
    if (!storage) {
        return;
    }
    try {
        storage.removeItem(STORAGE_KEY_AUTH_STATE);
    } catch (error) {
        logging.error(error);
    }
}

/**
 * @returns {Storage|null}
 */
function getLocalStorage() {
    if (typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined") {
        try {
            return globalThis.localStorage;
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Validate and normalize a persisted auth state against the stored credential payload.
 * @param {unknown} candidate
 * @returns {PersistedAuthState|null}
 */
export function validatePersistedAuthState(candidate) {
    if (!isValidAuthState(candidate)) {
        return null;
    }
    const typed = /** @type {PersistedAuthState} */ (candidate);
    try {
        const payload = decodeGoogleCredential(typed.credential);
        const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
        if (!subject || subject !== typed.user.id.trim()) {
            return null;
        }
        const normalizedAudience = normalizeAudience(payload.aud);
        if (!normalizedAudience) {
            return null;
        }
        const allowedAudiences = new Set();
        const storedClientId = normalizeOptionalString(typed.clientId);
        if (storedClientId) {
            allowedAudiences.add(storedClientId);
        }
        const configuredClientId = normalizeOptionalString(appConfig.googleClientId);
        if (configuredClientId) {
            allowedAudiences.add(configuredClientId);
        }
        if (allowedAudiences.size === 0 || !allowedAudiences.has(normalizedAudience)) {
            return null;
        }
        if (!isAllowedIssuer(payload.iss)) {
            return null;
        }
        const email = selectPreferredString(payload.email, typed.user.email);
        const name = selectPreferredString(payload.name, typed.user.name ?? email);
        const pictureUrl = selectPreferredString(payload.picture, typed.user.pictureUrl);
        const backendAccessToken = normalizeOptionalString(typed.backendAccessToken);
        const backendExpiresAtMs = typeof typed.backendAccessTokenExpiresAtMs === "number" && Number.isFinite(typed.backendAccessTokenExpiresAtMs)
            ? typed.backendAccessTokenExpiresAtMs
            : null;
        return {
            user: {
                id: subject,
                email,
                name,
                pictureUrl
            },
            credential: typed.credential,
            clientId: normalizedAudience,
            backendAccessToken,
            backendAccessTokenExpiresAtMs: backendExpiresAtMs
        };
    } catch (error) {
        logging.error(error);
        return null;
    }
}

/**
 * @param {unknown} candidate
 * @returns {candidate is PersistedAuthState}
 */
function isValidAuthState(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    const record = /** @type {{ user?: unknown, credential?: unknown }} */ (candidate);
    if (!record.user || typeof record.user !== "object") {
        return false;
    }
    if (typeof record.credential !== "string" || record.credential.length === 0) {
        return false;
    }
    const user = /** @type {{ id?: unknown, email?: unknown, name?: unknown, pictureUrl?: unknown }} */ (record.user);
    if (typeof user.id !== "string" || user.id.trim().length === 0) {
        return false;
    }
    return true;
}

/**
 * @param {unknown} audience
 * @param {string} expectedClientId
 * @returns {boolean}
 */
function sanitizeForPersistence(state) {
    if (!isValidAuthState(state)) {
        return null;
    }
    try {
        const payload = decodeGoogleCredential(state.credential);
        const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
        if (!subject || subject !== state.user.id.trim()) {
            return null;
        }
        const audience = normalizeAudience(payload.aud);
        if (!audience) {
            return null;
        }
        if (!isAllowedIssuer(payload.iss)) {
            return null;
        }
        const email = selectPreferredString(payload.email, state.user.email);
        const name = selectPreferredString(payload.name, state.user.name ?? email);
        const pictureUrl = selectPreferredString(payload.picture, state.user.pictureUrl);
        const backendAccessToken = normalizeOptionalString(state.backendAccessToken);
        const backendExpiresAtMs = typeof state.backendAccessTokenExpiresAtMs === "number" && Number.isFinite(state.backendAccessTokenExpiresAtMs)
            ? state.backendAccessTokenExpiresAtMs
            : null;
        const persisted = {
            user: {
                id: subject,
                email,
                name,
                pictureUrl
            },
            credential: state.credential,
            clientId: audience
        };
        if (backendAccessToken && typeof backendExpiresAtMs === "number") {
            persisted.backendAccessToken = backendAccessToken;
            persisted.backendAccessTokenExpiresAtMs = backendExpiresAtMs;
        }
        return persisted;
    } catch (error) {
        logging.error(error);
        return null;
    }
}

/**
 * @param {unknown} audience
 * @returns {string|null}
 */
function normalizeAudience(audience) {
    if (typeof audience === "string") {
        const trimmed = audience.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(audience)) {
        for (const entry of audience) {
            if (typeof entry === "string") {
                const trimmed = entry.trim();
                if (trimmed.length > 0) {
                    return trimmed;
                }
            }
        }
    }
    return null;
}

/**
 * @param {unknown} issuer
 * @returns {boolean}
 */
function isAllowedIssuer(issuer) {
    if (typeof issuer !== "string") {
        return false;
    }
    const normalized = issuer.trim().toLowerCase();
    return GOOGLE_ISSUER_ALLOWLIST.some((allowed) => allowed.toLowerCase() === normalized);
}

/**
 * @param {unknown} primary
 * @param {unknown} fallback
 * @returns {string|null}
 */
function selectPreferredString(primary, fallback) {
    const normalizedPrimary = normalizeOptionalString(primary);
    if (normalizedPrimary !== null) {
        return normalizedPrimary;
    }
    return normalizeOptionalString(fallback);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeOptionalString(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
