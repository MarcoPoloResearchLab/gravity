// @ts-check

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const DEFAULT_LLM_PROXY_BASE_URL = "https://llm-proxy.mprlab.com";

const staticConfig = {
    timezone: { value: "America/Los_Angeles", enumerable: true },
    llmProxyBaseUrl: {
        enumerable: true,
        get: () => resolveLlmProxyBaseUrl()
    },
    classifyPath: { value: "/v1/gravity/classify", enumerable: true },
    classificationTimeoutMs: { value: 5000, enumerable: true },
    defaultPrivacy: { value: "private", enumerable: true },
    storageKey: { value: "gravityNotesData", enumerable: true },
    storageKeyUserPrefix: { value: "gravityNotesData:user", enumerable: true },
    useMarkdownEditor: { value: false, enumerable: true },
    googleClientId: { value: "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com", enumerable: true },
    backendBaseUrl: {
        enumerable: true,
        get: () => resolveBackendBaseUrl()
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
    const config = /** @type {Record<string, unknown>|undefined} */ (runtimeWindow.GRAVITY_CONFIG);
    if (!config || typeof config !== "object") {
        return null;
    }
    const candidate = config.backendBaseUrl;
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
    const meta = runtimeDocument.querySelector('meta[name="gravity-backend-base-url"]');
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
 * @param {string} baseUrl
 * @returns {string}
 */
function stripTrailingSlashes(baseUrl) {
    return baseUrl.replace(/\/+$/u, "");
}

/**
 * Resolve the LLM proxy base URL using runtime overrides.
 * @param {{ window?: Window, document?: Document, location?: Location }} [environment]
 * @returns {string}
 */
export function resolveLlmProxyBaseUrl(environment = {}) {
    const runtimeWindow = environment.window
        ?? (typeof globalThis !== "undefined" && typeof globalThis.window !== "undefined" ? globalThis.window : undefined);
    const runtimeDocument = environment.document
        ?? (runtimeWindow && typeof runtimeWindow.document !== "undefined" ? runtimeWindow.document : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined" ? globalThis.document : undefined);
    const runtimeLocation = environment.location
        ?? (runtimeWindow && typeof runtimeWindow.location !== "undefined" ? runtimeWindow.location : undefined)
        ?? (typeof globalThis !== "undefined" && typeof globalThis.location !== "undefined" ? globalThis.location : undefined);

    const explicitConfig = readGlobalLlmProxyBaseUrl(runtimeWindow);
    if (explicitConfig !== null) {
        return normalizeLlmProxyBaseUrl(explicitConfig, runtimeLocation);
    }

    const metaConfig = readMetaLlmProxyBaseUrl(runtimeDocument);
    if (metaConfig !== null) {
        return normalizeLlmProxyBaseUrl(metaConfig, runtimeLocation);
    }

    return normalizeLlmProxyBaseUrl("", runtimeLocation);
}

/**
 * @param {Window|undefined} runtimeWindow
 * @returns {string|null}
 */
function readGlobalLlmProxyBaseUrl(runtimeWindow) {
    if (!runtimeWindow || typeof runtimeWindow !== "object") {
        return null;
    }
    const config = /** @type {Record<string, unknown>|undefined} */ (runtimeWindow.GRAVITY_CONFIG);
    if (!config || typeof config !== "object") {
        return null;
    }
    const candidate = config.llmProxyBaseUrl;
    return typeof candidate === "string" ? candidate : null;
}

/**
 * @param {Document|undefined} runtimeDocument
 * @returns {string|null}
 */
function readMetaLlmProxyBaseUrl(runtimeDocument) {
    if (!runtimeDocument || typeof runtimeDocument.querySelector !== "function") {
        return null;
    }
    const meta = runtimeDocument.querySelector('meta[name="gravity-llm-proxy-base-url"]');
    if (!meta) {
        return null;
    }
    const content = meta.getAttribute("content");
    return typeof content === "string" ? content : null;
}

/**
 * Normalize the proxy base URL with safe fallbacks.
 * @param {string} value
 * @param {Location|undefined} runtimeLocation
 * @returns {string}
 */
function normalizeLlmProxyBaseUrl(value, runtimeLocation) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed.length > 0) {
        return stripTrailingSlashes(trimmed);
    }
    const origin = typeof runtimeLocation?.origin === "string" && runtimeLocation.origin.length > 0
        ? runtimeLocation.origin
        : "";
    if (origin.length > 0) {
        return stripTrailingSlashes(origin);
    }
    return DEFAULT_LLM_PROXY_BASE_URL;
}
