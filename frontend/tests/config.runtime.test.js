import assert from "node:assert/strict";
import test from "node:test";

import {
    clearRuntimeConfigForTesting,
    resolveAuthBaseUrl,
    resolveBackendBaseUrl,
    resolveEnvironmentName,
    resolveLlmProxyUrl,
    setRuntimeConfig
} from "../js/core/config.js";

test.beforeEach(() => {
    clearRuntimeConfigForTesting();
});

test("resolveBackendBaseUrl falls back to default when no config injected", () => {
    assert.equal(resolveBackendBaseUrl(), "http://localhost:8080");
});

test("resolveBackendBaseUrl trims injected URLs", () => {
    setRuntimeConfig({ backendBaseUrl: " https://api.example.com/v1/ " });
    assert.equal(resolveBackendBaseUrl(), "https://api.example.com/v1");
});

test("resolveBackendBaseUrl uses environment defaults when value omitted", () => {
    setRuntimeConfig({ environment: "production" });
    assert.equal(resolveBackendBaseUrl(), "https://gravity-api.mprlab.com");
});

test("resolveLlmProxyUrl falls back to default endpoint", () => {
    assert.equal(resolveLlmProxyUrl(), "https://llm-proxy.mprlab.com/v1/gravity/classify");
});

test("resolveLlmProxyUrl respects injected override", () => {
    setRuntimeConfig({ llmProxyUrl: "http://localhost:5001/api/classify" });
    assert.equal(resolveLlmProxyUrl(), "http://localhost:5001/api/classify");
});

test("resolveLlmProxyUrl preserves intentional blanks", () => {
    setRuntimeConfig({ llmProxyUrl: "   " });
    assert.equal(resolveLlmProxyUrl(), "");
});

test("resolveAuthBaseUrl falls back to default endpoint", () => {
    assert.equal(resolveAuthBaseUrl(), "http://localhost:8082");
});

test("resolveAuthBaseUrl respects injected override", () => {
    setRuntimeConfig({ authBaseUrl: " https://auth.example.com/service/ " });
    assert.equal(resolveAuthBaseUrl(), "https://auth.example.com/service");
});

test("resolveAuthBaseUrl uses environment defaults", () => {
    setRuntimeConfig({ environment: "production" });
    assert.equal(resolveAuthBaseUrl(), "https://gravity-tauth.mprlab.com");
});

test("resolveEnvironmentName normalizes injected value", () => {
    setRuntimeConfig({ environment: " Production " });
    assert.equal(resolveEnvironmentName(), "production");
});

test("resolveEnvironmentName falls back to inferred host classification", () => {
    const originalWindow = globalThis.window;
    try {
        globalThis.window = {
            location: {
                hostname: "gravity-notes.example.com"
            }
        };
        clearRuntimeConfigForTesting();
        assert.equal(resolveEnvironmentName(), "production");
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }
});
