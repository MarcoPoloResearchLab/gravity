import { appConfig } from "./config.js";
import { nowIso } from "./utils.js";
import { collectReferencedAttachments, sanitizeAttachmentDictionary } from "./ui/imagePaste.js";

const EMPTY_STRING = "";

/**
 * @typedef {Object} NoteRecord
 * @property {string} noteId
 * @property {string} markdownText
 * @property {string} createdAtIso
 * @property {string} updatedAtIso
 * @property {string} lastActivityIso
 * @property {object=} classification
 * @property {Record<string, { dataUrl: string, altText: string }>=} attachments
 */

export const GravityStore = (() => {
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

    function saveAllNotes(records) {
        const normalized = Array.isArray(records)
            ? records
                .map(normalizeRecord)
                .filter(isValidNoteRecord)
            : [];
        localStorage.setItem(appConfig.storageKey, JSON.stringify(normalized));
    }

    // Invariant: never persist empty notes
    function upsertNonEmpty(record) {
        const sanitizedRecord = normalizeRecord(record);
        if (!isValidNoteRecord(sanitizedRecord)) return;
        const allRecords = loadAllNotes();
        const existingIndex = allRecords.findIndex(existingRecord => existingRecord.noteId === sanitizedRecord.noteId);
        if (existingIndex === -1) allRecords.unshift(sanitizedRecord);
        else allRecords[existingIndex] = sanitizedRecord;
        saveAllNotes(allRecords);
    }

    function removeById(noteId) {
        const remainingRecords = loadAllNotes().filter(noteRecord => noteRecord.noteId !== noteId);
        saveAllNotes(remainingRecords);
    }

    // Sync DOM order to storage (cards only; the top editor is separate)
    function syncFromDom(container) {
        const cards = Array.from(container.querySelectorAll(".markdown-block:not(.top-editor)"));
        const existingRecords = loadAllNotes();
        const nextRecords = [];
        for (const card of cards) {
            const noteId = card.getAttribute("data-note-id");
            const editor = card.querySelector(".markdown-editor");
            const text = editor ? editor.value : EMPTY_STRING;
            if (!isNonBlankString(text)) continue; // never create empties
            const existing = existingRecords.find(existingRecord => existingRecord.noteId === noteId);
            const base = existing ?? {
                noteId,
                createdAtIso: nowIso(),
                updatedAtIso: nowIso(),
                lastActivityIso: nowIso()
            };
            const attachments = collectReferencedAttachments(editor);
            const candidate = normalizeRecord({ ...base, markdownText: text, attachments });
            if (!isValidNoteRecord(candidate)) continue;
            nextRecords.push(candidate);
        }
        saveAllNotes(nextRecords);
    }

    return { loadAllNotes, saveAllNotes, upsertNonEmpty, removeById, syncFromDom };
})();

function normalizeRecord(record) {
    const markdownText = typeof record?.markdownText === "string" ? record.markdownText : EMPTY_STRING;
    const attachments = sanitizeAttachmentDictionary(record?.attachments || {});
    return { ...record, markdownText, attachments };
}

function isNonBlankString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function isValidNoteRecord(record) {
    if (!record || typeof record !== "object") return false;
    if (!isNonBlankString(record.noteId)) return false;
    if (!isNonBlankString(record.markdownText)) return false;
    return true;
}
