// @ts-check

import { EVENT_NOTIFICATION_REQUEST, MESSAGE_STORAGE_FULL } from "../constants.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import {
    openStorageDb,
    resolveStorageMode,
    STORE_SYNC_QUEUE,
    STORAGE_MODE_INDEXED,
    STORAGE_MODE_LOCAL,
    STORAGE_MODE_UNAVAILABLE
} from "./storageDb.js?build=2026-01-01T22:43:21Z";

/**
 * @typedef {{ serverVersion: number, serverEditSeq: number, serverUpdatedAtSeconds: number, serverPayload: unknown, rejectedAtSeconds: number }} ConflictInfo
 */

/**
 * @typedef {{ operationId: string, noteId: string, operation: "upsert"|"delete", payload: unknown|null, baseVersion: number, clientEditSeq: number, updatedAtSeconds: number, createdAtSeconds: number, clientTimeSeconds: number, status?: "pending"|"conflict", conflict?: ConflictInfo }} PendingOperation
 */

const ERROR_MESSAGES = Object.freeze({
    STORAGE_UNAVAILABLE: "storage.sync_queue.unavailable",
    STORAGE_READ_FAILED: "storage.sync_queue.read_failed",
    STORAGE_WRITE_FAILED: "storage.sync_queue.write_failed"
});

/**
 * Create a persistent queue for pending sync operations.
 * @param {{ storage?: Storage, keyPrefix?: string }} [options]
 */
export function createSyncQueue(options = {}) {
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
        : "gravitySyncQueue:";

    const queueCache = new Map();
    let persistChain = Promise.resolve();
    let storageBlocked = false;
    let storageNotificationSent = false;

    return Object.freeze({
        /**
         * Hydrate pending operations for the provided user.
         * @param {string} userId
         * @returns {Promise<void>}
         */
        async hydrate(userId) {
            if (storageMode !== STORAGE_MODE_INDEXED || !isNonEmptyString(userId)) {
                return;
            }
            const storageKey = composeKey(keyPrefix, userId);
            const operations = await loadQueueFromIndexedDb(storageKey);
            queueCache.set(userId, operations);
        },

        /**
         * Retrieve pending operations for the provided user.
         * @param {string} userId
         * @returns {PendingOperation[]}
         */
        load(userId) {
            if (!isNonEmptyString(userId)) {
                return [];
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                return cloneOperations(queueCache.get(userId) ?? []);
            }
            if (!localStorage) {
                return [];
            }
            const raw = localStorage.getItem(composeKey(keyPrefix, userId));
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
            if (!isNonEmptyString(userId)) {
                return;
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                const normalized = Array.isArray(operations) ? operations : [];
                if (normalized.length === 0) {
                    queueCache.delete(userId);
                } else {
                    queueCache.set(userId, cloneOperations(normalized));
                }
                queuePersist(composeKey(keyPrefix, userId), normalized);
                return;
            }
            if (!localStorage) {
                return;
            }
            if (!Array.isArray(operations) || operations.length === 0) {
                localStorage.removeItem(composeKey(keyPrefix, userId));
                return;
            }
            localStorage.setItem(composeKey(keyPrefix, userId), JSON.stringify(operations));
        },

        /**
         * Remove all pending operations for the provided user.
         * @param {string} userId
         * @returns {void}
         */
        clear(userId) {
            if (!isNonEmptyString(userId)) {
                return;
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                queueCache.delete(userId);
                queuePersist(composeKey(keyPrefix, userId), []);
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
     * @param {PendingOperation[]} operations
     * @returns {void}
     */
    function queuePersist(storageKey, operations) {
        if (storageBlocked) {
            return;
        }
        persistChain = persistChain
            .then(() => persistQueueToIndexedDb(storageKey, operations))
            .catch((error) => {
                handleStorageFailure(error);
            });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<PendingOperation[]>}
     */
    async function loadQueueFromIndexedDb(storageKey) {
        const value = await readQueueValueFromIndexedDb(storageKey);
        const operations = Array.isArray(value) ? value : [];
        if (operations.length > 0) {
            return operations;
        }
        const migrated = readQueueFromLocalStorage(storageKey);
        if (migrated.length === 0) {
            return [];
        }
        await persistQueueToIndexedDb(storageKey, migrated).catch((error) => {
            logging.error("Sync queue migration failed", error);
        });
        removeQueueFromLocalStorage(storageKey);
        return migrated;
    }

    /**
     * @param {string} storageKey
     * @param {PendingOperation[]} operations
     * @returns {Promise<void>}
     */
    async function persistQueueToIndexedDb(storageKey, operations) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_SYNC_QUEUE, "readwrite");
            const store = transaction.objectStore(STORE_SYNC_QUEUE);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                const message = transaction.error?.message ?? "unknown";
                reject(new Error(`${ERROR_MESSAGES.STORAGE_WRITE_FAILED}: ${message}`));
            };
            if (operations.length === 0) {
                store.delete(storageKey);
            } else {
                store.put(operations, storageKey);
            }
        });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<unknown>}
     */
    async function readQueueValueFromIndexedDb(storageKey) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_SYNC_QUEUE, "readonly");
            const store = transaction.objectStore(STORE_SYNC_QUEUE);
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
     * @returns {PendingOperation[]}
     */
    function readQueueFromLocalStorage(storageKey) {
        if (!legacyStorage) {
            return [];
        }
        const raw = legacyStorage.getItem(storageKey);
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * @param {string} storageKey
     * @returns {void}
     */
    function removeQueueFromLocalStorage(storageKey) {
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
        logging.error("Sync queue persistence failed", error);
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
 * @param {PendingOperation[]} operations
 * @returns {PendingOperation[]}
 */
function cloneOperations(operations) {
    if (!Array.isArray(operations)) {
        return [];
    }
    if (typeof structuredClone === "function") {
        return structuredClone(operations);
    }
    return JSON.parse(JSON.stringify(operations));
}
