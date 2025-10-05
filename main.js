import { mountTopEditor } from "./ui/topEditor.js";
import { renderCard, updateActionButtons } from "./ui/card.js";
import { initializeImportExport } from "./ui/importExport.js";
import { GravityStore } from "./store.js";

// Markdown options
marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: true,
    mangle: false,
    smartLists: true
});

const notesContainer = document.getElementById("notes-container");
const exportNotesButton = document.getElementById("export-notes-button");
const importNotesButton = document.getElementById("import-notes-button");
const importNotesInput = document.getElementById("import-notes-input");

(function boot() {
    // 1) Mount the structural top editor (it will call back into card renderer)
    mountTopEditor({
        notesContainer,
        onCreateRecord: (record) => {
            const card = renderCard(record, { notesContainer });
            notesContainer.insertBefore(card, notesContainer.firstChild);
            updateActionButtons(notesContainer);
        }
    });

    // 2) Load & render persisted notes
    renderPersistedNotes(GravityStore.loadAllNotes());

    initializeImportExport({
        exportButton: exportNotesButton,
        importButton: importNotesButton,
        fileInput: importNotesInput,
        onRecordsImported: () => {
            renderPersistedNotes(GravityStore.loadAllNotes());
        }
    });
})();

function renderPersistedNotes(records) {
    notesContainer.innerHTML = "";
    const sortedRecords = [...records];
    sortedRecords.sort((a, b) => (b.lastActivityIso || "").localeCompare(a.lastActivityIso || ""));
    for (const record of sortedRecords) {
        notesContainer.appendChild(renderCard(record, { notesContainer }));
    }
    updateActionButtons(notesContainer);
}
