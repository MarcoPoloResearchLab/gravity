// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { createTAuthSession } from "../js/core/tauthSession.js";

test("createTAuthSession binds the default fetch to the window context for logout fallback", async () => {
    const originalFetch = globalThis.fetch;
    try {
        const fakeWindow = {
            initAuthClient: async () => {},
            getAuthEndpoints: () => ({
                logoutUrl: "https://tauth.local/custom/logout"
            })
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
                    return {};
                }
            });
        };
        globalThis.fetch = mockFetch;

        const session = createTAuthSession({
            baseUrl: "https://tauth.local",
            windowRef: fakeWindow
        });

        await session.signOut();

        assert.equal(fetchCalls.length, 1);
        assert.equal(fetchCalls[0].url, "https://tauth.local/custom/logout");
    } finally {
        if (typeof originalFetch === "function") {
            globalThis.fetch = originalFetch;
        } else {
            delete globalThis.fetch;
        }
    }
});

test("createTAuthSession delegates nonce requests to auth-client helper", async () => {
    const fakeWindow = {
        initAuthClient: async () => {},
        requestNonce: async () => "test-nonce"
    };
    const session = createTAuthSession({
        baseUrl: "https://tauth.local",
        fetchImplementation: async () => ({
            ok: true,
            async json() {
                return {};
            }
        }),
        windowRef: fakeWindow
    });

    const nonce = await session.requestNonce();

    assert.equal(nonce, "test-nonce");
});

test("createTAuthSession delegates credential exchange to auth-client helper", async () => {
    const exchangeCalls = [];
    const fakeWindow = {
        initAuthClient: async () => {},
        exchangeGoogleCredential: async (payload) => {
            exchangeCalls.push(payload);
        }
    };
    const session = createTAuthSession({
        baseUrl: "https://tauth.local",
        fetchImplementation: async () => ({
            ok: true,
            async json() {
                return {};
            }
        }),
        windowRef: fakeWindow
    });

    await session.exchangeGoogleCredential({
        credential: "google-token",
        nonceToken: "nonce-123"
    });

    assert.deepEqual(exchangeCalls, [{ credential: "google-token", nonceToken: "nonce-123" }]);
});
