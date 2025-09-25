import { appConfig } from "./config.js";
import { nowIso } from "./utils.js";
import { collectReferencedAttachments, sanitizeAttachmentDictionary } from "./ui/imagePaste.js";

/**
 * @typedef {Object} NoteRecord
 * @property {string} noteId
 * @property {string} markdownText
 * @property {string} createdAtIso
 * @property {string} updatedAtIso
 * @property {string} lastActivityIso
 * @property {object=} classification
 * @property {Record<string, { dataUrl: string, altText: string }>=} [attachments]
 */

export const GravityStore = (() => {
    function loadAllNotes() {
        const raw = localStorage.getItem(appConfig.storageKey);
        if (!raw) return [];
        try {
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr.map(normalizeRecord);
        } catch {
            return [];
        }
    }

    function saveAllNotes(records) {
        const normalized = Array.isArray(records) ? records.map(normalizeRecord) : [];
        localStorage.setItem(appConfig.storageKey, JSON.stringify(normalized));
    }

    // Invariant: never persist empty notes
    function upsertNonEmpty(record) {
        if ((record.markdownText || "").trim().length === 0) return;
        const all = loadAllNotes();
        const idx = all.findIndex(r => r.noteId === record.noteId);
        const sanitizedRecord = normalizeRecord(record);
        if (idx === -1) all.unshift(sanitizedRecord);
        else all[idx] = sanitizedRecord;
        saveAllNotes(all);
    }

    function removeById(noteId) {
        saveAllNotes(loadAllNotes().filter(r => r.noteId !== noteId));
    }

    // Sync DOM order to storage (cards only; the top editor is separate)
    function syncFromDom(container) {
        const cards = Array.from(container.querySelectorAll(".markdown-block:not(.top-editor)"));
        const existingRecords = loadAllNotes();
        const next = [];
        for (const card of cards) {
            const noteId = card.getAttribute("data-note-id");
            const editor = card.querySelector(".markdown-editor");
            const text = editor ? editor.value : "";
            if ((text || "").trim().length === 0) continue; // never create empties
            const existing = existingRecords.find(r => r.noteId === noteId);
            const base = existing ?? {
                noteId,
                createdAtIso: nowIso(),
                updatedAtIso: nowIso(),
                lastActivityIso: nowIso()
            };
            const attachments = collectReferencedAttachments(editor);
            next.push({ ...base, markdownText: text, attachments });
        }
        saveAllNotes(next);
    }

    return { loadAllNotes, saveAllNotes, upsertNonEmpty, removeById, syncFromDom };
})();

function normalizeRecord(record) {
    const markdownText = typeof record?.markdownText === "string" ? record.markdownText : "";
    const attachments = sanitizeAttachmentDictionary(record?.attachments || {});
    return { ...record, markdownText, attachments };
}
