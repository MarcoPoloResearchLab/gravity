// @ts-check

export const STORAGE_DB_NAME = "gravity-storage";
export const STORAGE_DB_VERSION = 2;
export const STORE_NOTES = "notes";
export const STORE_SYNC_QUEUE = "sync-queue";
export const STORE_SYNC_METADATA = "sync-metadata";
export const STORE_CRDT_DOCS = "crdt-docs";

export const STORAGE_MODE_INDEXED = "indexeddb";
export const STORAGE_MODE_LOCAL = "localstorage";
export const STORAGE_MODE_UNAVAILABLE = "unavailable";

const ERROR_MESSAGES = Object.freeze({
    DB_UNAVAILABLE: "storage.db.unavailable",
    DB_OPEN_FAILED: "storage.db.open_failed"
});

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * @returns {"indexeddb"|"localstorage"|"unavailable"}
 */
export function resolveStorageMode() {
    if (forceLocalStorage()) {
        return STORAGE_MODE_LOCAL;
    }
    if (hasIndexedDb()) {
        return STORAGE_MODE_INDEXED;
    }
    if (isTestEnvironment()) {
        return STORAGE_MODE_LOCAL;
    }
    return STORAGE_MODE_UNAVAILABLE;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openStorageDb() {
    if (!hasIndexedDb()) {
        return Promise.reject(new Error(ERROR_MESSAGES.DB_UNAVAILABLE));
    }
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(STORAGE_DB_NAME, STORAGE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NOTES)) {
                db.createObjectStore(STORE_NOTES);
            }
            if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
                db.createObjectStore(STORE_SYNC_QUEUE);
            }
            if (!db.objectStoreNames.contains(STORE_SYNC_METADATA)) {
                db.createObjectStore(STORE_SYNC_METADATA);
            }
            if (!db.objectStoreNames.contains(STORE_CRDT_DOCS)) {
                db.createObjectStore(STORE_CRDT_DOCS);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            const message = request.error?.message ?? "unknown";
            reject(new Error(`${ERROR_MESSAGES.DB_OPEN_FAILED}: ${message}`));
        };
    });
    return dbPromise;
}

function hasIndexedDb() {
    return typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined";
}

function forceLocalStorage() {
    return typeof globalThis !== "undefined" && globalThis.__gravityForceLocalStorage === true;
}

function isTestEnvironment() {
    if (typeof process === "undefined") {
        return false;
    }
    const env = process.env ?? {};
    return env.NODE_ENV === "test";
}
