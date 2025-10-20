// @ts-check

import { setRuntimeConfig } from "./config.js";

const CONFIG_PATHS = Object.freeze({
    production: "data/runtime.config.production.json",
    development: "data/runtime.config.development.json"
});

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
        const response = await fetchImplementation(targetPath, {
            cache: "no-store",
            credentials: "same-origin"
        });
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
