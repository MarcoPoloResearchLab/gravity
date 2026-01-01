// @ts-check

import { GravityStore } from "../core/store.js?build=2026-01-01T21:20:40Z";

/** @typedef {import("../types.d.js").NoteRecord} NoteRecord */

/** @type {string|null} */
let pinnedNoteId = null;

/**
 * Initialize the in-memory note state, enforcing a single pinned note.
 * @param {NoteRecord[]} records
 * @returns {string|null}
 */
export function initializeNotesState(records) {
    if (!Array.isArray(records)) {
        pinnedNoteId = null;
        return pinnedNoteId;
    }

    const pinnedRecords = records.filter((record) => record?.pinned === true);
    if (pinnedRecords.length === 0) {
        pinnedNoteId = null;
        return pinnedNoteId;
    }

    if (pinnedRecords.length === 1) {
        pinnedNoteId = pinnedRecords[0].noteId;
        return pinnedNoteId;
    }

    const [primary] = pinnedRecords;
    pinnedNoteId = GravityStore.setPinned(primary.noteId);
    return pinnedNoteId;
}

/**
 * Toggle the pinned state for a note, ensuring uniqueness.
 * @param {string} noteId
 * @returns {{ pinnedNoteId: string|null, previousPinnedNoteId: string|null }}
 */
export function togglePinnedNote(noteId) {
    if (!isNonBlankString(noteId)) {
        return { pinnedNoteId, previousPinnedNoteId: pinnedNoteId };
    }
    const previousPinnedNoteId = pinnedNoteId;
    const desiredId = previousPinnedNoteId === noteId ? null : noteId;
    pinnedNoteId = GravityStore.setPinned(desiredId);
    return { pinnedNoteId, previousPinnedNoteId };
}

/**
 * Clear the pinned state if it references a removed note.
 * @param {string} noteId
 * @returns {string|null}
 */
export function clearPinnedNoteIfMatches(noteId) {
    if (!isNonBlankString(noteId)) {
        return pinnedNoteId;
    }
    if (pinnedNoteId !== noteId) {
        return pinnedNoteId;
    }
    pinnedNoteId = GravityStore.setPinned(null);
    return pinnedNoteId;
}

/**
 * Retrieve the currently pinned note identifier, if any.
 * @returns {string|null}
 */
export function getPinnedNoteId() {
    return pinnedNoteId;
}

function isNonBlankString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
