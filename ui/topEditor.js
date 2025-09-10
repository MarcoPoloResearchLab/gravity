import { nowIso, generateNoteId, createElement, autoResize } from "../utils.js";
import { GravityStore } from "../store.js";
import { triggerClassificationForCard } from "./card.js";

/**
 * Mounts the always-empty, structural editor at the top of the page.
 * It never persists empties; on finalize it creates a new record and
 * hands it to onCreateRecord so the caller can insert a card.
 */
export function mountTopEditor({ notesContainer, onCreateRecord }) {
    const host = document.getElementById("top-editor");
    host.innerHTML = "";

    const wrapper = createElement("div", "markdown-block top-editor");
    const preview = createElement("div", "markdown-content");   // <-- div, not <p>
    const editor  = createElement("textarea", "markdown-editor");

    wrapper.classList.add("edit-mode");     // always editing
    editor.value = "";
    editor.setAttribute("rows", "1");
    editor.setAttribute("autofocus", "autofocus");

    // live preview + autoresize
    editor.addEventListener("input", () => {
        autoResize(editor);
        preview.innerHTML = marked.parse(editor.value);
    });

    // finalize on Enter (no Shift)
    editor.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            finalizeTopEditor();
        }
    });

    // finalize on blur
    editor.addEventListener("blur", finalizeTopEditor);

    wrapper.appendChild(preview);
    wrapper.appendChild(editor);
    host.appendChild(wrapper);

    // robust focus
    requestAnimationFrame(() => {
        autoResize(editor);
        editor.focus({ preventScroll: true });
        setTimeout(() => editor.focus({ preventScroll: true }), 60);
    });

    function finalizeTopEditor() {
        const text = editor.value;
        const trimmed = text.trim();

        // Invariant: never persist empty notes
        if (trimmed.length === 0) {
            preview.innerHTML = "";
            return;
        }

        const ts = nowIso();
        const record = {
            noteId: generateNoteId(),
            markdownText: text,
            createdAtIso: ts,
            updatedAtIso: ts,
            lastActivityIso: ts
        };

        GravityStore.upsertNonEmpty(record);
        if (typeof onCreateRecord === "function") onCreateRecord(record);

        // Reset and refocus
        editor.value = "";
        preview.innerHTML = "";
        requestAnimationFrame(() => {
            autoResize(editor);
            editor.focus({ preventScroll: true });
            setTimeout(() => editor.focus({ preventScroll: true }), 60);
        });

        // classify in background
        triggerClassificationForCard(record.noteId, text, notesContainer);
    }
}
