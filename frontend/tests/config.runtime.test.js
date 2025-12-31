import assert from "node:assert/strict";
import test from "node:test";

import {
    clearRuntimeConfigForTesting,
    resolveAuthBaseUrl,
    resolveAuthTenantId,
    resolveBackendBaseUrl,
    resolveEnvironmentName,
    resolveLlmProxyUrl,
    setRuntimeConfig
} from "../js/core/config.js";

const ENVIRONMENT_PRODUCTION = "production";
const ENVIRONMENT_DEVELOPMENT = "development";
const EMPTY_STRING = "";

const BACKEND_URL_INPUT = " https://api.example.com/v1/ ";
const BACKEND_URL_EXPECTED = "https://api.example.com/v1";
const PRODUCTION_BACKEND_URL = "https://gravity-api.mprlab.com";

const LLM_PROXY_OVERRIDE = "http://localhost:5001/api/classify";
const DEVELOPMENT_LLM_PROXY_URL = "http://computercat:8081/v1/gravity/classify";

const AUTH_BASE_URL_INPUT = " https://auth.example.com/service/ ";
const AUTH_BASE_URL_EXPECTED = "https://auth.example.com/service";
const PRODUCTION_AUTH_BASE_URL = "https://tauth.mprlab.com";

const AUTH_TENANT_INPUT = " gravity ";
const AUTH_TENANT_EXPECTED = "gravity";

const SPACED_ENVIRONMENT_PRODUCTION = " Production ";
const BLANK_INPUT = "   ";

test.beforeEach(() => {
    clearRuntimeConfigForTesting();
});

test("resolveBackendBaseUrl throws when config missing", () => {
    assert.throws(() => resolveBackendBaseUrl());
});

test("resolveLlmProxyUrl throws when config missing", () => {
    assert.throws(() => resolveLlmProxyUrl());
});

test("resolveAuthBaseUrl throws when config missing", () => {
    assert.throws(() => resolveAuthBaseUrl());
});

test("resolveAuthTenantId throws when config missing", () => {
    assert.throws(() => resolveAuthTenantId());
});

test("resolveEnvironmentName throws when config missing", () => {
    assert.throws(() => resolveEnvironmentName());
});

test("setRuntimeConfig throws when environment missing", () => {
    assert.throws(() => setRuntimeConfig({ backendBaseUrl: BACKEND_URL_INPUT }));
});

test("resolveBackendBaseUrl trims injected URLs", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT, backendBaseUrl: BACKEND_URL_INPUT });
    assert.equal(resolveBackendBaseUrl(), BACKEND_URL_EXPECTED);
});

test("resolveBackendBaseUrl uses environment defaults when value omitted", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_PRODUCTION });
    assert.equal(resolveBackendBaseUrl(), PRODUCTION_BACKEND_URL);
});

test("resolveLlmProxyUrl uses environment defaults when value omitted", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT });
    assert.equal(resolveLlmProxyUrl(), DEVELOPMENT_LLM_PROXY_URL);
});

test("resolveLlmProxyUrl respects injected override", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT, llmProxyUrl: LLM_PROXY_OVERRIDE });
    assert.equal(resolveLlmProxyUrl(), LLM_PROXY_OVERRIDE);
});

test("resolveLlmProxyUrl preserves intentional blanks", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT, llmProxyUrl: BLANK_INPUT });
    assert.equal(resolveLlmProxyUrl(), EMPTY_STRING);
});

test("resolveAuthBaseUrl respects injected override", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_PRODUCTION, authBaseUrl: AUTH_BASE_URL_INPUT });
    assert.equal(resolveAuthBaseUrl(), AUTH_BASE_URL_EXPECTED);
});

test("resolveAuthBaseUrl uses environment defaults", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_PRODUCTION });
    assert.equal(resolveAuthBaseUrl(), PRODUCTION_AUTH_BASE_URL);
});

test("resolveAuthTenantId trims injected values", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_PRODUCTION, authTenantId: AUTH_TENANT_INPUT });
    assert.equal(resolveAuthTenantId(), AUTH_TENANT_EXPECTED);
});

test("resolveAuthTenantId uses environment defaults", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_PRODUCTION });
    assert.equal(resolveAuthTenantId(), AUTH_TENANT_EXPECTED);
});

test("resolveEnvironmentName normalizes injected value", () => {
    setRuntimeConfig({ environment: SPACED_ENVIRONMENT_PRODUCTION });
    assert.equal(resolveEnvironmentName(), ENVIRONMENT_PRODUCTION);
});

test("resolveEnvironmentName returns configured value", () => {
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT });
    assert.equal(resolveEnvironmentName(), ENVIRONMENT_DEVELOPMENT);
});
