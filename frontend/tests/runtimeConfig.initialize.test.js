// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { initializeRuntimeConfig } from "../js/core/runtimeConfig.js";
import {
    DEVELOPMENT_ENVIRONMENT_CONFIG,
    ENVIRONMENT_DEVELOPMENT,
    ENVIRONMENT_PRODUCTION
} from "../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";

const TEST_LABELS = Object.freeze({
    APPLIES_REMOTE_CONFIG: "initializeRuntimeConfig applies remote payload when fetch succeeds",
    RETRIES_TRANSIENT_FAILURES: "initializeRuntimeConfig retries transient failures before succeeding",
    HANDLES_HTTP_FAILURE: "initializeRuntimeConfig rejects HTTP failures",
    HANDLES_ABORT_FAILURE: "initializeRuntimeConfig normalizes abort failures into timeout errors"
});

const HOSTNAMES = Object.freeze({
    PRODUCTION: "gravity-notes.example.com",
    DEVELOPMENT: "localhost"
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
    LLM_PROXY: "https://llm.example.com/v1/classify",
    AUTH: "https://auth.example.com",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com"
});

const REMOTE_AUTH_TENANT_ID = "gravity";

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

const SUITE_LABELS = Object.freeze({
    INITIALIZE_RUNTIME_CONFIG: "initializeRuntimeConfig"
});

test.describe(SUITE_LABELS.INITIALIZE_RUNTIME_CONFIG, () => {
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
                        environment: ENVIRONMENT_PRODUCTION,
                        backendBaseUrl: REMOTE_ENDPOINTS.BACKEND,
                        llmProxyUrl: REMOTE_ENDPOINTS.LLM_PROXY,
                        authBaseUrl: REMOTE_ENDPOINTS.AUTH,
                        authTenantId: REMOTE_AUTH_TENANT_ID,
                        googleClientId: REMOTE_ENDPOINTS.GOOGLE_CLIENT_ID
                    };
                }
            };
        };

        /** @type {unknown[]} */
        const errorNotifications = [];
        const appConfig = await initializeRuntimeConfig({
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
        assert.equal(appConfig.environment, ENVIRONMENT_PRODUCTION);
        assert.equal(appConfig.backendBaseUrl, REMOTE_ENDPOINTS.BACKEND);
        assert.equal(appConfig.llmProxyUrl, REMOTE_ENDPOINTS.LLM_PROXY);
        assert.equal(appConfig.authBaseUrl, REMOTE_ENDPOINTS.AUTH);
        assert.equal(appConfig.authTenantId, REMOTE_AUTH_TENANT_ID);
        assert.equal(appConfig.googleClientId, REMOTE_ENDPOINTS.GOOGLE_CLIENT_ID);
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
                    return {
                        environment: ENVIRONMENT_DEVELOPMENT,
                        backendBaseUrl: REMOTE_ENDPOINTS.BACKEND,
                        googleClientId: REMOTE_ENDPOINTS.GOOGLE_CLIENT_ID
                    };
                }
            };
        };

        /** @type {unknown[]} */
        const errorNotifications = [];
        const appConfig = await initializeRuntimeConfig({
            fetchImplementation: fetchStub,
            location: { hostname: HOSTNAMES.DEVELOPMENT },
            onError: (error) => {
                errorNotifications.push(error);
            }
        });

        assert.equal(attemptCount, 2);
        assert.equal(appConfig.environment, ENVIRONMENT_DEVELOPMENT);
        assert.equal(appConfig.backendBaseUrl, REMOTE_ENDPOINTS.BACKEND);
        assert.equal(appConfig.llmProxyUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.llmProxyUrl);
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
        await assert.rejects(
            () => initializeRuntimeConfig({
                fetchImplementation: fetchStub,
                location: { hostname: HOSTNAMES.DEVELOPMENT },
                onError: (error) => {
                    errorNotifications.push(/** @type {Error} */ (error));
                }
            }),
            (error) => {
                assert.equal(error.message, `${ERROR_MESSAGES.HTTP_FAILURE_PREFIX} 503`);
                return true;
            }
        );

        assert.equal(errorNotifications.length, 1);
        assert.equal(errorNotifications[0].message, `${ERROR_MESSAGES.HTTP_FAILURE_PREFIX} 503`);
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
        await assert.rejects(
            () => initializeRuntimeConfig({
                fetchImplementation: fetchStub,
                location: { hostname: HOSTNAMES.DEVELOPMENT },
                onError: (error) => {
                    errorNotifications.push(/** @type {Error} */ (error));
                }
            }),
            (error) => {
                assert.equal(error.message, ERROR_MESSAGES.TIMEOUT_FAILURE);
                assert.equal(error.cause, abortError);
                return true;
            }
        );

        assert.equal(attemptCount, 2);
        assert.equal(errorNotifications.length, 1);
        assert.equal(errorNotifications[0].message, ERROR_MESSAGES.TIMEOUT_FAILURE);
        assert.equal(errorNotifications[0].cause, abortError);
    });
});
