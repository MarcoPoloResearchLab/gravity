// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { createClassifierClient } from "../js/core/classifier.js";
import { createAppConfig } from "../js/core/config.js?build=2026-01-01T22:43:21Z";
import { ENVIRONMENT_DEVELOPMENT } from "../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";

const EMPTY_STRING = "";
const DEFAULT_GOOGLE_CLIENT_ID = "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com";

test("createClassifierClient uses injected fetch for classification", async () => {
    const config = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });
    const mockResponse = {
        ok: true,
        status: 200,
        async json() {
            return {
                category: "Projects",
                status: "draft",
                privacy: "shareable",
                occurred_at: "2020-01-01T00:00:00.000Z",
                project_name: "Moving Maps",
                areas: ["finance", "infra"],
                people_handles: ["@alice", "bob"],
                tags: ["Quarterly Plan", "Infra & Ops"]
            };
        }
    };
    const fetchCalls = [];
    const client = createClassifierClient({
        config,
        fetchImplementation: async (url, options) => {
            fetchCalls.push({ url, options });
            return mockResponse;
        }
    });

    const result = await client.classifyOrFallback("Title", "Body");

    assert.equal(fetchCalls.length, 1, "injected fetch should be called once");
    assert.equal(result.category, "Projects");
    assert.equal(result.status, "draft");
    assert.equal(result.privacy, "shareable");
    assert.equal(result.occurred_at, "2020-01-01T00:00:00.000Z");
    assert.equal(result.project_name, "Moving Maps");
    assert.deepEqual(result.areas, ["Finance", "Infra"], "areas should be title-cased");
    assert.deepEqual(result.people_handles, ["@alice"], "non-handle entries are filtered out");
    assert.deepEqual(result.tags, ["quarterly-plan", "infra-ops"], "tags normalized via toTagToken");
});

test("ClassifierClient falls back when endpoint disabled", async () => {
    const config = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        llmProxyUrl: EMPTY_STRING,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });
    const client = createClassifierClient({ config });
    const result = await client.classifyOrFallback("Any", "Text");
    assert.equal(result.category, "Journal");
    assert.equal(result.status, "idea");
    assert.equal(typeof result.occurred_at, "string");
    assert.equal(result.privacy, "private");
    assert.deepEqual(result.tags, []);
});

test("createClassifierClient returns fallback on fetch error", async () => {
    const config = createAppConfig({
        environment: ENVIRONMENT_DEVELOPMENT,
        googleClientId: DEFAULT_GOOGLE_CLIENT_ID
    });
    const client = createClassifierClient({
        config,
        fetchImplementation: async () => { throw new Error("network"); }
    });
    const result = await client.classifyOrFallback("Title", "Body");
    assert.equal(result.category, "Journal");
    assert.equal(result.status, "idea");
});
