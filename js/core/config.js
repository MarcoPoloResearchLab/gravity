// @ts-check

import {
    GLOBAL_CONFIG_OBJECT_KEY,
    CONFIG_KEY_BACKEND_BASE_URL,
    CONFIG_KEY_LLM_PROXY_URL,
    CONFIG_KEY_ENVIRONMENT,
    META_NAME_BACKEND_BASE_URL,
    META_NAME_LLM_PROXY_URL,
    META_NAME_ENVIRONMENT
} from "../constants.js";

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const DEFAULT_LLM_PROXY_PATH = "/v1/gravity/classify";
const DEFAULT_LLM_PROXY_URL = `https://llm-proxy.mprlab.com${DEFAULT_LLM_PROXY_PATH}`;
const KNOWN_ENVIRONMENT_CONFIG = Object.freeze({
    production: Object.freeze({
        backendBaseUrl: "https://gravity-api.mprlab.com",
        llmProxyUrl: "https://llm-proxy.mprlab.com/v1/gravity/classify"
    }),
    development: Object.freeze({
        backendBaseUrl: "http://localhost:8080",
        llmProxyUrl: "http://computercat:8081/v1/gravity/classify"
    })
});

const staticConfig = {
    timezone: { value: "America/Los_Angeles", enumerable: true },
    environment: {
        enumerable: true,
        get: () => resolveEnvironmentName() ?? null
    },
    classificationTimeoutMs: { value: 5000, enumerable: true },
    defaultPrivacy: { value: "private", enumerable: true },
    storageKey: { value: "gravityNotesData", enumerable: true },
    storageKeyUserPrefix: { value: "gravityNotesData:user", enumerable: true },
    googleClientId: { value: "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com", enumerable: true },
    backendBaseUrl: {
        enumerable: true,
        get: () => resolveBackendBaseUrl()
    },
    llmProxyUrl: {
        enumerable: true,
        get: () => resolveLlmProxyUrl()
    }
};

export const appConfig = (() => {
    const target = {};
    Object.defineProperties(target, staticConfig);
    return Object.freeze(target);
})();

/**
 * Resolve the backend base URL using runtime overrides.
 * @param {{ window?: Window, document?: Document, location?: Location }} [environment]
 * @returns {string}
 */
export function resolveBackendBaseUrl(environment = {}) {
    const runtimeWindow = environment.window ?? (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined" ? globalThis.window : undefined);
    const runtimeDocument = environment.document
        ?? (runtimeWindow && typeof runtimeWindow.document !== "undefined" ? runtimeWindow.document : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined" ? globalThis.document : undefined);
    const runtimeLocation = environment.location
        ?? (runtimeWindow && typeof runtimeWindow.location !== "undefined" ? runtimeWindow.location : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.location !== "undefined" ? globalThis.location : undefined);

    const explicitConfig = readGlobalBackendBaseUrl(runtimeWindow);
    if (explicitConfig !== null) {
        return normalizeBackendBaseUrl(explicitConfig, runtimeLocation);
    }

    const metaConfig = readMetaBackendBaseUrl(runtimeDocument);
   if (metaConfig !== null) {
       return normalizeBackendBaseUrl(metaConfig, runtimeLocation);
   }

    const environmentName = resolveEnvironmentName({ window: runtimeWindow, document: runtimeDocument });
    const environmentBackendBaseUrl = readEnvironmentConfigValue(environmentName, "backendBaseUrl");
    if (environmentBackendBaseUrl) {
        return stripTrailingSlashes(environmentBackendBaseUrl);
    }

    return normalizeBackendBaseUrl("", runtimeLocation);
}

/**
 * @param {Window|undefined} runtimeWindow
 * @returns {string|null}
 */
function readGlobalBackendBaseUrl(runtimeWindow) {
    if (!runtimeWindow || typeof runtimeWindow !== "object") {
        return null;
    }
    const config = /** @type {Record<string, unknown>|undefined} */ (runtimeWindow?.[GLOBAL_CONFIG_OBJECT_KEY]);
    if (!config || typeof config !== "object") {
        return null;
    }
    const candidate = config?.[CONFIG_KEY_BACKEND_BASE_URL];
    return typeof candidate === "string" ? candidate : null;
}

/**
 * @param {Document|undefined} runtimeDocument
 * @returns {string|null}
 */
function readMetaBackendBaseUrl(runtimeDocument) {
    if (!runtimeDocument || typeof runtimeDocument.querySelector !== "function") {
        return null;
    }
    const meta = runtimeDocument.querySelector(`meta[name="${META_NAME_BACKEND_BASE_URL}"]`);
    if (!meta) {
        return null;
    }
    const content = meta.getAttribute("content");
    return typeof content === "string" ? content : null;
}

/**
 * Normalize and fall back when the backend base URL is missing.
 * @param {string} value
 * @param {Location|undefined} runtimeLocation
 * @returns {string}
 */
function normalizeBackendBaseUrl(value, runtimeLocation) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed.length > 0) {
        return stripTrailingSlashes(trimmed);
    }
    const inferred = inferBackendFromLocation(runtimeLocation);
    return stripTrailingSlashes(inferred);
}

