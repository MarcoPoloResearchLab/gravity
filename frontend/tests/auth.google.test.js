import assert from "node:assert/strict";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import {
    EVENT_AUTH_SIGN_IN,
    EVENT_AUTH_SIGN_OUT
} from "../js/constants.js";
import { createGoogleIdentityController, isGoogleIdentitySupportedOrigin } from "../js/core/auth.js";

const SAMPLE_USER = {
    sub: "demo-user-123",
    email: "demo.user@example.com",
    name: "Demo User",
    picture: "https://example.com/avatar.png"
};

test("createGoogleIdentityController initializes GSI and dispatches auth events", () => {
    const buttonElement = { nodeType: 1 };
    const renderCalls = [];
    let initializeOptions = null;
    let disableCalled = false;
    let promptCalled = false;

    const googleStub = {
        accounts: {
            id: {
                initialize(options) {
                    initializeOptions = options;
                },
                renderButton(target, config) {
                    renderCalls.push({ target, config });
                },
                prompt() {
                    promptCalled = true;
                },
                disableAutoSelect() {
                    disableCalled = true;
                }
            }
        }
    };

    const eventTarget = new EventTarget();
    const signInEvents = [];
    const signOutEvents = [];
    eventTarget.addEventListener(EVENT_AUTH_SIGN_IN, (event) => {
        signInEvents.push(event.detail);
    });
    eventTarget.addEventListener(EVENT_AUTH_SIGN_OUT, (event) => {
        signOutEvents.push(event.detail);
    });

    const controller = createGoogleIdentityController({
        clientId: appConfig.googleClientId,
        google: googleStub,
        buttonElement,
        eventTarget,
        autoPrompt: false
    });

    assert.ok(controller, "controller should be returned");
    assert.ok(initializeOptions, "initialize should be called");
    assert.equal(initializeOptions.client_id, appConfig.googleClientId);
    assert.equal(renderCalls.length, 1);
    assert.equal(renderCalls[0].target, buttonElement);

    assert.equal(signInEvents.length, 0);

    const credential = buildCredential(SAMPLE_USER);
    initializeOptions.callback({ credential });

    assert.equal(signInEvents.length, 1);
    assert.deepEqual(signInEvents[0].user, {
        id: SAMPLE_USER.sub,
        email: SAMPLE_USER.email,
        name: SAMPLE_USER.name,
        pictureUrl: SAMPLE_USER.picture
    });

    controller.signOut();
    assert.ok(disableCalled, "signOut should disable auto select");
    assert.equal(signOutEvents.length, 1);
    assert.equal(signOutEvents[0].reason, "manual");

    controller.dispose();
    assert.ok(promptCalled === false, "autoPrompt disabled should not prompt");
});

function buildCredential(payload) {
    const header = base64UrlEncode({ alg: "RS256", typ: "JWT" });
    const body = base64UrlEncode(payload);
    const signature = "signature-placeholder";
    return `${header}.${body}.${signature}`;
}

function base64UrlEncode(value) {
    const json = JSON.stringify(value);
    const raw = Buffer.from(json, "utf8").toString("base64");
    return raw.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

test("isGoogleIdentitySupportedOrigin filters unsupported protocols", () => {
    assert.equal(isGoogleIdentitySupportedOrigin(null), true);
    assert.equal(isGoogleIdentitySupportedOrigin(undefined), true);
    assert.equal(isGoogleIdentitySupportedOrigin(mockLocation("file:", "")), false);
    assert.equal(isGoogleIdentitySupportedOrigin(mockLocation("about:", "")), false);
    assert.equal(isGoogleIdentitySupportedOrigin(mockLocation("https:", "gravity.mprlab.com")), true);
    assert.equal(isGoogleIdentitySupportedOrigin(mockLocation("http:", "localhost")), true);
    assert.equal(isGoogleIdentitySupportedOrigin(mockLocation("http:", "127.0.0.1")), true);
    assert.equal(isGoogleIdentitySupportedOrigin(mockLocation("http:", "example.com")), false);
});

test("createGoogleIdentityController skips initialization on unsupported origin", () => {
    let initializeCalled = false;
    const googleStub = {
        accounts: {
            id: {
                initialize() {
                    initializeCalled = true;
                },
                renderButton() {},
                prompt() {},
                disableAutoSelect() {}
            }
        }
    };

    const controller = createGoogleIdentityController({
        clientId: appConfig.googleClientId,
        google: googleStub,
        buttonElement: { nodeType: 1, dataset: {} },
        eventTarget: new EventTarget(),
        autoPrompt: true,
        location: mockLocation("file:", "")
    });

    assert.equal(initializeCalled, false);
    assert.ok(controller, "controller should still provide noop methods");
    assert.doesNotThrow(() => controller.signOut());
});

/**
 * @param {string} protocol
 * @param {string} hostname
 * @returns {Location}
 */
function mockLocation(protocol, hostname) {
    return /** @type {Location} */ ({
        protocol,
        hostname
    });
}
