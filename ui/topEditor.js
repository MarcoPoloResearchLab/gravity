import { nowIso, generateNoteId, createElement, autoResize } from "../utils.js";
import { GravityStore } from "../store.js";
import { triggerClassificationForCard, focusCardEditor } from "./card.js";
import { shouldNavigateToNextEditor } from "./navigation.js";
import {
    enableClipboardImagePaste,
    waitForPendingImagePastes,
    registerInitialAttachments,
    getAllAttachments,
    collectReferencedAttachments,
    resetAttachments,
    transformMarkdownWithAttachments
} from "./imagePaste.js";

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

    registerInitialAttachments(editor, {});
    // Live preview + autoresize
    editor.addEventListener("input", () => {
        autoResize(editor);
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editor.value, attachments);
        preview.innerHTML = marked.parse(markdownWithAttachments);
    });

    // Finalize on Enter (no Shift)
    editor.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            finalizeTopEditor();
        }

        if (shouldNavigateToNextEditor(ev, editor)) {
            const navigated = focusFirstPersistedCard(notesContainer);
            if (navigated) {
                ev.preventDefault();
            }
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

        const shouldDeferFocus = () => {
            const activeElement = document.activeElement;
            const isDifferentMarkdownEditor =
                activeElement instanceof HTMLTextAreaElement &&
                activeElement !== el &&
                activeElement.classList.contains("markdown-editor");
            const cardEditing = notesContainer?.querySelector(".markdown-block.editing-in-place");
            return Boolean(isDifferentMarkdownEditor || cardEditing);
        };

        const kick = () => {
            if (shouldDeferFocus()) {
                tries = 0;
                setTimeout(kick, 120);
                return;
            }

            tries++;
            autoResize(el);
            if (document.activeElement !== el) {
                el.focus({ preventScroll: true });
                ensureCaretVisible(el);
                try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
            }
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
        const attachments = collectReferencedAttachments(editor);

        // Never persist empties; keep editor active
        if (trimmed.length === 0) {
            preview.innerHTML = "";
            resetAttachments(editor);
            keepFocus(editor);
            return;
        }

        const ts = nowIso();
        const record = {
            noteId: generateNoteId(),
            markdownText: text,
            createdAtIso: ts,
            updatedAtIso: ts,
            lastActivityIso: ts,
            attachments
        };

        GravityStore.upsertNonEmpty(record);
        if (typeof onCreateRecord === "function") onCreateRecord(record);

        // Reset and immediately refocus (with visible caret)
        editor.value = "";
        preview.innerHTML = "";
        resetAttachments(editor);
        keepFocus(editor);

        // Classify in background and update the new card’s chips
        triggerClassificationForCard(record.noteId, text, notesContainer);
    }

    function focusFirstPersistedCard(container) {
        const firstCard = container?.querySelector(".markdown-block:not(.top-editor)");
        if (!firstCard) return false;
        return focusCardEditor(firstCard, container, { bubblePreviousCardToTop: false });
    }
}
