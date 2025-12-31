import assert from "node:assert/strict";
import test from "node:test";

import { createClassifierClient, ClassifierClient } from "../js/core/classifier.js";
import { clearRuntimeConfigForTesting, setRuntimeConfig } from "../js/core/config.js";

const ENVIRONMENT_DEVELOPMENT = "development";
const EMPTY_STRING = "";

test.beforeEach(() => {
    clearRuntimeConfigForTesting();
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT });
});

test("createClassifierClient uses injected fetch for classification", async () => {
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
    setRuntimeConfig({ environment: ENVIRONMENT_DEVELOPMENT, llmProxyUrl: EMPTY_STRING });
    const result = await ClassifierClient.classifyOrFallback("Any", "Text");
    assert.equal(result.category, "Journal");
    assert.equal(result.status, "idea");
    assert.equal(typeof result.occurred_at, "string");
    assert.equal(result.privacy, "private");
    assert.deepEqual(result.tags, []);
});

test("createClassifierClient returns fallback on fetch error", async () => {
    const client = createClassifierClient({
        fetchImplementation: async () => { throw new Error("network"); }
    });
    const result = await client.classifyOrFallback("Title", "Body");
    assert.equal(result.category, "Journal");
    assert.equal(result.status, "idea");
});
