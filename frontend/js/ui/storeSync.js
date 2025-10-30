// @ts-check

import { GravityStore } from "../core/store.js?build=2024-10-05T12:00:00Z";
import { nowIso } from "../utils/datetime.js?build=2024-10-05T12:00:00Z";
import { collectReferencedAttachments } from "./imagePaste.js?build=2024-10-05T12:00:00Z";

/**
 * Synchronize the DOM order of cards back into storage.
 * @param {HTMLElement} container
 * @param {Record<string, Partial<import("../types.d.js").NoteRecord>>} [overrides]
 * @returns {void}
 */
export function syncStoreFromDom(container, overrides = {}) {
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
            lastActivityIso: timestamp,
            pinned: false
        };
        const attachments = editor ? collectReferencedAttachments(editor) : {};
        const override = overrides[noteId] ?? null;
        const candidate = {
            ...base,
            markdownText: text,
            attachments,
            pinned: override?.pinned ?? base.pinned === true
        };
        const mergedRecord = override
            ? { ...candidate, ...override, attachments: override.attachments ?? attachments }
            : candidate;
        if (!mergedRecord.updatedAtIso) {
            mergedRecord.updatedAtIso = timestamp;
        }
        if (!mergedRecord.lastActivityIso) {
            mergedRecord.lastActivityIso = timestamp;
        }
        nextRecords.push(mergedRecord);
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
