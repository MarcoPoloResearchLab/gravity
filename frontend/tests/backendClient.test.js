import assert from "node:assert/strict";
import test from "node:test";

import { createBackendClient } from "../js/core/backendClient.js";

function createJsonResponse(status, body, headers = {}) {
    const headerMap = new Map();
    headerMap.set("content-type", "application/json");
    for (const [key, value] of Object.entries(headers)) {
        headerMap.set(String(key).toLowerCase(), value);
    }
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get(name) {
                return headerMap.get(String(name).toLowerCase()) ?? null;
            }
        },
        async json() {
            return body;
        },
        async text() {
            return typeof body === "string" ? body : JSON.stringify(body);
        }
    };
}

test("syncOperations retries after refreshing an expired session", async () => {
    const calls = [];
    const responseMap = new Map([
        ["https://api.example.com/notes/sync", [
            createJsonResponse(401, { error: "unauthorized" }),
            createJsonResponse(200, { results: [{ note_id: "note-1" }] })
        ]],
        ["https://auth.example.com/auth/refresh", [
            createJsonResponse(200, { refreshed: true })
        ]]
    ]);

    const fetchImplementation = async (url, init = {}) => {
        calls.push({ url, method: init?.method ?? "GET" });
        const queue = responseMap.get(url);
        if (!queue || queue.length === 0) {
            throw new Error(`no stubbed response for ${url}`);
        }
        return queue.shift();
    };

    const client = createBackendClient({
        baseUrl: "https://api.example.com",
        authBaseUrl: "https://auth.example.com",
        fetchImplementation
    });

    const payload = await client.syncOperations({ operations: [{ note_id: "note-1" }] });

    assert.deepEqual(payload, { results: [{ note_id: "note-1" }] });
    assert.deepEqual(
        calls.map((call) => `${call.method}:${call.url}`),
        [
            "POST:https://api.example.com/notes/sync",
            "POST:https://auth.example.com/auth/refresh",
            "POST:https://api.example.com/notes/sync"
        ]
    );
});

test("syncOperations surfaces backend errors when refresh fails", async () => {
    const calls = [];
    const responseMap = new Map([
        ["https://api.example.com/notes/sync", [
            createJsonResponse(401, { error: "unauthorized" })
        ]],
        ["https://auth.example.com/auth/refresh", [
            createJsonResponse(500, { error: "refresh_failed" })
        ]]
    ]);

    const fetchImplementation = async (url, init = {}) => {
        calls.push({ url, method: init?.method ?? "GET" });
        const queue = responseMap.get(url);
        if (!queue || queue.length === 0) {
            throw new Error(`no stubbed response for ${url}`);
        }
        return queue.shift();
    };

    const client = createBackendClient({
        baseUrl: "https://api.example.com",
        authBaseUrl: "https://auth.example.com",
        fetchImplementation
    });

    await assert.rejects(
        client.syncOperations({ operations: [{ note_id: "note-1" }] }),
        /unauthorized/i
    );
    assert.deepEqual(
        calls.map((call) => `${call.method}:${call.url}`),
        [
            "POST:https://api.example.com/notes/sync",
            "POST:https://auth.example.com/auth/refresh"
        ]
    );
});
