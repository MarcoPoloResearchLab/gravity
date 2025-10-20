// @ts-check

import { setRuntimeConfig } from "./config.js";

const CONFIG_PATHS = Object.freeze({
    production: "data/runtime.config.production.json",
    development: "data/runtime.config.development.json"
});

const FETCH_TIMEOUT_MS = 5000;
const FETCH_RETRY_ATTEMPTS = 2;
const FETCH_RETRY_DELAY_MS = 250;

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
                    cache: "no-store",
                    credentials: "same-origin"
                },
                FETCH_TIMEOUT_MS
            );
            return response;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error("Unknown error during runtime config fetch");
            if (normalizedError.name === "AbortError") {
                const timeoutError = new Error("Timed out while fetching runtime configuration");
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
    throw lastError instanceof Error ? lastError : new Error("Failed to fetch runtime configuration");
}

/**
 * Determine the environment from the current location.
 * @param {Location|undefined} runtimeLocation
 * @returns {"production" | "development"}
 */
function detectEnvironment(runtimeLocation) {
    if (!runtimeLocation) {
        return "development";
    }
    const hostname = typeof runtimeLocation.hostname === "string" ? runtimeLocation.hostname.toLowerCase() : "";
    if (!hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
        return "development";
    }
    if (hostname.endsWith(".local") || hostname.endsWith(".test")) {
        return "development";
    }
    if (hostname.endsWith(".com")) {
        return "production";
    }
    return "development";
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
    const targetPath = CONFIG_PATHS[environment] ?? CONFIG_PATHS.development;
    try {
        const response = await fetchRuntimeConfig(fetchImplementation, targetPath);
        if (!response.ok) {
            throw new Error(`Failed to load runtime config: HTTP ${response.status}`);
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
