/* global marked */
// @ts-check

import Alpine from "https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/module.esm.js";

import { renderCard, updateActionButtons } from "./ui/card.js?build=2026-01-01T22:43:21Z";
import { createAttachmentSignature } from "./ui/card/renderPipeline.js?build=2026-01-01T22:43:21Z";
import { initializeImportExport } from "./ui/importExport.js?build=2026-01-01T22:43:21Z";
import { GravityStore } from "./core/store.js?build=2026-01-01T22:43:21Z";
import { initializeRuntimeConfig } from "./core/runtimeConfig.js?build=2026-01-01T22:43:21Z";
import { initializeAnalytics } from "./core/analytics.js?build=2026-01-01T22:43:21Z";
import { createSyncManager } from "./core/syncManager.js?build=2026-01-01T22:43:21Z";
import { createRealtimeSyncController } from "./core/realtimeSyncController.js?build=2026-01-01T22:43:21Z";
import { ensureTAuthClientLoaded } from "./core/tauthClient.js?build=2026-01-01T22:43:21Z";
import { mountTopEditor } from "./ui/topEditor.js?build=2026-01-01T22:43:21Z";
import {
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_ENTER_FULL_SCREEN,
    LABEL_LANDING_TITLE,
    LABEL_LANDING_DESCRIPTION,
    LABEL_LANDING_SIGN_IN_HINT,
    LABEL_LANDING_STATUS_LOADING,
    LABEL_SIGN_IN_WITH_GOOGLE,
    LABEL_SIGN_OUT,
    ERROR_NOTES_CONTAINER_NOT_FOUND,
    ERROR_AUTHENTICATION_GENERIC,
    EVENT_NOTE_CREATE,
    EVENT_NOTE_UPDATE,
    EVENT_NOTE_DELETE,
    EVENT_NOTE_PIN_TOGGLE,
    EVENT_NOTES_IMPORTED,
    EVENT_NOTIFICATION_REQUEST,
    EVENT_AUTH_SIGN_OUT_REQUEST,
    EVENT_MPR_AUTH_AUTHENTICATED,
    EVENT_MPR_AUTH_UNAUTHENTICATED,
    EVENT_MPR_AUTH_ERROR,
    EVENT_MPR_USER_MENU_ITEM,
    EVENT_SYNC_SNAPSHOT_APPLIED,
    MESSAGE_NOTES_IMPORTED,
    MESSAGE_NOTES_SKIPPED,
    MESSAGE_NOTES_IMPORT_FAILED,
    APP_BUILD_ID
} from "./constants.js?build=2026-01-01T22:43:21Z";
import { initializeKeyboardShortcutsModal } from "./ui/keyboardShortcutsModal.js?build=2026-01-01T22:43:21Z";
import { initializeNotesState } from "./ui/notesState.js?build=2026-01-01T22:43:21Z";
import { showSaveFeedback } from "./ui/saveFeedback.js?build=2026-01-01T22:43:21Z";
import { initializeFullScreenToggle } from "./ui/fullScreenToggle.js?build=2026-01-01T22:43:21Z";
import { initializeVersionRefresh } from "./utils/versionRefresh.js?build=2026-01-01T22:43:21Z";
import { logging } from "./utils/logging.js?build=2026-01-01T22:43:21Z";

const CONSTANTS_VIEW_MODEL = Object.freeze({
    LABEL_APP_SUBTITLE,
    LABEL_APP_TITLE,
    LABEL_EXPORT_NOTES,
    LABEL_IMPORT_NOTES,
    LABEL_ENTER_FULL_SCREEN,
    LABEL_LANDING_TITLE,
    LABEL_LANDING_DESCRIPTION,
    LABEL_LANDING_SIGN_IN_HINT
});

