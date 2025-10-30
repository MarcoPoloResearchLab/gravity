// @ts-check

import {
    FILENAME_EXPORT_NOTES_JSON,
    ACCEPT_IMPORT_NOTES_JSON,
    ERROR_IMPORT_READ_FAILED,
    EVENT_NOTES_IMPORTED,
    EVENT_NOTIFICATION_REQUEST,
    MESSAGE_NOTES_IMPORT_FAILED
} from "../constants.js?build=2024-10-05T12:00:00Z";
import { GravityStore } from "../core/store.js?build=2024-10-05T12:00:00Z";

const JSON_MIME_TYPE = ACCEPT_IMPORT_NOTES_JSON;

/**
 * Wire export and import controls to the GravityStore.
 * @param {{
 *   exportButton: HTMLButtonElement | null,
 *   importButton: HTMLButtonElement | null,
 *   fileInput: HTMLInputElement | null,
 *   notify?: (message: string) => void
 * }} options
 */
export function initializeImportExport(options) {
    const { exportButton, importButton, fileInput, notify } = options;

    if (exportButton) {
        exportButton.addEventListener("click", () => {
            const payload = GravityStore.exportNotes();
            triggerJsonDownload(payload);
        });
    }

    if (fileInput) {
        fileInput.accept = ACCEPT_IMPORT_NOTES_JSON;
        fileInput.addEventListener("change", async () => {
            const selectedFile = fileInput.files && fileInput.files[0];
            if (!selectedFile) return;
            try {
                const fileContents = await readFileAsText(selectedFile);
                const appendedRecords = GravityStore.importNotes(fileContents);
                dispatchImportResult(fileInput, appendedRecords);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : ERROR_IMPORT_READ_FAILED;
                if (typeof notify === "function") {
                    notify(errorMessage);
                } else {
                    dispatchNotification(fileInput, errorMessage || MESSAGE_NOTES_IMPORT_FAILED);
                }
            } finally {
                fileInput.value = "";
            }
        });
    }

    if (importButton && fileInput) {
        importButton.addEventListener("click", () => {
            fileInput.click();
        });
    }
}

function triggerJsonDownload(payload) {
    const blob = new Blob([payload], { type: JSON_MIME_TYPE });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = FILENAME_EXPORT_NOTES_JSON;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
            } else {
                reject(new Error(ERROR_IMPORT_READ_FAILED));
            }
        });
        reader.addEventListener("error", () => reject(new Error(ERROR_IMPORT_READ_FAILED)));
        reader.readAsText(file);
    });
}

/**
 * Dispatch the import result event, defaulting to a notification when no target provided.
 * @param {HTMLElement} dispatchTarget
 * @param {import("../types.d.js").NoteRecord[]} appendedRecords
 * @returns {void}
 */
function dispatchImportResult(dispatchTarget, appendedRecords) {
    const records = Array.isArray(appendedRecords) ? appendedRecords : [];
    const event = new CustomEvent(EVENT_NOTES_IMPORTED, {
        bubbles: true,
        detail: {
            records,
            storeUpdated: true,
            shouldRender: true
        }
    });
    dispatchTarget.dispatchEvent(event);
}

/**
 * Notify listeners through the shared notification channel.
 * @param {HTMLElement|null} element
 * @param {string} message
 * @returns {void}
 */
function dispatchNotification(element, message) {
    const target = element ?? document.body;
    const event = new CustomEvent(EVENT_NOTIFICATION_REQUEST, {
        bubbles: true,
        detail: { message }
    });
    target.dispatchEvent(event);
}
