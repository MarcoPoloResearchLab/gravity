// @ts-check

import { STORAGE_KEY, STORAGE_KEY_USER_PREFIX } from "./config.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import { ERROR_IMPORT_INVALID_PAYLOAD, EVENT_NOTIFICATION_REQUEST, MESSAGE_STORAGE_FULL } from "../constants.js?build=2026-01-01T22:43:21Z";
import { sanitizeAttachmentDictionary } from "./attachments.js?build=2026-01-01T22:43:21Z";
import {
    openStorageDb,
    resolveStorageMode,
    STORE_NOTES,
    STORAGE_MODE_INDEXED,
    STORAGE_MODE_LOCAL,
    STORAGE_MODE_UNAVAILABLE
} from "./storageDb.js?build=2026-01-01T22:43:21Z";

const EMPTY_STRING = "";
const STORAGE_KEY_BASE = STORAGE_KEY;
const STORAGE_MODE = resolveStorageMode();
const BROADCAST_CHANNEL_NAME = "gravity-notes-storage";
const STORAGE_USER_PREFIX = (() => {
    const configured = typeof STORAGE_KEY_USER_PREFIX === "string"
        ? STORAGE_KEY_USER_PREFIX.trim()
        : "";
    const prefix = configured.length > 0 ? configured : `${STORAGE_KEY_BASE}:user`;
    return prefix.endsWith(":") ? prefix : `${prefix}:`;
})();
let activeStorageKey = STORAGE_KEY_BASE;
const ERROR_MESSAGES = Object.freeze({
    STORAGE_UNAVAILABLE: "storage.notes.unavailable",
    STORAGE_NOT_READY: "storage.notes.not_ready",
    STORAGE_READ_FAILED: "storage.notes.read_failed",
    STORAGE_WRITE_FAILED: "storage.notes.write_failed",
    STORAGE_DELETE_FAILED: "storage.notes.delete_failed"
});
const ERROR_INVALID_NOTE_RECORD = "gravity.invalid_note_record";
export const ERROR_INVALID_NOTES_COLLECTION = "gravity.invalid_notes_collection";

/** @typedef {import("../types.d.js").NoteRecord} NoteRecord */

