// @ts-check

import { appConfig } from "./config.js";
import { ERROR_IMPORT_INVALID_PAYLOAD } from "../constants.js";
import { sanitizeAttachmentDictionary } from "./attachments.js";

const EMPTY_STRING = "";

/** @typedef {import("../types.d.js").NoteRecord} NoteRecord */

export const GravityStore = (() => {
    /**
     * @returns {NoteRecord[]}
     */
    function loadAllNotes() {
        const raw = localStorage.getItem(appConfig.storageKey);
        if (!raw) return [];
        try {
            const rawRecords = JSON.parse(raw);
            if (!Array.isArray(rawRecords)) return [];
            return rawRecords
                .map(normalizeRecord)
                .filter(isValidNoteRecord);
        } catch {
            return [];
        }
    }

    /**
     * @param {NoteRecord[]} records
     * @returns {void}
     */
    function saveAllNotes(records) {
        const normalized = Array.isArray(records)
            ? records
                .map(normalizeRecord)
                .filter(isValidNoteRecord)
            : [];
        localStorage.setItem(appConfig.storageKey, JSON.stringify(normalized));
    }

    /**
     * Serialize all persisted notes into a JSON string.
     * @returns {string}
     */
    function exportNotes() {
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

        const incomingRecords = parsed
            .map(normalizeRecord)
            .filter(isValidNoteRecord);

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

        const sanitizedRecord = normalizeRecord({ ...record, pinned: normalizedPinned });
        if (!isValidNoteRecord(sanitizedRecord)) return;

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

    return Object.freeze({
        loadAllNotes,
        saveAllNotes,
        exportNotes,
        importNotes,
        upsertNonEmpty,
        removeById,
        getById,
        setPinned
    });
})();

/**
 * @param {Partial<NoteRecord>} record
 * @returns {NoteRecord}
 */
function normalizeRecord(record) {
    const markdownText = typeof record?.markdownText === "string" ? record.markdownText : EMPTY_STRING;
    const attachments = sanitizeAttachmentDictionary(record?.attachments || {});
    const pinned = record?.pinned === true;
    return { ...record, markdownText, attachments, pinned };
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
