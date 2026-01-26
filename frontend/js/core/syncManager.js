// @ts-check

import { GravityStore } from "./store.js?build=2026-01-01T22:43:21Z";
import { createBackendClient } from "./backendClient.js?build=2026-01-01T22:43:21Z";
import { createSyncMetadataStore } from "./syncMetadataStore.js?build=2026-01-01T22:43:21Z";
import { createSyncQueue } from "./syncQueue.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import { EVENT_NOTIFICATION_REQUEST, EVENT_SYNC_SNAPSHOT_APPLIED, MESSAGE_SYNC_CONFLICT } from "../constants.js?build=2026-01-01T22:43:21Z";

const debugEnabled = () => typeof globalThis !== "undefined" && globalThis.__debugSyncScenarios === true;
const SYNC_OPERATION_STATUS_PENDING = "pending";
const SYNC_OPERATION_STATUS_CONFLICT = "conflict";
const TYPE_OBJECT = "object";
const TYPE_STRING = "string";

const ERROR_MESSAGES = Object.freeze({
    MISSING_OPTIONS: "sync_manager.missing_options",
    MISSING_BACKEND_BASE_URL: "sync_manager.missing_backend_base_url"
});

/**
 * @typedef {import("./syncMetadataStore.js").NoteMetadata} NoteMetadata
 * @typedef {import("./syncQueue.js").PendingOperation} PendingOperation
 */

/**
 * @typedef {{ authenticated: boolean, queueFlushed: boolean, snapshotApplied: boolean }} SignInResult
 */

/**
 * Create a synchronization manager responsible for coordinating backend persistence.
 * @param {{
 *   backendBaseUrl?: string,
 *   backendClient?: ReturnType<typeof createBackendClient>,
 *   metadataStore?: ReturnType<typeof createSyncMetadataStore>,
 *   queueStore?: ReturnType<typeof createSyncQueue>,
 *   clock?: () => Date,
 *   randomUUID?: () => string,
 *   eventTarget?: EventTarget|null
 * }} options
 */