export const GravityStore = (() => {
    const debugEnabled = () => typeof globalThis !== "undefined" && globalThis.__debugSyncScenarios === true;
    const notificationTarget = typeof globalThis !== "undefined" && globalThis.document
        ? globalThis.document
        : null;
    const broadcastChannel = STORAGE_MODE === STORAGE_MODE_INDEXED ? createBroadcastChannel() : null;
    const broadcastSourceId = broadcastChannel ? createBroadcastSourceId() : "";
    let cachedRecords = [];
    let cachedSerialized = "[]";
    let hydratedStorageKey = null;
    let persistChain = Promise.resolve();
    let storageBlocked = false;
    let storageNotificationSent = false;

    /**
     * @returns {NoteRecord[]}
     */
    function loadAllNotes() {
        if (STORAGE_MODE === STORAGE_MODE_UNAVAILABLE) {
            throw new Error(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
        }
        if (STORAGE_MODE === STORAGE_MODE_LOCAL) {
            return loadAllNotesFromLocalStorage();
        }
        ensureHydrated();
        return parseCachedRecords();
    }

    /**
     * @param {NoteRecord[]} records
     * @returns {void}
     */
    function saveAllNotes(records) {
        if (!Array.isArray(records)) {
            throw new Error(ERROR_INVALID_NOTES_COLLECTION);
        }
        if (STORAGE_MODE === STORAGE_MODE_UNAVAILABLE) {
            throw new Error(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
        }
        const normalized = [];
        for (const record of records) {
            const note = tryCreateNoteRecord(record);
            if (note) {
                normalized.push(note);
            }
        }
        const deduped = dedupeRecordsById(normalized);
        const storageKey = getActiveStorageKey();
        if (debugEnabled()) {
            try {
                const identifiers = deduped.map((record) => record.noteId);
                const stack = typeof Error === "function" ? new Error().stack : null;
                logging.info("GravityStore.saveAllNotes", storageKey, identifiers, stack);
            } catch {
                // ignore console failures
            }
        }
        if (STORAGE_MODE === STORAGE_MODE_LOCAL) {
            persistNotesToLocalStorage(storageKey, deduped);
            return;
        }
        ensureHydrated();
        updateCache(deduped);
        queuePersist(storageKey, deduped);
    }

    /**
     * Initialize storage for the current scope.
     * @returns {Promise<void>}
     */
    async function initialize() {
        if (STORAGE_MODE === STORAGE_MODE_UNAVAILABLE) {
            throw new Error(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
        }
        if (STORAGE_MODE !== STORAGE_MODE_INDEXED) {
            return;
        }
        await requestPersistentStorage();
        await hydrateActiveScope();
    }

    /**
     * Hydrate cached notes for the active storage scope.
     * @returns {Promise<void>}
     */
    async function hydrateActiveScope() {
        if (STORAGE_MODE === STORAGE_MODE_UNAVAILABLE) {
            throw new Error(ERROR_MESSAGES.STORAGE_UNAVAILABLE);
        }
        if (STORAGE_MODE !== STORAGE_MODE_INDEXED) {
            return;
        }
        const storageKey = getActiveStorageKey();
        const records = await loadNotesFromIndexedDb(storageKey);
        updateCache(records);
        hydratedStorageKey = storageKey;
    }

    /**
     * Subscribe to cross-tab updates for indexed storage.
     * @param {(storageKey: string) => void} handler
     * @returns {(() => void)|null}
     */
    function subscribeToChanges(handler) {
        if (!broadcastChannel) {
            return null;
        }
        const listener = (event) => {
            const payload = event?.data ?? null;
            if (!payload || payload.sourceId === broadcastSourceId) {
                return;
            }
            if (typeof payload.storageKey !== "string") {
                return;
            }
            handler(payload.storageKey);
        };
        broadcastChannel.addEventListener("message", listener);
        return () => broadcastChannel.removeEventListener("message", listener);
    }

    /**
     * Serialize all persisted notes into a JSON string.
     * @returns {string}
     */
    function exportNotes() {
        if (STORAGE_MODE === STORAGE_MODE_INDEXED) {
            ensureHydrated();
            return cachedSerialized;
        }
        const records = loadAllNotes();
        return JSON.stringify(records);
    }

    /**
     * Import notes from a JSON string, appending only unique records.
     * @param {string} serializedPayload
     * @returns {NoteRecord[]}
     */
    function importNotes(serializedPayload) {
        if (typeof serializedPayload !== "string" || serializedPayload.trim().length === 0) {
            throw new Error(ERROR_IMPORT_INVALID_PAYLOAD);
        }

        let parsed;
        try {
            parsed = JSON.parse(serializedPayload);
        } catch {
            throw new Error(ERROR_IMPORT_INVALID_PAYLOAD);
        }

        if (!Array.isArray(parsed)) {
            throw new Error(ERROR_IMPORT_INVALID_PAYLOAD);
        }

        const incomingRecords = [];
        for (const candidate of parsed) {
            const note = tryCreateNoteRecord(candidate);
            if (note) {
                incomingRecords.push(note);
            }
        }

        if (incomingRecords.length === 0) {
            return [];
        }

        const existingRecords = loadAllNotes();
        const existingById = new Map(existingRecords.map(record => [record.noteId, record]));
        const existingFingerprints = new Set(existingRecords.map(createContentFingerprint));

        const appendedRecords = [];
        for (const incomingRecord of incomingRecords) {
            if (existingById.has(incomingRecord.noteId)) continue;
            const fingerprint = createContentFingerprint(incomingRecord);
            if (existingFingerprints.has(fingerprint)) continue;
            existingRecords.push(incomingRecord);
            existingById.set(incomingRecord.noteId, incomingRecord);
            existingFingerprints.add(fingerprint);
            appendedRecords.push(incomingRecord);
        }

        if (appendedRecords.length > 0) {
            saveAllNotes(existingRecords);
        }

        return appendedRecords;
    }

    /**
     * Persist a non-empty record, inserting or replacing by identifier.
     * @param {NoteRecord} record
     * @returns {void}
     */
    function upsertNonEmpty(record) {
        const allRecords = loadAllNotes();
        const existingIndex = allRecords.findIndex(existingRecord => existingRecord.noteId === record.noteId);
        const existingRecord = existingIndex === -1 ? null : allRecords[existingIndex];
        const normalizedPinned = typeof record?.pinned === "boolean"
            ? record.pinned
            : existingRecord?.pinned === true;

        let sanitizedRecord;
        try {
            sanitizedRecord = createNoteRecord({ ...record, pinned: normalizedPinned });
        } catch {
            return;
        }

        if (debugEnabled()) {
            try {
                logging.info("GravityStore.upsertNonEmpty", getActiveStorageKey(), sanitizedRecord.noteId);
            } catch {
                // ignore console failures
            }
        }
        if (existingIndex === -1) {
            allRecords.unshift(sanitizedRecord);
        } else {
            allRecords[existingIndex] = sanitizedRecord;
        }

        if (sanitizedRecord.pinned) {
            for (let index = 0; index < allRecords.length; index += 1) {
                const candidate = allRecords[index];
                if (candidate.noteId === sanitizedRecord.noteId) continue;
                if (candidate.pinned) {
                    allRecords[index] = { ...candidate, pinned: false };
                }
            }
        }

        saveAllNotes(allRecords);
    }

    /**
     * Remove a note by identifier.
     * @param {string} noteId
     * @returns {void}
     */
    function removeById(noteId) {
        const remainingRecords = loadAllNotes().filter(noteRecord => noteRecord.noteId !== noteId);
        saveAllNotes(remainingRecords);
    }

    /**
     * Retrieve a note record by identifier.
     * @param {string} noteId
     * @returns {NoteRecord|null}
     */
    function getById(noteId) {
        if (!isNonBlankString(noteId)) return null;
        const records = loadAllNotes();
        return records.find(record => record.noteId === noteId) ?? null;
    }

    function setPinned(noteId) {
        const records = loadAllNotes();
        const normalizedId = typeof noteId === "string" && noteId.trim().length > 0 ? noteId : null;
        const targetExists = normalizedId ? records.some(record => record.noteId === normalizedId) : false;
        const targetId = targetExists ? normalizedId : null;
        let changed = false;

        const nextRecords = records.map((record) => {
            const shouldPin = targetId !== null && record.noteId === targetId;
            const isPinned = record.pinned === true;
            if (shouldPin === isPinned) {
                return record;
            }
            changed = true;
            return { ...record, pinned: shouldPin };
        });

        if (!changed && targetExists) {
            return targetId;
        }

        if (!changed && !targetExists) {
            const anyPinned = records.some(record => record.pinned === true);
            if (!anyPinned) {
                return null;
            }
        }

        if (!changed) {
            return targetId;
        }

        saveAllNotes(nextRecords);
        return targetId;
    }

    /**
     * Set the active storage key according to the provided user identifier.
     * @param {string|null|undefined} userId
     * @returns {string}
     */
    function setUserScope(userId) {
        const nextKey = isNonBlankString(userId) ? composeUserStorageKey(String(userId)) : STORAGE_KEY_BASE;
        if (nextKey === activeStorageKey) {
            return activeStorageKey;
        }
        activeStorageKey = nextKey;
        if (STORAGE_MODE === STORAGE_MODE_INDEXED) {
            hydratedStorageKey = null;
            cachedRecords = [];
            cachedSerialized = "[]";
        }
        return activeStorageKey;
    }

    function ensureHydrated() {
        if (STORAGE_MODE !== STORAGE_MODE_INDEXED) {
            return;
        }
        if (hydratedStorageKey !== activeStorageKey) {
            throw new Error(ERROR_MESSAGES.STORAGE_NOT_READY);
        }
    }

    /**
     * @param {NoteRecord[]} records
     * @returns {void}
     */
    function updateCache(records) {
        cachedRecords = records;
        cachedSerialized = JSON.stringify(records);
    }

    /**
     * @returns {NoteRecord[]}
     */
    function parseCachedRecords() {
        return cloneRecords(cachedRecords);
    }

    /**
     * @param {string} storageKey
     * @param {NoteRecord[]} records
     * @returns {void}
     */
    function queuePersist(storageKey, records) {
        if (storageBlocked) {
            return;
        }
        persistChain = persistChain
            .then(() => persistNotesToIndexedDb(storageKey, records))
            .then(() => broadcastChange(storageKey))
            .catch((error) => {
                handleStorageFailure(error);
            });
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<NoteRecord[]>}
     */
    async function loadNotesFromIndexedDb(storageKey) {
        const value = await readNotesValueFromIndexedDb(storageKey);
        const records = sanitizePersistedRecords(value);
        if (records.length > 0) {
            return records;
        }
        const migrated = readNotesFromLocalStorage(storageKey);
        if (migrated.length === 0) {
            return [];
        }
        await persistNotesToIndexedDb(storageKey, migrated).catch((error) => {
            logging.error("GravityStore migration failed", error);
        });
        removeNotesFromLocalStorage(storageKey);
        return migrated;
    }

    /**
     * @param {string} storageKey
     * @returns {Promise<unknown>}
     */
    async function readNotesValueFromIndexedDb(storageKey) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NOTES, "readonly");
            const store = transaction.objectStore(STORE_NOTES);
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
     * @param {NoteRecord[]} records
     * @returns {Promise<void>}
     */
    async function persistNotesToIndexedDb(storageKey, records) {
        const db = await openStorageDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NOTES, "readwrite");
            const store = transaction.objectStore(STORE_NOTES);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                const message = transaction.error?.message ?? "unknown";
                reject(new Error(`${ERROR_MESSAGES.STORAGE_WRITE_FAILED}: ${message}`));
            };
            if (records.length === 0) {
                store.delete(storageKey);
            } else {
                store.put(records, storageKey);
            }
        });
    }

    function handleStorageFailure(error) {
        if (storageNotificationSent) {
            return;
        }
        storageNotificationSent = true;
        storageBlocked = true;
        logging.error("GravityStore persistence failed", error);
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

    /**
     * @param {string} storageKey
     * @returns {void}
     */
    function broadcastChange(storageKey) {
        if (!broadcastChannel) {
            return;
        }
        try {
            broadcastChannel.postMessage({
                storageKey,
                sourceId: broadcastSourceId
            });
        } catch (error) {
            logging.error(error);
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async function requestPersistentStorage() {
        if (typeof navigator === "undefined" || !navigator.storage || typeof navigator.storage.persist !== "function") {
            return;
        }
        try {
            await navigator.storage.persist();
        } catch {
            // ignore persistent storage failures
        }
    }

    /**
     * @returns {NoteRecord[]}
     */
    function loadAllNotesFromLocalStorage() {
        return readNotesFromLocalStorage(getActiveStorageKey());
    }

    /**
     * @param {string} storageKey
     * @param {NoteRecord[]} records
     * @returns {void}
     */
    function persistNotesToLocalStorage(storageKey, records) {
        localStorage.setItem(storageKey, JSON.stringify(records));
    }

    /**
     * @param {string} storageKey
     * @returns {NoteRecord[]}
     */
    function readNotesFromLocalStorage(storageKey) {
        if (typeof localStorage === "undefined") {
            return [];
        }
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
            return [];
        }
        try {
            const rawRecords = JSON.parse(raw);
            return sanitizePersistedRecords(rawRecords);
        } catch {
            return [];
        }
    }

    /**
     * @param {string} storageKey
     * @returns {void}
     */
    function removeNotesFromLocalStorage(storageKey) {
        if (typeof localStorage === "undefined") {
            return;
        }
        localStorage.removeItem(storageKey);
    }

    /**
     * @param {unknown} value
     * @returns {NoteRecord[]}
     */
    function sanitizePersistedRecords(value) {
        if (!Array.isArray(value)) {
            return [];
        }
        const normalized = [];
        for (const rawRecord of value) {
            const note = tryCreateNoteRecord(rawRecord);
            if (note) {
                normalized.push(note);
            }
        }
        return dedupeRecordsById(normalized);
    }

return Object.freeze({
    initialize,
    hydrateActiveScope,
    subscribeToChanges,
    loadAllNotes,
    saveAllNotes,
    exportNotes,
    importNotes,
    upsertNonEmpty,
    removeById,
    getById,
    setPinned,
    setUserScope,
    getActiveStorageKey
});
})();

