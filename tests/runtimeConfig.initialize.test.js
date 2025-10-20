import assert from "node:assert/strict";
import test from "node:test";

import {
    clearRuntimeConfigForTesting,
    resolveBackendBaseUrl,
    resolveEnvironmentName,
    resolveLlmProxyUrl
} from "../js/core/config.js";
import { initializeRuntimeConfig } from "../js/core/runtimeConfig.js";

const TEST_LABELS = Object.freeze({
    APPLIES_REMOTE_CONFIG: "initializeRuntimeConfig applies remote payload when fetch succeeds",
    RETRIES_TRANSIENT_FAILURES: "initializeRuntimeConfig retries transient failures before succeeding",
    HANDLES_HTTP_FAILURE: "initializeRuntimeConfig reports HTTP failures and preserves defaults",
    HANDLES_ABORT_FAILURE: "initializeRuntimeConfig normalizes abort failures into timeout errors"
});

const HOSTNAMES = Object.freeze({
    PRODUCTION: "gravity-notes.example.com",
    DEVELOPMENT: "localhost"
});

const ENVIRONMENT_LABELS = Object.freeze({
    PRODUCTION: "production",
    DEVELOPMENT: "development"
});

const RUNTIME_PATHS = Object.freeze({
    PRODUCTION: "data/runtime.config.production.json",
    DEVELOPMENT: "data/runtime.config.development.json"
});

const FETCH_OPTIONS = Object.freeze({
    CACHE_DIRECTIVE: "no-store",
    CREDENTIAL_POLICY: "same-origin"
});

const REMOTE_ENDPOINTS = Object.freeze({
    BACKEND: "https://api.example.com/v1",
    LLM_PROXY: "https://llm.example.com/v1/classify"
});

const DEFAULT_ENDPOINTS = Object.freeze({
    BACKEND: "http://localhost:8080",
    LLM_PROXY: "https://llm-proxy.mprlab.com/v1/gravity/classify",
    DEVELOPMENT_LLM_PROXY: "http://computercat:8081/v1/gravity/classify"
});

const ERROR_MESSAGES = Object.freeze({
    HTTP_FAILURE_PREFIX: "Failed to load runtime config: HTTP",
    TIMEOUT_FAILURE: "Timed out while fetching runtime configuration"
});

const ERROR_NAMES = Object.freeze({
    ABORT: "AbortError"
});

const TRANSIENT_ERROR_MESSAGES = Object.freeze({
    NETWORK: "temporary network failure",
    ABORT: "request aborted"
});

