import { mountTopEditor } from "./ui/topEditor.js";
import { renderCard, updateActionButtons } from "./ui/card.js";
import { GravityStore } from "./store.js";

// Markdown options
marked.setOptions({ gfm: true, breaks: true });

const notesContainer = document.getElementById("notes-container");

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
    const records = GravityStore.loadAllNotes();
    records.sort((a, b) => (b.lastActivityIso || "").localeCompare(a.lastActivityIso || ""));
    for (const rec of records) {
        notesContainer.appendChild(renderCard(rec, { notesContainer }));
    }
    updateActionButtons(notesContainer);
})();
