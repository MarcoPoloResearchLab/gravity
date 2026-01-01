// @ts-check

import { ENVIRONMENT_CONFIG } from "./environmentConfig.js?build=2026-01-01T21:20:40Z";

const TIMEZONE_DEFAULT = "America/Los_Angeles";
const DEFAULT_PRIVACY = "private";
const STORAGE_KEY = "gravityNotesData";
const STORAGE_KEY_USER_PREFIX = "gravityNotesData:user";
const GOOGLE_CLIENT_ID = "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com";

const STATIC_APP_CONFIG = Object.freeze({
    timezone: TIMEZONE_DEFAULT,
    classificationTimeoutMs: 5000,
    defaultPrivacy: DEFAULT_PRIVACY,
    storageKey: STORAGE_KEY,
    storageKeyUserPrefix: STORAGE_KEY_USER_PREFIX,
    googleClientId: GOOGLE_CLIENT_ID
});

const EMPTY_RUNTIME_CONFIG = Object.freeze({
    environment: undefined,
    backendBaseUrl: undefined,
    llmProxyUrl: undefined,
    authBaseUrl: undefined,
    authTenantId: undefined
});

export let appConfig = Object.freeze({
    ...STATIC_APP_CONFIG,
    ...EMPTY_RUNTIME_CONFIG
});

/**
 * Inject the runtime configuration that downstream modules will consume.
 * @param {{ environment: "production" | "development", backendBaseUrl?: string|null, llmProxyUrl?: string|null, authBaseUrl?: string|null, authTenantId?: string|null }} config
 * @returns {void}
 */
export function setRuntimeConfig(config) {
    const environment = config.environment;
    const environmentDefaults = ENVIRONMENT_CONFIG[environment];

    const backendBaseUrl = config.backendBaseUrl ?? environmentDefaults.backendBaseUrl;
    const llmProxyUrl = config.llmProxyUrl ?? environmentDefaults.llmProxyUrl;
    const authBaseUrl = config.authBaseUrl ?? environmentDefaults.authBaseUrl;
    const authTenantId = config.authTenantId ?? environmentDefaults.authTenantId;

    appConfig = Object.freeze({
        ...STATIC_APP_CONFIG,
        environment,
        backendBaseUrl,
        llmProxyUrl,
        authBaseUrl,
        authTenantId
    });
}

/**
 * Reset stored runtime config (testing only).
 * @returns {void}
 */
export function clearRuntimeConfigForTesting() {
    appConfig = Object.freeze({
        ...STATIC_APP_CONFIG,
        ...EMPTY_RUNTIME_CONFIG
    });
}
