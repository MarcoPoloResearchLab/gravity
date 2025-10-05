// @ts-check

import {
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    FILENAME_EXPORT_NOTES_JSON,
    ACCEPT_IMPORT_NOTES_JSON,
    ERROR_IMPORT_READ_FAILED
} from "../constants.js";
import { GravityStore } from "../core/store.js";

const JSON_MIME_TYPE = ACCEPT_IMPORT_NOTES_JSON;

/**
 * Wire export and import controls to the GravityStore.
 * @param {{
 *   exportButton: HTMLButtonElement | null,
 *   importButton: HTMLButtonElement | null,
 *   fileInput: HTMLInputElement | null,
 *   onRecordsImported: (records: import("../core/store.js").NoteRecord[]) => void
 * }} options
 */
export function initializeImportExport(options) {
    const { exportButton, importButton, fileInput, onRecordsImported } = options;

    if (exportButton) {
        exportButton.textContent = LABEL_EXPORT_NOTES;
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
                if (typeof onRecordsImported === "function" && appendedRecords.length > 0) {
                    onRecordsImported(appendedRecords);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : ERROR_IMPORT_READ_FAILED;
                window.alert(errorMessage);
            } finally {
                fileInput.value = "";
            }
        });
    }

    if (importButton && fileInput) {
        importButton.textContent = LABEL_IMPORT_NOTES;
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
