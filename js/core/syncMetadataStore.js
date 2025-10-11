// @ts-check

/**
 * @typedef {{ clientEditSeq: number, serverEditSeq: number, serverVersion: number }} NoteMetadata
 */

/**
 * Create a store that persists per-note sync metadata.
 * @param {{ storage?: Storage, keyPrefix?: string }} [options]
 */
export function createSyncMetadataStore(options = {}) {
    const {
        storage = getLocalStorage(),
        keyPrefix = "gravitySyncMeta:"
    } = options;

    return Object.freeze({
        /**
         * Load metadata for a specific user identifier.
         * @param {string} userId
         * @returns {Record<string, NoteMetadata>}
         */
        load(userId) {
            if (!storage || !isNonEmptyString(userId)) {
                return {};
            }
            const raw = storage.getItem(composeKey(keyPrefix, userId));
            if (typeof raw !== "string" || raw.length === 0) {
                return {};
            }
            try {
                const parsed = JSON.parse(raw);
                return isPlainObject(parsed) ? parsed : {};
            } catch {
                return {};
            }
        },

        /**
         * Persist metadata for a specific user identifier.
         * @param {string} userId
         * @param {Record<string, NoteMetadata>} metadata
         * @returns {void}
         */
        save(userId, metadata) {
            if (!storage || !isNonEmptyString(userId)) {
                return;
            }
            if (!isPlainObject(metadata)) {
                storage.removeItem(composeKey(keyPrefix, userId));
                return;
            }
            storage.setItem(composeKey(keyPrefix, userId), JSON.stringify(metadata));
        },

        /**
         * Remove metadata for a user.
         * @param {string} userId
         * @returns {void}
         */
        clear(userId) {
            if (!storage || !isNonEmptyString(userId)) {
                return;
            }
            storage.removeItem(composeKey(keyPrefix, userId));
        }
    });
}

/**
 * @returns {Storage|null}
 */
function getLocalStorage() {
    if (typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined") {
        return globalThis.localStorage;
    }
    return null;
}

/**
 * @param {string} prefix
 * @param {string} userId
 * @returns {string}
 */
function composeKey(prefix, userId) {
    return `${prefix}${encodeURIComponent(userId)}`;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
