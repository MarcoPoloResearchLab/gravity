// @ts-check

import { MESSAGE_NOTE_SAVED } from "../constants.js?build=2026-01-01T22:43:21Z";

const TOAST_DURATION_MS = 2000;
let toastTimerId = /** @type {number|undefined} */ (undefined);

/**
 * Surface non-modal feedback that a note finished saving.
 * @param {string} [message]
 * @returns {void}
 */
export function showSaveFeedback(message = MESSAGE_NOTE_SAVED) {
    const toastElement = /** @type {HTMLElement|null} */ (document.getElementById("editor-toast"));
    const liveRegion = /** @type {HTMLElement|null} */ (document.getElementById("editor-save-status"));
    if (!(toastElement instanceof HTMLElement) || !(liveRegion instanceof HTMLElement)) {
        return;
    }

    liveRegion.textContent = message;
    toastElement.textContent = message;
    toastElement.hidden = false;
    toastElement.classList.add("toast--visible");

    if (typeof toastTimerId === "number") {
        window.clearTimeout(toastTimerId);
    }

    toastTimerId = window.setTimeout(() => {
        toastElement.classList.remove("toast--visible");
        toastElement.hidden = true;
        toastTimerId = undefined;
    }, TOAST_DURATION_MS);
}
