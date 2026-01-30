// @ts-check

import { createAppConfig } from "./config.js?build=2026-01-01T22:43:21Z";
import { ENVIRONMENT_DEVELOPMENT, ENVIRONMENT_PRODUCTION } from "./environmentConfig.js?build=2026-01-01T22:43:21Z";

const ENVIRONMENT_LABELS = Object.freeze({
    PRODUCTION: ENVIRONMENT_PRODUCTION,
    DEVELOPMENT: ENVIRONMENT_DEVELOPMENT
});

const RUNTIME_CONFIG_KEYS = Object.freeze({
    ENVIRONMENT: "environment",
    BACKEND_BASE_URL: "backendBaseUrl",
    LLM_PROXY_URL: "llmProxyUrl",
    AUTH_BASE_URL: "authBaseUrl",
    TAUTH_SCRIPT_URL: "tauthScriptUrl",
    MPR_UI_SCRIPT_URL: "mprUiScriptUrl",
    AUTH_TENANT_ID: "authTenantId",
    GOOGLE_CLIENT_ID: "googleClientId"
});

const TYPE_FUNCTION = "function";
const TYPE_OBJECT = "object";
const TYPE_STRING = "string";
const TYPE_UNDEFINED = "undefined";

const LOOPBACK_HOSTNAMES = Object.freeze(["localhost", "127.0.0.1", "[::1]", "::1"]);

const DEVELOPMENT_TLDS = Object.freeze([".local", ".test"]);

const PRODUCTION_TLDS = Object.freeze([".com"]);

const RUNTIME_CONFIG_PATHS = Object.freeze({
    [ENVIRONMENT_LABELS.PRODUCTION]: "data/runtime.config.production.json",
    [ENVIRONMENT_LABELS.DEVELOPMENT]: "data/runtime.config.development.json"
});

const FETCH_TIMEOUT_MS = 5000;
const FETCH_RETRY_ATTEMPTS = 2;
const FETCH_RETRY_DELAY_MS = 250;

const FETCH_CONFIGURATION = Object.freeze({
    CACHE_DIRECTIVE: "no-store",
    CREDENTIAL_POLICY: "same-origin"
});

const ERROR_MESSAGES = Object.freeze({
    UNKNOWN_FETCH_FAILURE: "Unknown error during runtime config fetch",
    TIMEOUT_FETCH_FAILURE: "Timed out while fetching runtime configuration",
    FINAL_FETCH_FAILURE: "Failed to fetch runtime configuration",
    HTTP_FAILURE_PREFIX: "Failed to load runtime config: HTTP",
    INVALID_PAYLOAD: "Invalid runtime config payload",
    ENVIRONMENT_MISMATCH: "Runtime config environment mismatch",
    MISSING_FETCH: "Runtime config fetch unavailable",
    MISSING_ABORT_CONTROLLER: "Runtime config requires AbortController"
});

const ABORT_ERROR_NAME = "AbortError";

/**
 * Delay execution for a specified amount of milliseconds.
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
function waitFor(durationMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });
}

/**
 * Perform a fetch call that automatically aborts after the configured timeout.
 * @param {typeof fetch} fetchImplementation
 * @param {string} resource
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(fetchImplementation, resource, init, timeoutMs) {
    if (typeof AbortController !== TYPE_FUNCTION) {
        throw new Error(ERROR_MESSAGES.MISSING_ABORT_CONTROLLER);
    }

    const controller = new AbortController();
    const timeoutReference = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetchImplementation(resource, {
            ...init,
            signal: controller.signal
        });
        return response;
    } catch (error) {
        throw error;
    } finally {
        clearTimeout(timeoutReference);
    }
}

/**
 * Attempt to fetch the runtime configuration, retrying when possible.
 * @param {typeof fetch} fetchImplementation
 * @param {string} resource
 * @returns {Promise<Response>}
 */
