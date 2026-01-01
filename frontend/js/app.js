/* global marked */
// @ts-check

import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js";

import { renderCard, updateActionButtons, insertCardRespectingPinned } from "./ui/card.js?build=2026-01-01T21:20:40Z";
import { initializeImportExport } from "./ui/importExport.js?build=2026-01-01T21:20:40Z";
import { GravityStore } from "./core/store.js?build=2026-01-01T21:20:40Z";
import { appConfig } from "./core/config.js?build=2026-01-01T21:20:40Z";
import { initializeRuntimeConfig } from "./core/runtimeConfig.js?build=2026-01-01T21:20:40Z";
import { createGoogleIdentityController, isGoogleIdentitySupportedOrigin } from "./core/auth.js?build=2026-01-01T21:20:40Z";
import { initializeAnalytics } from "./core/analytics.js?build=2026-01-01T21:20:40Z";
import { createSyncManager } from "./core/syncManager.js?build=2026-01-01T21:20:40Z";
import { createRealtimeSyncController } from "./core/realtimeSyncController.js?build=2026-01-01T21:20:40Z";
import { ensureTAuthClientLoaded } from "./core/tauthClient.js?build=2026-01-01T21:20:40Z";
import { createTAuthSession } from "./core/tauthSession.js?build=2026-01-01T21:20:40Z";
import { mountTopEditor } from "./ui/topEditor.js?build=2026-01-01T21:20:40Z";
import {
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_ENTER_FULL_SCREEN,
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
    EVENT_AUTH_CREDENTIAL_RECEIVED,
    EVENT_SYNC_SNAPSHOT_APPLIED,
    MESSAGE_NOTES_IMPORTED,
    MESSAGE_NOTES_SKIPPED,
    MESSAGE_NOTES_IMPORT_FAILED,
    APP_BUILD_ID
} from "./constants.js?build=2026-01-01T21:20:40Z";
import { initializeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal.js?build=2026-01-01T21:20:40Z";
import { initializeNotesState } from "./ui/notesState.js?build=2026-01-01T21:20:40Z";
import { showSaveFeedback } from "./ui/saveFeedback.js?build=2026-01-01T21:20:40Z";
import { initializeAuthControls } from "./ui/authControls.js?build=2026-01-01T21:20:40Z";
import { createAvatarMenu } from "./ui/menu/avatarMenu.js?build=2026-01-01T21:20:40Z";
import { initializeFullScreenToggle } from "./ui/fullScreenToggle.js?build=2026-01-01T21:20:40Z";
import { initializeVersionRefresh } from "./utils/versionRefresh.js?build=2026-01-01T21:20:40Z";
import { logging } from "./utils/logging.js?build=2026-01-01T21:20:40Z";

const CONSTANTS_VIEW_MODEL = Object.freeze({
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_ENTER_FULL_SCREEN
});

const NOTIFICATION_DEFAULT_DURATION_MS = 3000;

/**
 * @param {string} targetUrl
 * @param {string} buildId
 * @returns {string}
 */
function buildCacheBustedUrl(targetUrl, buildId) {
    if (typeof window === "undefined") {
        return targetUrl;
    }
    try {
        const normalizedBuildId = typeof buildId === "string" ? buildId.trim() : "";
        const resolved = new URL(targetUrl, window.location.origin);
        if (normalizedBuildId.length > 0) {
            resolved.searchParams.set("build", normalizedBuildId);
        }
        return resolved.toString();
    } catch {
        return targetUrl;
    }
}

async function clearAssetCaches() {
    if (typeof window === "undefined" || typeof caches === "undefined") {
        return;
    }
    try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
        // Suppress cache-clearing failures; the reload will still proceed.
    }
}

bootstrapApplication().catch((error) => {
    logging.error("Failed to bootstrap Gravity Notes", error);
});

