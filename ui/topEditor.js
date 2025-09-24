import { nowIso, generateNoteId, createElement, autoResize } from "../utils.js";
import { GravityStore } from "../store.js";
import { triggerClassificationForCard } from "./card.js";
import { enableClipboardImagePaste, waitForPendingImagePastes } from "./imagePaste.js";

/**
 * Mount the always-empty top editor. It never persists empties; on finalize
 * it creates a record and passes it to onCreateRecord so a card can be inserted.
 */
export function mountTopEditor({ notesContainer, onCreateRecord }) {
    const host = document.getElementById("top-editor");
    host.innerHTML = "";

    const wrapper = createElement("div", "markdown-block top-editor");
    const preview = createElement("div", "markdown-content");   // div so tables render
    const editor  = createElement("textarea", "markdown-editor");

    wrapper.classList.add("edit-mode"); // always in edit mode
    editor.value = "";
    editor.setAttribute("rows", "1");
    editor.setAttribute("aria-label", "New note");
    editor.setAttribute("autofocus", "autofocus");

    // Live preview + autoresize
    editor.addEventListener("input", () => {
        autoResize(editor);
        preview.innerHTML = marked.parse(editor.value);
    });

    // Finalize on Enter (no Shift)
    editor.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            finalizeTopEditor();
        }
    });

    // Finalize on blur
    editor.addEventListener("blur", finalizeTopEditor);

    enableClipboardImagePaste(editor);

    wrapper.append(preview, editor);
    host.appendChild(wrapper);

    // Ensure the caret is visible even when empty (some embeds hide it)
    function ensureCaretVisible(el) {
        if (el.value === "") {
            // Briefly inject a char and reset to empty while keeping caret
            el.value = " ";
            try { el.setSelectionRange(1, 1); } catch {}
            el.value = "";
        }
    }

    // Robust focus: keep nudging focus briefly; also retry on load/visibility
    function keepFocus(el) {
        let tries = 0;
        const maxTries = 20; // ~1s total
        const kick = () => {
            tries++;
            autoResize(el);
            el.focus({ preventScroll: true });
            ensureCaretVisible(el);
            try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
            if (document.activeElement !== el && tries < maxTries) setTimeout(kick, 50);
        };
        requestAnimationFrame(kick);
        window.addEventListener("load", () => setTimeout(kick, 0), { once: true });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && el.value.length === 0) kick();
        });
    }

    keepFocus(editor);

    async function finalizeTopEditor() {
        await waitForPendingImagePastes(editor);
        const text = editor.value;
        const trimmed = text.trim();

        // Never persist empties; keep editor active
        if (trimmed.length === 0) {
            preview.innerHTML = "";
            keepFocus(editor);
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

        // Reset and immediately refocus (with visible caret)
        editor.value = "";
        preview.innerHTML = "";
        keepFocus(editor);

        // Classify in background and update the new card’s chips
        triggerClassificationForCard(record.noteId, text, notesContainer);
    }
}
