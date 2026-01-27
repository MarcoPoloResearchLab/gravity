// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { createAppConfig } from "../js/core/config.js?build=2026-01-01T22:43:21Z";
import {
    DEVELOPMENT_ENVIRONMENT_CONFIG,
    ENVIRONMENT_DEVELOPMENT,
    ENVIRONMENT_PRODUCTION,
    PRODUCTION_ENVIRONMENT_CONFIG
} from "../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";

const BACKEND_URL_OVERRIDE = "https://api.example.com/v1/";
const LLM_PROXY_OVERRIDE = "http://localhost:5001/api/classify";
const AUTH_BASE_URL_OVERRIDE = "https://auth.example.com/service/";
const TAUTH_SCRIPT_URL_OVERRIDE = "https://cdn.example.com/tauth.js";
const AUTH_TENANT_OVERRIDE = " gravity ";
const DEFAULT_GOOGLE_CLIENT_ID = "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com";
const GOOGLE_CLIENT_ID_OVERRIDE = "custom-client.apps.googleusercontent.com";

const TEST_LABELS = Object.freeze({
    DEVELOPMENT_DEFAULTS: "createAppConfig uses development defaults with required googleClientId",
    PRODUCTION_DEFAULTS: "createAppConfig rejects production defaults without backendBaseUrl",
    BACKEND_OVERRIDE: "createAppConfig respects injected backendBaseUrl",
    LLM_OVERRIDE: "createAppConfig respects injected llmProxyUrl",
    AUTH_BASE_OVERRIDE: "createAppConfig respects injected authBaseUrl",
    TAUTH_SCRIPT_OVERRIDE: "createAppConfig respects injected tauthScriptUrl",
    AUTH_TENANT_OVERRIDE: "createAppConfig preserves injected authTenantId",
    GOOGLE_CLIENT_ID_OVERRIDE: "createAppConfig preserves injected googleClientId"
});

test(TEST_LABELS.DEVELOPMENT_DEFAULTS, () => {
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });

    assert.equal(appConfig.environment, ENVIRONMENT_DEVELOPMENT);
    assert.equal(appConfig.backendBaseUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.backendBaseUrl);
    assert.equal(appConfig.llmProxyUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.llmProxyUrl);
    assert.equal(appConfig.authBaseUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.authBaseUrl);
    assert.equal(appConfig.tauthScriptUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.tauthScriptUrl);
    assert.equal(appConfig.authTenantId, DEVELOPMENT_ENVIRONMENT_CONFIG.authTenantId);
    assert.equal(appConfig.googleClientId, DEFAULT_GOOGLE_CLIENT_ID);
});

test(TEST_LABELS.PRODUCTION_DEFAULTS, () => {
    // Production config requires runtime overrides from runtime.config.production.json
    // Empty defaults should throw when no override is provided
    assert.throws(
        () => createAppConfig({
            environment: ENVIRONMENT_PRODUCTION,
            googleClientId: DEFAULT_GOOGLE_CLIENT_ID
        }),
        { message: "app_config.invalid_backend_base_url" }
    );
});

test(TEST_LABELS.BACKEND_OVERRIDE, () => {
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        backendBaseUrl: BACKEND_URL_OVERRIDE,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });

    assert.equal(appConfig.backendBaseUrl, BACKEND_URL_OVERRIDE);
});

test(TEST_LABELS.LLM_OVERRIDE, () => {
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        llmProxyUrl: LLM_PROXY_OVERRIDE,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });

    assert.equal(appConfig.llmProxyUrl, LLM_PROXY_OVERRIDE);
});

test(TEST_LABELS.AUTH_BASE_OVERRIDE, () => {
    // Production requires backendBaseUrl override as well
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_PRODUCTION,
        backendBaseUrl: BACKEND_URL_OVERRIDE,
        authBaseUrl: AUTH_BASE_URL_OVERRIDE,
        tauthScriptUrl: TAUTH_SCRIPT_URL_OVERRIDE,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });

    assert.equal(appConfig.authBaseUrl, AUTH_BASE_URL_OVERRIDE);
});

test(TEST_LABELS.TAUTH_SCRIPT_OVERRIDE, () => {
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        tauthScriptUrl: TAUTH_SCRIPT_URL_OVERRIDE,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });

    assert.equal(appConfig.tauthScriptUrl, TAUTH_SCRIPT_URL_OVERRIDE);
});

test(TEST_LABELS.AUTH_TENANT_OVERRIDE, () => {
    // Production requires backendBaseUrl and authBaseUrl overrides as well
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_PRODUCTION,
        backendBaseUrl: BACKEND_URL_OVERRIDE,
        authBaseUrl: AUTH_BASE_URL_OVERRIDE,
        tauthScriptUrl: TAUTH_SCRIPT_URL_OVERRIDE,
        authTenantId: AUTH_TENANT_OVERRIDE,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });

    assert.equal(appConfig.authTenantId, AUTH_TENANT_OVERRIDE);
});

test(TEST_LABELS.GOOGLE_CLIENT_ID_OVERRIDE, () => {
    const appConfig = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        googleClientId: GOOGLE_CLIENT_ID_OVERRIDE
    });

    assert.equal(appConfig.googleClientId, GOOGLE_CLIENT_ID_OVERRIDE);
});