const AUTH_STATE_LOADING = "loading";
const AUTH_STATE_AUTHENTICATED = "authenticated";
const AUTH_STATE_UNAUTHENTICATED = "unauthenticated";
const USER_MENU_ACTION_EXPORT = "export-notes";
const USER_MENU_ACTION_IMPORT = "import-notes";
const TAUTH_LOGIN_PATH = "/auth/google";
const TAUTH_LOGOUT_PATH = "/auth/logout";
const TAUTH_NONCE_PATH = "/auth/nonce";
const TYPE_STRING = "string";
const LANDING_LOGIN_ELEMENT_ID = "landing-login";
const LANDING_LOGIN_TEMPLATE_ID = "landing-login-template";
const LANDING_LOGIN_SLOT_ID = "landing-login-slot";
const USER_MENU_ELEMENT_ID = "app-user-menu";
const USER_MENU_TEMPLATE_ID = "user-menu-template";
const USER_MENU_SLOT_ID = "user-menu-slot";

const PROFILE_KEYS = Object.freeze({
    USER_ID: "user_id",
    USER_EMAIL: "user_email",
    DISPLAY: "display",
    USER_DISPLAY: "user_display",
    USER_DISPLAY_NAME: "user_display_name",
    AVATAR_URL: "avatar_url",
    USER_AVATAR_URL: "user_avatar_url"
});

const PROFILE_NAME_KEYS = Object.freeze([
    PROFILE_KEYS.DISPLAY,
    PROFILE_KEYS.USER_DISPLAY,
    PROFILE_KEYS.USER_DISPLAY_NAME
]);

const PROFILE_AVATAR_KEYS = Object.freeze([
    PROFILE_KEYS.AVATAR_URL,
    PROFILE_KEYS.USER_AVATAR_URL
]);

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
    const appConfig = await initializeRuntimeConfig();
    await ensureTAuthClientLoaded({
        baseUrl: appConfig.authBaseUrl,
        tenantId: appConfig.authTenantId
    }).catch((error) => {
        logging.error("TAuth client failed to load", error);
    });
    configureAuthElements(appConfig);
    initializeAnalytics({ config: appConfig });
    document.addEventListener("alpine:init", () => {
        Alpine.data("gravityApp", () => gravityApp(appConfig));
    });
    window.Alpine = Alpine;
    Alpine.start();
}

/**
 * Apply runtime auth configuration to mpr-ui elements.
 * @param {import("./core/config.js").AppConfig} appConfig
 * @returns {void}
 */
function configureAuthElements(appConfig) {
    if (typeof document === "undefined") {
        return;
    }
    ensureAuthElementMounted(
        LANDING_LOGIN_ELEMENT_ID,
        LANDING_LOGIN_TEMPLATE_ID,
        LANDING_LOGIN_SLOT_ID,
        (loginButton) => {
            loginButton.setAttribute("site-id", appConfig.googleClientId);
            loginButton.setAttribute("tauth-tenant-id", appConfig.authTenantId);
            loginButton.setAttribute("tauth-url", appConfig.authBaseUrl);
            loginButton.setAttribute("tauth-login-path", TAUTH_LOGIN_PATH);
            loginButton.setAttribute("tauth-logout-path", TAUTH_LOGOUT_PATH);
            loginButton.setAttribute("tauth-nonce-path", TAUTH_NONCE_PATH);
            loginButton.setAttribute("base-url", appConfig.authBaseUrl);
            loginButton.setAttribute("login-path", TAUTH_LOGIN_PATH);
            loginButton.setAttribute("logout-path", TAUTH_LOGOUT_PATH);
            loginButton.setAttribute("nonce-path", TAUTH_NONCE_PATH);
            loginButton.setAttribute("button-text", LABEL_SIGN_IN_WITH_GOOGLE);
        }
    );

    ensureAuthElementMounted(
        USER_MENU_ELEMENT_ID,
        USER_MENU_TEMPLATE_ID,
        USER_MENU_SLOT_ID,
        (userMenu) => {
            userMenu.setAttribute("display-mode", "avatar-name");
            userMenu.setAttribute("logout-url", resolveLogoutUrl());
            userMenu.setAttribute("logout-label", LABEL_SIGN_OUT);
            userMenu.setAttribute("tauth-tenant-id", appConfig.authTenantId);
        }
    );
}

/**
 * @param {string} elementId
 * @param {string} templateId
 * @param {string} slotId
 * @param {(element: HTMLElement) => void} applyAttributes
 * @returns {HTMLElement|null}
 */