/**
 * @param {Partial<NoteRecord>|null|undefined} record
 * @returns {NoteRecord}
 */
export function createNoteRecord(record) {
    const normalized = normalizeRecord(record);
    if (!isValidNoteRecord(normalized)) {
        throw new Error(ERROR_INVALID_NOTE_RECORD);
    }
    return normalized;
}

/**
 * @param {unknown} candidate
 * @returns {NoteRecord|null}
 */
function tryCreateNoteRecord(candidate) {
    try {
        return createNoteRecord(/** @type {Partial<NoteRecord>} */ (candidate));
    } catch {
        return null;
    }
}

/**
 * @param {Partial<NoteRecord>|null|undefined} record
 * @returns {NoteRecord}
 */
function normalizeRecord(record) {
    const baseRecord = typeof record === "object" && record !== null ? record : {};
    const markdownText = typeof baseRecord?.markdownText === "string" ? baseRecord.markdownText : EMPTY_STRING;
    const attachments = sanitizeAttachmentDictionary(baseRecord?.attachments || {});
    const pinned = baseRecord?.pinned === true;
    return { ...baseRecord, markdownText, attachments, pinned };
}

/**
 * Return the current storage key used for persistence.
 * @returns {string}
 */
function getActiveStorageKey() {
    return activeStorageKey;
}