/**
 * @param {Location|undefined} runtimeLocation
 * @returns {string}
 */
function inferBackendFromLocation(runtimeLocation) {
    if (!runtimeLocation) {
        return DEFAULT_BACKEND_BASE_URL;
    }
    const protocol = typeof runtimeLocation.protocol === "string" ? runtimeLocation.protocol : "";
    if (protocol === "file:") {
        return DEFAULT_BACKEND_BASE_URL;
    }
    const origin = typeof runtimeLocation.origin === "string" && runtimeLocation.origin.length > 0
        ? runtimeLocation.origin
        : "";
    if (origin.length > 0) {
        return origin;
    }
    const host = typeof runtimeLocation.host === "string" && runtimeLocation.host.length > 0
        ? runtimeLocation.host
        : "";
    if (host.length > 0) {
        return `${protocol}//${host}`;
    }
    return DEFAULT_BACKEND_BASE_URL;
}

/**
 * Resolve the named environment configured for the current runtime.
 * @param {{ window?: Window, document?: Document }} [environment]
 * @returns {("production" | "development" | null)}
 */
export function resolveEnvironmentName(environment = {}) {
    const runtimeWindow = environment.window ?? (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined" ? globalThis.window : undefined);
    const runtimeDocument = environment.document
        ?? (runtimeWindow && typeof runtimeWindow.document !== "undefined" ? runtimeWindow.document : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined" ? globalThis.document : undefined);

    const explicitEnvironment = readGlobalEnvironment(runtimeWindow);
    if (explicitEnvironment) {
        return explicitEnvironment;
    }
    const metaEnvironment = readMetaEnvironment(runtimeDocument);
    if (metaEnvironment) {
        return metaEnvironment;
    }
    return null;
}

/**
 * @param {Window|undefined} runtimeWindow
 * @returns {("production" | "development" | null)}
 */
function readGlobalEnvironment(runtimeWindow) {
    if (!runtimeWindow || typeof runtimeWindow !== "object") {
        return null;
    }
    const config = /** @type {Record<string, unknown>|undefined} */ (runtimeWindow?.[GLOBAL_CONFIG_OBJECT_KEY]);
    if (!config || typeof config !== "object") {
        return null;
    }
    const candidate = config?.[CONFIG_KEY_ENVIRONMENT];
    return normalizeEnvironmentName(candidate);
}

/**
 * @param {Document|undefined} runtimeDocument
 * @returns {("production" | "development" | null)}
 */
function readMetaEnvironment(runtimeDocument) {
    if (!runtimeDocument || typeof runtimeDocument.querySelector !== "function") {
        return null;
    }
    const meta = runtimeDocument.querySelector(`meta[name="${META_NAME_ENVIRONMENT}"]`);
    if (!meta) {
        return null;
    }
    const content = meta.getAttribute("content");
    return normalizeEnvironmentName(content);
}

/**
 * @param {unknown} candidate
 * @returns {("production" | "development" | null)}
 */
function normalizeEnvironmentName(candidate) {
    if (typeof candidate !== "string") {
        return null;
    }
    const normalized = candidate.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(KNOWN_ENVIRONMENT_CONFIG, normalized)) {
        return /** @type {("production" | "development")} */ (normalized);
    }
    return null;
}

/**
 * @param {("production" | "development" | null)} environmentName
 * @param {"backendBaseUrl" | "llmProxyUrl"} key
 * @returns {string|null}
 */
function readEnvironmentConfigValue(environmentName, key) {
    if (!environmentName) {
        return null;
    }
    const config = KNOWN_ENVIRONMENT_CONFIG[environmentName];
    if (!config) {
        return null;
    }
    const value = config[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function stripTrailingSlashes(baseUrl) {
    return baseUrl.replace(/\/+$/u, "");
}

/**
 * Resolve the LLM proxy endpoint using runtime overrides.
 * @param {{ window?: Window, document?: Document, location?: Location }} [environment]
 * @returns {string}
 */
export function resolveLlmProxyUrl(environment = {}) {
    const runtimeWindow = environment.window
        ?? (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined" ? globalThis.window : undefined);
    const runtimeDocument = environment.document
        ?? (runtimeWindow && typeof runtimeWindow.document !== "undefined" ? runtimeWindow.document : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined" ? globalThis.document : undefined);
    const runtimeLocation = environment.location
        ?? (runtimeWindow && typeof runtimeWindow.location !== "undefined" ? runtimeWindow.location : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.location !== "undefined" ? globalThis.location : undefined);

    const explicitConfig = readGlobalLlmProxyUrl(runtimeWindow);
    if (explicitConfig !== null) {
        return explicitConfig;
    }

    const metaConfig = readMetaLlmProxyUrl(runtimeDocument);
    if (metaConfig !== null) {
        return metaConfig;
    }

    const environmentName = resolveEnvironmentName({ window: runtimeWindow, document: runtimeDocument });
    const environmentUrl = readEnvironmentConfigValue(environmentName, "llmProxyUrl");
    if (environmentUrl) {
        return sanitizeLlmProxyUrl(environmentUrl);
    }

    return inferLlmProxyFromLocation(runtimeLocation);
}

/**
 * @param {Window|undefined} runtimeWindow
 * @returns {string|null}
 */
function readGlobalLlmProxyUrl(runtimeWindow) {
    if (!runtimeWindow || typeof runtimeWindow !== "object") {
        return null;
    }
    const config = /** @type {Record<string, unknown>|undefined} */ (runtimeWindow?.[GLOBAL_CONFIG_OBJECT_KEY]);
    if (!config || typeof config !== "object") {
        return null;
    }
    const direct = config?.[CONFIG_KEY_LLM_PROXY_URL];
    if (typeof direct === "string") {
        return sanitizeLlmProxyUrl(direct);
    }
    const legacyClassify = config?.llmProxyClassifyUrl;
    if (typeof legacyClassify === "string") {
        return sanitizeLlmProxyUrl(legacyClassify);
    }
    const legacyBase = config?.llmProxyBaseUrl;
    if (typeof legacyBase === "string") {
        const trimmedBase = stripTrailingSlashes(legacyBase.trim());
        if (trimmedBase.length === 0) {
            return "";
        }
        return composeProxyEndpoint(trimmedBase, DEFAULT_LLM_PROXY_PATH);
    }
    return null;
}

/**
 * @param {Document|undefined} runtimeDocument
 * @returns {string|null}
 */
function readMetaLlmProxyUrl(runtimeDocument) {
    if (!runtimeDocument || typeof runtimeDocument.querySelector !== "function") {
        return null;
    }
    const direct = runtimeDocument.querySelector(`meta[name="${META_NAME_LLM_PROXY_URL}"]`);
    if (direct) {
        const content = direct.getAttribute("content");
        if (typeof content === "string") {
            return sanitizeLlmProxyUrl(content);
        }
    }
    const legacyClassify = runtimeDocument.querySelector('meta[name="gravity-llm-proxy-classify-url"]');
    if (legacyClassify) {
        const content = legacyClassify.getAttribute("content");
        if (typeof content === "string") {
            return sanitizeLlmProxyUrl(content);
        }
    }
    const legacyBase = runtimeDocument.querySelector('meta[name="gravity-llm-proxy-base-url"]');
    if (legacyBase) {
        const content = legacyBase.getAttribute("content");
        if (typeof content === "string") {
            const trimmedBase = stripTrailingSlashes(content.trim());
            if (trimmedBase.length === 0) {
                return "";
            }
            return composeProxyEndpoint(trimmedBase, DEFAULT_LLM_PROXY_PATH);
        }
    }
    return null;
}

/**
 * @param {string} candidate
 * @returns {string}
 */
function sanitizeLlmProxyUrl(candidate) {
    if (typeof candidate !== "string") {
        return "";
    }
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
        return "";
    }
    return trimmed;
}

/**
 * @param {Location|undefined} runtimeLocation
 * @returns {string}
 */
function inferLlmProxyFromLocation(runtimeLocation) {
    if (!runtimeLocation) {
        return DEFAULT_LLM_PROXY_URL;
    }
    const origin = typeof runtimeLocation.origin === "string" && runtimeLocation.origin.length > 0
        ? runtimeLocation.origin
        : "";
    if (origin.length > 0) {
        return composeProxyEndpoint(origin, DEFAULT_LLM_PROXY_PATH);
    }
    const protocol = typeof runtimeLocation.protocol === "string" && runtimeLocation.protocol.length > 0
        ? runtimeLocation.protocol
        : "";
    const host = typeof runtimeLocation.host === "string" && runtimeLocation.host.length > 0
        ? runtimeLocation.host
        : "";
    if (protocol && host) {
        return composeProxyEndpoint(`${protocol}//${host}`, DEFAULT_LLM_PROXY_PATH);
    }
    return DEFAULT_LLM_PROXY_URL;
}

/**
 * Combine a base URL with a path segment ensuring single slashes.
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
function composeProxyEndpoint(baseUrl, path) {
    const sanitizedBase = stripTrailingSlashes(baseUrl);
    const normalizedPath = typeof path === "string" && path.startsWith("/") ? path : `/${path ?? ""}`;
    return `${sanitizedBase}${normalizedPath}`;
}
