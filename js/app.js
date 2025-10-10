/* global marked */
// @ts-check

import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js";

import { renderCard, updateActionButtons, insertCardRespectingPinned } from "./ui/card.js";
import { initializeImportExport } from "./ui/importExport.js";
import { GravityStore } from "./core/store.js";
import { mountTopEditor } from "./ui/topEditor.js";
import {
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    ERROR_NOTES_CONTAINER_NOT_FOUND,
    EVENT_NOTE_CREATE,
    EVENT_NOTE_UPDATE,
    EVENT_NOTE_DELETE,
    EVENT_NOTE_PIN_TOGGLE,
    EVENT_NOTES_IMPORTED,
    EVENT_NOTIFICATION_REQUEST,
    MESSAGE_NOTES_IMPORTED,
    MESSAGE_NOTES_SKIPPED,
    MESSAGE_NOTES_IMPORT_FAILED
} from "./constants.js";
import { initializeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal.js";
import { initializeNotesState } from "./ui/notesState.js";
import { showSaveFeedback } from "./ui/saveFeedback.js";

const CONSTANTS_VIEW_MODEL = Object.freeze({
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES
});

const NOTIFICATION_DEFAULT_DURATION_MS = 3000;

document.addEventListener("alpine:init", () => {
    Alpine.data("gravityApp", gravityApp);
});

window.Alpine = Alpine;
Alpine.start();

/**
 * Alpine root component that wires the Gravity Notes application.
 * @returns {import("alpinejs").AlpineComponent}
 */
function gravityApp() {
    return {
        constants: CONSTANTS_VIEW_MODEL,
        notesContainer: /** @type {HTMLElement|null} */ (null),
        exportButton: /** @type {HTMLButtonElement|null} */ (null),
        importButton: /** @type {HTMLButtonElement|null} */ (null),
        importInput: /** @type {HTMLInputElement|null} */ (null),
        initialized: false,

        init() {
            this.notesContainer = this.$refs.notesContainer ?? document.getElementById("notes-container");
            if (!(this.notesContainer instanceof HTMLElement)) {
                throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
            }

            this.exportButton = /** @type {HTMLButtonElement|null} */ (this.$refs.exportButton ?? document.getElementById("export-notes-button"));
            this.importButton = /** @type {HTMLButtonElement|null} */ (this.$refs.importButton ?? document.getElementById("import-notes-button"));
            this.importInput = /** @type {HTMLInputElement|null} */ (this.$refs.importInput ?? document.getElementById("import-notes-input"));

            this.configureMarked();
            this.registerEventBridges();
            this.initializeTopEditor();
            this.initializeImportExport();
            this.initializeNotes();
            initializeKeyboardShortcutsModal();
            this.initialized = true;
        },

        /**
         * Configure Marked once at boot.
         * @returns {void}
         */
        configureMarked() {
            marked.setOptions({
                gfm: true,
                breaks: true,
                headerIds: true,
                mangle: false,
                smartLists: true
            });
        },

        /**
         * Hydrate Alpine state from persisted storage.
         * @returns {void}
         */
        initializeNotes() {
            const initialRecords = GravityStore.loadAllNotes();
            initializeNotesState(initialRecords);
            this.renderNotes(initialRecords);
        },

        /**
         * Register DOM-scoped listeners bridging UI components.
         * @returns {void}
         */
        registerEventBridges() {
            const root = this.$el;
            root.addEventListener(EVENT_NOTE_CREATE, (event) => {
                const { record, storeUpdated, shouldRender } = extractNoteDetail(event);
                if (!record) return;
                if (!storeUpdated) {
                    GravityStore.upsertNonEmpty(record);
                }
                if (shouldRender !== false) {
                    const cards = GravityStore.loadAllNotes();
                    initializeNotesState(cards);
                    this.renderNotes(cards);
                }
                if (!storeUpdated) {
                    showSaveFeedback();
                }
            });

            root.addEventListener(EVENT_NOTE_UPDATE, (event) => {
                const { record, storeUpdated, shouldRender } = extractNoteDetail(event);
                if (!record) return;
                if (!storeUpdated) {
                    GravityStore.upsertNonEmpty(record);
                }
                if (shouldRender) {
                    const cards = GravityStore.loadAllNotes();
                    initializeNotesState(cards);
                    this.renderNotes(cards);
                }
                if (!storeUpdated) {
                    showSaveFeedback();
                }
            });

            root.addEventListener(EVENT_NOTE_DELETE, (event) => {
                const { noteId, storeUpdated, shouldRender } = extractNoteDetail(event);
                if (!noteId) return;
                if (!storeUpdated) {
                    GravityStore.removeById(noteId);
                }
                if (shouldRender !== false) {
                    const cards = GravityStore.loadAllNotes();
                    initializeNotesState(cards);
                    this.renderNotes(cards);
                }
            });

            root.addEventListener(EVENT_NOTE_PIN_TOGGLE, (event) => {
                const { noteId, storeUpdated, shouldRender } = extractNoteDetail(event);
                if (!noteId) return;
                if (!storeUpdated) {
                    GravityStore.setPinned(noteId);
                }
                if (shouldRender !== false) {
                    const cards = GravityStore.loadAllNotes();
                    initializeNotesState(cards);
                    this.renderNotes(cards);
                }
            });

            root.addEventListener(EVENT_NOTES_IMPORTED, (event) => {
                const { records, shouldRender } = extractImportDetail(event);
                if (shouldRender !== false) {
                    const nextRecords = GravityStore.loadAllNotes();
                    initializeNotesState(nextRecords);
                    this.renderNotes(nextRecords);
                }
                const message = records.length > 0
                    ? MESSAGE_NOTES_IMPORTED
                    : MESSAGE_NOTES_SKIPPED;
                this.emitNotification(message);
            });

            root.addEventListener(EVENT_NOTIFICATION_REQUEST, (event) => {
                const detail = /** @type {{ message?: string, durationMs?: number }|undefined} */ (event?.detail);
                if (!detail || typeof detail.message !== "string" || detail.message.length === 0) {
                    return;
                }
                const duration = typeof detail.durationMs === "number" && Number.isFinite(detail.durationMs)
                    ? detail.durationMs
                    : NOTIFICATION_DEFAULT_DURATION_MS;
                this.emitNotification(detail.message, duration);
            });
        },

        /**
         * Render the provided records into the notes container.
         * @param {import("./types.d.js").NoteRecord[]} records
         * @returns {void}
         */
        renderNotes(records) {
            const container = this.notesContainer;
            if (!(container instanceof HTMLElement)) {
                return;
            }

            container.innerHTML = "";
            const sortedRecords = [...records];
            sortedRecords.sort((a, b) => (b.lastActivityIso || "").localeCompare(a.lastActivityIso || ""));
            const pinnedRecords = sortedRecords.filter((record) => record.pinned === true);
            const unpinnedRecords = sortedRecords.filter((record) => record.pinned !== true);
            const orderedRecords = [...pinnedRecords, ...unpinnedRecords];
            for (const record of orderedRecords) {
                const card = renderCard(record, { notesContainer: container });
                container.appendChild(card);
            }
            updateActionButtons(container);
        },

        /**
         * Mount the top editor component.
         * @returns {void}
         */
        initializeTopEditor() {
            const container = this.notesContainer;
            if (!container) {
                return;
            }
            mountTopEditor({
                notesContainer: container
            });
        },

        /**
         * Wire up import/export controls and emit notifications on outcomes.
         * @returns {void}
         */
        initializeImportExport() {
            initializeImportExport({
                exportButton: this.exportButton ?? null,
                importButton: this.importButton ?? null,
                fileInput: this.importInput ?? null,
                notify: (message) => {
                    const finalMessage = typeof message === "string" && message.length > 0
                        ? message
                        : MESSAGE_NOTES_IMPORT_FAILED;
                    this.emitNotification(finalMessage);
                }
            });
        },

        /**
         * Show the toast notification for a short duration.
         * @param {string} message
         * @param {number} [durationMs]
         * @returns {void}
         */
        emitNotification(message, durationMs = NOTIFICATION_DEFAULT_DURATION_MS) {
            void durationMs; // duration reserved for future adjustments
            showSaveFeedback(message);
        }
    };
}

/**
 * Attempt to extract a note identifier from an event.
 * @param {Event} event
 * @returns {string|null}
 */
function extractNoteDetail(event) {
    const detail = /** @type {{ noteId?: unknown, record?: unknown, storeUpdated?: unknown, shouldRender?: unknown }} */ (event?.detail || {});
    const record = isNoteRecord(detail.record) ? detail.record : null;
    const noteId = typeof detail.noteId === "string" && detail.noteId.trim().length > 0
        ? detail.noteId.trim()
        : (record?.noteId ?? null);
    const storeUpdated = detail.storeUpdated === true;
    const shouldRender = detail.shouldRender;
    return {
        record,
        noteId,
        storeUpdated,
        shouldRender
    };
}

/**
 * Extract details from an import event payload.
 * @param {Event} event
 * @returns {{ records: import("./types.d.js").NoteRecord[], shouldRender: boolean }}
 */
function extractImportDetail(event) {
    const detail = /** @type {{ records?: unknown, shouldRender?: unknown }} */ (event?.detail || {});
    const records = Array.isArray(detail.records)
        ? /** @type {import("./types.d.js").NoteRecord[]} */ (detail.records)
        : [];
    const shouldRender = detail.shouldRender === false ? false : true;
    return { records, shouldRender };
}

/**
 * Type guard for note records coming from event detail.
 * @param {unknown} candidate
 * @returns {candidate is import("./types.d.js").NoteRecord}
 */
function isNoteRecord(candidate) {
    if (!candidate || typeof candidate !== "object") {
        return false;
    }
    const record = /** @type {import("./types.d.js").NoteRecord} */ (candidate);
    return typeof record.noteId === "string"
        && record.noteId.trim().length > 0
        && typeof record.markdownText === "string"
        && record.markdownText.trim().length > 0;
}