/**
 * Compose the storage key for a specific user identifier.
 * @param {string} userId
 * @returns {string}
 */
function composeUserStorageKey(userId) {
    const trimmed = typeof userId === "string" ? userId.trim() : "";
    if (trimmed.length === 0) {
        return STORAGE_KEY_BASE;
    }
    const encoded = encodeURIComponent(trimmed);
    return `${STORAGE_USER_PREFIX}${encoded}`;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonBlankString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} record
 * @returns {record is NoteRecord}
 */
function isValidNoteRecord(record) {
    if (!record || typeof record !== "object") return false;
    if (!isNonBlankString(/** @type {{ noteId?: unknown }} */ (record).noteId)) return false;
    if (!isNonBlankString(/** @type {{ markdownText?: unknown }} */ (record).markdownText)) return false;
    return true;
}

/**
 * Remove duplicate records by identifier, preserving the most recently seen entry.
 * @param {NoteRecord[]} records
 * @returns {NoteRecord[]}
 */
function dedupeRecordsById(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return [];
    }
    const byId = new Map();
    for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index];
        if (!record || !isNonBlankString(record.noteId)) {
            continue;
        }
        if (!byId.has(record.noteId)) {
            byId.set(record.noteId, record);
        }
    }
    const deduped = Array.from(byId.values());
    deduped.reverse();
    return deduped;
}

