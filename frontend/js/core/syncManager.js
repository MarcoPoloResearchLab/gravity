// @ts-check

import { GravityStore } from "./store.js?build=2026-01-01T22:43:21Z";
import { createBackendClient } from "./backendClient.js?build=2026-01-01T22:43:21Z";
import { createSyncMetadataStore } from "./syncMetadataStore.js?build=2026-01-01T22:43:21Z";
import { createSyncQueue } from "./syncQueue.js?build=2026-01-01T22:43:21Z";
import { createCrdtNoteEngine } from "./crdtNoteEngine.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import { EVENT_SYNC_SNAPSHOT_APPLIED } from "../constants.js?build=2026-01-01T22:43:21Z";

const debugEnabled = () => typeof globalThis !== "undefined" && globalThis.__debugSyncScenarios === true;
const TYPE_OBJECT = "object";
const TYPE_STRING = "string";
const SNAPSHOT_UPDATE_ID_MAX = Number.MAX_SAFE_INTEGER;
const SYNC_SOURCE_SNAPSHOT = "snapshot";
const SYNC_SOURCE_UPDATES = "updates";

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
 *   crdtEngine?: ReturnType<typeof createCrdtNoteEngine>,
 *   yjsLoader?: () => Promise<typeof import("yjs")>,
 *   documentStore?: Parameters<typeof createCrdtNoteEngine>[0]["documentStore"],
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

    const engineOptions = {};
    if (options.documentStore) {
        engineOptions.documentStore = options.documentStore;
    }
    if (typeof options.yjsLoader === "function") {
        engineOptions.yjsLoader = options.yjsLoader;
    }

    const crdtEngine = options.crdtEngine ?? createCrdtNoteEngine(engineOptions);

    /** @type {{ userId: string|null, metadata: Record<string, NoteMetadata>, queue: PendingOperation[], flushing: boolean }} */
    const state = {
        userId: null,
        metadata: {},
        queue: [],
        flushing: false
    };

    let engineReady = false;

    return Object.freeze({
        /**
         * Record a local upsert event and queue a sync operation when applicable.
         * @param {import("../types.d.js").NoteRecord} record
         * @returns {void}
         */
        recordLocalUpsert(record) {
            if (!state.userId || !engineReady) {
                return;
            }
            if (!isValidRecord(record)) {
                return;
            }

            const operationResult = crdtEngine.applyLocalRecord(record, false);
            enqueueOperation(record.noteId, operationResult);
            persistState();
            void syncPendingQueue();
        },

        /**
         * Record a local delete event and queue a sync operation.
         * @param {string} noteId
         * @param {import("../types.d.js").NoteRecord|null} priorRecord
         * @returns {void}
         */
        recordLocalDelete(noteId, priorRecord) {
            if (!state.userId || !engineReady || !noteId) {
                return;
            }

            const record = isValidRecord(priorRecord)
                ? priorRecord
                : buildTombstoneRecord(noteId);
            const operationResult = crdtEngine.applyLocalRecord(record, true);
            enqueueOperation(noteId, operationResult);
            persistState();
            void syncPendingQueue();
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
                logging.info("syncManager.handleSignIn", params.userId);
            }

            if (typeof metadataStore.hydrate === "function") {
                await metadataStore.hydrate(params.userId);
            }
            if (typeof queueStore.hydrate === "function") {
                await queueStore.hydrate(params.userId);
            }
            await crdtEngine.hydrate(params.userId);

            const loadedMetadata = metadataStore.load(params.userId);
            const loadedQueue = queueStore.load(params.userId);

            state.userId = params.userId;
            state.metadata = loadedMetadata;
            state.queue = loadedQueue;
            engineReady = true;

            seedLocalRecords();
            persistState();

            if (debugEnabled()) {
                logging.info("syncManager.handleSignIn.state", JSON.stringify({
                    queueLength: state.queue.length,
                    userId: state.userId
                }));
            }

            const queueFlushed = await syncPendingQueue();
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
            state.userId = null;
            state.metadata = {};
            state.queue = [];
            state.flushing = false;
            engineReady = false;
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
            const queueFlushed = shouldFlush ? await syncPendingQueue() : true;
            const snapshotApplied = await refreshSnapshot();
            return { queueFlushed, snapshotApplied };
        },

        /**
         * Expose internal state for diagnostics and testing.
         * @returns {{ activeUserId: string|null, pendingOperations: PendingOperation[], lastSeenUpdateIds: Record<string, NoteMetadata> }}
         */
        getDebugState() {
            return {
                activeUserId: state.userId,
                pendingOperations: state.queue.map((operation) => ({ ...operation })),
                lastSeenUpdateIds: { ...state.metadata }
            };
        }
    });

    function persistState() {
        if (!state.userId) {
            return;
        }
        metadataStore.save(state.userId, state.metadata);
        queueStore.save(state.userId, state.queue);
        crdtEngine.persist();
    }

    function seedLocalRecords() {
        const records = GravityStore.loadAllNotes();
        for (const record of records) {
            if (!isValidRecord(record)) {
                continue;
            }
            const existing = crdtEngine.buildRecord(record.noteId);
            if (recordsMatch(existing, record)) {
                continue;
            }
            const operationResult = crdtEngine.applyLocalRecord(record, false);
            enqueueOperation(record.noteId, operationResult);
        }
    }

    function enqueueOperation(noteId, operationResult) {
        if (!noteId || !operationResult) {
            return;
        }
        const operation = {
            operationId: generateUUID(),
            noteId,
            updateB64: operationResult.updateB64,
            snapshotB64: operationResult.snapshotB64,
            snapshotUpdateId: SNAPSHOT_UPDATE_ID_MAX
        };

        const existingIndex = state.queue.findIndex((entry) => entry.noteId === noteId);
        if (existingIndex >= 0) {
            state.queue[existingIndex] = operation;
            return;
        }
        state.queue.push(operation);
    }

    async function syncPendingQueue() {
        if (!state.userId) {
            return false;
        }
        if (state.flushing) {
            return false;
        }
        state.flushing = true;
        try {
            const updates = buildUpdatePayloads();
            const cursors = buildCursorPayloads();
            if (updates.length === 0 && cursors.length === 0) {
                return true;
            }
            const response = await backendClient.syncOperations({ updates, cursors });
            const acceptedNotes = applySyncResults(response?.results ?? []);
            if (acceptedNotes.size > 0) {
                state.queue = state.queue.filter((operation) => !acceptedNotes.has(operation.noteId));
            }
            const appliedUpdates = applyRemoteUpdates(response?.updates ?? []);
            if (appliedUpdates || acceptedNotes.size > 0) {
                persistState();
            }
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
        try {
            const snapshot = await backendClient.fetchSnapshot();
            const notes = Array.isArray(snapshot?.notes) ? snapshot.notes : null;
            if (!notes) {
                return false;
            }
            const applied = applySnapshotNotes(notes);
            if (applied) {
                persistState();
            }
            return applied || notes.length === 0;
        } catch (error) {
            logging.error(error);
            return false;
        }
    }

    function applySyncResults(results) {
        const acceptedNotes = new Set();
        if (!Array.isArray(results) || results.length === 0) {
            return acceptedNotes;
        }
        for (const result of results) {
            if (!result || typeof result !== "object") {
                continue;
            }
            const noteId = typeof result.note_id === "string" ? result.note_id : "";
            if (!noteId) {
                continue;
            }
            const accepted = result.accepted === true || result.duplicate === true;
            if (!accepted) {
                continue;
            }
            const updateId = typeof result.update_id === "number" && Number.isFinite(result.update_id)
                ? result.update_id
                : null;
            if (updateId !== null) {
                updateLastSeenUpdateId(noteId, updateId);
            }
            acceptedNotes.add(noteId);
        }
        return acceptedNotes;
    }

    function applyRemoteUpdates(updates) {
        if (!Array.isArray(updates) || updates.length === 0) {
            return false;
        }
        const sorted = updates
            .filter((entry) => entry && typeof entry === "object")
            .slice()
            .sort((first, second) => {
                const firstId = typeof first.update_id === "number" ? first.update_id : 0;
                const secondId = typeof second.update_id === "number" ? second.update_id : 0;
                return firstId - secondId;
            });

        let applied = false;
        for (const update of sorted) {
            const noteId = typeof update.note_id === "string" ? update.note_id : "";
            const updateB64 = typeof update.update_b64 === "string" ? update.update_b64 : "";
            if (!noteId || !updateB64) {
                continue;
            }
            crdtEngine.applyUpdate(noteId, updateB64);
            if (typeof update.update_id === "number" && Number.isFinite(update.update_id)) {
                updateLastSeenUpdateId(noteId, update.update_id);
            }
            applied = true;
        }

        if (applied) {
            crdtEngine.persist();
            syncNotesFromEngine(SYNC_SOURCE_UPDATES);
        }
        return applied;
    }

    function applySnapshotNotes(notes) {
        if (!Array.isArray(notes) || notes.length === 0) {
            return false;
        }
        const localRecords = GravityStore.loadAllNotes();
        const localRecordsById = new Map(localRecords.map((record) => [record.noteId, record]));
        let appliedSnapshot = false;
        let queuedMigration = false;

        for (const entry of notes) {
            if (!entry || typeof entry !== "object") {
                continue;
            }
            const noteId = typeof entry.note_id === "string" ? entry.note_id : "";
            if (!noteId) {
                continue;
            }
            const snapshotB64 = typeof entry.snapshot_b64 === "string" ? entry.snapshot_b64 : "";
            if (snapshotB64) {
                crdtEngine.applySnapshot(noteId, snapshotB64);
                if (typeof entry.snapshot_update_id === "number" && Number.isFinite(entry.snapshot_update_id)) {
                    updateLastSeenUpdateId(noteId, entry.snapshot_update_id);
                }
                appliedSnapshot = true;
                continue;
            }

            if (!("legacy_payload" in entry)) {
                continue;
            }
            const localRecord = localRecordsById.get(noteId) ?? null;
            if (localRecord && isValidRecord(localRecord)) {
                const operationResult = crdtEngine.applyLocalRecord(localRecord, false);
                enqueueOperation(noteId, operationResult);
                queuedMigration = true;
                appliedSnapshot = true;
                continue;
            }
            const legacyPayload = entry.legacy_payload && typeof entry.legacy_payload === "object"
                ? entry.legacy_payload
                : {};
            const legacyDeleted = entry.legacy_deleted === true;
            const operationResult = crdtEngine.applyLegacyPayload(noteId, legacyPayload, legacyDeleted);
            enqueueOperation(noteId, operationResult);
            queuedMigration = true;
            appliedSnapshot = true;
        }

        if (appliedSnapshot) {
            crdtEngine.persist();
            syncNotesFromEngine(SYNC_SOURCE_SNAPSHOT);
        }
        return appliedSnapshot || queuedMigration;
    }

    function syncNotesFromEngine(source) {
        const records = crdtEngine.buildAllRecords();
        GravityStore.saveAllNotes(records);
        dispatchSnapshotEvent(records, source);
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

    function buildUpdatePayloads() {
        if (!Array.isArray(state.queue) || state.queue.length === 0) {
            return [];
        }
        return state.queue.map((operation) => ({
            note_id: operation.noteId,
            update_b64: operation.updateB64,
            snapshot_b64: operation.snapshotB64,
            snapshot_update_id: operation.snapshotUpdateId
        }));
    }

    function buildCursorPayloads() {
        const noteIds = new Set();
        for (const noteId of Object.keys(state.metadata)) {
            if (noteId) {
                noteIds.add(noteId);
            }
        }
        for (const operation of state.queue) {
            if (operation?.noteId) {
                noteIds.add(operation.noteId);
            }
        }
        try {
            const records = GravityStore.loadAllNotes();
            for (const record of records) {
                if (record?.noteId) {
                    noteIds.add(record.noteId);
                }
            }
        } catch (error) {
            logging.error(error);
        }

        const cursors = [];
        for (const noteId of noteIds) {
            const lastSeen = state.metadata[noteId]?.lastSeenUpdateId ?? 0;
            cursors.push({
                note_id: noteId,
                last_update_id: Number.isFinite(lastSeen) && lastSeen >= 0 ? lastSeen : 0
            });
        }
        return cursors;
    }

    function updateLastSeenUpdateId(noteId, updateId) {
        if (!noteId) {
            return;
        }
        if (!Number.isFinite(updateId) || updateId < 0) {
            return;
        }
        const existing = state.metadata[noteId]?.lastSeenUpdateId ?? 0;
        const next = updateId > existing ? updateId : existing;
        state.metadata[noteId] = { lastSeenUpdateId: next };
    }

    /**
     * @param {string} noteId
     * @returns {import("../types.d.js").NoteRecord}
     */
    function buildTombstoneRecord(noteId) {
        const now = clock().toISOString();
        return {
            noteId,
            markdownText: "",
            createdAtIso: now,
            updatedAtIso: now,
            lastActivityIso: now
        };
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
 * @param {import("../types.d.js").NoteRecord|null|undefined} record
 * @returns {boolean}
 */
function isValidRecord(record) {
    return Boolean(record
        && typeof record.noteId === "string"
        && record.noteId.length > 0
        && typeof record.markdownText === "string");
}

/**
 * @param {import("../types.d.js").NoteRecord} record
 * @returns {import("../types.d.js").NoteRecord}
 */
function cloneRecord(record) {
    if (typeof structuredClone === "function") {
        return structuredClone(record);
    }
    return JSON.parse(JSON.stringify(record));
}

/**
 * @param {import("../types.d.js").NoteRecord|null} left
 * @param {import("../types.d.js").NoteRecord} right
 * @returns {boolean}
 */
function recordsMatch(left, right) {
    if (!left) {
        return false;
    }
    if (left.noteId !== right.noteId) {
        return false;
    }
    if (left.markdownText !== right.markdownText) {
        return false;
    }
    if ((left.createdAtIso ?? "") !== (right.createdAtIso ?? "")) {
        return false;
    }
    if ((left.updatedAtIso ?? "") !== (right.updatedAtIso ?? "")) {
        return false;
    }
    if ((left.lastActivityIso ?? "") !== (right.lastActivityIso ?? "")) {
        return false;
    }
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
        return false;
    }
    if (!objectsMatch(left.attachments, right.attachments)) {
        return false;
    }
    if (!objectsMatch(left.classification, right.classification)) {
        return false;
    }
    return true;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function objectsMatch(left, right) {
    if (!left && !right) {
        return true;
    }
    return stableStringify(left) === stableStringify(right);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
    if (value === null || typeof value === "undefined") {
        return "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    }
    if (typeof value === "object") {
        const entries = Object.entries(value)
            .map(([key, entryValue]) => [key, stableStringify(entryValue)])
            .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
        return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${entryValue}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function defaultRandomUUID() {
    if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `op-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}
