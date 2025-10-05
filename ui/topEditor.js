import { nowIso, generateNoteId, createElement, autoResize } from "../utils.js";
import { GravityStore } from "../store.js";
import { triggerClassificationForCard, focusCardEditor } from "./card.js";
import { renderSanitizedMarkdown } from "./markdownPreview.js";
import {
    enableClipboardImagePaste,
    registerInitialAttachments,
    getAllAttachments,
    collectReferencedAttachments,
    resetAttachments,
    transformMarkdownWithAttachments
} from "./imagePaste.js";
import { createMarkdownEditorHost, MARKDOWN_MODE_EDIT } from "./markdownEditorHost.js";

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

    editor.value = "";
    editor.setAttribute("rows", "1");
    editor.setAttribute("aria-label", "New note");
    editor.setAttribute("autofocus", "autofocus");

    registerInitialAttachments(editor, {});
    enableClipboardImagePaste(editor);

    wrapper.append(preview, editor);
    host.appendChild(wrapper);

    const editorHost = createMarkdownEditorHost({
        container: wrapper,
        textarea: editor,
        previewElement: preview,
        initialMode: MARKDOWN_MODE_EDIT,
        showToolbar: false
    });
    // Expose for cross-module focus utilities.
    wrapper.__markdownHost = editorHost;

    const updatePreview = () => {
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editorHost.getValue(), attachments);
        renderSanitizedMarkdown(preview, markdownWithAttachments);
        if (!editorHost.isEnhanced()) {
            autoResize(editor);
        }
    };

    editorHost.on("change", updatePreview);
    editorHost.on("modechange", ({ mode }) => {
        if (mode === MARKDOWN_MODE_EDIT) {
            keepFocus();
        } else {
            updatePreview();
        }
    });
    editorHost.on("submit", finalizeTopEditor);
    editorHost.on("blur", finalizeTopEditor);
    editorHost.on("navigateNext", () => {
        const navigated = focusFirstPersistedCard(notesContainer);
        if (navigated) {
            editorHost.setMode(MARKDOWN_MODE_EDIT);
        }
    });

    updatePreview();
    keepFocus();

    async function finalizeTopEditor() {
        await editorHost.waitForPendingImages();
        const text = editorHost.getValue();
        const trimmed = text.trim();
        const attachments = collectReferencedAttachments(editor);

        if (trimmed.length === 0) {
            editorHost.setMode(MARKDOWN_MODE_EDIT);
            renderSanitizedMarkdown(preview, "");
            resetAttachments(editor);
            editorHost.setValue("");
            keepFocus();
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

        editorHost.setValue("");
        editorHost.setMode(MARKDOWN_MODE_EDIT);
        renderSanitizedMarkdown(preview, "");
        resetAttachments(editor);
        keepFocus();

        triggerClassificationForCard(record.noteId, text, notesContainer);
    }

    // Ensure the caret is visible even when empty (fallback textarea only)
    function ensureCaretVisible(el) {
        if (editorHost.isEnhanced()) return;
        if (el.value === "") {
            el.value = " ";
            try { el.setSelectionRange(1, 1); } catch {}
            el.value = "";
        }
    }

    function keepFocus() {
        let tries = 0;
        const maxTries = 20;

        const shouldDeferFocus = () => {
            const activeElement = document.activeElement;
            const activeBlock = activeElement?.closest?.(".markdown-block");
            const editingCard = notesContainer?.querySelector(".markdown-block.editing-in-place");
            return Boolean(editingCard || (activeBlock && activeBlock !== wrapper));
        };

        const isFocused = () => {
            if (editorHost.isEnhanced()) {
                return Boolean(wrapper.querySelector(".CodeMirror-focused"));
            }
            return document.activeElement === editor;
        };

        const kick = () => {
            if (shouldDeferFocus()) {
                tries = 0;
                setTimeout(kick, 120);
                return;
            }

            tries += 1;
            if (!editorHost.isEnhanced()) {
                autoResize(editor);
            }

            if (!isFocused()) {
                editorHost.focus();
                ensureCaretVisible(editor);
            }

            if (!isFocused() && tries < maxTries) {
                setTimeout(kick, 50);
            }
        };

        requestAnimationFrame(kick);
        window.addEventListener("load", () => setTimeout(kick, 0), { once: true });
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && editorHost.getValue().length === 0) kick();
        });
    }

    function focusFirstPersistedCard(container) {
        const firstCard = container?.querySelector(".markdown-block:not(.top-editor)");
        if (!firstCard) return false;
        return focusCardEditor(firstCard, container, { bubblePreviousCardToTop: false });
    }
}
