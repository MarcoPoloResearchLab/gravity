/* global marked */
// @ts-check

import { renderCard, updateActionButtons, insertCardRespectingPinned } from "./ui/card.js";
import { initializeImportExport } from "./ui/importExport.js";
import { GravityStore } from "./core/store.js";
import { mountTopEditor } from "./ui/topEditor.js";
import {
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    ERROR_NOTES_CONTAINER_NOT_FOUND
} from "./constants.js";
import { initializeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal.js";
import { initializeNotesState } from "./ui/notesState.js";

/**
 * Ensure the main application chrome reflects the centralized string constants.
 */
function initializeStaticCopy() {
    const titleElement = document.querySelector(".app-title");
    if (titleElement) {
        titleElement.textContent = LABEL_APP_TITLE;
    }

    const subtitleElement = document.querySelector(".app-subtitle");
    if (subtitleElement) {
        subtitleElement.textContent = LABEL_APP_SUBTITLE;
    }
}

initializeStaticCopy();
initializeKeyboardShortcutsModal();

marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: true,
    mangle: false,
    smartLists: true
});

const notesContainer = document.getElementById("notes-container");
if (!notesContainer) {
    throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
}
const exportNotesButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("export-notes-button"));
const importNotesButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("import-notes-button"));
const importNotesInput = /** @type {HTMLInputElement|null} */ (document.getElementById("import-notes-input"));
(function boot() {
    mountTopEditor({
        notesContainer,
        onCreateRecord: (record) => {
            const card = renderCard(record, { notesContainer });
            insertCardRespectingPinned(card, notesContainer);
            updateActionButtons(notesContainer);
        }
    });
    const initialRecords = GravityStore.loadAllNotes();
    initializeNotesState(initialRecords);
    renderPersistedNotes(GravityStore.loadAllNotes());

    initializeImportExport({
        exportButton: exportNotesButton,
        importButton: importNotesButton,
        fileInput: importNotesInput,
        onRecordsImported: () => {
            const nextRecords = GravityStore.loadAllNotes();
            initializeNotesState(nextRecords);
            renderPersistedNotes(GravityStore.loadAllNotes());
        }
    });
})();

/**
 * Render persisted notes sorted by last activity timestamp.
 * @param {import("./types.d.js").NoteRecord[]} records
 */
function renderPersistedNotes(records) {
    notesContainer.innerHTML = "";
    const sortedRecords = [...records];
    sortedRecords.sort((a, b) => (b.lastActivityIso || "").localeCompare(a.lastActivityIso || ""));
    const pinnedRecords = sortedRecords.filter((record) => record.pinned === true);
    const unpinnedRecords = sortedRecords.filter((record) => record.pinned !== true);
    const orderedRecords = [...pinnedRecords, ...unpinnedRecords];
    for (const record of orderedRecords) {
        const card = renderCard(record, { notesContainer });
        notesContainer.appendChild(card);
    }
    updateActionButtons(notesContainer);
}
