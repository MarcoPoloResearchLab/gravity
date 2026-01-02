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
const AUTH_TENANT_OVERRIDE = " gravity ";

const TEST_LABELS = Object.freeze({
    DEVELOPMENT_DEFAULTS: "createAppConfig uses development defaults when overrides are omitted",
    PRODUCTION_DEFAULTS: "createAppConfig uses production defaults when overrides are omitted",
    BACKEND_OVERRIDE: "createAppConfig respects injected backendBaseUrl",
    LLM_OVERRIDE: "createAppConfig respects injected llmProxyUrl",
    AUTH_BASE_OVERRIDE: "createAppConfig respects injected authBaseUrl",
    AUTH_TENANT_OVERRIDE: "createAppConfig preserves injected authTenantId"
});

test(TEST_LABELS.DEVELOPMENT_DEFAULTS, () => {
    const appConfig = createAppConfig({ environment: ENVIRONMENT_DEVELOPMENT });

    assert.equal(appConfig.environment, ENVIRONMENT_DEVELOPMENT);
    assert.equal(appConfig.backendBaseUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.backendBaseUrl);
    assert.equal(appConfig.llmProxyUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.llmProxyUrl);
    assert.equal(appConfig.authBaseUrl, DEVELOPMENT_ENVIRONMENT_CONFIG.authBaseUrl);
    assert.equal(appConfig.authTenantId, DEVELOPMENT_ENVIRONMENT_CONFIG.authTenantId);
});

test(TEST_LABELS.PRODUCTION_DEFAULTS, () => {
    const appConfig = createAppConfig({ environment: ENVIRONMENT_PRODUCTION });

    assert.equal(appConfig.environment, ENVIRONMENT_PRODUCTION);
    assert.equal(appConfig.backendBaseUrl, PRODUCTION_ENVIRONMENT_CONFIG.backendBaseUrl);
    assert.equal(appConfig.authBaseUrl, PRODUCTION_ENVIRONMENT_CONFIG.authBaseUrl);
    assert.equal(appConfig.authTenantId, PRODUCTION_ENVIRONMENT_CONFIG.authTenantId);
});

test(TEST_LABELS.BACKEND_OVERRIDE, () => {
    const appConfig = createAppConfig({ environment: ENVIRONMENT_DEVELOPMENT, backendBaseUrl: BACKEND_URL_OVERRIDE });

    assert.equal(appConfig.backendBaseUrl, BACKEND_URL_OVERRIDE);
});

test(TEST_LABELS.LLM_OVERRIDE, () => {
    const appConfig = createAppConfig({ environment: ENVIRONMENT_DEVELOPMENT, llmProxyUrl: LLM_PROXY_OVERRIDE });

    assert.equal(appConfig.llmProxyUrl, LLM_PROXY_OVERRIDE);
});

test(TEST_LABELS.AUTH_BASE_OVERRIDE, () => {
    const appConfig = createAppConfig({ environment: ENVIRONMENT_PRODUCTION, authBaseUrl: AUTH_BASE_URL_OVERRIDE });

    assert.equal(appConfig.authBaseUrl, AUTH_BASE_URL_OVERRIDE);
});

test(TEST_LABELS.AUTH_TENANT_OVERRIDE, () => {
    const appConfig = createAppConfig({ environment: ENVIRONMENT_PRODUCTION, authTenantId: AUTH_TENANT_OVERRIDE });

    assert.equal(appConfig.authTenantId, AUTH_TENANT_OVERRIDE);
});
