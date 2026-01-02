// @ts-check

import { ENVIRONMENT_CONFIG } from "./environmentConfig.js?build=2026-01-01T22:43:21Z";

const TYPE_OBJECT = "object";
const TYPE_STRING = "string";

const CONFIG_KEYS = Object.freeze({
    ENVIRONMENT: "environment",
    BACKEND_BASE_URL: "backendBaseUrl",
    LLM_PROXY_URL: "llmProxyUrl",
    AUTH_BASE_URL: "authBaseUrl",
    AUTH_TENANT_ID: "authTenantId"
});

const ERROR_MESSAGES = Object.freeze({
    INVALID_CONFIG: "app_config.invalid_config",
    INVALID_ENVIRONMENT: "app_config.invalid_environment",
    INVALID_BACKEND_BASE_URL: "app_config.invalid_backend_base_url",
    INVALID_LLM_PROXY_URL: "app_config.invalid_llm_proxy_url",
    INVALID_AUTH_BASE_URL: "app_config.invalid_auth_base_url",
    INVALID_AUTH_TENANT_ID: "app_config.invalid_auth_tenant_id"
});

export const TIMEZONE_DEFAULT = "America/Los_Angeles";
export const CLASSIFICATION_TIMEOUT_MS = 5000;
export const DEFAULT_PRIVACY = "private";
export const STORAGE_KEY = "gravityNotesData";
export const STORAGE_KEY_USER_PREFIX = "gravityNotesData:user";
export const GOOGLE_CLIENT_ID = "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com";

export const STATIC_APP_CONFIG = Object.freeze({
    timezone: TIMEZONE_DEFAULT,
    classificationTimeoutMs: CLASSIFICATION_TIMEOUT_MS,
    defaultPrivacy: DEFAULT_PRIVACY,
    storageKey: STORAGE_KEY,
    storageKeyUserPrefix: STORAGE_KEY_USER_PREFIX,
    googleClientId: GOOGLE_CLIENT_ID
});

/**
 * @typedef {{
 *   environment: "production" | "development",
 *   backendBaseUrl: string,
 *   llmProxyUrl: string,
 *   authBaseUrl: string,
 *   authTenantId: string,
 *   timezone: string,
 *   classificationTimeoutMs: number,
 *   defaultPrivacy: string,
 *   storageKey: string,
 *   storageKeyUserPrefix: string,
 *   googleClientId: string
 * }} AppConfig
 */

/**
 * @typedef {{
 *   environment: "production" | "development",
 *   backendBaseUrl?: string,
 *   llmProxyUrl?: string,
 *   authBaseUrl?: string,
 *   authTenantId?: string
 * }} RuntimeConfigOverrides
 */

/**
 * Build a fully-resolved runtime configuration for the application.
 * @param {RuntimeConfigOverrides} config
 * @returns {AppConfig}
 */
export function createAppConfig(config) {
    if (!config || typeof config !== TYPE_OBJECT || Array.isArray(config)) {
        throw new Error(ERROR_MESSAGES.INVALID_CONFIG);
    }

    const environment = config[CONFIG_KEYS.ENVIRONMENT];
    const environmentDefaults = ENVIRONMENT_CONFIG[environment];
    if (!environmentDefaults) {
        throw new Error(ERROR_MESSAGES.INVALID_ENVIRONMENT);
    }

    const backendBaseUrl = resolveConfigValue(
        config,
        CONFIG_KEYS.BACKEND_BASE_URL,
        environmentDefaults.backendBaseUrl,
        false,
        ERROR_MESSAGES.INVALID_BACKEND_BASE_URL
    );
    const llmProxyUrl = resolveConfigValue(
        config,
        CONFIG_KEYS.LLM_PROXY_URL,
        environmentDefaults.llmProxyUrl,
        true,
        ERROR_MESSAGES.INVALID_LLM_PROXY_URL
    );
    const authBaseUrl = resolveConfigValue(
        config,
        CONFIG_KEYS.AUTH_BASE_URL,
        environmentDefaults.authBaseUrl,
        false,
        ERROR_MESSAGES.INVALID_AUTH_BASE_URL
    );
    const authTenantId = resolveConfigValue(
        config,
        CONFIG_KEYS.AUTH_TENANT_ID,
        environmentDefaults.authTenantId,
        true,
        ERROR_MESSAGES.INVALID_AUTH_TENANT_ID
    );

    return Object.freeze({
        ...STATIC_APP_CONFIG,
        environment,
        backendBaseUrl,
        llmProxyUrl,
        authBaseUrl,
        authTenantId
    });
}

/**
 * @param {RuntimeConfigOverrides} config
 * @param {string} key
 * @param {string} fallback
 * @param {boolean} allowEmpty
 * @param {string} errorCode
 * @returns {string}
 */
function resolveConfigValue(config, key, fallback, allowEmpty, errorCode) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
        return assertString(config[key], allowEmpty, errorCode);
    }
    return assertString(fallback, allowEmpty, errorCode);
}

/**
 * @param {unknown} value
 * @param {boolean} allowEmpty
 * @param {string} errorCode
 * @returns {string}
 */
function assertString(value, allowEmpty, errorCode) {
    if (typeof value !== TYPE_STRING) {
        throw new Error(errorCode);
    }
    if (!allowEmpty && value.length === 0) {
        throw new Error(errorCode);
    }
    return value;
}