export function createSyncManager(options) {
    if (!options || typeof options !== TYPE_OBJECT) {
        throw new Error(ERROR_MESSAGES.MISSING_OPTIONS);
    }
    const metadataStore = options.metadataStore ?? createSyncMetadataStore();
    const queueStore = options.queueStore ?? createSyncQueue();
    const clock = typeof options.clock === "function" ? options.clock : () => new Date();
    const generateUUID = typeof options.randomUUID === "function"
        ? options.randomUUID
        : defaultRandomUUID;
    const defaultEventTarget = typeof globalThis !== "undefined"
        && typeof globalThis.document !== "undefined"
        ? globalThis.document
        : null;
    const syncEventTarget = options.eventTarget ?? defaultEventTarget;
    const backendClient = options.backendClient ?? createBackendClient({
        baseUrl: assertBaseUrl(options.backendBaseUrl),
        eventTarget: syncEventTarget
    });

    /** @type {{ userId: string|null, metadata: Record<string, NoteMetadata>, queue: PendingOperation[], flushing: boolean }} */
    const state = {
        userId: null,
        metadata: {},
        queue: [],
        flushing: false
    };

    return Object.freeze({
        /**
         * Record a local upsert event and queue a sync operation when applicable.
         * @param {import("../types.d.js").NoteRecord} record
         * @returns {void}
         */
        recordLocalUpsert(record) {
            if (!state.userId) {
                return;
            }
            if (!isValidRecord(record)) {
                return;
            }

            const noteId = record.noteId;
            clearConflictsForNote(noteId);
            const metadata = ensureMetadata(noteId);
            const nextEditSeq = metadata.clientEditSeq + 1;

            metadata.clientEditSeq = nextEditSeq;
            state.metadata[noteId] = metadata;

            const operation = buildPendingOperation({
                operationId: generateUUID(),
                noteId,
                operation: "upsert",
                payload: null,
                updatedAtSeconds: isoToSeconds(record.updatedAtIso, clock),
                createdAtSeconds: isoToSeconds(record.createdAtIso, clock),
                clientTimeSeconds: isoToSeconds(record.lastActivityIso, clock),
                clientEditSeq: nextEditSeq
            });

            upsertPendingOperation(operation);
            persistState();
            void flushQueue();
        },

        /**
         * Record a local delete event and queue a sync operation.
         * @param {string} noteId
         * @param {import("../types.d.js").NoteRecord|null} priorRecord
         * @returns {void}
         */
        recordLocalDelete(noteId, priorRecord) {
            if (!state.userId || !noteId) {
                return;
            }
            clearConflictsForNote(noteId);
            const metadata = ensureMetadata(noteId);
            const nextEditSeq = metadata.clientEditSeq + 1;
            metadata.clientEditSeq = nextEditSeq;
            state.metadata[noteId] = metadata;

            const payloadRecord = priorRecord ? cloneRecord(priorRecord) : null;
            const nowSeconds = Math.floor(clock().getTime() / 1000);
            const operation = buildPendingOperation({
                operationId: generateUUID(),
                noteId,
                operation: "delete",
                payload: payloadRecord,
                updatedAtSeconds: nowSeconds,
                createdAtSeconds: nowSeconds,
                clientTimeSeconds: nowSeconds,
                clientEditSeq: nextEditSeq
            });

            upsertPendingOperation(operation);
            persistState();
            void flushQueue();
        },

        /**
         * Handle sign-in by hydrating metadata, flushing the local queue, and reconciling a snapshot.
         * @param {{ userId: string }} params
         * @returns {Promise<SignInResult>}
         */
        async handleSignIn(params) {
            if (!params || typeof params.userId !== "string" || params.userId.length === 0) {
                return { authenticated: false, queueFlushed: false, snapshotApplied: false };
            }

            if (debugEnabled()) {
                try {
                    logging.info("syncManager.handleSignIn", params.userId);
                } catch {
                    // ignore console failures
                }
            }
            if (typeof metadataStore.hydrate === "function") {
                await metadataStore.hydrate(params.userId);
            }
            if (typeof queueStore.hydrate === "function") {
                await queueStore.hydrate(params.userId);
            }
            const loadedMetadata = metadataStore.load(params.userId);
            const loadedQueue = queueStore.load(params.userId);

            state.userId = params.userId;
            state.metadata = loadedMetadata;
            state.queue = loadedQueue;

            seedInitialOperations();
            persistState();

            if (debugEnabled()) {
                try {
                    logging.info("syncManager.handleSignIn.state", JSON.stringify({
                        queueLength: state.queue.length,
                        userId: state.userId
                    }));
                } catch {
                    // ignore console failures
                }
            }
            const queueFlushed = await flushQueue();
            const snapshotApplied = await refreshSnapshot();

            return {
                authenticated: queueFlushed || snapshotApplied,
                queueFlushed,
                snapshotApplied
            };
        },

        /**
         * Reset sync state when signing out.
         * @returns {void}
         */
        handleSignOut() {
            if (state.userId) {
                metadataStore.clear(state.userId);
                queueStore.clear(state.userId);
            }
            state.userId = null;
            state.metadata = {};
            state.queue = [];
            state.flushing = false;
        },

        /**
         * Synchronize pending operations and refresh backend snapshot.
         * @param {{ flushQueue?: boolean }} [options]
         * @returns {Promise<{ queueFlushed: boolean, snapshotApplied: boolean }>}
         */
        async synchronize(options = {}) {
            if (!state.userId) {
                return { queueFlushed: false, snapshotApplied: false };
            }
            const shouldFlush = options.flushQueue !== false;
            let queueFlushed = !shouldFlush;
            if (shouldFlush) {
                queueFlushed = await flushQueue();
            }
            const snapshotApplied = await refreshSnapshot();
            return { queueFlushed, snapshotApplied };
        },

        /**
         * Expose internal state for diagnostics and testing.
         * @returns {{ activeUserId: string|null, pendingOperations: PendingOperation[], conflictOperations: PendingOperation[] }}
         */
        getDebugState() {
            return {
                activeUserId: state.userId,
                pendingOperations: state.queue.filter(isPendingOperation).map((operation) => ({ ...operation })),
                conflictOperations: state.queue.filter(isConflictOperation).map((operation) => ({ ...operation }))
            };
        }
    });

    function ensureMetadata(noteId) {
        if (!state.metadata[noteId]) {
            state.metadata[noteId] = {
                clientEditSeq: 0,
                serverEditSeq: 0,
                serverVersion: 0
            };
        }
        return state.metadata[noteId];
    }

    function persistState() {
        if (state.userId) {
            metadataStore.save(state.userId, state.metadata);
            queueStore.save(state.userId, state.queue);
        }
    }

    function clearConflictsForNote(noteId) {
        if (!noteId) {
            return;
        }
        const nextQueue = state.queue.filter((operation) => !(isConflictOperation(operation) && operation.noteId === noteId));
        if (nextQueue.length !== state.queue.length) {
            state.queue = nextQueue;
        }
    }

    /**
     * @param {PendingOperation} operation
     * @returns {void}
     */
    function upsertPendingOperation(operation) {
        const existingIndex = state.queue.findIndex((entry) => isPendingOperation(entry) && entry.noteId === operation.noteId);
        if (existingIndex >= 0) {
            state.queue[existingIndex] = operation;
            return;
        }
        state.queue.push(operation);
    }

    function collectConflictNoteIds() {
        const conflictNotes = new Set();
        for (const operation of state.queue) {
            if (isConflictOperation(operation)) {
                conflictNotes.add(operation.noteId);
            }
        }
        return conflictNotes;
    }

    function getPendingOperations() {
        return state.queue.filter(isPendingOperation);
    }

    function getConflictOperations() {
        return state.queue.filter(isConflictOperation);
    }

    function countPendingOperations(queue) {
        return queue.filter(isPendingOperation).length;
    }

    function countConflictOperations(queue) {
        return queue.filter(isConflictOperation).length;
    }

    function seedInitialOperations() {
        if (!state.userId) {
            return;
        }
        const notes = GravityStore.loadAllNotes();
        for (const record of notes) {
            if (!isValidRecord(record)) {
                continue;
            }
            const pendingExists = state.queue.some((operation) => operation.noteId === record.noteId);
            if (pendingExists) {
                continue;
            }
            const metadata = ensureMetadata(record.noteId);
            if (metadata.serverVersion > 0 && metadata.clientEditSeq === metadata.serverEditSeq) {
                continue;
            }
            const nextSeq = metadata.clientEditSeq + 1;
            metadata.clientEditSeq = nextSeq;
            state.metadata[record.noteId] = metadata;
            upsertPendingOperation(buildPendingOperation({
                operationId: generateUUID(),
                noteId: record.noteId,
                operation: "upsert",
                payload: null,
                updatedAtSeconds: isoToSeconds(record.updatedAtIso, clock),
                createdAtSeconds: isoToSeconds(record.createdAtIso, clock),
                clientTimeSeconds: isoToSeconds(record.lastActivityIso, clock),
                clientEditSeq: nextSeq
            }));
        }
    }

    async function flushQueue() {
        if (!state.userId) {
            return false;
        }
        if (state.flushing) {
            return false;
        }
        state.flushing = true;
        try {
            const pendingOperations = getPendingOperations();
            const conflictOperations = getConflictOperations();
            if (pendingOperations.length === 0) {
                return conflictOperations.length === 0;
            }
            const operations = pendingOperations.map(convertToSyncOperation);
            const response = await backendClient.syncOperations({
                operations
            });
            const syncOutcome = applySyncResults(response?.results ?? [], pendingOperations);
            state.queue = reconcileQueue(state.queue, syncOutcome);
            persistState();
            return countPendingOperations(state.queue) === 0 && countConflictOperations(state.queue) === 0;
        } catch (error) {
            logging.error(error);
            return false;
        } finally {
            state.flushing = false;
        }
    }

    async function refreshSnapshot() {
        if (!state.userId) {
            return false;
        }
        const pendingOperations = getPendingOperations();
        const conflictOperations = getConflictOperations();
        if (debugEnabled()) {
            try {
                logging.info("syncManager.refreshSnapshot", JSON.stringify({
                    userId: state.userId,
                    pendingCount: pendingOperations.length,
                    conflictCount: conflictOperations.length
                }));
            } catch {
                // ignore console failures
            }
        }
        if (pendingOperations.length > 0) {
            if (debugEnabled()) {
                try {
                    logging.info("syncManager.refreshSnapshot.skipped", pendingOperations.length);
                } catch {
                    // ignore console failures
                }
            }
            return false;
        }
        try {
            const snapshot = await backendClient.fetchSnapshot();
            if (getPendingOperations().length > 0) {
                return false;
            }
            applySnapshot(snapshot?.notes ?? [], collectConflictNoteIds());
            if (debugEnabled()) {
                try {
                    logging.info("syncManager.refreshSnapshot.applied", JSON.stringify({
                        userId: state.userId,
                        recordCount: Array.isArray(snapshot?.notes) ? snapshot.notes.length : 0
                    }));
                } catch {
                    // ignore console failures
                }
            }
            persistState();
            return true;
        } catch (error) {
            logging.error(error);
            return false;
        }
    }

    /**
     * @param {Array<Record<string, any>>} results
     * @param {PendingOperation[]} pendingOperations
     * @returns {{ acceptedOperationIds: Set<string>, conflictOperationUpdates: Array<{ operationId: string, noteId: string, conflict: import("./syncQueue.js").ConflictInfo }>, resolvedNoteIds: Set<string> }}
     */
    function applySyncResults(results, pendingOperations) {
        const syncOutcome = {
            acceptedOperationIds: new Set(),
            conflictOperationUpdates: [],
            resolvedNoteIds: new Set()
        };
        if (!Array.isArray(results) || results.length === 0) {
            return syncOutcome;
        }
        const existingNotes = GravityStore.loadAllNotes();
        const notesById = new Map(existingNotes.map((record) => [record.noteId, record]));
        let hasChanges = false;

        for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
            const result = results[resultIndex];
            const operation = pendingOperations[resultIndex];
            if (!operation) {
                continue;
            }
            const noteId = resolveNoteId(result, operation.noteId);
            if (!noteId) {
                continue;
            }
            const metadata = ensureMetadata(noteId);
            const serverEditSeq = typeof result?.last_writer_edit_seq === "number" ? result.last_writer_edit_seq : metadata.serverEditSeq;
            const serverVersion = typeof result?.version === "number" ? result.version : metadata.serverVersion;
            metadata.serverEditSeq = serverEditSeq;
            metadata.serverVersion = serverVersion;
            if (metadata.clientEditSeq < serverEditSeq) {
                metadata.clientEditSeq = serverEditSeq;
            }
            const accepted = result?.accepted === true;
            if (!accepted) {
                syncOutcome.conflictOperationUpdates.push({
                    operationId: operation.operationId,
                    noteId,
                    conflict: buildConflictInfo(result)
                });
                continue;
            }
            syncOutcome.acceptedOperationIds.add(operation.operationId);
            syncOutcome.resolvedNoteIds.add(noteId);
            const isDeleted = result?.is_deleted === true;
            if (isDeleted) {
                const existing = GravityStore.getById(noteId);
                if (existing) {
                    GravityStore.removeById(noteId);
                    hasChanges = true;
                }
                delete state.metadata[noteId];
                notesById.delete(noteId);
                continue;
            }
            const payload = normalizeSnapshotPayload(result?.payload);
            if (!payload) {
                continue;
            }
            notesById.set(noteId, payload);
            GravityStore.upsertNonEmpty(payload);
            hasChanges = true;
        }

        const noteArray = Array.from(notesById.values());
        GravityStore.saveAllNotes(noteArray);
        if (hasChanges) {
            dispatchSnapshotEvent(noteArray, "sync-results");
        }
        if (syncOutcome.conflictOperationUpdates.length > 0) {
            dispatchConflictNotification(syncOutcome.conflictOperationUpdates.length);
        }
        return syncOutcome;
    }

    /**
     * @param {Array<Record<string, any>>} snapshotNotes
     * @param {Set<string>} conflictNoteIds
     * @returns {void}
     */
    function applySnapshot(snapshotNotes, conflictNoteIds) {
        if (!Array.isArray(snapshotNotes)) {
            return;
        }
        const conflictNotes = conflictNoteIds instanceof Set ? conflictNoteIds : new Set();
        const existingNotes = GravityStore.loadAllNotes();
        const notesById = new Map(existingNotes.map((record) => [record.noteId, record]));
        for (const entry of snapshotNotes) {
            const noteId = typeof entry?.note_id === "string" ? entry.note_id : null;
            if (!noteId) {
                continue;
            }
            const metadata = ensureMetadata(noteId);
            const serverEditSeq = typeof entry?.last_writer_edit_seq === "number" ? entry.last_writer_edit_seq : metadata.serverEditSeq;
            const serverVersion = typeof entry?.version === "number" ? entry.version : metadata.serverVersion;
            metadata.serverEditSeq = serverEditSeq;
            metadata.serverVersion = serverVersion;
            if (metadata.clientEditSeq < serverEditSeq) {
                metadata.clientEditSeq = serverEditSeq;
            }
            if (conflictNotes.has(noteId)) {
                continue;
            }
            if (entry?.is_deleted === true) {
                delete state.metadata[noteId];
                notesById.delete(noteId);
                continue;
            }
            const payload = normalizeSnapshotPayload(entry?.payload);
            if (!payload) {
                continue;
            }
            notesById.set(noteId, payload);
        }
        const nextRecords = Array.from(notesById.values());
        GravityStore.saveAllNotes(nextRecords);
        dispatchSnapshotEvent(nextRecords, "snapshot");
    }

    /**
     * @param {any} payload
     * @returns {import("../types.d.js").NoteRecord|null}
     */
    function normalizeSnapshotPayload(payload) {
        if (!payload || typeof payload !== "object") {
            logging.warn("snapshot payload invalid", payload);
            return null;
        }
        const candidate = /** @type {Record<string, unknown>} */ (payload);
        const noteId = typeof candidate.noteId === "string" ? candidate.noteId : null;
        const markdownText = typeof candidate.markdownText === "string" ? candidate.markdownText : null;
        if (!noteId || !markdownText) {
            logging.warn("snapshot payload missing fields", payload);
            return null;
        }
        return {
            ...candidate,
            noteId,
            markdownText
        };
    }

    function buildConflictInfo(result) {
        const serverEditSeq = typeof result?.last_writer_edit_seq === "number" ? result.last_writer_edit_seq : 0;
        const serverVersion = typeof result?.version === "number" ? result.version : 0;
        const serverUpdatedAtSeconds = typeof result?.updated_at_s === "number" ? result.updated_at_s : 0;
        const serverPayload = result?.payload ?? null;
        const rejectedAtSeconds = Math.floor(clock().getTime() / 1000);
        return {
            serverEditSeq,
            serverVersion,
            serverUpdatedAtSeconds,
            serverPayload,
            rejectedAtSeconds
        };
    }

    function resolveNoteId(result, fallbackNoteId) {
        const candidate = typeof result?.note_id === "string" ? result.note_id : "";
        if (candidate.length > 0) {
            return candidate;
        }
        return fallbackNoteId;
    }

    function reconcileQueue(existingQueue, syncOutcome) {
        const conflictUpdatesByOperationId = new Map();
        for (const update of syncOutcome.conflictOperationUpdates) {
            conflictUpdatesByOperationId.set(update.operationId, update);
        }
        const nextQueue = [];
        for (const operation of existingQueue) {
            if (syncOutcome.acceptedOperationIds.has(operation.operationId)) {
                continue;
            }
            if (syncOutcome.resolvedNoteIds.has(operation.noteId) && isConflictOperation(operation)) {
                continue;
            }
            const conflictUpdate = conflictUpdatesByOperationId.get(operation.operationId);
            if (conflictUpdate) {
                nextQueue.push({
                    ...operation,
                    status: SYNC_OPERATION_STATUS_CONFLICT,
                    conflict: conflictUpdate.conflict
                });
                continue;
            }
            nextQueue.push(operation);
        }
        return nextQueue;
    }

    /**
     * @param {PendingOperation} operation
     * @returns {Record<string, any>}
     */
    function convertToSyncOperation(operation) {
        return {
            operation: operation.operation,
            note_id: operation.noteId,
            client_edit_seq: operation.clientEditSeq,
            client_time_s: operation.clientTimeSeconds,
            created_at_s: operation.createdAtSeconds,
            updated_at_s: operation.updatedAtSeconds,
            payload: resolveOperationPayload(operation)
        };
    }

    /**
     * @param {PendingOperation} operation
     * @returns {unknown}
     */
    function resolveOperationPayload(operation) {
        if (operation.payload !== null && typeof operation.payload !== "undefined") {
            return operation.payload;
        }
        if (operation.operation === "delete") {
            return operation.payload ?? null;
        }
        const record = GravityStore.getById(operation.noteId);
        if (!record) {
            throw new Error(`sync.payload.missing: ${operation.noteId}`);
        }
        return cloneRecord(record);
    }

    function dispatchSnapshotEvent(records, source) {
        if (!syncEventTarget) {
            return;
        }
        const detail = {
            records: records.map((record) => cloneRecord(record)),
            source
        };
        try {
            const event = new CustomEvent(EVENT_SYNC_SNAPSHOT_APPLIED, {
                bubbles: true,
                detail
            });
            syncEventTarget.dispatchEvent(event);
        } catch (error) {
            logging.error(error);
            try {
                const fallbackEvent = new Event(EVENT_SYNC_SNAPSHOT_APPLIED);
                /** @type {any} */ (fallbackEvent).detail = detail;
                syncEventTarget.dispatchEvent(fallbackEvent);
            } catch (fallbackError) {
                logging.error(fallbackError);
            }
        }
    }

    function dispatchConflictNotification(conflictCount) {
        if (!syncEventTarget) {
            return;
        }
        const detail = {
            message: MESSAGE_SYNC_CONFLICT,
            conflictCount
        };
        try {
            const event = new CustomEvent(EVENT_NOTIFICATION_REQUEST, {
                bubbles: true,
                detail
            });
            syncEventTarget.dispatchEvent(event);
        } catch (error) {
            logging.error(error);
            try {
                const fallbackEvent = new Event(EVENT_NOTIFICATION_REQUEST);
                /** @type {any} */ (fallbackEvent).detail = detail;
                syncEventTarget.dispatchEvent(fallbackEvent);
            } catch (fallbackError) {
                logging.error(fallbackError);
            }
        }
    }

}

