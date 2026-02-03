// @ts-check

import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import {
    openStorageDb,
    resolveStorageMode,
    STORE_CRDT_DOCS,
    STORAGE_MODE_INDEXED,
    STORAGE_MODE_LOCAL,
    STORAGE_MODE_UNAVAILABLE
} from "./storageDb.js?build=2026-01-01T22:43:21Z";

const ERROR_MESSAGES = Object.freeze({
    STORAGE_UNAVAILABLE: "storage.crdt_docs.unavailable",
    STORAGE_READ_FAILED: "storage.crdt_docs.read_failed",
    STORAGE_WRITE_FAILED: "storage.crdt_docs.write_failed"
});

/**
 * Create a store that persists CRDT snapshots per user.
 * @param {{ storage?: Storage, keyPrefix?: string }} [options]
 */
export function createCrdtDocumentStore(options = {}) {
    const storageMode = resolveStorageMode();
    if (storageMode === STORAGE_MODE_UNAVAILABLE) {
        throw new Error(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
    }

    const localStorage = storageMode === STORAGE_MODE_LOCAL
        ? (options.storage ?? getLocalStorage())
        : null;
    const legacyStorage = getLocalStorage();
    const keyPrefix = typeof options.keyPrefix === "string" && options.keyPrefix.length > 0
        ? options.keyPrefix
        : "gravityCrdtDocs:";

    const snapshotCache = new Map();
    let persistChain = Promise.resolve();
    let storageBlocked = false;

    return Object.freeze({
        /**
         * Hydrate snapshots for the provided user.
         * @param {string} userId
         * @returns {Promise<void>}
         */
        async hydrate(userId) {
            if (storageMode !== STORAGE_MODE_INDEXED || !isNonEmptyString(userId)) {
                return;
            }
            const storageKey = composeKey(keyPrefix, userId);
            const snapshots = await loadSnapshotsFromIndexedDb(storageKey);
            snapshotCache.set(userId, snapshots);
        },

        /**
         * Load snapshots for a specific user.
         * @param {string} userId
         * @returns {Record<string, string>}
         */
        load(userId) {
            if (!isNonEmptyString(userId)) {
                return {};
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                return cloneSnapshots(snapshotCache.get(userId) ?? {});
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
                return isPlainObject(parsed) ? parsed : {};
            } catch (error) {
                logging.error("CRDT snapshot local storage parse failed", error);
                return {};
            }
        },

        /**
         * Persist snapshots for a specific user.
         * @param {string} userId
         * @param {Record<string, string>} snapshots
         * @returns {void}
         */
        save(userId, snapshots) {
            if (!isNonEmptyString(userId)) {
                return;
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                if (!isPlainObject(snapshots)) {
                    snapshotCache.delete(userId);
                    queuePersist(composeKey(keyPrefix, userId), null);
                    return;
                }
                snapshotCache.set(userId, cloneSnapshots(snapshots));
                queuePersist(composeKey(keyPrefix, userId), snapshots);
                return;
            }
            if (!localStorage) {
                return;
            }
            if (!isPlainObject(snapshots)) {
                localStorage.removeItem(composeKey(keyPrefix, userId));
                return;
            }
            localStorage.setItem(composeKey(keyPrefix, userId), JSON.stringify(snapshots));
        },

        /**
         * Remove all snapshots for a user.
         * @param {string} userId
         * @returns {void}
         */
        clear(userId) {
            if (!isNonEmptyString(userId)) {
                return;
            }
            if (storageMode === STORAGE_MODE_INDEXED) {
                snapshotCache.delete(userId);
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
     * @param {Record<string, string>|null} snapshots
     * @returns {void}
     */
    function queuePersist(storageKey, snapshots) {
        if (storageBlocked) {
            return;
        }
        persistChain = persistChain
            .then(() => persistSnapshotsToIndexedDb(storageKey, snapshots))
            .catch((error) => {
                storageBlocked = true;
                logging.error("CRDT snapshot persistence failed", error);
            });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<Record<string, string>>}
     */
    async function loadSnapshotsFromIndexedDb(storageKey) {
        const value = await readSnapshotsValueFromIndexedDb(storageKey);
        if (isPlainObject(value)) {
            return value;
        }
        const migrated = readSnapshotsFromLocalStorage(storageKey);
        if (!isPlainObject(migrated)) {
            return {};
        }
        await persistSnapshotsToIndexedDb(storageKey, migrated).catch((error) => {
            logging.error("CRDT snapshot migration failed", error);
        });
        removeSnapshotsFromLocalStorage(storageKey);
        return migrated;
    }

    /**
     * @param {string} storageKey
     * @param {Record<string, string>|null} snapshots
     * @returns {Promise<void>}
     */
    async function persistSnapshotsToIndexedDb(storageKey, snapshots) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_CRDT_DOCS, "readwrite");
            const store = transaction.objectStore(STORE_CRDT_DOCS);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                const message = transaction.error?.message ?? "unknown";
                reject(new Error(`${ERROR_MESSAGES.STORAGE_WRITE_FAILED}: ${message}`));
            };
            if (!isPlainObject(snapshots)) {
                store.delete(storageKey);
                return;
            }
            store.put(snapshots, storageKey);
        });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<unknown>}
     */
    async function readSnapshotsValueFromIndexedDb(storageKey) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_CRDT_DOCS, "readonly");
            const store = transaction.objectStore(STORE_CRDT_DOCS);
            const request = store.get(storageKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                const message = request.error?.message ?? "unknown";
                reject(new Error(`${ERROR_MESSAGES.STORAGE_READ_FAILED}: ${message}`));
            };
        });
    }

    /**
     * @param {string} storageKey
     * @returns {Record<string, string>}
     */
    function readSnapshotsFromLocalStorage(storageKey) {
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
            logging.error("CRDT snapshot migration parse failed", error);
            return {};
        }
    }

    /**
     * @param {string} storageKey
     * @returns {void}
     */
    function removeSnapshotsFromLocalStorage(storageKey) {
        if (!legacyStorage) {
            return;
        }
        legacyStorage.removeItem(storageKey);
    }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, string>}
 */
function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {string} prefix
 * @param {string} userId
 * @returns {string}
 */
function composeKey(prefix, userId) {
    const encoded = encodeURIComponent(userId);
    return `${prefix}${encoded}`;
}

/**
 * @param {Record<string, string>} snapshots
 * @returns {Record<string, string>}
 */
function cloneSnapshots(snapshots) {
    return { ...snapshots };
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * @returns {Storage|null}
 */
function getLocalStorage() {
    if (typeof globalThis === "undefined") {
        return null;
    }
    return globalThis.localStorage ?? null;
}
