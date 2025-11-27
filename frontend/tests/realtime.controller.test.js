import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeSyncController } from "../js/core/realtimeSyncController.js";

test.describe("RealtimeSyncController", () => {
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

    test("connect opens a withCredentials EventSource", () => {
        const controller = createRealtimeSyncController({
            syncManager: createNoopSyncManager()
        });

        controller.connect({
            baseUrl: "https://gravity.example"
        });

        assert.equal(FakeEventSource.instances.length, 1, "connect should create an EventSource instance");
        assert.equal(
            FakeEventSource.instances[0].url,
            "https://gravity.example/notes/stream",
            "stream URL should target the backend"
        );
        assert.equal(
            FakeEventSource.instances[0].init?.withCredentials,
            true,
            "EventSource should opt into cookie authentication"
        );
        controller.dispose();
    });

    test("disconnect closes the active EventSource", () => {
        const controller = createRealtimeSyncController({
            syncManager: createNoopSyncManager()
        });

        controller.connect({
            baseUrl: "https://gravity.example"
        });
        assert.equal(FakeEventSource.instances.length, 1);
        assert.equal(FakeEventSource.instances[0].closed, false, "EventSource should begin in an open state");

        controller.disconnect();

        assert.equal(FakeEventSource.instances[0].closed, true, "disconnect should close the EventSource");
        controller.dispose();
    });
});

class FakeEventSource {
    /**
     * @param {string} url
     * @param {{ withCredentials?: boolean }|undefined} init
     */
    constructor(url, init = undefined) {
        this.url = url;
        this.closed = false;
        this.readyState = 0;
        this.init = init;
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
