// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { createTAuthSession } from "../js/core/tauthSession.js";

const TEST_LABELS = Object.freeze({
    SIGN_OUT_DELEGATES_LOGOUT: "createTAuthSession delegates signOut to auth-client logout",
    REQUEST_NONCE_DELEGATES: "createTAuthSession delegates nonce requests to auth-client helper",
    EXCHANGE_DELEGATES: "createTAuthSession delegates credential exchange to auth-client helper"
});

const BASE_URL = "https://tauth.local";
const NONCE_VALUE = "test-nonce";
const CREDENTIAL_TOKEN = "google-token";
const NONCE_TOKEN = "nonce-123";

const EVENT_TARGET = {
    dispatchEvent() {
        return true;
    }
};

test(TEST_LABELS.SIGN_OUT_DELEGATES_LOGOUT, async () => {
    let initCalls = 0;
    let logoutCalls = 0;
    const fakeWindow = {
        initAuthClient: async () => {
            initCalls += 1;
        },
        logout: async () => {
            logoutCalls += 1;
        }
    };

    const session = createTAuthSession({
        baseUrl: BASE_URL,
        eventTarget: EVENT_TARGET,
        windowRef: fakeWindow
    });

    await session.signOut();

    assert.equal(initCalls, 1);
    assert.equal(logoutCalls, 1);
});

test(TEST_LABELS.REQUEST_NONCE_DELEGATES, async () => {
    let initCalls = 0;
    let nonceCalls = 0;
    const fakeWindow = {
        initAuthClient: async () => {
            initCalls += 1;
        },
        requestNonce: async () => {
            nonceCalls += 1;
            return NONCE_VALUE;
        },
        logout: async () => {}
    };

    const session = createTAuthSession({
        baseUrl: BASE_URL,
        eventTarget: EVENT_TARGET,
        windowRef: fakeWindow
    });

    const nonce = await session.requestNonce();

    assert.equal(initCalls, 1);
    assert.equal(nonceCalls, 1);
    assert.equal(nonce, NONCE_VALUE);
});

test(TEST_LABELS.EXCHANGE_DELEGATES, async () => {
    const exchangeCalls = [];
    const fakeWindow = {
        initAuthClient: async () => {},
        exchangeGoogleCredential: async (payload) => {
            exchangeCalls.push(payload);
        },
        logout: async () => {}
    };

    const session = createTAuthSession({
        baseUrl: BASE_URL,
        eventTarget: EVENT_TARGET,
        windowRef: fakeWindow
    });

    await session.exchangeGoogleCredential({
        credential: CREDENTIAL_TOKEN,
        nonceToken: NONCE_TOKEN
    });

    assert.deepEqual(exchangeCalls, [{ credential: CREDENTIAL_TOKEN, nonceToken: NONCE_TOKEN }]);
});