/**
 * @param {NoteRecord} record
 * @returns {string}
 */
function createContentFingerprint(record) {
    const attachmentsFingerprint = canonicalizeForFingerprint(record.attachments || {});
    const classificationFingerprint = canonicalizeForFingerprint(record.classification ?? null);
    return JSON.stringify({
        markdownText: record.markdownText,
        attachments: attachmentsFingerprint,
        classification: classificationFingerprint
    });
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalizeForFingerprint(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalizeForFingerprint);
    }
    if (value && typeof value === "object") {
        const sortedKeys = Object.keys(value).sort();
        const result = {};
        for (const key of sortedKeys) {
            result[key] = canonicalizeForFingerprint(value[key]);
        }
        return result;
    }
    return value ?? null;
}

/**
 * @param {NoteRecord} record
 * @returns {NoteRecord}
 */
function cloneRecord(record) {
    if (typeof structuredClone === "function") {
        return structuredClone(record);
    }
    return JSON.parse(JSON.stringify(record));
}

/**
 * @param {NoteRecord[]} records
 * @returns {NoteRecord[]}
 */
function cloneRecords(records) {
    if (!Array.isArray(records)) {
        return [];
    }
    return records.map(cloneRecord);
}

function createBroadcastChannel() {
    if (typeof globalThis === "undefined" || typeof globalThis.BroadcastChannel !== "function") {
        return null;
    }
    return new BroadcastChannel(BROADCAST_CHANNEL_NAME);
}

function createBroadcastSourceId() {
    if (typeof globalThis !== "undefined" && typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `gravity-${Math.random().toString(36).slice(2)}`;
}