async function bootstrapApplication() {
    await initializeRuntimeConfig();
    await ensureTAuthClientLoaded({
        baseUrl: appConfig.authBaseUrl,
        tenantId: appConfig.authTenantId
    }).catch((error) => {
        logging.error("TAuth client failed to load", error);
    });
    initializeAnalytics();
    document.addEventListener("alpine:init", () => {
        Alpine.data("gravityApp", gravityApp);
    });
    window.Alpine = Alpine;
    Alpine.start();
}

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
        authController: /** @type {{ signOut(reason?: string): void, dispose(): void, requestCredential(): Promise<string|null> }|null} */ (null),
        authControllerPromise: /** @type {Promise<void>|null} */ (null),
        tauthSession: /** @type {ReturnType<typeof createTAuthSession>|null} */ (null),
        tauthReadyPromise: /** @type {Promise<void>|null} */ (null),
        authUser: /** @type {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }|null} */ (null),
        pendingSignInUserId: /** @type {string|null} */ (null),
        authPollHandle: /** @type {number|null} */ (null),
        guestExportButton: /** @type {HTMLButtonElement|null} */ (null),
        syncManager: /** @type {ReturnType<typeof createSyncManager>|null} */ (null),
        realtimeSync: /** @type {{ connect(params: { baseUrl: string, accessToken: string, expiresAtMs?: number|null }): void, disconnect(): void, dispose(): void }|null} */ (null),
        syncIntervalHandle: /** @type {number|null} */ (null),
        authNonceToken: /** @type {string|null} */ (null),
        lastRenderedSignature: /** @type {string|null} */ (null),
        fullScreenToggleController: /** @type {{ dispose(): void }|null} */ (null),
        versionRefreshController: /** @type {{ dispose(): void, checkNow(): Promise<{ reloaded: boolean, remoteVersion: string|null }> }|null} */ (null),

        init() {
            this.notesContainer = this.$refs.notesContainer ?? document.getElementById("notes-container");
            if (!(this.notesContainer instanceof HTMLElement)) {
                throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
            }

            this.exportButton = /** @type {HTMLButtonElement|null} */ (this.$refs.exportButton ?? document.getElementById("export-notes-button"));
            this.importButton = /** @type {HTMLButtonElement|null} */ (this.$refs.importButton ?? document.getElementById("import-notes-button"));
            this.importInput = /** @type {HTMLInputElement|null} */ (this.$refs.importInput ?? document.getElementById("import-notes-input"));
            this.guestExportButton = /** @type {HTMLButtonElement|null} */ (this.$refs.guestExportButton ?? document.getElementById("guest-export-button"));
            const fullScreenButton = /** @type {HTMLButtonElement|null} */ (this.$refs.fullScreenToggle ?? document.querySelector('[data-test="fullscreen-toggle"]'));

            this.fullScreenToggleController = initializeFullScreenToggle({
                button: fullScreenButton,
                targetElement: document.documentElement ?? null,
                notify: (message) => {
                    this.emitNotification(message);
                }
            });

            this.configureMarked();
            this.registerEventBridges();
            this.initializeTAuthSession();
            this.initializeAuth();
            this.initializeTopEditor();
            this.initializeImportExport();
            this.syncManager = createSyncManager({
                eventTarget: this.$el ?? null
            });
            this.realtimeSync = createRealtimeSyncController({ syncManager: this.syncManager });

            GravityStore.setUserScope(null);

            if (typeof window !== "undefined") {
                window.addEventListener("storage", (event) => {
                    if (!event) {
                        return;
                    }
                    if (event.storageArea !== window.localStorage) {
                        return;
                    }
                    const activeKey = GravityStore.getActiveStorageKey();
                    if (event.key !== activeKey) {
                        return;
                    }
                    this.initializeNotes();
                    void this.syncManager?.synchronize({ flushQueue: false });
                });
                if (this.syncIntervalHandle === null) {
                    this.syncIntervalHandle = window.setInterval(() => {
                        void this.syncManager?.synchronize({ flushQueue: false });
                    }, 3000);
                }
            }
            this.initializeNotes();
            this.setGuestExportVisibility(true);
            initializeKeyboardShortcutsModal();
            this.versionRefreshController = initializeVersionRefresh({
                currentVersion: APP_BUILD_ID,
                manifestUrl: "./data/version.json",
                checkIntervalMs: 5 * 60 * 1000,
                autoStart: true,
                onVersionMismatch: () => {
                    this.emitNotification("Gravity Notes updated. Reloading…");
                },
                reload: (nextVersion) => {
                    if (typeof window === "undefined") {
                        return;
                    }
                    const targetBuildId = typeof nextVersion === "string" && nextVersion.trim().length > 0
                        ? nextVersion.trim()
                        : APP_BUILD_ID;
                    const targetUrl = buildCacheBustedUrl(window.location.href, targetBuildId);
                    window.setTimeout(() => {
                        const navigate = () => window.location.assign(targetUrl);
                        clearAssetCaches().finally(navigate);
                    }, 600);
                },
                onError: (error) => {
                    logging.warn("Version manifest check failed", error);
                }
            });
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
            const avatar = /** @type {HTMLImageElement|null} */ (this.$refs.authAvatar ?? null);
            const status = /** @type {HTMLElement|null} */ (this.$refs.authStatus ?? null);
            const signOutButton = /** @type {HTMLButtonElement|null} */ (this.$refs.authSignOutButton ?? null);
            const menuWrapper = /** @type {HTMLElement|null} */ (this.$refs.authMenuWrapper ?? null);
            const menuPanel = /** @type {HTMLElement|null} */ (this.$refs.authMenu ?? null);
            const avatarTrigger = /** @type {HTMLButtonElement|null} */ (this.$refs.authAvatarTrigger ?? null);

            if (!container || !buttonHost || !profile || !displayName) {
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
            void this.ensureGoogleIdentityController();
        },

        /**
         * Initialize the TAuth session bridge if available.
         * @returns {Promise<void>|void}
         */
        initializeTAuthSession() {
            if (this.tauthSession) {
                return this.tauthReadyPromise ?? Promise.resolve();
            }
            this.tauthSession = createTAuthSession({
                baseUrl: appConfig.authBaseUrl,
                eventTarget: this.$el ?? document,
                tenantId: appConfig.authTenantId,
                windowRef: typeof window !== "undefined" ? window : undefined
            });
            this.tauthReadyPromise = this.tauthSession.initialize().catch((error) => {
                logging.error("Failed to initialize TAuth session", error);
            });
            return this.tauthReadyPromise;
        },

        /**
         * Ensure the Google Identity controller is instantiated once the API is available.
         * @returns {void}
         */
        async ensureGoogleIdentityController(force = false) {
            if (this.authController && !force) {
                return;
            }
            if (this.authControllerPromise) {
                await this.authControllerPromise;
                return;
            }
            if (typeof window === "undefined") {
                return;
            }
            if (!isGoogleIdentitySupportedOrigin(window.location)) {
                this.stopGoogleIdentityPolling();
                return;
            }
            const google = /** @type {any} */ (window.google);
            const hasIdentity = Boolean(google?.accounts?.id);
            if (!hasIdentity) {
                this.startGoogleIdentityPolling();
                return;
            }

            this.authControllerPromise = (async () => {
                if (this.tauthReadyPromise) {
                    await this.tauthReadyPromise;
                }
                const shouldAutoPrompt = !(this.authUser && typeof this.authUser.id === "string" && this.authUser.id.length > 0);

                if (this.tauthSession) {
                    try {
                        this.authNonceToken = await this.tauthSession.requestNonce();
                    } catch (error) {
                        logging.error("Failed to request auth nonce", error);
                        this.authNonceToken = null;
                    }
                }

                const buttonHost = this.authControls?.getButtonHost() ?? null;
                this.authController = createGoogleIdentityController({
                    clientId: appConfig.googleClientId,
                    google,
                    buttonElement: buttonHost ?? undefined,
                    eventTarget: this.$el,
                    autoPrompt: shouldAutoPrompt,
                    nonceToken: this.authNonceToken ?? undefined
                });
                this.stopGoogleIdentityPolling();
            })();

            try {
                await this.authControllerPromise;
            } finally {
                this.authControllerPromise = null;
            }
        },

        async requestFreshCredential() {
            await this.ensureGoogleIdentityController();
            const controller = this.authController;
            if (!controller || typeof controller.requestCredential !== "function") {
                return null;
            }
            try {
                const credential = await controller.requestCredential();
                if (typeof credential === "string" && credential.length > 0) {
                    return credential;
                }
            } catch (error) {
                logging.error(error);
            }
            return null;
        },

        async exchangeCredentialWithTAuth(credential) {
            if (!this.tauthSession || typeof credential !== "string" || credential.length === 0) {
                return;
            }
            if (!this.authNonceToken) {
                try {
                    this.authNonceToken = await this.tauthSession.requestNonce();
                } catch (error) {
                    logging.error("Failed to request auth nonce", error);
                    this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                    return;
                }
            }
            if (!this.authNonceToken) {
                this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                return;
            }
            try {
                await this.tauthSession.exchangeGoogleCredential({
                    credential,
                    nonceToken: this.authNonceToken
                });
                this.authNonceToken = null;
            } catch (error) {
                logging.error("Credential exchange failed", error);
                this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                this.authNonceToken = null;
            }
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
            if (!isGoogleIdentitySupportedOrigin(window.location)) {
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
            this.realtimeSync?.disconnect();
            if (this.tauthSession) {
                void this.tauthSession.signOut();
            }
            if (this.authController) {
                this.authController.signOut("manual");
            }
            this.authControls?.showSignedOut();
            this.avatarMenu?.setEnabled(false);
            GravityStore.setUserScope(null);
            this.initializeNotes();
            this.authNonceToken = null;
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

        root.addEventListener(EVENT_AUTH_CREDENTIAL_RECEIVED, (event) => {
            const detail = /** @type {{ credential?: string|null }} */ (event?.detail ?? {});
            const credential = typeof detail?.credential === "string" ? detail.credential : "";
            if (!credential) {
                return;
            }
            void this.exchangeCredentialWithTAuth(credential);
        });

        root.addEventListener(EVENT_AUTH_SIGN_IN, (event) => {
            const detail = /** @type {{ user?: { id?: string, email?: string|null, name?: string|null, pictureUrl?: string|null } }} */ (event?.detail ?? {});
            const user = detail?.user;
            if (!user || !user.id) {
                return;
            }
            if (this.authUser?.id === user.id || this.pendingSignInUserId === user.id) {
                return;
            }
            this.pendingSignInUserId = user.id;

            const applyGuestState = () => {
                this.authUser = null;
                this.authControls?.showSignedOut();
                this.avatarMenu?.setEnabled(false);
                this.avatarMenu?.close({ focusTrigger: false });
                GravityStore.setUserScope(null);
                this.initializeNotes();
                this.setGuestExportVisibility(true);
                this.authNonceToken = null;
                this.realtimeSync?.disconnect();
            };

            const applySignedInState = () => {
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
                this.setGuestExportVisibility(false);
            };

            const attemptSignIn = async () => {
                GravityStore.setUserScope(user.id);
                try {
                    const result = this.syncManager && typeof this.syncManager.handleSignIn === "function"
                        ? await this.syncManager.handleSignIn({
                            userId: user.id
                        })
                        : {
                            authenticated: true,
                            queueFlushed: false,
                            snapshotApplied: false
                        };
                    if (!result?.authenticated) {
                        applyGuestState();
                        this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                        return;
                    }
                    applySignedInState();
                    this.realtimeSync?.connect({
                        baseUrl: appConfig.backendBaseUrl
                    });
                } catch (error) {
                    logging.error(error);
                    applyGuestState();
                    this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                } finally {
                    if (this.pendingSignInUserId === user.id) {
                        this.pendingSignInUserId = null;
                    }
                }
            };

            void attemptSignIn();
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
            this.realtimeSync?.disconnect();
            if (typeof window !== "undefined" && this.syncIntervalHandle !== null) {
                window.clearInterval(this.syncIntervalHandle);
                this.syncIntervalHandle = null;
            }
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

        root.addEventListener(EVENT_SYNC_SNAPSHOT_APPLIED, () => {
            const refreshedRecords = GravityStore.loadAllNotes();
            initializeNotesState(refreshedRecords);
            this.renderNotes(refreshedRecords);
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

            const sortedRecords = Array.isArray(records) ? [...records] : [];
            sortedRecords.sort((a, b) => (b.lastActivityIso || "").localeCompare(a.lastActivityIso || ""));
            const pinnedRecords = sortedRecords.filter((record) => record.pinned === true);
            const unpinnedRecords = sortedRecords.filter((record) => record.pinned !== true);
            const orderedRecords = [...pinnedRecords, ...unpinnedRecords];
            const signature = createRenderSignature(orderedRecords);
            if (this.lastRenderedSignature === signature) {
                return;
            }

            /** @type {Map<string, HTMLElement>} */
            const existingCards = new Map();
            for (const element of container.querySelectorAll(".markdown-block[data-note-id]")) {
                if (!(element instanceof HTMLElement)) continue;
                const noteId = element.getAttribute("data-note-id");
                if (typeof noteId === "string" && noteId.length > 0) {
                    existingCards.set(noteId, element);
                }
            }

            const desiredOrder = [];

            for (const record of orderedRecords) {
                const noteId = record.noteId;
                const existingCard = existingCards.get(noteId);
                const isEditing = existingCard?.classList?.contains("editing-in-place") ?? false;

                if (existingCard && isEditing) {
                    existingCard.dataset.pinned = record.pinned ? "true" : "false";
                    if (typeof record.createdAtIso === "string") existingCard.dataset.createdAtIso = record.createdAtIso;
                    if (typeof record.updatedAtIso === "string") existingCard.dataset.updatedAtIso = record.updatedAtIso;
                    if (typeof record.lastActivityIso === "string") existingCard.dataset.lastActivityIso = record.lastActivityIso;
                    desiredOrder.push(existingCard);
                    existingCards.delete(noteId);
                    continue;
                }

                const freshCard = renderCard(record, { notesContainer: container });
                desiredOrder.push(freshCard);
                if (existingCard) {
                    existingCard.replaceWith(freshCard);
                    existingCards.delete(noteId);
                }
            }

            for (const leftover of existingCards.values()) {
                leftover.remove();
            }

            for (const card of desiredOrder) {
                container.appendChild(card);
            }

            updateActionButtons(container);
            this.lastRenderedSignature = signature;
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

/**
 * Create a deterministic signature representing the rendered note order and content.
 * @param {import("./types.d.js").NoteRecord[]} records
 * @returns {string}
 */
function createRenderSignature(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return "[]";
    }
    const summary = records.map((record) => {
        const contentHash = hashString(typeof record?.markdownText === "string" ? record.markdownText : "");
        const attachmentsFingerprint = stableStringify(record?.attachments ?? {});
        const classificationFingerprint = stableStringify(record?.classification ?? null);
        return {
            id: typeof record?.noteId === "string" ? record.noteId : "",
            updatedAt: typeof record?.updatedAtIso === "string" ? record.updatedAtIso : "",
            lastActivity: typeof record?.lastActivityIso === "string" ? record.lastActivityIso : "",
            pinned: record?.pinned === true,
            contentHash,
            attachmentsHash: hashString(attachmentsFingerprint),
            classification: classificationFingerprint
        };
    });
    return JSON.stringify(summary);
}

/**
 * Convert a value into a canonical JSON string for comparison.
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
    const canonical = canonicalizeForSignature(value);
    return JSON.stringify(canonical);
}

/**
 * Recursively sort object keys and normalise primitive fallbacks.
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalizeForSignature(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalizeForSignature);
    }
    if (value && typeof value === "object") {
        const sortedKeys = Object.keys(value).sort();
        const result = {};
        for (const key of sortedKeys) {
            result[key] = canonicalizeForSignature(value[key]);
        }
        return result;
    }
    if (typeof value === "undefined") {
        return null;
    }
    return value;
}

/**
 * Generate a stable hash for textual content.
 * @param {string} value
 * @returns {number}
 */
function hashString(value) {
    if (typeof value !== "string" || value.length === 0) {
        return 0;
    }
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
}
