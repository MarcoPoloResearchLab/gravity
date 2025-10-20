import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveBackendBaseUrl,
    resolveLlmProxyBaseUrl,
    resolveLlmProxyClassifyUrl,
    resolveEnvironmentName
} from "../js/core/config.js";

test("resolveBackendBaseUrl falls back to default without environment", () => {
    const resolved = resolveBackendBaseUrl();
    assert.equal(resolved, "http://localhost:8080");
});

test("resolveBackendBaseUrl respects window.GRAVITY_CONFIG override", () => {
    const resolved = resolveBackendBaseUrl({
        window: {
            GRAVITY_CONFIG: {
                backendBaseUrl: "https://api.example.com/v1/"
            }
        }
    });
    assert.equal(resolved, "https://api.example.com/v1");
});

test("resolveBackendBaseUrl defers to meta tag when global override absent", () => {
    const fakeMeta = {
        getAttribute(name) {
            return name === "content" ? "https://meta.example.com/base" : null;
        }
    };
    const fakeDocument = {
        querySelector(selector) {
            return selector === 'meta[name="gravity-backend-base-url"]' ? fakeMeta : null;
        }
    };
    const resolved = resolveBackendBaseUrl({
        document: fakeDocument
    });
    assert.equal(resolved, "https://meta.example.com/base");
});

test("resolveBackendBaseUrl infers from location when override empty", () => {
    const resolved = resolveBackendBaseUrl({
        window: {
            GRAVITY_CONFIG: {
                backendBaseUrl: "   "
            }
        },
        location: {
            protocol: "https:",
            host: "notes.example.com",
            origin: "https://notes.example.com"
        }
    });
    assert.equal(resolved, "https://notes.example.com");
});

test("resolveBackendBaseUrl uses production environment mapping", () => {
    const resolved = resolveBackendBaseUrl({
        window: {
            GRAVITY_CONFIG: {
                environment: "production"
            }
        }
    });
    assert.equal(resolved, "https://gravity-api.mprlab.com");
});

test("resolveBackendBaseUrl honors environment meta tag", () => {
    const fakeMeta = {
        getAttribute(name) {
            return name === "content" ? "development" : null;
        }
    };
    const fakeDocument = {
        querySelector(selector) {
            return selector === 'meta[name="gravity-environment"]' ? fakeMeta : null;
        }
    };
    const resolved = resolveBackendBaseUrl({
        document: fakeDocument
    });
    assert.equal(resolved, "http://localhost:8080");
});

test("resolveLlmProxyBaseUrl falls back to default proxy host", () => {
    const resolved = resolveLlmProxyBaseUrl();
    assert.equal(resolved, "https://llm-proxy.mprlab.com");
});

test("resolveLlmProxyBaseUrl respects window.GRAVITY_CONFIG override", () => {
    const resolved = resolveLlmProxyBaseUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyBaseUrl: "http://localhost:5001/v1/"
            }
        }
    });
    assert.equal(resolved, "http://localhost:5001/v1");
});

test("resolveLlmProxyBaseUrl defers to meta tag when global override absent", () => {
    const fakeMeta = {
        getAttribute(name) {
            return name === "content" ? "https://meta.llm.example.com/base" : null;
        }
    };
    const fakeDocument = {
        querySelector(selector) {
            return selector === 'meta[name="gravity-llm-proxy-base-url"]' ? fakeMeta : null;
        }
    };
    const resolved = resolveLlmProxyBaseUrl({
        document: fakeDocument
    });
    assert.equal(resolved, "https://meta.llm.example.com/base");
});

test("resolveLlmProxyBaseUrl falls back to origin when overrides blank", () => {
    const resolved = resolveLlmProxyBaseUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyBaseUrl: " "
            }
        },
        location: {
            origin: "https://notes.dev.local"
        }
    });
    assert.equal(resolved, "https://notes.dev.local");
});

test("resolveLlmProxyBaseUrl uses development environment mapping", () => {
    const resolved = resolveLlmProxyBaseUrl({
        window: {
            GRAVITY_CONFIG: {
                environment: "development"
            }
        }
    });
    assert.equal(resolved, "http://computercat:8081");
});

test("resolveLlmProxyClassifyUrl composes default endpoint", () => {
    const resolved = resolveLlmProxyClassifyUrl();
    assert.equal(resolved, "https://llm-proxy.mprlab.com/v1/gravity/classify");
});

test("resolveLlmProxyClassifyUrl respects global override", () => {
    const resolved = resolveLlmProxyClassifyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyClassifyUrl: "http://localhost:5001/api/classify"
            }
        }
    });
    assert.equal(resolved, "http://localhost:5001/api/classify");
});

test("resolveLlmProxyClassifyUrl defers to meta override", () => {
    const fakeMeta = {
        getAttribute(name) {
            return name === "content" ? "https://meta.llm.example.com/api" : null;
        }
    };
    const fakeDocument = {
        querySelector(selector) {
            return selector === 'meta[name="gravity-llm-proxy-classify-url"]' ? fakeMeta : null;
        }
    };
    const resolved = resolveLlmProxyClassifyUrl({
        document: fakeDocument
    });
    assert.equal(resolved, "https://meta.llm.example.com/api");
});

test("resolveLlmProxyClassifyUrl disables requests when override blank", () => {
    const resolved = resolveLlmProxyClassifyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyClassifyUrl: "   "
            }
        }
    });
    assert.equal(resolved, "");
});

test("resolveLlmProxyClassifyUrl composes base overrides", () => {
    const resolved = resolveLlmProxyClassifyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyBaseUrl: "http://localhost:5001/"
            }
        }
    });
    assert.equal(resolved, "http://localhost:5001/v1/gravity/classify");
});

test("resolveLlmProxyClassifyUrl uses environment mapping when provided", () => {
    const resolved = resolveLlmProxyClassifyUrl({
        window: {
            GRAVITY_CONFIG: {
                environment: "development"
            }
        }
    });
    assert.equal(resolved, "http://computercat:8081/v1/gravity/classify");
});

test("resolveEnvironmentName normalizes window config values", () => {
    const resolved = resolveEnvironmentName({
        window: {
            GRAVITY_CONFIG: {
                environment: " Production "
            }
        }
    });
    assert.equal(resolved, "production");
});

test("resolveEnvironmentName defers to meta tag when window absent", () => {
    const fakeMeta = {
        getAttribute(name) {
            if (name === "content") return "development";
            return null;
        }
    };
    const fakeDocument = {
        querySelector(selector) {
            return selector === 'meta[name="gravity-environment"]' ? fakeMeta : null;
        }
    };
    const resolved = resolveEnvironmentName({ document: fakeDocument });
    assert.equal(resolved, "development");
});

test("resolveEnvironmentName returns null for unknown environment values", () => {
    const resolved = resolveEnvironmentName({
        window: {
            GRAVITY_CONFIG: {
                environment: "staging"
            }
        }
    });
    assert.equal(resolved, null);
});
