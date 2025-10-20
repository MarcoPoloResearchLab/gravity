import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveBackendBaseUrl,
    resolveLlmProxyUrl,
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
    const resolved = resolveBackendBaseUrl({ document: fakeDocument });
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
    const resolved = resolveBackendBaseUrl({ document: fakeDocument });
    assert.equal(resolved, "http://localhost:8080");
});

test("resolveLlmProxyUrl falls back to default endpoint", () => {
    const resolved = resolveLlmProxyUrl();
    assert.equal(resolved, "https://llm-proxy.mprlab.com/v1/gravity/classify");
});

test("resolveLlmProxyUrl respects window.GRAVITY_CONFIG override", () => {
    const resolved = resolveLlmProxyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyUrl: "  http://localhost:5001/api/classify  "
            }
        }
    });
    assert.equal(resolved, "http://localhost:5001/api/classify");
});

test("resolveLlmProxyUrl respects meta tag override", () => {
    const fakeMeta = {
        getAttribute(name) {
            return name === "content" ? "https://meta.llm.example.com/api" : null;
        }
    };
    const fakeDocument = {
        querySelector(selector) {
            return selector === 'meta[name="gravity-llm-proxy-url"]' ? fakeMeta : null;
        }
    };
    const resolved = resolveLlmProxyUrl({ document: fakeDocument });
    assert.equal(resolved, "https://meta.llm.example.com/api");
});

test("resolveLlmProxyUrl returns blank when override is blank", () => {
    const resolved = resolveLlmProxyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyUrl: "   "
            }
        }
    });
    assert.equal(resolved, "");
});

test("resolveLlmProxyUrl honors legacy classify override", () => {
    const resolved = resolveLlmProxyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyClassifyUrl: "http://localhost:5001/v1/gravity/custom"
            }
        }
    });
    assert.equal(resolved, "http://localhost:5001/v1/gravity/custom");
});

test("resolveLlmProxyUrl composes legacy base override", () => {
    const resolved = resolveLlmProxyUrl({
        window: {
            GRAVITY_CONFIG: {
                llmProxyBaseUrl: "http://localhost:5001/"
            }
        }
    });
    assert.equal(resolved, "http://localhost:5001/v1/gravity/classify");
});

test("resolveLlmProxyUrl uses development environment mapping", () => {
    const resolved = resolveLlmProxyUrl({
        window: {
            GRAVITY_CONFIG: {
                environment: "development"
            }
        }
    });
    assert.equal(resolved, "http://computercat:8081/v1/gravity/classify");
});

test("resolveLlmProxyUrl infers endpoint from location when overrides absent", () => {
    const resolved = resolveLlmProxyUrl({
        location: {
            origin: "https://notes.dev.local"
        }
    });
    assert.equal(resolved, "https://notes.dev.local/v1/gravity/classify");
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
