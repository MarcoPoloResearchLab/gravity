// @ts-check

import { EVENT_NOTIFICATION_REQUEST, MESSAGE_STORAGE_FULL } from "../constants.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import {
    openStorageDb,
    resolveStorageMode,
    STORE_SYNC_METADATA,
    STORAGE_MODE_INDEXED,
    STORAGE_MODE_LOCAL,
    STORAGE_MODE_UNAVAILABLE
} from "./storageDb.js?build=2026-01-01T22:43:21Z";

/**
 * @typedef {{ lastSeenUpdateId: number }} NoteMetadata
 */

const ERROR_MESSAGES = Object.freeze({
    STORAGE_UNAVAILABLE: "storage.sync_meta.unavailable",
    STORAGE_READ_FAILED: "storage.sync_meta.read_failed",
    STORAGE_WRITE_FAILED: "storage.sync_meta.write_failed"
});

/**
 * Create a store that persists per-note sync metadata.
 * @param {{ storage?: Storage, keyPrefix?: string }} [options]
 */
export function createSyncMetadataStore(options = {}) {
    const storageMode = resolveStorageMode();
    if (storageMode === STORAGE_MODE_UNAVAILABLE) {
        throw new Error(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
    }

    const notificationTarget = typeof globalThis !== "undefined" && globalThis.document
        ? globalThis.document
        : null;
    const localStorage = storageMode === STORAGE_MODE_LOCAL
        ? (options.storage ?? getLocalStorage())
        : null;
    const legacyStorage = getLocalStorage();
    const keyPrefix = typeof options.keyPrefix === "string" && options.keyPrefix.length > 0
        ? options.keyPrefix
        : "gravitySyncMeta:";

    const metadataCache = new Map();
    let persistChain = Promise.resolve();
    let storageBlocked = false;
    let storageNotificationSent = false;

    return Object.freeze({
        /**
         * Hydrate metadata for a specific user identifier.
         * @param {string} userId
         * @returns {Promise<void>}
         */
        async hydrate(userId) {
            if (storageMode !== STORAGE_MODE_INDEXED || !isNonEmptyString(userId)) {
                return;
            }
            const storageKey = composeKey(keyPrefix, userId);
            const metadata = await loadMetadataFromIndexedDb(storageKey);
            metadataCache.set(userId, metadata);
        },

        /**
         * Load metadata for a specific user identifier.
         * @param {string} userId
         * @returns {Record<string, NoteMetadata>}
         */
        load(userId) {
            if (!isNonEmptyString(userId)) {
                return {};
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                return normalizeMetadata(metadataCache.get(userId) ?? {});
            }
            if (!localStorage) {
                return {};
            }
            const raw = localStorage.getItem(composeKey(keyPrefix, userId));
            if (typeof raw !== "string" || raw.length === 0) {
                return {};
            }
            try {
                const parsed = JSON.parse(raw);
                return normalizeMetadata(parsed);
            } catch (error) {
                logging.error("Sync metadata local storage parse failed", error);
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
            if (!isNonEmptyString(userId)) {
                return;
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                if (!isPlainObject(metadata)) {
                    metadataCache.delete(userId);
                    queuePersist(composeKey(keyPrefix, userId), null);
                    return;
                }
                const normalized = normalizeMetadata(metadata);
                metadataCache.set(userId, normalized);
                queuePersist(composeKey(keyPrefix, userId), normalized);
                return;
            }
            if (!localStorage) {
                return;
            }
            if (!isPlainObject(metadata)) {
                localStorage.removeItem(composeKey(keyPrefix, userId));
                return;
            }
            localStorage.setItem(composeKey(keyPrefix, userId), JSON.stringify(normalizeMetadata(metadata)));
        },

        /**
         * Remove metadata for a user.
         * @param {string} userId
         * @returns {void}
         */
        clear(userId) {
            if (!isNonEmptyString(userId)) {
                return;
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                metadataCache.delete(userId);
                queuePersist(composeKey(keyPrefix, userId), null);
                return;
            }
            if (!localStorage) {
                return;
            }
            localStorage.removeItem(composeKey(keyPrefix, userId));
        }
    });

    /**
     * @param {string} storageKey
     * @param {Record<string, NoteMetadata>|null} metadata
     * @returns {void}
     */
    function queuePersist(storageKey, metadata) {
        if (storageBlocked) {
            return;
        }
        persistChain = persistChain
            .then(() => persistMetadataToIndexedDb(storageKey, metadata))
            .catch((error) => {
                handleStorageFailure(error);
            });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<Record<string, NoteMetadata>>}
     */
    async function loadMetadataFromIndexedDb(storageKey) {
        const value = await readMetadataValueFromIndexedDb(storageKey);
        if (isPlainObject(value)) {
            return normalizeMetadata(value);
        }
        const migrated = readMetadataFromLocalStorage(storageKey);
        if (!isPlainObject(migrated)) {
            return {};
        }
        const normalized = normalizeMetadata(migrated);
        await persistMetadataToIndexedDb(storageKey, normalized).catch((error) => {
            logging.error("Sync metadata migration failed", error);
        });
        removeMetadataFromLocalStorage(storageKey);
        return normalized;
    }

    /**
     * @param {string} storageKey
     * @param {Record<string, NoteMetadata>|null} metadata
     * @returns {Promise<void>}
     */
    async function persistMetadataToIndexedDb(storageKey, metadata) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_SYNC_METADATA, "readwrite");
            const store = transaction.objectStore(STORE_SYNC_METADATA);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                const message = transaction.error?.message ?? "unknown";
                reject(new Error(`${ERROR_MESSAGES.STORAGE_WRITE_FAILED}: ${message}`));
            };
            if (!isPlainObject(metadata)) {
                store.delete(storageKey);
                return;
            }
            store.put(metadata, storageKey);
        });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<unknown>}
     */
    async function readMetadataValueFromIndexedDb(storageKey) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_SYNC_METADATA, "readonly");
            const store = transaction.objectStore(STORE_SYNC_METADATA);
            const request = store.get(storageKey);
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = () => {
                const message = request.error?.message ?? "unknown";
                reject(new Error(`${ERROR_MESSAGES.STORAGE_READ_FAILED}: ${message}`));
            };
        });
    }

    /**
     * @param {string} storageKey
     * @returns {Record<string, NoteMetadata>}
     */
    function readMetadataFromLocalStorage(storageKey) {
        if (!legacyStorage) {
            return {};
        }
        const raw = legacyStorage.getItem(storageKey);
        if (!raw) {
            return {};
        }
        try {
            const parsed = JSON.parse(raw);
            return isPlainObject(parsed) ? parsed : {};
        } catch (error) {
            logging.error("Sync metadata migration parse failed", error);
            return {};
        }
    }

    /**
     * @param {string} storageKey
     * @returns {void}
     */
    function removeMetadataFromLocalStorage(storageKey) {
        if (!legacyStorage) {
            return;
        }
        legacyStorage.removeItem(storageKey);
    }

    function handleStorageFailure(error) {
        if (storageNotificationSent) {
            return;
        }
        storageNotificationSent = true;
        storageBlocked = true;
        logging.error("Sync metadata persistence failed", error);
        if (!notificationTarget) {
            return;
        }
        const detail = { message: MESSAGE_STORAGE_FULL };
        try {
            const event = new CustomEvent(EVENT_NOTIFICATION_REQUEST, {
                bubbles: true,
                detail
            });
            notificationTarget.dispatchEvent(event);
        } catch (dispatchError) {
            logging.error(dispatchError);
            try {
                const fallbackEvent = new Event(EVENT_NOTIFICATION_REQUEST);
                /** @type {any} */ (fallbackEvent).detail = detail;
                notificationTarget.dispatchEvent(fallbackEvent);
            } catch (fallbackError) {
                logging.error(fallbackError);
            }
        }
    }
}

/**
 * @param {unknown} value
 * @returns {Record<string, NoteMetadata>}
 */
function normalizeMetadata(value) {
    if (!isPlainObject(value)) {
        return {};
    }
    const normalized = {};
    for (const [noteId, entry] of Object.entries(value)) {
        const candidate = /** @type {Record<string, unknown>} */ (entry);
        const lastSeenUpdateId = typeof candidate.lastSeenUpdateId === "number"
            && Number.isFinite(candidate.lastSeenUpdateId)
            && candidate.lastSeenUpdateId >= 0
            ? candidate.lastSeenUpdateId
            : 0;
        normalized[noteId] = { lastSeenUpdateId };
    }
    return normalized;
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
