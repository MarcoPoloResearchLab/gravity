/* global marked */
// @ts-check

import { renderCard, updateActionButtons, triggerClassificationForCard } from "./ui/card.js";
import { initializeImportExport } from "./ui/importExport.js";
import { GravityStore } from "./core/store.js";
import { createMarkdownEditorOverlay } from "./ui/markdownEditorHost.js";
import {
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_NEW_NOTE,
    LABEL_ENTER_EDIT_MODE,
    LABEL_NEW_NOTE_PLACEHOLDER,
    ERROR_NOTES_CONTAINER_NOT_FOUND
} from "./constants.js";
import { generateNoteId, nowIso, createElement } from "./utils/index.js";

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
const topEntryHost = document.getElementById("top-editor");

const overlayElement = /** @type {HTMLElement|null} */ (document.getElementById("markdown-editor-overlay"));
const overlayTextarea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById("editor-overlay-textarea"));
const overlayTitle = /** @type {HTMLElement|null} */ (document.getElementById("editor-overlay-title"));
const overlayCloseButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("editor-close-button"));
const overlayEnterEditButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("editor-enter-edit-button"));
const overlayToast = /** @type {HTMLElement|null} */ (document.getElementById("editor-toast"));
const overlayLiveRegion = /** @type {HTMLElement|null} */ (document.getElementById("editor-save-status"));
const overlayRendered = /** @type {HTMLElement|null} */ (document.getElementById("editor-overlay-rendered"));

if (!overlayElement || !overlayTextarea || !overlayTitle || !overlayCloseButton || !overlayEnterEditButton || !overlayToast || !overlayLiveRegion || !overlayRendered) {
    throw new Error("Markdown editor overlay elements are missing.");
}

const overlayController = createMarkdownEditorOverlay({
    overlayElement,
    textareaElement: overlayTextarea,
    titleElement: overlayTitle,
    closeButton: overlayCloseButton,
    enterEditButton: overlayEnterEditButton,
    toastElement: overlayToast,
    liveRegionElement: overlayLiveRegion,
    renderedElement: overlayRendered
});

const notesById = new Map();

(function boot() {
    renderNewNotePlaceholder();
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

/**
 * Render persisted notes sorted by last activity timestamp.
 * @param {import("./types.d.js").NoteRecord[]} records
 */
function renderPersistedNotes(records) {
    notesContainer.innerHTML = "";
    const sortedRecords = [...records];
    sortedRecords.sort((a, b) => (b.lastActivityIso || "").localeCompare(a.lastActivityIso || ""));
    notesById.clear();
    for (const record of sortedRecords) {
        notesById.set(record.noteId, record);
        notesContainer.appendChild(renderCard(record, {
            notesContainer,
            onOpenOverlay: (noteId, options) => openOverlayForNote(noteId, options)
        }));
    }
    updateActionButtons(notesContainer);
}

function openOverlayForNote(noteId, options = {}) {
    const record = notesById.get(noteId) ?? GravityStore.getById(noteId);
    if (!record) return;
    const initialMode = options.mode === "view" ? "view" : "edit";
    overlayController.open({
        noteId: record.noteId,
        markdown: record.markdownText,
        attachments: record.attachments || {},
        title: deriveOverlayTitle(record.markdownText),
        mode: initialMode,
        onSave: async ({ noteId: targetNoteId, markdown, attachments }) => {
            await persistNote(targetNoteId, markdown, attachments);
        }
    });
}

async function persistNote(noteId, markdown, attachments) {
    const trimmed = (markdown || "").trim();
    if (trimmed.length === 0) {
        GravityStore.removeById(noteId);
        notesById.delete(noteId);
        renderPersistedNotes(GravityStore.loadAllNotes());
        return;
    }

    const timestamp = nowIso();
    const base = GravityStore.getById(noteId);
    GravityStore.upsertNonEmpty({
        noteId,
        markdownText: markdown,
        attachments,
        createdAtIso: base?.createdAtIso ?? timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        classification: base?.classification
    });

    renderPersistedNotes(GravityStore.loadAllNotes());
    triggerClassificationForCard(noteId, markdown, notesContainer);
}

function openOverlayForCreation() {
    const noteId = generateNoteId();
    overlayController.open({
        noteId,
        markdown: "",
        attachments: {},
        title: LABEL_NEW_NOTE,
        mode: "edit",
        onSave: async ({ noteId: targetNoteId, markdown, attachments }) => {
            await persistNote(targetNoteId, markdown, attachments);
        }
    });
}

function renderNewNotePlaceholder() {
    if (!(topEntryHost instanceof HTMLElement)) return;
    topEntryHost.innerHTML = "";
    const placeholder = createElement("div", "new-note-blank");
    placeholder.setAttribute("tabindex", "0");

    const preview = createElement("div", "note-preview");
    const content = createElement("div", "markdown-content");
    preview.appendChild(content);
    placeholder.appendChild(preview);

    const startNew = () => openOverlayForCreation();
    placeholder.addEventListener("click", startNew);
    placeholder.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            startNew();
        }
    });

    topEntryHost.appendChild(placeholder);

    requestAnimationFrame(() => {
        preview.classList.remove("note-preview--overflow");
    });
}

function deriveOverlayTitle(markdown) {
    if (typeof markdown !== "string" || markdown.length === 0) return LABEL_NEW_NOTE;
    const firstLine = markdown.split("\n").find((line) => line.trim().length > 0);
    if (!firstLine) return LABEL_NEW_NOTE;
    return firstLine.replace(/^#+\s*/, "").slice(0, 80).trim() || LABEL_NEW_NOTE;
}
