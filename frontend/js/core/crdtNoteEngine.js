// @ts-check

import { loadYjs } from "./crdtAdapter.js?build=2026-01-01T22:43:21Z";
import { createCrdtDocumentStore } from "./crdtDocumentStore.js?build=2026-01-01T22:43:21Z";
import { decodeBase64, encodeBase64 } from "../utils/base64.js?build=2026-01-01T22:43:21Z";
import { nowIso } from "../utils/datetime.js?build=2026-01-01T22:43:21Z";

const TEXT_KEY = "markdown";
const META_KEY = "meta";
const META_CREATED_AT = "createdAtIso";
const META_UPDATED_AT = "updatedAtIso";
const META_LAST_ACTIVITY = "lastActivityIso";
const META_PINNED = "pinned";
const META_ATTACHMENTS = "attachments";
const META_CLASSIFICATION = "classification";
const META_DELETED = "deleted";

/**
 * @typedef {{ doc: import("yjs").Doc }} CrdtDocState
 */

/**
 * Create a CRDT engine for note documents.
 * @param {{
 *   documentStore?: ReturnType<typeof createCrdtDocumentStore>,
 *   yjsLoader?: () => Promise<typeof import("yjs")>
 * }} [options]
 */
export function createCrdtNoteEngine(options = {}) {
    const documentStore = options.documentStore ?? createCrdtDocumentStore();
    const yjsLoader = typeof options.yjsLoader === "function" ? options.yjsLoader : loadYjs;

    /** @type {Map<string, CrdtDocState>} */
    const docsById = new Map();
    /** @type {Record<string, string>} */
    let snapshotsById = {};
    /** @type {string|null} */
    let activeUserId = null;
    /** @type {typeof import("yjs")|null} */
    let yjsModule = null;

    return Object.freeze({
        /**
         * Hydrate CRDT documents for a user.
         * @param {string} userId
         * @returns {Promise<void>}
         */
        async hydrate(userId) {
            activeUserId = userId;
            yjsModule = await yjsLoader();
            await documentStore.hydrate(userId);
            snapshotsById = documentStore.load(userId);
            docsById.clear();
            for (const [noteId, snapshotB64] of Object.entries(snapshotsById)) {
                const docState = createDocState(noteId);
                applyUpdateToDoc(docState.doc, snapshotB64, "snapshot");
            }
        },

        /**
         * Apply a CRDT snapshot for a note.
         * @param {string} noteId
         * @param {string} snapshotB64
         * @returns {void}
         */
        applySnapshot(noteId, snapshotB64) {
            const docState = ensureDocState(noteId);
            applyUpdateToDoc(docState.doc, snapshotB64, "snapshot");
            snapshotsById[noteId] = encodeDocSnapshot(docState.doc);
        },

        /**
         * Apply a CRDT update for a note.
         * @param {string} noteId
         * @param {string} updateB64
         * @returns {void}
         */
        applyUpdate(noteId, updateB64) {
            const docState = ensureDocState(noteId);
            applyUpdateToDoc(docState.doc, updateB64, "remote");
            snapshotsById[noteId] = encodeDocSnapshot(docState.doc);
        },

        /**
         * Apply a legacy payload to a CRDT document.
         * @param {string} noteId
         * @param {Record<string, unknown>} legacyPayload
         * @param {boolean} legacyDeleted
         * @returns {{ updateB64: string, snapshotB64: string }}
         */
        applyLegacyPayload(noteId, legacyPayload, legacyDeleted) {
            const markdownText = typeof legacyPayload.markdownText === "string" ? legacyPayload.markdownText : "";
            const record = {
                noteId,
                markdownText,
                createdAtIso: typeof legacyPayload.createdAtIso === "string" ? legacyPayload.createdAtIso : nowIso(),
                updatedAtIso: typeof legacyPayload.updatedAtIso === "string" ? legacyPayload.updatedAtIso : nowIso(),
                lastActivityIso: typeof legacyPayload.lastActivityIso === "string" ? legacyPayload.lastActivityIso : nowIso(),
                pinned: legacyPayload.pinned === true,
                attachments: isPlainObject(legacyPayload.attachments) ? legacyPayload.attachments : {},
                classification: isPlainObject(legacyPayload.classification) ? legacyPayload.classification : undefined
            };
            const result = applyLocalRecord(record, legacyDeleted);
            return result;
        },

        /**
         * Apply a local note record to the CRDT document.
         * @param {import("../types.d.js").NoteRecord} record
         * @param {boolean} [markDeleted]
         * @returns {{ updateB64: string, snapshotB64: string }}
         */
        applyLocalRecord(record, markDeleted = false) {
            return applyLocalRecord(record, markDeleted);
        },

        /**
         * Build a CRDT snapshot for a note.
         * @param {string} noteId
         * @returns {string|null}
         */
        buildSnapshot(noteId) {
            const docState = docsById.get(noteId);
            if (!docState) {
                return null;
            }
            return encodeDocSnapshot(docState.doc);
        },

        /**
         * Build a note record from a CRDT document.
         * @param {string} noteId
         * @returns {import("../types.d.js").NoteRecord|null}
         */
        buildRecord(noteId) {
            const docState = docsById.get(noteId);
            if (!docState) {
                return null;
            }
            return buildRecordFromDoc(noteId, docState.doc);
        },

        /**
         * Build all note records from CRDT documents.
         * @returns {import("../types.d.js").NoteRecord[]}
         */
        buildAllRecords() {
            const records = [];
            for (const [noteId, docState] of docsById.entries()) {
                const record = buildRecordFromDoc(noteId, docState.doc);
                if (record) {
                    records.push(record);
                }
            }
            return records;
        },

        /**
         * Persist all snapshots for the active user.
         * @returns {void}
         */
        persist() {
            if (!activeUserId) {
                return;
            }
            documentStore.save(activeUserId, { ...snapshotsById });
        },

        /**
         * Clear persisted documents for the active user.
         * @returns {void}
         */
        clear() {
            if (!activeUserId) {
                return;
            }
            documentStore.clear(activeUserId);
            docsById.clear();
            snapshotsById = {};
            activeUserId = null;
        }
    });

    /**
     * @param {string} noteId
     * @returns {CrdtDocState}
     */
    function ensureDocState(noteId) {
        const existing = docsById.get(noteId);
        if (existing) {
            return existing;
        }
        return createDocState(noteId);
    }

    /**
     * @param {string} noteId
     * @returns {CrdtDocState}
     */
    function createDocState(noteId) {
        const module = requireYjs();
        const doc = new module.Doc();
        doc.getText(TEXT_KEY);
        doc.getMap(META_KEY);
        const docState = { doc };
        docsById.set(noteId, docState);
        return docState;
    }

    /**
     * @param {import("../types.d.js").NoteRecord} record
     * @param {boolean} markDeleted
     * @returns {{ updateB64: string, snapshotB64: string }}
     */
    function applyLocalRecord(record, markDeleted) {
        const docState = ensureDocState(record.noteId);
        const module = requireYjs();
        const nowValue = nowIso();
        const createdAtIso = typeof record.createdAtIso === "string" && record.createdAtIso ? record.createdAtIso : nowValue;
        const updatedAtIso = typeof record.updatedAtIso === "string" && record.updatedAtIso ? record.updatedAtIso : nowValue;
        const lastActivityIso = typeof record.lastActivityIso === "string" && record.lastActivityIso ? record.lastActivityIso : updatedAtIso;
        const attachments = isPlainObject(record.attachments) ? record.attachments : {};
        const classification = isPlainObject(record.classification) ? record.classification : undefined;

        docState.doc.transact(() => {
            const text = docState.doc.getText(TEXT_KEY);
            const currentText = text.toString();
            if (currentText !== record.markdownText) {
                text.delete(0, currentText.length);
                text.insert(0, record.markdownText);
            }
            const metadata = docState.doc.getMap(META_KEY);
            metadata.set(META_CREATED_AT, createdAtIso);
            metadata.set(META_UPDATED_AT, updatedAtIso);
            metadata.set(META_LAST_ACTIVITY, lastActivityIso);
            metadata.set(META_PINNED, record.pinned === true);
            metadata.set(META_ATTACHMENTS, attachments);
            metadata.set(META_CLASSIFICATION, classification ?? null);
            metadata.set(META_DELETED, markDeleted === true);
        }, "local");

        const snapshotB64 = encodeDocSnapshot(docState.doc);
        snapshotsById[record.noteId] = snapshotB64;
        return { updateB64: snapshotB64, snapshotB64 };
    }

    /**
     * @param {import("yjs").Doc} doc
     * @param {string} updateB64
     * @param {string} origin
     * @returns {void}
     */
    function applyUpdateToDoc(doc, updateB64, origin) {
        const module = requireYjs();
        const updateBytes = decodeBase64(updateB64);
        if (updateBytes.length === 0) {
            return;
        }
        module.applyUpdate(doc, updateBytes, origin);
    }

    /**
     * @param {string} noteId
     * @param {import("yjs").Doc} doc
     * @returns {import("../types.d.js").NoteRecord|null}
     */
    function buildRecordFromDoc(noteId, doc) {
        const text = doc.getText(TEXT_KEY).toString();
        const metadata = doc.getMap(META_KEY);
        const deleted = metadata.get(META_DELETED) === true;
        if (deleted) {
            return null;
        }
        const createdAtIso = readMetaString(metadata, META_CREATED_AT, nowIso());
        const updatedAtIso = readMetaString(metadata, META_UPDATED_AT, createdAtIso);
        const lastActivityIso = readMetaString(metadata, META_LAST_ACTIVITY, updatedAtIso);
        const pinned = metadata.get(META_PINNED) === true;
        const attachments = readMetaObject(metadata, META_ATTACHMENTS, {});
        const classification = readMetaObject(metadata, META_CLASSIFICATION, null);
        const record = {
            noteId,
            markdownText: text,
            createdAtIso,
            updatedAtIso,
            lastActivityIso,
            pinned,
            attachments,
            classification: classification ?? undefined
        };
        return record;
    }

    /**
     * @param {import("yjs").Doc} doc
     * @returns {string}
     */
    function encodeDocSnapshot(doc) {
        const module = requireYjs();
        return encodeBase64(module.encodeStateAsUpdate(doc));
    }

    /**
     * @param {import("yjs").Map<any>} metadata
     * @param {string} key
     * @param {string} fallbackValue
     * @returns {string}
     */
    function readMetaString(metadata, key, fallbackValue) {
        const value = metadata.get(key);
        return typeof value === "string" && value ? value : fallbackValue;
    }

    /**
     * @param {import("yjs").Map<any>} metadata
     * @param {string} key
     * @param {any} fallbackValue
     * @returns {any}
     */
    function readMetaObject(metadata, key, fallbackValue) {
        const value = metadata.get(key);
        if (!isPlainObject(value)) {
            return fallbackValue;
        }
        return cloneValue(value);
    }

    /**
     * @param {unknown} value
     * @returns {value is Record<string, any>}
     */
    function isPlainObject(value) {
        return Boolean(value && typeof value === "object" && !Array.isArray(value));
    }

    /**
     * @param {any} value
     * @returns {any}
     */
    function cloneValue(value) {
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    /**
     * @returns {typeof import("yjs")}
     */
    function requireYjs() {
        if (!yjsModule) {
            throw new Error("crdt.yjs.uninitialized");
        }
        return yjsModule;
    }
}