async function fetchRuntimeConfig(fetchImplementation, resource) {
    /** @type {unknown} */
    let lastError;
    for (let attemptIndex = 0; attemptIndex < FETCH_RETRY_ATTEMPTS; attemptIndex += 1) {
        try {
            const response = await fetchWithTimeout(
                fetchImplementation,
                resource,
                {
                    cache: FETCH_CONFIGURATION.CACHE_DIRECTIVE,
                    credentials: FETCH_CONFIGURATION.CREDENTIAL_POLICY
                },
                FETCH_TIMEOUT_MS
            );
            return response;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(ERROR_MESSAGES.UNKNOWN_FETCH_FAILURE);
            if (normalizedError.name === ABORT_ERROR_NAME) {
                const timeoutError = new Error(ERROR_MESSAGES.TIMEOUT_FETCH_FAILURE);
                /** @type {Error & { cause?: unknown }} */ (timeoutError).cause = normalizedError;
                lastError = timeoutError;
            } else {
                lastError = normalizedError;
            }
            if (attemptIndex < FETCH_RETRY_ATTEMPTS - 1) {
                await waitFor(FETCH_RETRY_DELAY_MS);
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(ERROR_MESSAGES.FINAL_FETCH_FAILURE);
}

/**
 * Validate and project the runtime config payload into known keys.
 * @param {unknown} payload
 * @param {"production" | "development"} environment
 * @returns {{ backendBaseUrl?: string, llmProxyUrl?: string, authBaseUrl?: string, tauthScriptUrl?: string, mprUiScriptUrl?: string, authTenantId?: string, googleClientId: string }}
 */
function parseRuntimeConfigPayload(payload, environment) {
    if (!payload || typeof payload !== TYPE_OBJECT || Array.isArray(payload)) {
        throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
    }
    const payloadKeys = Object.keys(payload);
    const allowedKeys = new Set(Object.values(RUNTIME_CONFIG_KEYS));
    for (const key of payloadKeys) {
        if (!allowedKeys.has(key)) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.ENVIRONMENT)) {
        const payloadEnvironment = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.ENVIRONMENT];
        if (typeof payloadEnvironment !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        if (payloadEnvironment !== environment) {
            throw new Error(ERROR_MESSAGES.ENVIRONMENT_MISMATCH);
        }
    }

    const overrides = {};
    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.BACKEND_BASE_URL)) {
        const backendBaseUrl = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.BACKEND_BASE_URL];
        if (typeof backendBaseUrl !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        overrides.backendBaseUrl = backendBaseUrl;
    }
    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.LLM_PROXY_URL)) {
        const llmProxyUrl = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.LLM_PROXY_URL];
        if (typeof llmProxyUrl !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        overrides.llmProxyUrl = llmProxyUrl;
    }
    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.AUTH_BASE_URL)) {
        const authBaseUrl = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.AUTH_BASE_URL];
        if (typeof authBaseUrl !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        overrides.authBaseUrl = authBaseUrl;
    }
    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.TAUTH_SCRIPT_URL)) {
        const tauthScriptUrl = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.TAUTH_SCRIPT_URL];
        if (typeof tauthScriptUrl !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        overrides.tauthScriptUrl = tauthScriptUrl;
    }
    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.MPR_UI_SCRIPT_URL)) {
        const mprUiScriptUrl = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.MPR_UI_SCRIPT_URL];
        if (typeof mprUiScriptUrl !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        overrides.mprUiScriptUrl = mprUiScriptUrl;
    }
    if (Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.AUTH_TENANT_ID)) {
        const authTenantId = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.AUTH_TENANT_ID];
        if (typeof authTenantId !== TYPE_STRING) {
            throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
        }
        overrides.authTenantId = authTenantId;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, RUNTIME_CONFIG_KEYS.GOOGLE_CLIENT_ID)) {
        throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
    }
    const googleClientId = /** @type {Record<string, unknown>} */ (payload)[RUNTIME_CONFIG_KEYS.GOOGLE_CLIENT_ID];
    if (typeof googleClientId !== TYPE_STRING) {
        throw new Error(ERROR_MESSAGES.INVALID_PAYLOAD);
    }
    overrides.googleClientId = googleClientId;
    return overrides;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHostname(hostname) {
    if (typeof hostname !== TYPE_STRING) {
        return false;
    }
    const normalized = hostname.trim().toLowerCase();
    if (normalized.length === 0) {
        return false;
    }
    return LOOPBACK_HOSTNAMES.includes(normalized);
}

/**
 * @param {string} urlValue
 * @param {string} targetHostname
 * @returns {string}
 */
function rewriteLoopbackUrl(urlValue, targetHostname) {
    const parsedUrl = new URL(urlValue);
    if (!isLoopbackHostname(parsedUrl.hostname)) {
        return urlValue;
    }
    const keepTrailingSlash = urlValue.endsWith("/") || parsedUrl.pathname !== "/";
    parsedUrl.hostname = targetHostname;
    const rewrittenUrl = parsedUrl.toString();
    if (!keepTrailingSlash && rewrittenUrl.endsWith("/")) {
        return rewrittenUrl.slice(0, -1);
    }
    return rewrittenUrl;
}

