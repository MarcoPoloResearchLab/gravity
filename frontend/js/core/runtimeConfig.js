// @ts-check

import { setRuntimeConfig } from "./config.js?build=2024-10-05T12:00:00Z";

const ENVIRONMENT_LABELS = Object.freeze({
    PRODUCTION: "production",
    DEVELOPMENT: "development"
});

const LOOPBACK_HOSTNAMES = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

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
    HTTP_FAILURE_PREFIX: "Failed to load runtime config: HTTP"
});

const ABORT_ERROR_NAME = "AbortError";

/**
 * Delay execution for a specified amount of milliseconds.
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
function waitFor(durationMs) {
    return new Promise((resolve) => {
        const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
        setTimeout(resolve, safeDuration);
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
    if (typeof AbortController !== "function") {
        return fetchImplementation(resource, init);
    }

    const controller = new AbortController();
    const timeoutDuration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
    const timeoutReference = setTimeout(() => {
        controller.abort();
    }, timeoutDuration);

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
 * Determine the environment from the current location.
 * @param {Location|undefined} runtimeLocation
 * @returns {"production" | "development"}
 */
function detectEnvironment(runtimeLocation) {
    if (!runtimeLocation) {
        return ENVIRONMENT_LABELS.DEVELOPMENT;
    }
    const hostname = typeof runtimeLocation.hostname === "string" ? runtimeLocation.hostname.toLowerCase() : "";
    if (!hostname || LOOPBACK_HOSTNAMES.includes(hostname)) {
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
 * Load the runtime configuration JSON and push it into the shared config store.
 * @param {{ fetchImplementation?: typeof fetch, location?: Location, onError?: (error: unknown) => void }} [options]
 * @returns {Promise<void>}
 */
export async function initializeRuntimeConfig(options = {}) {
    const { fetchImplementation = typeof fetch === "function" ? fetch : null, location = typeof window !== "undefined" ? window.location : undefined } = options;
    if (!fetchImplementation) {
        setRuntimeConfig({});
        return;
    }
    const environment = detectEnvironment(location);
    const targetPath = RUNTIME_CONFIG_PATHS[environment] ?? RUNTIME_CONFIG_PATHS[ENVIRONMENT_LABELS.DEVELOPMENT];
    try {
        const response = await fetchRuntimeConfig(fetchImplementation, targetPath);
        if (!response.ok) {
            throw new Error(`${ERROR_MESSAGES.HTTP_FAILURE_PREFIX} ${response.status}`);
        }
        const payload = await response.json();
        setRuntimeConfig({
            environment,
            ...payload
        });
    } catch (error) {
        if (typeof options.onError === "function") {
            options.onError(error);
        }
        setRuntimeConfig({ environment });
    }
}
