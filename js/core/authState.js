// @ts-check

import { STORAGE_KEY_AUTH_STATE } from "../constants.js";
import { logging } from "../utils/logging.js";

/**
 * @typedef {{ user: { id: string, email: string|null, name: string|null, pictureUrl: string|null }, credential: string }} PersistedAuthState
 */

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
    if (!isValidAuthState(state)) {
        return;
    }
    try {
        storage.setItem(STORAGE_KEY_AUTH_STATE, JSON.stringify(state));
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
        if (isValidAuthState(parsed)) {
            return {
                user: {
                    id: parsed.user.id,
                    email: parsed.user.email ?? null,
                    name: parsed.user.name ?? null,
                    pictureUrl: parsed.user.pictureUrl ?? null
                },
                credential: parsed.credential
            };
        }
    } catch (error) {
        logging.error(error);
    }
    return null;
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