/**
 * @param {unknown} value
 * @returns {string}
 */
function assertBaseUrl(value) {
    if (typeof value !== TYPE_STRING || value.length === 0) {
        throw new Error(ERROR_MESSAGES.MISSING_BACKEND_BASE_URL);
    }
    return value;
}

/**
 * @param {{ operationId: string, noteId: string, operation: "upsert"|"delete", payload?: unknown|null, clientEditSeq: number, updatedAtSeconds: number, createdAtSeconds: number, clientTimeSeconds: number }} options
 * @returns {PendingOperation}
 */
function buildPendingOperation(options) {
    return {
        operationId: options.operationId,
        noteId: options.noteId,
        operation: options.operation,
        payload: options.payload ?? null,
        clientEditSeq: options.clientEditSeq,
        updatedAtSeconds: options.updatedAtSeconds,
        createdAtSeconds: options.createdAtSeconds,
        clientTimeSeconds: options.clientTimeSeconds,
        status: SYNC_OPERATION_STATUS_PENDING
    };
}

/**
 * @param {PendingOperation} operation
 * @returns {boolean}
 */
function isConflictOperation(operation) {
    return operation?.status === SYNC_OPERATION_STATUS_CONFLICT;
}

/**
 * @param {PendingOperation} operation
 * @returns {boolean}
 */
function isPendingOperation(operation) {
    return operation?.status !== SYNC_OPERATION_STATUS_CONFLICT;
}

/**
 * @param {import("../types.d.js").NoteRecord} record
 * @returns {boolean}
 */
function isValidRecord(record) {
    return Boolean(record && typeof record.noteId === "string" && record.noteId.length > 0 && typeof record.markdownText === "string");
}

/**
 * @param {import("../types.d.js").NoteRecord} record
 * @returns {import("../types.d.js").NoteRecord}
 */
function cloneRecord(record) {
    return JSON.parse(JSON.stringify(record));
}

/**
 * @param {string|undefined|null} iso
 * @param {() => Date} clock
 * @returns {number}
 */
function isoToSeconds(iso, clock) {
    if (typeof iso === "string") {
        const parsed = Date.parse(iso);
        if (!Number.isNaN(parsed)) {
            return Math.floor(parsed / 1000);
        }
    }
    return Math.floor(clock().getTime() / 1000);
}

function defaultRandomUUID() {
    if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `op-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}
