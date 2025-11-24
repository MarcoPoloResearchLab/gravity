import assert from "node:assert/strict";
import test from "node:test";

import { createTAuthSession } from "../js/core/tauthSession.js";

test("createTAuthSession binds the default fetch to the window context", async () => {
    const originalFetch = globalThis.fetch;
    try {
        const fakeWindow = {
            initAuthClient: async () => {},
            logout: async () => {}
        };
        const fetchCalls = [];
        /** @type {(input: RequestInfo, init?: RequestInit) => Promise<Response>} */
        const mockFetch = function mockFetch(url, init) {
            if (this !== fakeWindow) {
                throw new TypeError("fetch invoked with incorrect context");
            }
            fetchCalls.push({ url, init });
            return Promise.resolve({
                ok: true,
                async json() {
                    return { nonce: "test-nonce" };
                }
            });
        };
        globalThis.fetch = mockFetch;

        const session = createTAuthSession({
            baseUrl: "https://tauth.local",
            windowRef: fakeWindow
        });

        const nonce = await session.requestNonce();
        assert.equal(nonce, "test-nonce");
        assert.equal(fetchCalls.length, 1);
        assert.ok(String(fetchCalls[0].url).startsWith("https://tauth.local/auth/nonce"));
    } finally {
        if (typeof originalFetch === "function") {
            globalThis.fetch = originalFetch;
        } else {
            delete globalThis.fetch;
        }
    }
});
