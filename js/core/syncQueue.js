// @ts-check

/**
 * @typedef {{ operationId: string, noteId: string, operation: "upsert"|"delete", payload: unknown, clientEditSeq: number, updatedAtSeconds: number, createdAtSeconds: number, clientTimeSeconds: number }} PendingOperation
 */

/**
 * Create a persistent queue for pending sync operations.
 * @param {{ storage?: Storage, keyPrefix?: string }} [options]
 */
export function createSyncQueue(options = {}) {
    const {
        storage = getLocalStorage(),
        keyPrefix = "gravitySyncQueue:"
    } = options;

    return Object.freeze({
        /**
         * Retrieve pending operations for the provided user.
         * @param {string} userId
         * @returns {PendingOperation[]}
         */
        load(userId) {
            if (!storage || !isNonEmptyString(userId)) {
                return [];
            }
            const raw = storage.getItem(composeKey(keyPrefix, userId));
            if (typeof raw !== "string" || raw.length === 0) {
                return [];
            }
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        },

        /**
         * Persist the queue for the provided user.
         * @param {string} userId
         * @param {PendingOperation[]} operations
         * @returns {void}
         */
        save(userId, operations) {
            if (!storage || !isNonEmptyString(userId)) {
                return;
            }
            if (!Array.isArray(operations) || operations.length === 0) {
                storage.removeItem(composeKey(keyPrefix, userId));
                return;
            }
            storage.setItem(composeKey(keyPrefix, userId), JSON.stringify(operations));
        },

        /**
         * Remove all pending operations for the provided user.
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