function ensureAuthElementMounted(elementId, templateId, slotId, applyAttributes) {
    if (typeof document === "undefined") {
        return null;
    }
    const existing = document.getElementById(elementId);
    if (existing instanceof HTMLElement) {
        applyAttributes(existing);
        return existing;
    }
    const template = document.getElementById(templateId);
    const slot = document.getElementById(slotId);
    if (!(template instanceof HTMLTemplateElement) || !(slot instanceof HTMLElement)) {
        return null;
    }
    const fragment = template.content.cloneNode(true);
    const staged = fragment.querySelector(`#${elementId}`);
    if (!(staged instanceof HTMLElement)) {
        return null;
    }
    applyAttributes(staged);
    slot.appendChild(fragment);
    return staged;
}

/**
 * Resolve the redirect URL used after a TAuth logout.
 * @returns {string}
 */
function resolveLogoutUrl() {
    if (typeof window === "undefined") {
        return "/";
    }
    if (window.location.protocol === "file:") {
        return window.location.pathname || "/";
    }
    return window.location.href;
}

/**
 * Alpine root component that wires the Gravity Notes application.
 * @returns {import("alpinejs").AlpineComponent}
 */
function gravityApp(appConfig) {
    return {
        constants: CONSTANTS_VIEW_MODEL,
        landingView: /** @type {HTMLElement|null} */ (null),
        landingStatus: /** @type {HTMLElement|null} */ (null),
        landingLogin: /** @type {HTMLElement|null} */ (null),
        appShell: /** @type {HTMLElement|null} */ (null),
        userMenu: /** @type {HTMLElement|null} */ (null),
        authState: AUTH_STATE_LOADING,
        notesContainer: /** @type {HTMLElement|null} */ (null),
        exportButton: /** @type {HTMLButtonElement|null} */ (null),
        importButton: /** @type {HTMLButtonElement|null} */ (null),
        importInput: /** @type {HTMLInputElement|null} */ (null),
        authUser: /** @type {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }|null} */ (null),
        pendingSignInUserId: /** @type {string|null} */ (null),
        syncManager: /** @type {ReturnType<typeof createSyncManager>|null} */ (null),
        realtimeSync: /** @type {{ connect(params: { baseUrl: string }): void, disconnect(): void, dispose(): void }|null} */ (null),
        syncIntervalHandle: /** @type {number|null} */ (null),
        lastRenderedSignature: /** @type {string|null} */ (null),
        fullScreenToggleController: /** @type {{ dispose(): void }|null} */ (null),
        versionRefreshController: /** @type {{ dispose(): void, checkNow(): Promise<{ reloaded: boolean, remoteVersion: string|null }> }|null} */ (null),

        init() {
            this.landingView = this.$refs.landingView ?? document.querySelector("[data-test=\"landing\"]");
            this.landingStatus = this.$refs.landingStatus ?? document.querySelector("[data-test=\"landing-status\"]");
            this.landingLogin = this.$refs.landingLogin ?? document.querySelector("[data-test=\"landing-login\"]");
            this.appShell = this.$refs.appShell ?? document.querySelector("[data-test=\"app-shell\"]");
            this.userMenu = this.$refs.userMenu ?? document.querySelector("[data-test=\"user-menu\"]");

            this.notesContainer = this.$refs.notesContainer ?? document.getElementById("notes-container");
            if (!(this.notesContainer instanceof HTMLElement)) {
                throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
            }

            this.exportButton = /** @type {HTMLButtonElement|null} */ (this.$refs.exportButton ?? document.getElementById("export-notes-button"));
            this.importButton = /** @type {HTMLButtonElement|null} */ (this.$refs.importButton ?? document.getElementById("import-notes-button"));
            this.importInput = /** @type {HTMLInputElement|null} */ (this.$refs.importInput ?? document.getElementById("import-notes-input"));
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
            this.initializeTopEditor();
            this.initializeImportExport();
            this.syncManager = createSyncManager({
                backendBaseUrl: appConfig.backendBaseUrl,
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
            this.setAuthState(AUTH_STATE_LOADING);
            this.setLandingStatus(LABEL_LANDING_STATUS_LOADING, "loading");
            this.updateUserMenuItems();
            void this.bootstrapAuthState();
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

        setAuthState(nextState) {
            this.authState = nextState;
            const landing = this.landingView;
            const shell = this.appShell;
            if (nextState === AUTH_STATE_AUTHENTICATED) {
                if (landing) {
                    landing.hidden = true;
                    landing.setAttribute("aria-hidden", "true");
                }
                if (shell) {
                    shell.hidden = false;
                    shell.setAttribute("aria-hidden", "false");
                }
            } else {
                if (landing) {
                    landing.hidden = false;
                    landing.setAttribute("aria-hidden", "false");
                }
                if (shell) {
                    shell.hidden = true;
                    shell.setAttribute("aria-hidden", "true");
                }
            }
            if (typeof document !== "undefined") {
                document.body.dataset.authState = nextState;
            }
        },

        setLandingStatus(message, status) {
            const statusElement = this.landingStatus;
            if (!statusElement) {
                return;
            }
            if (typeof message === "string" && message.length > 0) {
                statusElement.hidden = false;
                statusElement.textContent = message;
                statusElement.dataset.status = status;
                statusElement.setAttribute("aria-hidden", "false");
            } else {
                statusElement.hidden = true;
                statusElement.textContent = "";
                statusElement.setAttribute("aria-hidden", "true");
                delete statusElement.dataset.status;
            }
        },

        clearLandingStatus() {
            this.setLandingStatus("", "");
        },

        updateUserMenuItems() {
            const menu = this.userMenu;
            if (!(menu instanceof HTMLElement)) {
                return;
            }
            const items = [
                { label: LABEL_EXPORT_NOTES, action: USER_MENU_ACTION_EXPORT },
                { label: LABEL_IMPORT_NOTES, action: USER_MENU_ACTION_IMPORT }
            ];
            menu.setAttribute("menu-items", JSON.stringify(items));
        },

        handleUserMenuAction(action) {
            if (action === USER_MENU_ACTION_EXPORT) {
                this.exportButton?.click();
                return;
            }
            if (action === USER_MENU_ACTION_IMPORT) {
                this.importButton?.click();
            }
        },

        async handleAuthAuthenticated(profile) {
            const normalizedUser = normalizeAuthProfile(profile);
            if (!normalizedUser || !normalizedUser.id) {
                this.setLandingStatus(ERROR_AUTHENTICATION_GENERIC, "error");
                this.setAuthState(AUTH_STATE_UNAUTHENTICATED);
                return;
            }
            if (this.authUser?.id === normalizedUser.id || this.pendingSignInUserId === normalizedUser.id) {
                return;
            }
            this.pendingSignInUserId = normalizedUser.id;

            const applySignedInState = () => {
                this.authUser = normalizedUser;
                this.clearLandingStatus();
                this.setAuthState(AUTH_STATE_AUTHENTICATED);
                GravityStore.setUserScope(normalizedUser.id);
                this.initializeNotes();
                this.realtimeSync?.connect({
                    baseUrl: appConfig.backendBaseUrl
                });
                if (typeof window !== "undefined" && this.syncIntervalHandle === null) {
                    this.syncIntervalHandle = window.setInterval(() => {
                        void this.syncManager?.synchronize({ flushQueue: false });
                    }, 3000);
                }
            };

            const applySignedOutState = () => {
                this.authUser = null;
                this.setAuthState(AUTH_STATE_UNAUTHENTICATED);
                GravityStore.setUserScope(null);
                this.initializeNotes();
                this.syncManager?.handleSignOut();
                this.realtimeSync?.disconnect();
            };

            try {
                GravityStore.setUserScope(normalizedUser.id);
                const result = this.syncManager && typeof this.syncManager.handleSignIn === "function"
                    ? await this.syncManager.handleSignIn({ userId: normalizedUser.id })
                    : { authenticated: true, queueFlushed: false, snapshotApplied: false };
                if (!result?.authenticated) {
                    applySignedOutState();
                    this.setLandingStatus(ERROR_AUTHENTICATION_GENERIC, "error");
                    return;
                }
                applySignedInState();
            } catch (error) {
                logging.error(error);
                applySignedOutState();
                this.setLandingStatus(ERROR_AUTHENTICATION_GENERIC, "error");
            } finally {
                if (this.pendingSignInUserId === normalizedUser.id) {
                    this.pendingSignInUserId = null;
                }
            }
        },

        handleAuthUnauthenticated() {
            this.authUser = null;
            this.pendingSignInUserId = null;
            this.setAuthState(AUTH_STATE_UNAUTHENTICATED);
            const statusElement = this.landingStatus;
            const shouldPreserveError = Boolean(statusElement && statusElement.dataset.status === "error");
            if (!shouldPreserveError) {
                this.clearLandingStatus();
            }
            GravityStore.setUserScope(null);
            this.initializeNotes();
            this.syncManager?.handleSignOut();
            this.realtimeSync?.disconnect();
            if (typeof window !== "undefined" && this.syncIntervalHandle !== null) {
                window.clearInterval(this.syncIntervalHandle);
                this.syncIntervalHandle = null;
            }
        },

        handleAuthError(detail) {
            if (this.authState === AUTH_STATE_AUTHENTICATED) {
                return;
            }
            const errorMessage = ERROR_AUTHENTICATION_GENERIC;
            if (detail?.code) {
                logging.warn("Auth error reported by mpr-ui", detail);
            }
            this.setAuthState(AUTH_STATE_UNAUTHENTICATED);
            this.setLandingStatus(errorMessage, "error");
        },

        handleAuthSignOutRequest(reason = "manual") {
            void reason;
            this.handleAuthUnauthenticated();
            if (typeof window !== "undefined" && typeof window.logout === "function") {
                window.logout().catch((error) => {
                    logging.error("TAuth logout failed", error);
                });
            }
        },

        async bootstrapAuthState() {
            if (this.authState !== AUTH_STATE_LOADING) {
                return;
            }
            if (typeof window === "undefined" || typeof window.getCurrentUser !== "function") {
                this.handleAuthUnauthenticated();
                return;
            }
            try {
                const profile = await window.getCurrentUser();
                if (this.authState !== AUTH_STATE_LOADING) {
                    return;
                }
                if (profile) {
                    await this.handleAuthAuthenticated(profile);
                    return;
                }
            } catch (error) {
                logging.error("Auth bootstrap failed", error);
            }
            if (this.authState === AUTH_STATE_LOADING) {
                this.handleAuthUnauthenticated();
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

            root.addEventListener(EVENT_MPR_AUTH_AUTHENTICATED, (event) => {
                const detail = /** @type {{ profile?: unknown }} */ (event?.detail ?? {});
                void this.handleAuthAuthenticated(detail.profile ?? null);
            });

            root.addEventListener(EVENT_MPR_AUTH_UNAUTHENTICATED, () => {
                this.handleAuthUnauthenticated();
            });

            root.addEventListener(EVENT_MPR_AUTH_ERROR, (event) => {
                const detail = /** @type {{ message?: unknown, code?: unknown }} */ (event?.detail ?? {});
                this.handleAuthError(detail);
            });

            root.addEventListener(EVENT_MPR_USER_MENU_ITEM, (event) => {
                const detail = /** @type {{ action?: string }} */ (event?.detail ?? {});
                const action = typeof detail.action === "string" ? detail.action : "";
                if (!action) {
                    return;
                }
                this.handleUserMenuAction(action);
            });

            root.addEventListener(EVENT_AUTH_SIGN_OUT_REQUEST, (event) => {
                const detail = /** @type {{ reason?: string }} */ (event?.detail ?? {});
                const reason = typeof detail.reason === "string" && detail.reason.length > 0
                    ? detail.reason
                    : "backend-unauthorized";
                this.handleAuthSignOutRequest(reason);
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
                const attachmentsSignature = createAttachmentSignature(record.attachments ?? {});

                if (existingCard && isEditing) {
                    existingCard.dataset.pinned = record.pinned ? "true" : "false";
                    if (typeof record.createdAtIso === "string") existingCard.dataset.createdAtIso = record.createdAtIso;
                    if (typeof record.updatedAtIso === "string") existingCard.dataset.updatedAtIso = record.updatedAtIso;
                    if (typeof record.lastActivityIso === "string") existingCard.dataset.lastActivityIso = record.lastActivityIso;
                    existingCard.dataset.attachmentsSignature = attachmentsSignature;
                    desiredOrder.push(existingCard);
                    existingCards.delete(noteId);
                    continue;
                }

                if (existingCard && canReuseRenderedCard(existingCard, record, attachmentsSignature)) {
                    applyRecordMetadata(existingCard, record, attachmentsSignature);
                    desiredOrder.push(existingCard);
                    existingCards.delete(noteId);
                    continue;
                }

                const freshCard = renderCard(record, { notesContainer: container, config: appConfig });
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
                notesContainer: container,
                config: appConfig
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
 * @param {HTMLElement} card
 * @returns {string}
 */
function readCardMarkdown(card) {
    const host = Reflect.get(card, "__markdownHost");
    if (host && typeof host.getValue === "function") {
        return host.getValue();
    }
    const textarea = card.querySelector(".markdown-editor");
    if (textarea instanceof HTMLTextAreaElement) {
        return textarea.value;
    }
    return typeof card.dataset.initialValue === "string" ? card.dataset.initialValue : "";
}

/**
 * @param {HTMLElement} card
 * @param {import("./types.d.js").NoteRecord} record
 * @param {string} attachmentsSignature
 * @returns {boolean}
 */
function canReuseRenderedCard(card, record, attachmentsSignature) {
    if (!(card instanceof HTMLElement)) {
        return false;
    }
    const currentMarkdown = readCardMarkdown(card);
    if (currentMarkdown !== record.markdownText) {
        return false;
    }
    const cardSignature = typeof card.dataset.attachmentsSignature === "string"
        ? card.dataset.attachmentsSignature
        : "";
    if (cardSignature !== attachmentsSignature) {
        return false;
    }
    const pinnedMatches = card.dataset.pinned === "true"
        ? record.pinned === true
        : record.pinned !== true;
    return pinnedMatches;
}

/**
 * @param {HTMLElement} card
 * @param {import("./types.d.js").NoteRecord} record
 * @param {string} attachmentsSignature
 * @returns {void}
 */
function applyRecordMetadata(card, record, attachmentsSignature) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    card.dataset.initialValue = record.markdownText;
    card.dataset.attachmentsSignature = attachmentsSignature;
    card.dataset.pinned = record.pinned === true ? "true" : "false";
    card.classList.toggle("markdown-block--pinned", record.pinned === true);
    if (typeof record.createdAtIso === "string") {
        card.dataset.createdAtIso = record.createdAtIso;
    }
    if (typeof record.updatedAtIso === "string") {
        card.dataset.updatedAtIso = record.updatedAtIso;
    }
    if (typeof record.lastActivityIso === "string") {
        card.dataset.lastActivityIso = record.lastActivityIso;
    }
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

/**
 * Normalize an auth profile payload into the Gravity auth shape.
 * @param {unknown} profile
 * @returns {{ id: string|null, email: string|null, name: string|null, pictureUrl: string|null }|null}
 */
function normalizeAuthProfile(profile) {
    if (!profile || typeof profile !== "object") {
        return null;
    }
    const record = /** @type {Record<string, unknown>} */ (profile);
    return {
        id: typeof record[PROFILE_KEYS.USER_ID] === TYPE_STRING ? record[PROFILE_KEYS.USER_ID] : null,
        email: typeof record[PROFILE_KEYS.USER_EMAIL] === TYPE_STRING ? record[PROFILE_KEYS.USER_EMAIL] : null,
        name: selectProfileString(record, PROFILE_NAME_KEYS),
        pictureUrl: selectProfileString(record, PROFILE_AVATAR_KEYS)
    };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string[]} keys
 * @returns {string|null}
 */
function selectProfileString(profile, keys) {
    for (const key of keys) {
        const value = profile[key];
        if (typeof value === TYPE_STRING && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}
