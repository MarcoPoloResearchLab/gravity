// @ts-check

import { isNonBlankString } from "../../utils/string.js?build=2026-01-01T22:43:21Z";
import {
    EVENT_NOTE_UPDATE,
    EVENT_NOTE_DELETE,
    EVENT_NOTE_PIN_TOGGLE
} from "../../constants.js?build=2026-01-01T22:43:21Z";

/**
 * Dispatch a note update event so the composition root can persist or re-render.
 * @param {HTMLElement} target
 * @param {import("../../types.d.js").NoteRecord} record
 * @param {{ storeUpdated?: boolean, shouldRender?: boolean }} [options]
 * @returns {void}
 */
export function dispatchNoteUpdate(target, record, options = {}) {
    if (!(target instanceof HTMLElement) || !record) {
        return;
    }
    const { storeUpdated = true, shouldRender = false } = options;
    const event = new CustomEvent(EVENT_NOTE_UPDATE, {
        bubbles: true,
        detail: {
            record,
            noteId: record.noteId,
            storeUpdated,
            shouldRender
        }
    });
    target.dispatchEvent(event);
}

/**
 * Dispatch a note deletion request upstream.
 * @param {HTMLElement} target
 * @param {string} noteId
 * @param {{ storeUpdated?: boolean, shouldRender?: boolean }} [options]
 * @returns {void}
 */
export function dispatchNoteDelete(target, noteId, options = {}) {
    if (!(target instanceof HTMLElement) || !isNonBlankString(noteId)) {
        return;
    }
    const { storeUpdated = true, shouldRender = true } = options;
    const event = new CustomEvent(EVENT_NOTE_DELETE, {
        bubbles: true,
        detail: {
            noteId,
            storeUpdated,
            shouldRender
        }
    });
    target.dispatchEvent(event);
}

/**
 * Dispatch a pin toggle notification upstream.
 * @param {HTMLElement} target
 * @param {string} noteId
 * @param {{ storeUpdated?: boolean, shouldRender?: boolean }} [options]
 * @returns {void}
 */
export function dispatchPinToggle(target, noteId, options = {}) {
    if (!(target instanceof HTMLElement) || !isNonBlankString(noteId)) {
        return;
    }
    const { storeUpdated = true, shouldRender = true } = options;
    const event = new CustomEvent(EVENT_NOTE_PIN_TOGGLE, {
        bubbles: true,
        detail: {
            noteId,
            storeUpdated,
            shouldRender
        }
    });
    target.dispatchEvent(event);
}
