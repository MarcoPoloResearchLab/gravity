// @ts-check

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const DEFAULT_LLM_PROXY_URL = "https://llm-proxy.mprlab.com/v1/gravity/classify";

const DEFAULT_GOOGLE_AUTHORIZED_ORIGINS = Object.freeze([
    "https://gravity.mprlab.com"
]);

const DEFAULT_DEVELOPMENT_GOOGLE_ORIGINS = Object.freeze([
    "http://localhost:8000",
    "http://localhost:8080",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8080",
    "http://[::1]:8000",
    "http://[::1]:8080"
]);

const DEFAULT_ENVIRONMENT_CONFIG = Object.freeze({
    production: Object.freeze({
        backendBaseUrl: "https://gravity-api.mprlab.com",
        llmProxyUrl: "https://llm-proxy.mprlab.com/v1/gravity/classify",
        googleAuthorizedOrigins: DEFAULT_GOOGLE_AUTHORIZED_ORIGINS
    }),
    development: Object.freeze({
        backendBaseUrl: "http://localhost:8080",
        llmProxyUrl: "http://computercat:8081/v1/gravity/classify",
        googleAuthorizedOrigins: DEFAULT_DEVELOPMENT_GOOGLE_ORIGINS
    })
});

/** @type {{ environment: ("production" | "development" | null), backendBaseUrl: string, llmProxyUrl: string, googleAuthorizedOrigins: readonly string[] } | null} */
let runtimeConfig = null;

const staticConfig = {
    timezone: { value: "America/Los_Angeles", enumerable: true },
    environment: {
        enumerable: true,
        get: () => resolveEnvironmentName()
    },
    classificationTimeoutMs: { value: 5000, enumerable: true },
    defaultPrivacy: { value: "private", enumerable: true },
    storageKey: { value: "gravityNotesData", enumerable: true },
    storageKeyUserPrefix: { value: "gravityNotesData:user", enumerable: true },
    googleClientId: { value: "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com", enumerable: true },
    googleAuthorizedOrigins: {
        enumerable: true,
        get: () => resolveGoogleAuthorizedOrigins()
    },
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
 * Inject the runtime configuration that downstream modules will consume.
 * @param {{ environment?: string|null, backendBaseUrl?: string|null, llmProxyUrl?: string|null }} [config]
 * @returns {void}
 */
export function setRuntimeConfig(config = {}) {
    const normalizedEnvironment = normalizeEnvironmentName(config.environment);
    const environmentDefaults = normalizedEnvironment ? DEFAULT_ENVIRONMENT_CONFIG[normalizedEnvironment] : null;

    const backendBaseUrl = normalizeUrl(config.backendBaseUrl ?? environmentDefaults?.backendBaseUrl ?? DEFAULT_BACKEND_BASE_URL);
    const llmProxyUrl = normalizeUrl(config.llmProxyUrl ?? environmentDefaults?.llmProxyUrl ?? DEFAULT_LLM_PROXY_URL);
    const authorizedOrigins = normalizeOriginList(config.googleAuthorizedOrigins ?? config.googleSignInOrigins ?? environmentDefaults?.googleAuthorizedOrigins ?? DEFAULT_GOOGLE_AUTHORIZED_ORIGINS);

    runtimeConfig = Object.freeze({
        environment: normalizedEnvironment,
        backendBaseUrl,
        llmProxyUrl,
        googleAuthorizedOrigins: Object.freeze(authorizedOrigins.length > 0 ? authorizedOrigins : [...DEFAULT_GOOGLE_AUTHORIZED_ORIGINS])
    });
}

/**
 * Reset stored runtime config (testing only).
 * @returns {void}
 */
export function clearRuntimeConfigForTesting() {
    runtimeConfig = null;
}

/**
 * Resolve the backend base URL from the injected config or defaults.
 * @returns {string}
 */
export function resolveBackendBaseUrl() {
    if (runtimeConfig?.backendBaseUrl) {
        return runtimeConfig.backendBaseUrl;
    }
    return DEFAULT_BACKEND_BASE_URL;
}

/**
 * Resolve the LLM proxy URL from the injected config or defaults.
 * @returns {string}
 */
export function resolveLlmProxyUrl() {
    if (runtimeConfig?.llmProxyUrl !== undefined) {
        return runtimeConfig.llmProxyUrl;
    }
    return DEFAULT_LLM_PROXY_URL;
}

/**
 * Resolve the allowed Google Identity origins from config or defaults.
 * @returns {readonly string[]}
 */
export function resolveGoogleAuthorizedOrigins() {
    if (runtimeConfig?.googleAuthorizedOrigins && runtimeConfig.googleAuthorizedOrigins.length > 0) {
        return runtimeConfig.googleAuthorizedOrigins;
    }
    return DEFAULT_GOOGLE_AUTHORIZED_ORIGINS;
}

/**
 * Resolve the current environment label.
 * @returns {("production" | "development" | null)}
 */
export function resolveEnvironmentName() {
    if (runtimeConfig?.environment) {
        return runtimeConfig.environment;
    }
    return inferEnvironmentFromLocation(typeof window !== "undefined" ? window.location : undefined);
}

/**
 * Normalize user-provided environment names.
 * @param {unknown} candidate
 * @returns {("production" | "development" | null)}
 */
function normalizeEnvironmentName(candidate) {
    if (typeof candidate !== "string") {
        return null;
    }
    const normalized = candidate.trim().toLowerCase();
    if (normalized === "production" || normalized === "development") {
        return normalized;
    }
    return null;
}

/**
 * Normalize endpoint URLs while preserving intentional blanks.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUrl(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    return trimmed.replace(/\/+$/u, "");
}

/**
 * Best-effort environment inference from the active location.
 * @param {Location|undefined} runtimeLocation
 * @returns {("production" | "development" | null)}
 */
function inferEnvironmentFromLocation(runtimeLocation) {
    if (!runtimeLocation) {
        return null;
    }
    const hostname = typeof runtimeLocation.hostname === "string" ? runtimeLocation.hostname.toLowerCase() : "";
    if (!hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".local") || hostname.endsWith(".test")) {
        return "development";
    }
    if (hostname.endsWith(".com")) {
        return "production";
    }
    return null;
}

