// @ts-check

import { GravityStore } from "./store.js";
import { createBackendClient } from "./backendClient.js";
import { createSyncMetadataStore } from "./syncMetadataStore.js";
import { createSyncQueue } from "./syncQueue.js";
import { appConfig } from "./config.js";
import { logging } from "../utils/logging.js";
import { EVENT_SYNC_SNAPSHOT_APPLIED } from "../constants.js";

/**
 * @typedef {import("./syncMetadataStore.js").NoteMetadata} NoteMetadata
 * @typedef {import("./syncQueue.js").PendingOperation} PendingOperation
 */

/**
 * @typedef {{ authenticated: boolean, queueFlushed: boolean, snapshotApplied: boolean, accessToken: string|null, accessTokenExpiresAtMs: number|null }} SignInResult
 */

const BACKEND_TOKEN_EXPIRY_SKEW_MS = 1000;

/**
 * Create a synchronization manager responsible for coordinating backend persistence.
 * @param {{
 *   backendClient?: ReturnType<typeof createBackendClient>,
 *   metadataStore?: ReturnType<typeof createSyncMetadataStore>,
 *   queueStore?: ReturnType<typeof createSyncQueue>,
 *   clock?: () => Date,
 *   randomUUID?: () => string,
 *   eventTarget?: EventTarget|null,
 *   onBackendTokenRefreshed?: (token: { accessToken: string, expiresAtMs: number }) => void
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
    const backendTokenCallback = typeof options.onBackendTokenRefreshed === "function"
        ? options.onBackendTokenRefreshed
        : null;

    /** @type {{ userId: string|null, backendToken: { accessToken: string, expiresAtMs: number }|null, metadata: Record<string, NoteMetadata>, queue: PendingOperation[], flushing: boolean, googleCredential: string|null }} */
    const state = {
        userId: null,
        backendToken: null,
        metadata: {},
        queue: [],
        flushing: false,
        googleCredential: null
    };
    /** @type {Promise<{ accessToken: string, expiresAtMs: number }|null>|null} */
    let pendingTokenRefresh = null;

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
         * Handle sign-in by exchanging credentials, flushing queue, and reconciling a snapshot.
         * @param {{ userId: string, credential?: string, backendToken?: { accessToken: string, expiresAtMs: number } }} params
         * @returns {Promise<SignInResult>}
         */
        async handleSignIn(params) {
            if (!params || !params.userId) {
                return { authenticated: false, queueFlushed: false, snapshotApplied: false, accessToken: null, accessTokenExpiresAtMs: null };
            }

            const loadedMetadata = metadataStore.load(params.userId);
            const loadedQueue = queueStore.load(params.userId);
            const now = clock().getTime();

            let backendToken = null;
            const providedToken = params.backendToken;
            if (providedToken
                && typeof providedToken.accessToken === "string"
                && providedToken.accessToken.length > 0
                && typeof providedToken.expiresAtMs === "number"
                && Number.isFinite(providedToken.expiresAtMs)
                && providedToken.expiresAtMs > now) {
                backendToken = {
                    accessToken: providedToken.accessToken,
                    expiresAtMs: providedToken.expiresAtMs
                };
            }

            const credential = typeof params.credential === "string" && params.credential.length > 0
                ? params.credential
                : null;
            state.googleCredential = credential;

            if (!backendToken) {
                if (!credential) {
                    logging.error("Missing credential for backend token exchange");
                    state.googleCredential = null;
                    return { authenticated: false, queueFlushed: false, snapshotApplied: false, accessToken: null, accessTokenExpiresAtMs: null };
                }
                let exchanged;
                try {
                    exchanged = await backendClient.exchangeGoogleCredential({ credential });
                } catch (error) {
                    logging.error(error);
                    state.googleCredential = null;
                    return { authenticated: false, queueFlushed: false, snapshotApplied: false, accessToken: null, accessTokenExpiresAtMs: null };
                }
                backendToken = {
                    accessToken: exchanged.accessToken,
                    expiresAtMs: now + exchanged.expiresIn * 1000
                };
            }

            state.userId = params.userId;
            state.metadata = loadedMetadata;
            state.queue = loadedQueue;
            state.backendToken = backendToken;
            notifyBackendTokenRefreshed(state.backendToken);

            seedInitialOperations();
            persistState();

            const queueFlushed = await flushQueue();
            let snapshotApplied = false;
            if (queueFlushed) {
                snapshotApplied = await refreshSnapshot();
            }

            return {
                authenticated: true,
                queueFlushed,
                snapshotApplied,
                accessToken: state.backendToken ? state.backendToken.accessToken : null,
                accessTokenExpiresAtMs: state.backendToken ? state.backendToken.expiresAtMs : null
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
            state.backendToken = null;
            state.metadata = {};
            state.queue = [];
            state.flushing = false;
            state.googleCredential = null;
            pendingTokenRefresh = null;
        },

        /**
         * Synchronize pending operations and refresh backend snapshot.
         * @param {{ flushQueue?: boolean }} [options]
         * @returns {Promise<{ queueFlushed: boolean, snapshotApplied: boolean }>}
         */
        async synchronize(options = {}) {
            if (!state.userId || !state.backendToken) {
                return { queueFlushed: false, snapshotApplied: false };
            }
            const shouldFlush = options.flushQueue !== false;
            let queueFlushed = state.queue.length === 0;
            if (shouldFlush) {
                queueFlushed = await flushQueue();
            }
            const snapshotApplied = await refreshSnapshot();
            return { queueFlushed, snapshotApplied };
        },

        /**
         * Expose internal state for diagnostics and testing.
         * @returns {{ activeUserId: string|null, backendToken: { accessToken: string, expiresAtMs: number }|null, pendingOperations: PendingOperation[] }}
         */
        getDebugState() {
            return {
                activeUserId: state.userId,
                backendToken: state.backendToken ? { ...state.backendToken } : null,
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
        if (!state.userId || !state.backendToken) {
            return false;
        }
        if (state.flushing) {
            return false;
        }
        if (state.queue.length === 0) {
            return true;
        }
        const ensuredToken = await ensureBackendToken();
        if (!ensuredToken) {
            return false;
        }
        state.flushing = true;
        try {
            const pendingOperations = state.queue.slice();
            const operations = pendingOperations.map(convertToSyncOperation);
            if (operations.length === 0) {
                return true;
            }
            const response = await backendClient.syncOperations({
                accessToken: ensuredToken.accessToken,
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
        if (!state.userId || !state.backendToken) {
            return false;
        }
        const ensuredToken = await ensureBackendToken();
        if (!ensuredToken) {
            return false;
        }
        try {
            const snapshot = await backendClient.fetchSnapshot({
                accessToken: ensuredToken.accessToken
            });
            applySnapshot(snapshot?.notes ?? []);
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

    /**
     * Ensure a valid backend token is available, refreshing it when expired.
     * @returns {Promise<{ accessToken: string, expiresAtMs: number }|null>}
     */
    async function ensureBackendToken() {
        if (!state.userId) {
            return null;
        }
        const activeToken = state.backendToken;
        const nowMs = clock().getTime();
        if (activeToken && activeToken.expiresAtMs - BACKEND_TOKEN_EXPIRY_SKEW_MS > nowMs) {
            return activeToken;
        }
        if (pendingTokenRefresh) {
            return pendingTokenRefresh;
        }
        const credential = state.googleCredential;
        if (!credential) {
            state.backendToken = null;
            persistState();
            return null;
        }
        pendingTokenRefresh = (async () => {
            try {
                const exchanged = await backendClient.exchangeGoogleCredential({ credential });
                const refreshedToken = {
                    accessToken: exchanged.accessToken,
                    expiresAtMs: clock().getTime() + exchanged.expiresIn * 1000
                };
                state.backendToken = refreshedToken;
                persistState();
                notifyBackendTokenRefreshed(refreshedToken);
                return refreshedToken;
            } catch (error) {
                logging.error(error);
                state.backendToken = null;
                persistState();
                return null;
            } finally {
                pendingTokenRefresh = null;
            }
        })();
        return pendingTokenRefresh;
    }

    /**
     * Notify listeners that a backend token has been refreshed.
     * @param {{ accessToken: string, expiresAtMs: number }|null} token
     * @returns {void}
     */
    function notifyBackendTokenRefreshed(token) {
        if (!backendTokenCallback || !token) {
            return;
        }
        try {
            backendTokenCallback({ accessToken: token.accessToken, expiresAtMs: token.expiresAtMs });
        } catch (error) {
            logging.error(error);
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
