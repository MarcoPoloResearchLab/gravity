import { appConfig } from "./config.js";
import { nowIso } from "./utils.js";

/**
 * @typedef {Object} NoteRecord
 * @property {string} noteId
 * @property {string} markdownText
 * @property {string} createdAtIso
 * @property {string} updatedAtIso
 * @property {string} lastActivityIso
 * @property {object=} classification
 */

export const GravityStore = (() => {
    function loadAllNotes() {
        const raw = localStorage.getItem(appConfig.storageKey);
        if (!raw) return [];
        try {
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function saveAllNotes(records) {
        localStorage.setItem(appConfig.storageKey, JSON.stringify(records));
    }

    // Invariant: never persist empty notes
    function upsertNonEmpty(record) {
        if ((record.markdownText || "").trim().length === 0) return;
        const all = loadAllNotes();
        const idx = all.findIndex(r => r.noteId === record.noteId);
        if (idx === -1) all.unshift(record);
        else all[idx] = record;
        saveAllNotes(all);
    }

    function removeById(noteId) {
        saveAllNotes(loadAllNotes().filter(r => r.noteId !== noteId));
    }

    // Sync DOM order to storage (cards only; the top editor is separate)
    function syncFromDom(container) {
        const cards = Array.from(container.querySelectorAll(".markdown-block:not(.top-editor)"));
        const next = [];
        for (const card of cards) {
            const noteId = card.getAttribute("data-note-id");
            const editor = card.querySelector(".markdown-editor");
            const text = editor ? editor.value : "";
            if ((text || "").trim().length === 0) continue; // never create empties
            const existing = loadAllNotes().find(r => r.noteId === noteId);
            const base = existing ?? {
                noteId,
                createdAtIso: nowIso(),
                updatedAtIso: nowIso(),
                lastActivityIso: nowIso()
            };
            next.push({ ...base, markdownText: text });
        }
        saveAllNotes(next);
    }

    return { loadAllNotes, saveAllNotes, upsertNonEmpty, removeById, syncFromDom };
})();
