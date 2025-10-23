import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeSyncController } from "../js/core/realtimeSyncController.js";

test.describe("RealtimeSyncController token expiry guard", () => {
    /** @type {typeof EventSource|undefined} */
    let originalEventSource;

    test.beforeEach(() => {
        originalEventSource = globalThis.EventSource;
        FakeEventSource.reset();
        globalThis.EventSource = FakeEventSource;
    });

    test.afterEach(() => {
        if (typeof originalEventSource === "undefined") {
            delete globalThis.EventSource;
        } else {
            globalThis.EventSource = originalEventSource;
        }
        FakeEventSource.reset();
    });

    test("connect skips realtime stream when backend token already expired", () => {
        let nowMs = Date.now();
        const controller = createRealtimeSyncController({
            syncManager: createNoopSyncManager(),
            now: () => nowMs
        });

        controller.connect({
            baseUrl: "https://example.test",
            accessToken: "expired-token",
            expiresAtMs: nowMs - 1000
        });

        assert.equal(FakeEventSource.instances.length, 0, "EventSource should not start for expired token");
        controller.dispose();
    });

    test("connect disconnects realtime stream before backend token expiry", async () => {
        let nowMs = Date.now();
        const controller = createRealtimeSyncController({
            syncManager: createNoopSyncManager(),
            now: () => nowMs
        });

        const expiresAtMs = nowMs + 1500;
        controller.connect({
            baseUrl: "https://gravity.example",
            accessToken: "live-token",
            expiresAtMs
        });

        assert.equal(FakeEventSource.instances.length, 1, "EventSource should open when token is valid");

        // Advance the logical clock and wait for the expiry guard to execute.
        nowMs = expiresAtMs + 10;
        await delay(600);

        assert.equal(FakeEventSource.instances.length, 1, "No additional reconnects should be attempted");
        assert.equal(FakeEventSource.instances[0].closed, true, "EventSource should close before expiry");
        controller.dispose();
    });
});

class FakeEventSource {
    /**
     * @param {string} url
     * @param {{ withCredentials?: boolean }|undefined} _init
     */
    constructor(url, _init) {
        this.url = url;
        this.closed = false;
        this.readyState = 0;
        FakeEventSource.instances.push(this);
    }

    /**
     * @param {string} _type
     * @param {() => void} _handler
     * @returns {void}
     */
    addEventListener(_type, _handler) {}

    /**
     * @returns {void}
     */
    close() {
        this.closed = true;
        this.readyState = 2;
    }

    static reset() {
        FakeEventSource.instances.length = 0;
    }
}

FakeEventSource.instances = [];

/**
 * @returns {any}
 */
function createNoopSyncManager() {
    return {
        async synchronize() {
            return { queueFlushed: false, snapshotApplied: false };
        }
    };
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
