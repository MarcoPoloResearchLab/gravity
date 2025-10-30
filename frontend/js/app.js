/* global marked */
// @ts-check

import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js";

import { renderCard, updateActionButtons, insertCardRespectingPinned } from "./ui/card.js?build=2024-10-05T12:00:00Z";
import { initializeImportExport } from "./ui/importExport.js?build=2024-10-05T12:00:00Z";
import { GravityStore } from "./core/store.js?build=2024-10-05T12:00:00Z";
import { appConfig } from "./core/config.js?build=2024-10-05T12:00:00Z";
import { initializeRuntimeConfig } from "./core/runtimeConfig.js?build=2024-10-05T12:00:00Z";
import { createGoogleIdentityController, isGoogleIdentitySupportedOrigin } from "./core/auth.js?build=2024-10-05T12:00:00Z";
import { initializeAnalytics } from "./core/analytics.js?build=2024-10-05T12:00:00Z";
import { createSyncManager } from "./core/syncManager.js?build=2024-10-05T12:00:00Z";
import { createRealtimeSyncController } from "./core/realtimeSyncController.js?build=2024-10-05T12:00:00Z";
import {
    loadAuthState,
    saveAuthState,
    clearAuthState,
    isAuthStateFresh,
    hasActiveAuthenticationSession
} from "./core/authState.js?build=2024-10-05T12:00:00Z";
import { mountTopEditor } from "./ui/topEditor.js?build=2024-10-05T12:00:00Z";
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
    EVENT_SYNC_SNAPSHOT_APPLIED,
    MESSAGE_NOTES_IMPORTED,
    MESSAGE_NOTES_SKIPPED,
    MESSAGE_NOTES_IMPORT_FAILED,
    APP_BUILD_ID
} from "./constants.js?build=2024-10-05T12:00:00Z";
import { initializeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal.js?build=2024-10-05T12:00:00Z";
import { initializeNotesState } from "./ui/notesState.js?build=2024-10-05T12:00:00Z";
import { showSaveFeedback } from "./ui/saveFeedback.js?build=2024-10-05T12:00:00Z";
import { initializeAuthControls } from "./ui/authControls.js?build=2024-10-05T12:00:00Z";
import { createAvatarMenu } from "./ui/menu/avatarMenu.js?build=2024-10-05T12:00:00Z";
import { initializeFullScreenToggle } from "./ui/fullScreenToggle.js?build=2024-10-05T12:00:00Z";
import { initializeVersionRefresh } from "./utils/versionRefresh.js?build=2024-10-05T12:00:00Z";
import { logging } from "./utils/logging.js?build=2024-10-05T12:00:00Z";

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
        authController: /** @type {{ signOut(reason?: string): void, dispose(): void }|null} */ (null),
        authUser: /** @type {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }|null} */ (null),
        authPollHandle: /** @type {number|null} */ (null),
        cachedPersistedAuthState: /** @type {ReturnType<typeof loadAuthState>|null|undefined} */ (undefined),
        guestExportButton: /** @type {HTMLButtonElement|null} */ (null),
        syncManager: /** @type {ReturnType<typeof createSyncManager>|null} */ (null),
        realtimeSync: /** @type {{ connect(params: { baseUrl: string, accessToken: string, expiresAtMs?: number|null }): void, disconnect(): void, dispose(): void }|null} */ (null),
        syncIntervalHandle: /** @type {number|null} */ (null),
        backendAccessToken: /** @type {string|null} */ (null),
        backendAccessTokenExpiresAtMs: /** @type {number|null} */ (null),
        latestCredential: /** @type {string|null} */ (null),
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
            this.initializeAuth();
            this.initializeTopEditor();
            this.initializeImportExport();
            this.syncManager = createSyncManager({
                eventTarget: this.$el ?? null,
                onBackendTokenRefreshed: (token) => {
                    this.handleBackendTokenRefresh(token);
                }
            });
            this.realtimeSync = createRealtimeSyncController({ syncManager: this.syncManager });

            const persistedAuthState = loadAuthState();
            if (persistedAuthState && persistedAuthState.user && typeof persistedAuthState.user.id === "string" && persistedAuthState.user.id.length > 0) {
                this.cachedPersistedAuthState = persistedAuthState;
                GravityStore.setUserScope(persistedAuthState.user.id);
            } else {
                GravityStore.setUserScope(null);
            }

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
            const restored = this.restoreAuthFromStorage();
            if (!restored) {
                GravityStore.setUserScope(null);
                this.initializeNotes();
                this.setGuestExportVisibility(true);
            }
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
         * Handle backend token refreshes bubbling up from the sync manager.
         * @param {{ accessToken: string, expiresAtMs: number }} token
         * @returns {void}
         */
        handleBackendTokenRefresh(token) {
            if (!token || typeof token.accessToken !== "string" || token.accessToken.length === 0) {
                return;
            }
            if (!hasActiveAuthenticationSession(this.authUser, this.latestCredential)) {
                return;
            }
            this.backendAccessToken = token.accessToken;
            this.backendAccessTokenExpiresAtMs = typeof token.expiresAtMs === "number" && Number.isFinite(token.expiresAtMs)
                ? token.expiresAtMs
                : null;
            this.persistAuthState();
            this.realtimeSync?.connect({
                baseUrl: appConfig.backendBaseUrl,
                accessToken: this.backendAccessToken,
                expiresAtMs: this.backendAccessTokenExpiresAtMs ?? undefined
            });
        },

        /**
         * Persist the active authentication state to storage.
         * @returns {void}
         */
        persistAuthState() {
            if (!this.authUser || typeof this.latestCredential !== "string" || this.latestCredential.length === 0) {
                return;
            }
            saveAuthState({
                user: {
                    id: this.authUser.id,
                    email: this.authUser.email,
                    name: this.authUser.name,
                    pictureUrl: this.authUser.pictureUrl
                },
                credential: this.latestCredential,
                backendAccessToken: typeof this.backendAccessToken === "string" ? this.backendAccessToken : null,
                backendAccessTokenExpiresAtMs: typeof this.backendAccessTokenExpiresAtMs === "number"
                    ? this.backendAccessTokenExpiresAtMs
                    : null
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
         * Attempt to rehydrate authentication from storage.
         * @returns {boolean}
         */
        restoreAuthFromStorage() {
            const cachedState = this.cachedPersistedAuthState;
            const persisted = typeof cachedState === "undefined" ? loadAuthState() : cachedState;
            this.cachedPersistedAuthState = undefined;
            if (!persisted || !persisted.user || typeof persisted.user.id !== "string" || persisted.user.id.length === 0) {
                if (persisted) {
                    clearAuthState();
                }
                return false;
            }
            if (typeof persisted.credential !== "string" || persisted.credential.length === 0) {
                if (persisted) {
                    clearAuthState();
                }
                return false;
            }
            if (!isAuthStateFresh(persisted)) {
                clearAuthState();
                return false;
            }
            const target = this.$el instanceof HTMLElement ? this.$el : document.body;
            if (!target) {
                return false;
            }
            try {
                target.dispatchEvent(new CustomEvent(EVENT_AUTH_SIGN_IN, {
                    detail: {
                        user: persisted.user,
                        credential: persisted.credential,
                        restored: true,
                        backendAccessToken: typeof persisted.backendAccessToken === "string" ? persisted.backendAccessToken : null,
                        backendAccessTokenExpiresAtMs: typeof persisted.backendAccessTokenExpiresAtMs === "number"
                            ? persisted.backendAccessTokenExpiresAtMs
                            : null
                    }
                }));
                return true;
            } catch (error) {
                logging.error(error);
                return false;
            }
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

            let persistedAuthState = this.cachedPersistedAuthState;
            if (typeof persistedAuthState === "undefined") {
                persistedAuthState = loadAuthState();
            }
            this.cachedPersistedAuthState = persistedAuthState ?? null;
            const shouldAutoPrompt = !(persistedAuthState && isAuthStateFresh(persistedAuthState));

            const buttonHost = this.authControls?.getButtonHost() ?? null;
            this.authController = createGoogleIdentityController({
                clientId: appConfig.googleClientId,
                google,
                buttonElement: buttonHost ?? undefined,
                eventTarget: this.$el,
                autoPrompt: shouldAutoPrompt
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
            if (this.authController) {
                this.realtimeSync?.disconnect();
                this.authController.signOut("manual");
            } else {
                this.authControls?.showSignedOut();
                this.avatarMenu?.setEnabled(false);
                GravityStore.setUserScope(null);
                this.initializeNotes();
                this.realtimeSync?.disconnect();
            }
            this.cachedPersistedAuthState = undefined;
            this.backendAccessToken = null;
            this.backendAccessTokenExpiresAtMs = null;
            this.latestCredential = null;
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
            const detail = /** @type {{ user?: { id?: string, email?: string|null, name?: string|null, pictureUrl?: string|null }, credential?: string, restored?: boolean, backendAccessToken?: string|null, backendAccessTokenExpiresAtMs?: number|null }} */ (event?.detail ?? {});
            const user = detail?.user;
            if (!user || !user.id) {
                return;
            }
            const credential = typeof detail?.credential === "string" ? detail.credential : "";
            if (credential.length > 0) {
                this.latestCredential = credential;
            }
            const providedBackendToken = typeof detail?.backendAccessToken === "string" && detail.backendAccessToken.length > 0
                ? detail.backendAccessToken
                : null;
            const providedBackendTokenExpiresAtMs = typeof detail?.backendAccessTokenExpiresAtMs === "number"
                && Number.isFinite(detail.backendAccessTokenExpiresAtMs)
                ? detail.backendAccessTokenExpiresAtMs
                : null;
            this.backendAccessToken = providedBackendToken;
            this.backendAccessTokenExpiresAtMs = providedBackendTokenExpiresAtMs;

            const applyGuestState = () => {
                this.authUser = null;
                this.authControls?.showSignedOut();
                this.avatarMenu?.setEnabled(false);
                this.avatarMenu?.close({ focusTrigger: false });
                GravityStore.setUserScope(null);
                this.initializeNotes();
                this.setGuestExportVisibility(true);
                this.backendAccessToken = null;
                this.backendAccessTokenExpiresAtMs = null;
                this.latestCredential = null;
                clearAuthState();
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
                this.persistAuthState();
            };

            const syncManager = this.syncManager;
            const attemptSignIn = async () => {
                const backendTokenHint = typeof this.backendAccessToken === "string"
                    && this.backendAccessToken.length > 0
                    && typeof this.backendAccessTokenExpiresAtMs === "number"
                    && Number.isFinite(this.backendAccessTokenExpiresAtMs)
                    ? {
                        accessToken: this.backendAccessToken,
                        expiresAtMs: this.backendAccessTokenExpiresAtMs
                    }
                    : null;
                if (!credential && !backendTokenHint) {
                    applyGuestState();
                    this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                    return;
                }
                GravityStore.setUserScope(user.id);
                try {
                    const result = syncManager && typeof syncManager.handleSignIn === "function"
                        ? await syncManager.handleSignIn({
                            userId: user.id,
                            credential,
                            backendToken: backendTokenHint ?? undefined
                        })
                        : {
                            authenticated: true,
                            queueFlushed: false,
                            snapshotApplied: false,
                            accessToken: backendTokenHint ? backendTokenHint.accessToken : null,
                            accessTokenExpiresAtMs: backendTokenHint ? backendTokenHint.expiresAtMs : null
                        };
                    if (!result?.authenticated) {
                        applyGuestState();
                        this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
                        return;
                    }
                    if (typeof result.accessToken === "string" && result.accessToken.length > 0) {
                        this.backendAccessToken = result.accessToken;
                    }
                    if (typeof result.accessTokenExpiresAtMs === "number" && Number.isFinite(result.accessTokenExpiresAtMs)) {
                        this.backendAccessTokenExpiresAtMs = result.accessTokenExpiresAtMs;
                    }
                    applySignedInState();
                    const accessToken = typeof this.backendAccessToken === "string" && this.backendAccessToken.length > 0
                        ? this.backendAccessToken
                        : "";
                    if (accessToken) {
                        const accessTokenExpiresAtMs = typeof result.accessTokenExpiresAtMs === "number"
                            && Number.isFinite(result.accessTokenExpiresAtMs)
                            ? result.accessTokenExpiresAtMs
                            : null;
                        this.realtimeSync?.connect({
                            baseUrl: appConfig.backendBaseUrl,
                            accessToken,
                            expiresAtMs: accessTokenExpiresAtMs ?? undefined
                        });
                    } else {
                        this.realtimeSync?.disconnect();
                    }
                } catch (error) {
                    logging.error(error);
                    applyGuestState();
                    this.authControls?.showError(ERROR_AUTHENTICATION_GENERIC);
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
            clearAuthState();
            this.realtimeSync?.disconnect();
            this.cachedPersistedAuthState = undefined;
            this.backendAccessToken = null;
            this.backendAccessTokenExpiresAtMs = null;
            this.latestCredential = null;
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