/**
 * Normalize a set of origins into lowercase protocol/host/optional port tuples.
 * @param {unknown} candidate
 * @returns {string[]}
 */
function normalizeOriginList(candidate) {
    const source = Array.isArray(candidate)
        ? candidate
        : typeof candidate === "string"
            ? candidate.split(",")
            : [];
    const normalized = [];
    for (const entry of source) {
        const origin = normalizeOrigin(entry);
        if (origin) {
            normalized.push(origin);
        }
    }
    return Array.from(new Set(normalized));
}

/**
 * Normalize a single origin-like value.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeOrigin(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }
    try {
        const url = new URL(trimmed);
        if (!url.protocol || !url.hostname) {
            return null;
        }
        const protocol = url.protocol.toLowerCase();
        const hostname = url.hostname.toLowerCase();
        const port = normalizePort(url.port, protocol);
        return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
    } catch {
        return null;
    }
}

/**
 * Normalize explicit port representation for default schemes.
 * @param {string} rawPort
 * @param {string} protocol
 * @returns {string}
 */
function normalizePort(rawPort, protocol) {
    if (!rawPort) {
        return "";
    }
    const trimmed = rawPort.trim();
    if (trimmed.length === 0) {
        return "";
    }
    const portNumber = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(portNumber) || portNumber <= 0) {
        return "";
    }
    if ((protocol === "https:" && portNumber === 443) || (protocol === "http:" && portNumber === 80)) {
        return "";
    }
    return `${portNumber}`;
}
