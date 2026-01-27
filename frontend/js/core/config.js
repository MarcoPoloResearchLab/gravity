// @ts-check

import { ENVIRONMENT_CONFIG } from "./environmentConfig.js?build=2026-01-01T22:43:21Z";

const TYPE_OBJECT = "object";
const TYPE_STRING = "string";

const ERROR_MESSAGES = Object.freeze({
    INVALID_CONFIG: "app_config.invalid_config",
    INVALID_ENVIRONMENT: "app_config.invalid_environment",
    INVALID_BACKEND_BASE_URL: "app_config.invalid_backend_base_url",
    INVALID_LLM_PROXY_URL: "app_config.invalid_llm_proxy_url",
    INVALID_AUTH_BASE_URL: "app_config.invalid_auth_base_url",
    INVALID_TAUTH_SCRIPT_URL: "app_config.invalid_tauth_script_url",
    INVALID_MPR_UI_SCRIPT_URL: "app_config.invalid_mpr_ui_script_url",
    INVALID_AUTH_TENANT_ID: "app_config.invalid_auth_tenant_id",
    INVALID_GOOGLE_CLIENT_ID: "app_config.invalid_google_client_id"
});

export const TIMEZONE_DEFAULT = "America/Los_Angeles";
export const CLASSIFICATION_TIMEOUT_MS = 5000;
export const DEFAULT_PRIVACY = "private";
export const STORAGE_KEY = "gravityNotesData";
export const STORAGE_KEY_USER_PREFIX = "gravityNotesData:user";

export const STATIC_APP_CONFIG = Object.freeze({
    timezone: TIMEZONE_DEFAULT,
    classificationTimeoutMs: CLASSIFICATION_TIMEOUT_MS,
    defaultPrivacy: DEFAULT_PRIVACY,
    storageKey: STORAGE_KEY,
    storageKeyUserPrefix: STORAGE_KEY_USER_PREFIX
});

/**
 * @typedef {{
 *   environment: "production" | "development",
 *   backendBaseUrl: string,
 *   llmProxyUrl: string,
 *   authBaseUrl: string,
 *   tauthScriptUrl: string,
 *   mprUiScriptUrl: string,
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
 *   tauthScriptUrl?: string,
 *   mprUiScriptUrl?: string,
 *   authTenantId?: string,
 *   googleClientId: string
 * }} RuntimeConfigInput
 */

/**
 * Build a fully-resolved runtime configuration for the application.
 * @param {RuntimeConfigInput} config
 * @returns {AppConfig}
 */
export function createAppConfig(config) {
    if (!config || typeof config !== TYPE_OBJECT || Array.isArray(config)) {
        throw new Error(ERROR_MESSAGES.INVALID_CONFIG);
    }

    const environment = config.environment;
    const environmentDefaults = ENVIRONMENT_CONFIG[environment];
    if (!environmentDefaults) {
        throw new Error(ERROR_MESSAGES.INVALID_ENVIRONMENT);
    }

    const hasBackendBaseUrl = Object.prototype.hasOwnProperty.call(config, "backendBaseUrl");
    const backendBaseUrl = resolveConfigValue(
        config.backendBaseUrl,
        environmentDefaults.backendBaseUrl,
        false,
        ERROR_MESSAGES.INVALID_BACKEND_BASE_URL,
        hasBackendBaseUrl
    );
    const hasLlmProxyUrl = Object.prototype.hasOwnProperty.call(config, "llmProxyUrl");
    const llmProxyUrl = resolveConfigValue(
        config.llmProxyUrl,
        environmentDefaults.llmProxyUrl,
        true,
        ERROR_MESSAGES.INVALID_LLM_PROXY_URL,
        hasLlmProxyUrl
    );
    const hasAuthBaseUrl = Object.prototype.hasOwnProperty.call(config, "authBaseUrl");
    const authBaseUrl = resolveConfigValue(
        config.authBaseUrl,
        environmentDefaults.authBaseUrl,
        false,
        ERROR_MESSAGES.INVALID_AUTH_BASE_URL,
        hasAuthBaseUrl
    );
    const hasTauthScriptUrl = Object.prototype.hasOwnProperty.call(config, "tauthScriptUrl");
    const tauthScriptUrl = resolveConfigValue(
        config.tauthScriptUrl,
        environmentDefaults.tauthScriptUrl,
        false,
        ERROR_MESSAGES.INVALID_TAUTH_SCRIPT_URL,
        hasTauthScriptUrl
    );
    const hasMprUiScriptUrl = Object.prototype.hasOwnProperty.call(config, "mprUiScriptUrl");
    const mprUiScriptUrl = resolveConfigValue(
        config.mprUiScriptUrl,
        environmentDefaults.mprUiScriptUrl,
        false,
        ERROR_MESSAGES.INVALID_MPR_UI_SCRIPT_URL,
        hasMprUiScriptUrl
    );
    const hasAuthTenantId = Object.prototype.hasOwnProperty.call(config, "authTenantId");
    const authTenantId = resolveConfigValue(
        config.authTenantId,
        environmentDefaults.authTenantId,
        true,
        ERROR_MESSAGES.INVALID_AUTH_TENANT_ID,
        hasAuthTenantId
    );
    if (!Object.prototype.hasOwnProperty.call(config, "googleClientId")) {
        throw new Error(ERROR_MESSAGES.INVALID_GOOGLE_CLIENT_ID);
    }
    const googleClientId = assertString(
        config.googleClientId,
        false,
        ERROR_MESSAGES.INVALID_GOOGLE_CLIENT_ID
    );

    return Object.freeze({
        ...STATIC_APP_CONFIG,
        environment,
        backendBaseUrl,
        llmProxyUrl,
        authBaseUrl,
        tauthScriptUrl,
        mprUiScriptUrl,
        authTenantId,
        googleClientId
    });
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {boolean} allowEmpty
 * @param {string} errorCode
 * @param {boolean} hasOverride
 * @returns {string}
 */
function resolveConfigValue(value, fallback, allowEmpty, errorCode, hasOverride) {
    const resolvedValue = hasOverride ? value : fallback;
    return assertString(resolvedValue, allowEmpty, errorCode);
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
