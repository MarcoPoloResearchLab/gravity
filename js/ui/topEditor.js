// @ts-check

import { nowIso } from "../utils/datetime.js";
import { generateNoteId } from "../utils/id.js";
import { createElement } from "../utils/dom.js";
import {
    ARIA_LABEL_NEW_NOTE,
    ERROR_NOTES_CONTAINER_NOT_FOUND,
    ERROR_TOP_EDITOR_NOT_FOUND,
    EVENT_NOTE_CREATE
} from "../constants.js";
import { triggerClassificationForCard, focusCardEditor } from "./card.js";
import { renderHtmlView } from "./htmlView.js";
import {
    enableClipboardImagePaste,
    registerInitialAttachments,
    getAllAttachments,
    collectReferencedAttachments,
    resetAttachments,
    transformMarkdownWithAttachments
} from "./imagePaste.js";
import { createMarkdownEditorHost, MARKDOWN_MODE_EDIT } from "./markdownEditorHost.js";
import {
    isTopEditorAutofocusSuppressed,
    clearTopEditorAutofocusSuppression,
    suppressTopEditorAutofocus
} from "./focusManager.js";

/**
 * Mount the always-empty top editor. It never persists empties; on finalize
 * it creates a record and passes it to onCreateRecord so a card can be inserted.
 * @param {{ notesContainer: HTMLElement }} params
 * @returns {void}
 */
export function mountTopEditor({ notesContainer }) {
    if (!(notesContainer instanceof HTMLElement)) {
        throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
    }
    const host = document.getElementById("top-editor");
    if (!(host instanceof HTMLElement)) {
        throw new Error(ERROR_TOP_EDITOR_NOT_FOUND);
    }
    host.innerHTML = "";

    const wrapper = createElement("div", "markdown-block top-editor");
    const htmlView = createElement("div", "markdown-content");   // div so tables render
    const editor  = createElement("textarea", "markdown-editor");

    editor.value = "";
    editor.setAttribute("rows", "1");
    editor.setAttribute("aria-label", ARIA_LABEL_NEW_NOTE);
    editor.setAttribute("autofocus", "autofocus");
    editor.addEventListener("focus", clearTopEditorAutofocusSuppression);

    registerInitialAttachments(editor, {});
    enableClipboardImagePaste(editor);

    wrapper.append(htmlView, editor);
    host.appendChild(wrapper);

    let maintainAutofocus = true;

    if (typeof document !== "undefined") {
        document.addEventListener("focusin", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            const isWithinTopEditor = wrapper.contains(target);
            if (isWithinTopEditor) {
                maintainAutofocus = true;
                return;
            }
            if (target === document.body) {
                return;
            }
            maintainAutofocus = false;
            suppressTopEditorAutofocus();
        });
    }

    const editorHost = createMarkdownEditorHost({
        container: wrapper,
        textarea: editor,
        htmlViewElement: htmlView,
        initialMode: MARKDOWN_MODE_EDIT,
        showToolbar: false
    });
    // Expose for cross-module focus utilities.
    wrapper.__markdownHost = editorHost;

    const updateHtmlView = () => {
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editorHost.getValue(), attachments);
        renderHtmlView(htmlView, markdownWithAttachments);
    };

    editorHost.on("change", updateHtmlView);
    editorHost.on("modechange", ({ mode }) => {
        if (mode === MARKDOWN_MODE_EDIT) {
            keepFocus();
        } else {
            updateHtmlView();
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

    updateHtmlView();
    keepFocus({ force: true });

    async function finalizeTopEditor() {
        await editorHost.waitForPendingImages();
        const text = editorHost.getValue();
        const trimmed = text.trim();
        const attachments = collectReferencedAttachments(editor);

        if (trimmed.length === 0) {
            editorHost.setMode(MARKDOWN_MODE_EDIT);
            renderHtmlView(htmlView, "");
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
            attachments,
            pinned: false
        };

        dispatchNoteCreated(wrapper, record);

        editorHost.setValue("");
        editorHost.setMode(MARKDOWN_MODE_EDIT);
        renderHtmlView(htmlView, "");
        resetAttachments(editor);
        keepFocus();

        triggerClassificationForCard(record.noteId, text, notesContainer);
    }

    function keepFocus(options = {}) {
        const { force = false } = options;
        let tries = 0;
        const maxTries = 20;

        const shouldRespectExternalFocus = () => {
            if (force) {
                return false;
            }
            return !maintainAutofocus;
        };

        const shouldDeferFocus = () => {
            const activeElement = document.activeElement;
            const activeBlock = activeElement?.closest?.(".markdown-block");
            const editingCard = notesContainer?.querySelector(".markdown-block.editing-in-place");
            return Boolean(editingCard || (activeBlock && activeBlock !== wrapper));
        };

        const isFocused = () => Boolean(wrapper.querySelector(".CodeMirror-focused"));

        const kick = () => {
            if (shouldRespectExternalFocus()) {
                tries = 0;
                return;
            }

            if (isTopEditorAutofocusSuppressed()) {
                tries = 0;
                setTimeout(kick, 250);
                return;
            }

            if (shouldDeferFocus()) {
                tries = 0;
                setTimeout(kick, 120);
                return;
            }

            tries += 1;
            if (!isFocused()) {
                editorHost.focus();
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

/**
 * Dispatch a DOM-scoped creation event so the composition root can persist the note.
 * @param {HTMLElement} dispatchTarget
 * @param {import("../types.d.js").NoteRecord} record
 * @returns {void}
 */
function dispatchNoteCreated(dispatchTarget, record) {
    if (!(dispatchTarget instanceof HTMLElement)) {
        return;
    }
    const event = new CustomEvent(EVENT_NOTE_CREATE, {
        bubbles: true,
        detail: {
            record,
            storeUpdated: false,
            shouldRender: true
        }
    });
    dispatchTarget.dispatchEvent(event);
}