test.describe("initializeRuntimeConfig", () => {
    test.beforeEach(() => {
        clearRuntimeConfigForTesting();
    });

    test.afterEach(() => {
        clearRuntimeConfigForTesting();
    });

    test(TEST_LABELS.APPLIES_REMOTE_CONFIG, async () => {
        /** @type {{ resource: string, init: RequestInit | undefined }[]} */
        const fetchCalls = [];
        const fetchStub = async (resource, init = undefined) => {
            fetchCalls.push({ resource, init });
            return {
                ok: true,
                status: 200,
                async json() {
                    return {
                        backendBaseUrl: REMOTE_ENDPOINTS.BACKEND,
                        llmProxyUrl: REMOTE_ENDPOINTS.LLM_PROXY
                    };
                }
            };
        };

        /** @type {unknown[]} */
        const errorNotifications = [];
        await initializeRuntimeConfig({
            fetchImplementation: fetchStub,
            location: { hostname: HOSTNAMES.PRODUCTION },
            onError: (error) => {
                errorNotifications.push(error);
            }
        });

        assert.equal(fetchCalls.length, 1);
        assert.equal(fetchCalls[0].resource, RUNTIME_PATHS.PRODUCTION);
        assert.equal(fetchCalls[0].init?.cache, FETCH_OPTIONS.CACHE_DIRECTIVE);
        assert.equal(fetchCalls[0].init?.credentials, FETCH_OPTIONS.CREDENTIAL_POLICY);
        assert.equal(resolveEnvironmentName(), ENVIRONMENT_LABELS.PRODUCTION);
        assert.equal(resolveBackendBaseUrl(), REMOTE_ENDPOINTS.BACKEND);
        assert.equal(resolveLlmProxyUrl(), REMOTE_ENDPOINTS.LLM_PROXY);
        assert.equal(errorNotifications.length, 0);
    });

    test(TEST_LABELS.RETRIES_TRANSIENT_FAILURES, async () => {
        let attemptCount = 0;
        const fetchStub = async () => {
            attemptCount += 1;
            if (attemptCount === 1) {
                throw new Error(TRANSIENT_ERROR_MESSAGES.NETWORK);
            }
            return {
                ok: true,
                status: 200,
                async json() {
                    return { backendBaseUrl: REMOTE_ENDPOINTS.BACKEND };
                }
            };
        };

        /** @type {unknown[]} */
        const errorNotifications = [];
        await initializeRuntimeConfig({
            fetchImplementation: fetchStub,
            location: { hostname: HOSTNAMES.DEVELOPMENT },
            onError: (error) => {
                errorNotifications.push(error);
            }
        });

        assert.equal(attemptCount, 2);
        assert.equal(resolveEnvironmentName(), ENVIRONMENT_LABELS.DEVELOPMENT);
        assert.equal(resolveBackendBaseUrl(), REMOTE_ENDPOINTS.BACKEND);
        assert.equal(resolveLlmProxyUrl(), DEFAULT_ENDPOINTS.DEVELOPMENT_LLM_PROXY);
        assert.equal(errorNotifications.length, 0);
    });

    test(TEST_LABELS.HANDLES_HTTP_FAILURE, async () => {
        const fetchStub = async () => ({
            ok: false,
            status: 503,
            async json() {
                return {};
            }
        });

        /** @type {Error[]} */
        const errorNotifications = [];
        await initializeRuntimeConfig({
            fetchImplementation: fetchStub,
            location: { hostname: HOSTNAMES.DEVELOPMENT },
            onError: (error) => {
                errorNotifications.push(/** @type {Error} */ (error));
            }
        });

        assert.equal(errorNotifications.length, 1);
        assert.equal(errorNotifications[0].message, `${ERROR_MESSAGES.HTTP_FAILURE_PREFIX} 503`);
        assert.equal(resolveEnvironmentName(), ENVIRONMENT_LABELS.DEVELOPMENT);
        assert.equal(resolveBackendBaseUrl(), DEFAULT_ENDPOINTS.BACKEND);
        assert.equal(resolveLlmProxyUrl(), DEFAULT_ENDPOINTS.DEVELOPMENT_LLM_PROXY);
    });

    test(TEST_LABELS.HANDLES_ABORT_FAILURE, async () => {
        const abortError = new Error(TRANSIENT_ERROR_MESSAGES.ABORT);
        abortError.name = ERROR_NAMES.ABORT;
        let attemptCount = 0;
        const fetchStub = async () => {
            attemptCount += 1;
            throw abortError;
        };

        /** @type {Error[]} */
        const errorNotifications = [];
        await initializeRuntimeConfig({
            fetchImplementation: fetchStub,
            location: { hostname: HOSTNAMES.DEVELOPMENT },
            onError: (error) => {
                errorNotifications.push(/** @type {Error} */ (error));
            }
        });

        assert.equal(attemptCount, 2);
        assert.equal(errorNotifications.length, 1);
        assert.equal(errorNotifications[0].message, ERROR_MESSAGES.TIMEOUT_FAILURE);
        assert.equal(errorNotifications[0].cause, abortError);
        assert.equal(resolveEnvironmentName(), ENVIRONMENT_LABELS.DEVELOPMENT);
        assert.equal(resolveBackendBaseUrl(), DEFAULT_ENDPOINTS.BACKEND);
        assert.equal(resolveLlmProxyUrl(), DEFAULT_ENDPOINTS.DEVELOPMENT_LLM_PROXY);
    });
});
