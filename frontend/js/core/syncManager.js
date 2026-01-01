// @ts-check

import { GravityStore } from "./store.js?build=2026-01-01T21:20:40Z";
import { createBackendClient } from "./backendClient.js?build=2026-01-01T21:20:40Z";
import { createSyncMetadataStore } from "./syncMetadataStore.js?build=2026-01-01T21:20:40Z";
import { createSyncQueue } from "./syncQueue.js?build=2026-01-01T21:20:40Z";
import { appConfig } from "./config.js?build=2026-01-01T21:20:40Z";
import { logging } from "../utils/logging.js?build=2026-01-01T21:20:40Z";
import { EVENT_SYNC_SNAPSHOT_APPLIED } from "../constants.js?build=2026-01-01T21:20:40Z";

const debugEnabled = () => typeof globalThis !== "undefined" && globalThis.__debugSyncScenarios === true;

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
 *   backendClient?: ReturnType<typeof createBackendClient>,
 *   metadataStore?: ReturnType<typeof createSyncMetadataStore>,
 *   queueStore?: ReturnType<typeof createSyncQueue>,
 *   clock?: () => Date,
 *   randomUUID?: () => string,
 *   eventTarget?: EventTarget|null
 * }} [options]
 */
export function createSyncManager(options = {}) {
    const backendClient = options.backendClient ?? createBackendClient({ baseUrl: appConfig.backendBaseUrl });
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
            const metadata = ensureMetadata(noteId);
            const nextEditSeq = metadata.clientEditSeq + 1;

            metadata.clientEditSeq = nextEditSeq;
            state.metadata[noteId] = metadata;

            const operation = buildPendingOperation({
                operationId: generateUUID(),
                noteId,
                operation: "upsert",
                payload: cloneRecord(record),
                updatedAtSeconds: isoToSeconds(record.updatedAtIso, clock),
                createdAtSeconds: isoToSeconds(record.createdAtIso, clock),
                clientTimeSeconds: isoToSeconds(record.lastActivityIso, clock),
                clientEditSeq: nextEditSeq
            });

            state.queue.push(operation);
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

            state.queue.push(operation);
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
         * @returns {{ activeUserId: string|null, pendingOperations: PendingOperation[] }}
         */
        getDebugState() {
            return {
                activeUserId: state.userId,
                pendingOperations: state.queue.map((operation) => ({ ...operation }))
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
            state.queue.push(buildPendingOperation({
                operationId: generateUUID(),
                noteId: record.noteId,
                operation: "upsert",
                payload: cloneRecord(record),
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
        if (state.queue.length === 0) {
            return true;
        }
        state.flushing = true;
        try {
            const pendingOperations = state.queue.slice();
            const operations = pendingOperations.map(convertToSyncOperation);
            if (operations.length === 0) {
                return true;
            }
            const response = await backendClient.syncOperations({
                operations
            });
            applySyncResults(response?.results ?? [], operations);
            const sentOperationIds = new Set(pendingOperations.map((operation) => operation.operationId));
            state.queue = state.queue.filter((operation) => !sentOperationIds.has(operation.operationId));
            persistState();
            return state.queue.length === 0;
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
        if (debugEnabled()) {
            try {
                logging.info("syncManager.refreshSnapshot", JSON.stringify({
                    userId: state.userId,
                    queueLength: state.queue.length
                }));
            } catch {
                // ignore console failures
            }
        }
        if (state.queue.length > 0) {
            if (debugEnabled()) {
                try {
                    logging.info("syncManager.refreshSnapshot.skipped", state.queue.length);
                } catch {
                    // ignore console failures
                }
            }
            return false;
        }
        try {
            const snapshot = await backendClient.fetchSnapshot();
            if (state.queue.length > 0) {
                return false;
            }
            applySnapshot(snapshot?.notes ?? []);
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
     * @param {Array<Record<string, any>>} requestedOperations
     * @returns {void}
     */
    function applySyncResults(results, requestedOperations) {
        if (!Array.isArray(results) || results.length === 0) {
            return;
        }
        const existingNotes = GravityStore.loadAllNotes();
        const notesById = new Map(existingNotes.map((record) => [record.noteId, record]));
        let hasChanges = false;

        for (const result of results) {
            const noteId = typeof result?.note_id === "string" ? result.note_id : null;
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
    }

    /**
     * @param {Array<Record<string, any>>} snapshotNotes
     * @returns {void}
     */
    function applySnapshot(snapshotNotes) {
        if (!Array.isArray(snapshotNotes)) {
            return;
        }
        const nextRecords = [];
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
            if (entry?.is_deleted === true) {
                delete state.metadata[noteId];
                continue;
            }
            const payload = normalizeSnapshotPayload(entry?.payload);
            if (!payload) {
                continue;
            }
            nextRecords.push(payload);
        }
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
            payload: operation.payload
        };
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

}

/**
 * @param {{ operationId: string, noteId: string, operation: "upsert"|"delete", payload: unknown, clientEditSeq: number, updatedAtSeconds: number, createdAtSeconds: number, clientTimeSeconds: number }} options
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
        clientTimeSeconds: options.clientTimeSeconds
    };
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