/**
 * @param {import("./config.js").AppConfig} appConfig
 * @param {Location|undefined} runtimeLocation
 * @returns {import("./config.js").AppConfig}
 */
function applyRuntimeHostOverrides(appConfig, runtimeLocation) {
    if (appConfig.environment !== ENVIRONMENT_LABELS.DEVELOPMENT) {
        return appConfig;
    }
    if (!runtimeLocation || typeof runtimeLocation.hostname !== TYPE_STRING) {
        return appConfig;
    }
    const runtimeHostname = runtimeLocation.hostname.trim().toLowerCase();
    if (!runtimeHostname || isLoopbackHostname(runtimeHostname)) {
        return appConfig;
    }
    const backendBaseUrl = rewriteLoopbackUrl(appConfig.backendBaseUrl, runtimeHostname);
    const authBaseUrl = rewriteLoopbackUrl(appConfig.authBaseUrl, runtimeHostname);
    const llmProxyUrl = rewriteLoopbackUrl(appConfig.llmProxyUrl, runtimeHostname);
    const tauthScriptUrl = rewriteLoopbackUrl(appConfig.tauthScriptUrl, runtimeHostname);
    const mprUiScriptUrl = rewriteLoopbackUrl(appConfig.mprUiScriptUrl, runtimeHostname);
    if (backendBaseUrl === appConfig.backendBaseUrl
        && authBaseUrl === appConfig.authBaseUrl
        && llmProxyUrl === appConfig.llmProxyUrl
        && tauthScriptUrl === appConfig.tauthScriptUrl
        && mprUiScriptUrl === appConfig.mprUiScriptUrl) {
        return appConfig;
    }
    return Object.freeze({
        ...appConfig,
        backendBaseUrl,
        authBaseUrl,
        llmProxyUrl,
        tauthScriptUrl,
        mprUiScriptUrl
    });
}

/**
 * Determine the environment from the current location.
 * @param {Location|undefined} runtimeLocation
 * @returns {"production" | "development"}
 */
function detectEnvironment(runtimeLocation) {
    if (!runtimeLocation || typeof runtimeLocation.hostname !== TYPE_STRING) {
        return ENVIRONMENT_LABELS.DEVELOPMENT;
    }
    const hostname = runtimeLocation.hostname.toLowerCase();
    if (!hostname) {
        return ENVIRONMENT_LABELS.DEVELOPMENT;
    }
    if (LOOPBACK_HOSTNAMES.includes(hostname)) {
        return ENVIRONMENT_LABELS.DEVELOPMENT;
    }
    if (DEVELOPMENT_TLDS.some((suffix) => hostname.endsWith(suffix))) {
        return ENVIRONMENT_LABELS.DEVELOPMENT;
    }
    if (PRODUCTION_TLDS.some((suffix) => hostname.endsWith(suffix))) {
        return ENVIRONMENT_LABELS.PRODUCTION;
    }
    return ENVIRONMENT_LABELS.DEVELOPMENT;
}

/**
 * Load the runtime configuration JSON and return a resolved app config.
 * @param {{ fetchImplementation?: typeof fetch, location?: Location, onError?: (error: unknown) => void }} [options]
 * @returns {Promise<import("./config.js").AppConfig>}
 */
export async function initializeRuntimeConfig(options = {}) {
    const { fetchImplementation = typeof fetch === TYPE_FUNCTION ? fetch : null, location = typeof window !== TYPE_UNDEFINED ? window.location : undefined } = options;
    if (!fetchImplementation) {
        throw new Error(ERROR_MESSAGES.MISSING_FETCH);
    }
    const environment = detectEnvironment(location);
    const targetPath = RUNTIME_CONFIG_PATHS[environment];
    try {
        const response = await fetchRuntimeConfig(fetchImplementation, targetPath);
        if (!response.ok) {
            throw new Error(`${ERROR_MESSAGES.HTTP_FAILURE_PREFIX} ${response.status}`);
        }
        const payload = await response.json();
        const overrides = parseRuntimeConfigPayload(payload, environment);
        const appConfig = createAppConfig({
            environment,
            ...overrides
        });
        return applyRuntimeHostOverrides(appConfig, location);
    } catch (error) {
        if (typeof options.onError === TYPE_FUNCTION) {
            options.onError(error);
        }
        throw error;
    }
}
