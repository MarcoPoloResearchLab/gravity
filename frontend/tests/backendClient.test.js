// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../js/core/backendClient.js";
import { EVENT_AUTH_SIGN_OUT_REQUEST } from "../js/constants.js";

class StubResponse {
    constructor(status, body, headers = {}) {
        this.status = status;
        this.body = body;
        this.headers = new Map();
        this.headers.set("content-type", "application/json");
        for (const [key, value] of Object.entries(headers)) {
            this.headers.set(String(key).toLowerCase(), value);
        }
    }

    get ok() {
        return this.status >= 200 && this.status < 300;
    }

    async json() {
        return this.body;
    }

    async text() {
        return typeof this.body === "string" ? this.body : JSON.stringify(this.body);
    }

    headers = {
        get: (name) => this.headers.get(String(name).toLowerCase()) ?? null
    };
}

test.afterEach(() => {
    delete global.apiFetch;
});

test("backend client picks up apiFetch when it becomes available", async () => {
    let apiFetchCalls = 0;
    let defaultFetchUsed = false;

    global.fetch = async () => {
        defaultFetchUsed = true;
        throw new Error("default fetch should not be used when apiFetch is available");
    };

    const client = createBackendClient({
        baseUrl: "https://api.example.com"
    });

    global.apiFetch = async (url, init) => {
        apiFetchCalls += 1;
        assert.equal(url, "https://api.example.com/notes");
        assert.equal(init?.method, "GET");
        return new StubResponse(200, { notes: [] });
    };

    const snapshot = await client.fetchSnapshot();
    assert.deepEqual(snapshot, { notes: [] });
    assert.equal(apiFetchCalls, 1);
    assert.equal(defaultFetchUsed, false);
});

test("custom fetch is preferred over apiFetch", async () => {
    let customCalls = 0;
    global.apiFetch = async () => {
        throw new Error("apiFetch should not be used when custom fetch provided");
    };

    const client = createBackendClient({
        baseUrl: "https://api.example.com",
        fetchImplementation: async (url, init) => {
            customCalls += 1;
            assert.equal(url, "https://api.example.com/notes/sync");
            assert.equal(init?.method, "POST");
            return new StubResponse(200, { results: [] });
        }
    });

    const result = await client.syncOperations({ operations: [] });
    assert.deepEqual(result, { results: [] });
    assert.equal(customCalls, 1);
});

test("backend client dispatches sign-out requests on unauthorized responses", async () => {
    const events = [];
    const eventTarget = new EventTarget();
    eventTarget.addEventListener(EVENT_AUTH_SIGN_OUT_REQUEST, (event) => {
        events.push(event?.detail ?? null);
    });

    const responses = [
        new StubResponse(401, { error: "unauthorized" }),
        new StubResponse(200, { notes: [] }),
        new StubResponse(401, { error: "unauthorized" })
    ];

    const client = createBackendClient({
        baseUrl: "https://api.example.com",
        eventTarget,
        fetchImplementation: async () => {
            const response = responses.shift();
            if (!response) {
                throw new Error("unexpected request");
            }
            return response;
        }
    });

    await assert.rejects(() => client.fetchSnapshot());
    const snapshot = await client.fetchSnapshot();
    assert.deepEqual(snapshot, { notes: [] });
    await assert.rejects(() => client.fetchSnapshot());

    assert.equal(events.length, 2);
    assert.equal(events[0]?.reason, "backend-unauthorized");
    assert.equal(events[0]?.status, 401);
});
