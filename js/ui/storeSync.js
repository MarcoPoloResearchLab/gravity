// @ts-check

import { GravityStore } from "../core/store.js";
import { nowIso } from "../utils/index.js";
import { collectReferencedAttachments } from "./imagePaste.js";

/**
 * Synchronize the DOM order of cards back into storage.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function syncStoreFromDom(container) {
    if (!(container instanceof HTMLElement)) return;
    const cards = Array.from(container.querySelectorAll(".markdown-block:not(.top-editor)"));
    const existingRecords = GravityStore.loadAllNotes();
    const nextRecords = [];
    for (const card of cards) {
        const noteId = card.getAttribute("data-note-id");
        if (!noteId) continue;
        const editor = /** @type {HTMLTextAreaElement|null} */ (card.querySelector(".markdown-editor"));
        const text = editor ? editor.value : "";
        if (!isNonBlankString(text)) continue;
        const existing = existingRecords.find(existingRecord => existingRecord.noteId === noteId);
        const timestamp = nowIso();
        const base = existing ?? {
            noteId,
            createdAtIso: timestamp,
            updatedAtIso: timestamp,
            lastActivityIso: timestamp
        };
        const attachments = editor ? collectReferencedAttachments(editor) : {};
        const candidate = { ...base, markdownText: text, attachments };
        nextRecords.push(candidate);
    }
    GravityStore.saveAllNotes(nextRecords);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonBlankString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
