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
        const sanitizedRecord = normalizeRecord(record);
        if (!isValidNoteRecord(sanitizedRecord)) return;
        const allRecords = loadAllNotes();
        const existingIndex = allRecords.findIndex(existingRecord => existingRecord.noteId === sanitizedRecord.noteId);
        if (existingIndex === -1) allRecords.unshift(sanitizedRecord);
        else allRecords[existingIndex] = sanitizedRecord;
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

    return Object.freeze({ loadAllNotes, saveAllNotes, exportNotes, importNotes, upsertNonEmpty, removeById });
})();

/**
 * @param {Partial<NoteRecord>} record
 * @returns {NoteRecord}
 */
function normalizeRecord(record) {
    const markdownText = typeof record?.markdownText === "string" ? record.markdownText : EMPTY_STRING;
    const attachments = sanitizeAttachmentDictionary(record?.attachments || {});
    return { ...record, markdownText, attachments };
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
