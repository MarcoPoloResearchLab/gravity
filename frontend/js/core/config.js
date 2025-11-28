// @ts-check

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
const DEFAULT_LLM_PROXY_URL = "https://llm-proxy.mprlab.com/v1/gravity/classify";
const DEFAULT_AUTH_BASE_URL = "http://localhost:8082";

const DEFAULT_ENVIRONMENT_CONFIG = Object.freeze({
    production: Object.freeze({
        backendBaseUrl: "https://gravity-api.mprlab.com",
        llmProxyUrl: "https://llm-proxy.mprlab.com/v1/gravity/classify",
        authBaseUrl: "https://gravity-tauth.mprlab.com"
    }),
    development: Object.freeze({
        backendBaseUrl: "http://localhost:8080",
        llmProxyUrl: "http://computercat:8081/v1/gravity/classify",
        authBaseUrl: "http://localhost:8082"
    })
});

const RUNTIME_CONFIG_STATE_KEY = Symbol.for("gravity.core.config.runtimeState");

/**
 * Resolve the shared runtime configuration backing store. Using a shared symbol keeps
 * the browser modules (loaded with build fingerprints) and the Node test modules in
 * sync even though their specifiers differ.
 * @returns {{ config: { environment: ("production" | "development" | null), backendBaseUrl: string, llmProxyUrl: string, authBaseUrl: string } | null }}
 */
function resolveRuntimeConfigState() {
    const globalScope = typeof globalThis === "object" && globalThis !== null ? globalThis : {};
    const existing = /** @type {{ config: { environment: ("production" | "development" | null), backendBaseUrl: string, llmProxyUrl: string, authBaseUrl: string } | null } | undefined} */
        (globalScope[RUNTIME_CONFIG_STATE_KEY]);
    if (existing && typeof existing === "object" && Object.prototype.hasOwnProperty.call(existing, "config")) {
        return existing;
    }
    const state = { config: null };
    try {
        Object.defineProperty(globalScope, RUNTIME_CONFIG_STATE_KEY, {
            value: state,
            enumerable: false,
            configurable: false,
            writable: false
        });
    } catch {
        // Fallback assignment when defineProperty is unavailable (older runtimes / frozen globals).
        /** @type {any} */ (globalScope)[RUNTIME_CONFIG_STATE_KEY] = state;
    }
    return state;
}

const runtimeConfigState = resolveRuntimeConfigState();

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
    backendBaseUrl: {
        enumerable: true,
        get: () => resolveBackendBaseUrl()
    },
    llmProxyUrl: {
        enumerable: true,
        get: () => resolveLlmProxyUrl()
    },
    authBaseUrl: {
        enumerable: true,
        get: () => resolveAuthBaseUrl()
    }
};

export const appConfig = (() => {
    const target = {};
    Object.defineProperties(target, staticConfig);
    return Object.freeze(target);
})();

/**
 * Inject the runtime configuration that downstream modules will consume.
 * @param {{ environment?: string|null, backendBaseUrl?: string|null, llmProxyUrl?: string|null, authBaseUrl?: string|null }} [config]
 * @returns {void}
 */
export function setRuntimeConfig(config = {}) {
    const normalizedEnvironment = normalizeEnvironmentName(config.environment);
    const environmentDefaults = normalizedEnvironment ? DEFAULT_ENVIRONMENT_CONFIG[normalizedEnvironment] : null;

    const backendBaseUrl = normalizeUrl(config.backendBaseUrl ?? environmentDefaults?.backendBaseUrl ?? DEFAULT_BACKEND_BASE_URL);
    const llmProxyUrl = normalizeUrl(config.llmProxyUrl ?? environmentDefaults?.llmProxyUrl ?? DEFAULT_LLM_PROXY_URL);
    const authBaseUrl = normalizeUrl(config.authBaseUrl ?? environmentDefaults?.authBaseUrl ?? DEFAULT_AUTH_BASE_URL);

    runtimeConfigState.config = Object.freeze({
        environment: normalizedEnvironment,
        backendBaseUrl,
        llmProxyUrl,
        authBaseUrl
    });
}

/**
 * Reset stored runtime config (testing only).
 * @returns {void}
 */
export function clearRuntimeConfigForTesting() {
    runtimeConfigState.config = null;
}

/**
 * Resolve the backend base URL from the injected config or defaults.
 * @returns {string}
 */
export function resolveBackendBaseUrl() {
    if (runtimeConfigState.config?.backendBaseUrl) {
        return runtimeConfigState.config.backendBaseUrl;
    }
    return DEFAULT_BACKEND_BASE_URL;
}

/**
 * Resolve the LLM proxy URL from the injected config or defaults.
 * @returns {string}
 */
export function resolveLlmProxyUrl() {
    if (runtimeConfigState.config?.llmProxyUrl !== undefined) {
        return runtimeConfigState.config.llmProxyUrl;
    }
    return DEFAULT_LLM_PROXY_URL;
}

/**
 * Resolve the TAuth base URL from the injected config or defaults.
 * @returns {string}
 */
export function resolveAuthBaseUrl() {
    if (runtimeConfigState.config?.authBaseUrl !== undefined) {
        return runtimeConfigState.config.authBaseUrl;
    }
    return DEFAULT_AUTH_BASE_URL;
}

/**
 * Resolve the current environment label.
 * @returns {("production" | "development" | null)}
 */
export function resolveEnvironmentName() {
    if (runtimeConfigState.config?.environment) {
        return runtimeConfigState.config.environment;
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
