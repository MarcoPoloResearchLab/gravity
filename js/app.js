/* global marked */
// @ts-check

import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js";

import { renderCard, updateActionButtons, insertCardRespectingPinned } from "./ui/card.js";
import { initializeImportExport } from "./ui/importExport.js";
import { GravityStore } from "./core/store.js";
import { appConfig } from "./core/config.js";
import { createGoogleIdentityController } from "./core/auth.js";
import { createSyncManager } from "./core/syncManager.js";
import { mountTopEditor } from "./ui/topEditor.js";
import {
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    ERROR_NOTES_CONTAINER_NOT_FOUND,
    ERROR_AUTHENTICATION_GENERIC,
    EVENT_NOTE_CREATE,
    EVENT_NOTE_UPDATE,
    EVENT_NOTE_DELETE,
    EVENT_NOTE_PIN_TOGGLE,
    EVENT_NOTES_IMPORTED,
    EVENT_NOTIFICATION_REQUEST,
    EVENT_AUTH_SIGN_IN,
    EVENT_AUTH_SIGN_OUT,
    EVENT_AUTH_ERROR,
    MESSAGE_NOTES_IMPORTED,
    MESSAGE_NOTES_SKIPPED,
    MESSAGE_NOTES_IMPORT_FAILED
} from "./constants.js";
import { initializeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal.js";
import { initializeNotesState } from "./ui/notesState.js";
import { showSaveFeedback } from "./ui/saveFeedback.js";
import { initializeAuthControls } from "./ui/authControls.js";
import { createAvatarMenu } from "./ui/menu/avatarMenu.js";
import { logging } from "./utils/logging.js";

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
        authControls: /** @type {ReturnType<typeof initializeAuthControls>|null} */ (null),
        avatarMenu: /** @type {ReturnType<typeof createAvatarMenu>|null} */ (null),
        authController: /** @type {{ signOut(reason?: string): void, dispose(): void }|null} */ (null),
        authUser: /** @type {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }|null} */ (null),
        authPollHandle: /** @type {number|null} */ (null),
        guestExportButton: /** @type {HTMLButtonElement|null} */ (null),
        syncManager: /** @type {ReturnType<typeof createSyncManager>|null} */ (null),
        initialized: false,

        init() {
            this.notesContainer = this.$refs.notesContainer ?? document.getElementById("notes-container");
            if (!(this.notesContainer instanceof HTMLElement)) {
                throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
            }

            this.exportButton = /** @type {HTMLButtonElement|null} */ (this.$refs.exportButton ?? document.getElementById("export-notes-button"));
            this.importButton = /** @type {HTMLButtonElement|null} */ (this.$refs.importButton ?? document.getElementById("import-notes-button"));
            this.importInput = /** @type {HTMLInputElement|null} */ (this.$refs.importInput ?? document.getElementById("import-notes-input"));
            this.guestExportButton = /** @type {HTMLButtonElement|null} */ (this.$refs.guestExportButton ?? document.getElementById("guest-export-button"));

            this.configureMarked();
            this.registerEventBridges();
            this.initializeAuth();
            this.initializeTopEditor();
            this.initializeImportExport();
            this.syncManager = createSyncManager();
            GravityStore.setUserScope(null);
            this.initializeNotes();
            initializeKeyboardShortcutsModal();
            this.setGuestExportVisibility(true);
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
         * Initialize Google Identity auth controls and controller.
         * @returns {void}
         */
        initializeAuth() {
            const container = /** @type {HTMLElement|null} */ (this.$refs.authContainer ?? null);
            const buttonHost = /** @type {HTMLElement|null} */ (this.$refs.authButtonHost ?? null);
            const profile = /** @type {HTMLElement|null} */ (this.$refs.authProfile ?? null);
            const displayName = /** @type {HTMLElement|null} */ (this.$refs.authDisplayName ?? null);
            const email = /** @type {HTMLElement|null} */ (this.$refs.authEmail ?? null);
            const avatar = /** @type {HTMLImageElement|null} */ (this.$refs.authAvatar ?? null);
            const status = /** @type {HTMLElement|null} */ (this.$refs.authStatus ?? null);
            const signOutButton = /** @type {HTMLButtonElement|null} */ (this.$refs.authSignOutButton ?? null);
            const menuWrapper = /** @type {HTMLElement|null} */ (this.$refs.authMenuWrapper ?? null);
            const menuPanel = /** @type {HTMLElement|null} */ (this.$refs.authMenu ?? null);
            const avatarTrigger = /** @type {HTMLButtonElement|null} */ (this.$refs.authAvatarTrigger ?? null);

            if (!container || !buttonHost || !profile || !displayName || !email) {
                return;
            }

            if (this.avatarMenu) {
                this.avatarMenu.dispose();
                this.avatarMenu = null;
            }

            this.authControls = initializeAuthControls({
                container,
                buttonElement: buttonHost,
                profileContainer: profile,
                displayNameElement: displayName,
                emailElement: email,
                avatarElement: avatar ?? null,
                statusElement: status ?? null,
                signOutButton: signOutButton ?? null,
                menuWrapper: menuWrapper ?? null,
                onSignOutRequested: () => {
                    this.handleAuthSignOutRequest();
                }
            });

            if (avatarTrigger && menuPanel) {
                this.avatarMenu = createAvatarMenu({
                    triggerElement: avatarTrigger,
                    menuElement: menuPanel
                });
                this.avatarMenu.setEnabled(false);
            }

            this.authControls.showSignedOut();
            this.ensureGoogleIdentityController();
        },

        /**
         * Ensure the Google Identity controller is instantiated once the API is available.
         * @returns {void}
         */
        ensureGoogleIdentityController() {
            if (this.authController) {
                return;
            }
            if (typeof window === "undefined") {
                return;
            }
            const google = /** @type {any} */ (window.google);
            const hasIdentity = Boolean(google?.accounts?.id);
            if (!hasIdentity) {
                this.startGoogleIdentityPolling();
                return;
            }

            const buttonHost = this.authControls?.getButtonHost() ?? null;
            this.authController = createGoogleIdentityController({
                clientId: appConfig.googleClientId,
                google,
                buttonElement: buttonHost ?? undefined,
                eventTarget: this.$el,
                autoPrompt: true
            });
            this.stopGoogleIdentityPolling();
        },

        /**
         * Begin polling for the Google Identity script to become available.
         * @returns {void}
         */
        startGoogleIdentityPolling() {
            if (this.authPollHandle !== null) {
                return;
            }
            if (typeof window === "undefined") {
                return;
            }
            const poll = () => {
                if (window.google && window.google.accounts && window.google.accounts.id) {
                    this.stopGoogleIdentityPolling();
                    this.ensureGoogleIdentityController();
                }
            };
            poll();
            if (!this.authController) {
                this.authPollHandle = window.setInterval(poll, 350);
            }
        },

        /**
         * Stop any outstanding polling interval for Google Identity availability.
         * @returns {void}
         */
        stopGoogleIdentityPolling() {
            if (this.authPollHandle === null) {
                return;
            }
            if (typeof window !== "undefined") {
                window.clearInterval(this.authPollHandle);
            }
            this.authPollHandle = null;
        },

        /**
         * Handle a local sign-out request from the UI.
         * @returns {void}
         */
        handleAuthSignOutRequest() {
            this.avatarMenu?.close({ focusTrigger: false });
            if (this.authController) {
                this.authController.signOut("manual");
            } else {
                this.authControls?.showSignedOut();
                this.avatarMenu?.setEnabled(false);
                GravityStore.setUserScope(null);
                this.initializeNotes();
            }
        },

        /**
         * Hydrate Alpine state from persisted storage.
         * @returns {void}
         */
        initializeNotes() {
            const initialRecords = GravityStore.loadAllNotes();
            initializeNotesState(initialRecords);
            const normalizedRecords = GravityStore.loadAllNotes();
            this.renderNotes(normalizedRecords);
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
                const persisted = GravityStore.getById(record.noteId) ?? record;
                this.syncManager?.recordLocalUpsert(persisted);
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
                const persisted = GravityStore.getById(record.noteId) ?? record;
                this.syncManager?.recordLocalUpsert(persisted);
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
                const { noteId, record, storeUpdated, shouldRender } = extractNoteDetail(event);
                if (!noteId) return;
                const existing = record ?? GravityStore.getById(noteId);
                if (!storeUpdated) {
                    GravityStore.removeById(noteId);
                }
                this.syncManager?.recordLocalDelete(noteId, existing ?? null);
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
                const queuedRecords = GravityStore.loadAllNotes();
                for (const record of queuedRecords) {
                    this.syncManager?.recordLocalUpsert(record);
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
                for (const record of records) {
                    const persisted = GravityStore.getById(record.noteId) ?? record;
                    this.syncManager?.recordLocalUpsert(persisted);
                }
                const message = records.length > 0
                    ? MESSAGE_NOTES_IMPORTED
                    : MESSAGE_NOTES_SKIPPED;
                this.emitNotification(message);
            });

            root.addEventListener(EVENT_AUTH_SIGN_IN, (event) => {
                const detail = /** @type {{ user?: { id?: string, email?: string|null, name?: string|null, pictureUrl?: string|null }, credential?: string }} */ (event?.detail ?? {});
                const user = detail?.user;
                if (!user || !user.id) {
                    return;
                }
                this.authUser = {
                    id: user.id,
                    email: typeof user.email === "string" ? user.email : null,
                    name: typeof user.name === "string" ? user.name : null,
                    pictureUrl: typeof user.pictureUrl === "string" ? user.pictureUrl : null
                };
                this.authControls?.clearError();
                this.authControls?.showSignedIn(this.authUser);
                this.avatarMenu?.setEnabled(true);
                this.avatarMenu?.close({ focusTrigger: false });
                GravityStore.setUserScope(this.authUser.id);
                this.initializeNotes();
                const credential = typeof detail?.credential === "string" ? detail.credential : "";
                this.syncManager?.handleSignIn({
                    userId: this.authUser.id,
                    credential
                }).catch((error) => {
                    logging.error(error);
                });
                this.setGuestExportVisibility(false);
            });

            root.addEventListener(EVENT_AUTH_SIGN_OUT, () => {
                this.authUser = null;
                this.authControls?.clearError();
                this.authControls?.showSignedOut();
                this.avatarMenu?.setEnabled(false);
                this.avatarMenu?.close({ focusTrigger: false });
                GravityStore.setUserScope(null);
                this.initializeNotes();
                this.syncManager?.handleSignOut();
                this.setGuestExportVisibility(true);
            });

            root.addEventListener(EVENT_AUTH_ERROR, (event) => {
                const detail = /** @type {{ error?: unknown, reason?: unknown }} */ (event?.detail ?? {});
                const errorMessage = typeof detail.error === "string"
                    ? detail.error
                    : typeof detail.reason === "string"
                        ? String(detail.reason)
                        : ERROR_AUTHENTICATION_GENERIC;
                this.authControls?.showError(errorMessage);
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
            const notify = (message) => {
                const finalMessage = typeof message === "string" && message.length > 0
                    ? message
                    : MESSAGE_NOTES_IMPORT_FAILED;
                this.emitNotification(finalMessage);
            };

            initializeImportExport({
                exportButton: this.exportButton ?? null,
                importButton: this.importButton ?? null,
                fileInput: this.importInput ?? null,
                notify
            });

            if (this.guestExportButton) {
                initializeImportExport({
                    exportButton: this.guestExportButton,
                    importButton: null,
                    fileInput: null,
                    notify
                });
            }
        },

        setGuestExportVisibility(isVisible) {
            const button = this.guestExportButton;
            if (!button) {
                return;
            }
            if (isVisible) {
                button.hidden = false;
                button.removeAttribute("aria-hidden");
            } else {
                button.hidden = true;
                button.setAttribute("aria-hidden", "true");
            }
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
