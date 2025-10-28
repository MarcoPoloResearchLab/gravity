import assert from "node:assert/strict";
import test from "node:test";

import { initializeVersionRefresh } from "../js/utils/versionRefresh.js";

const MANIFEST_URL = "/data/version.json";

test.describe("GN-206 version refresh watcher", () => {
    test("does not reload when manifest version matches current build", async () => {
        const reloadCalls = [];
        const mismatchCalls = [];
        const controller = initializeVersionRefresh({
            currentVersion: "v-current",
            manifestUrl: MANIFEST_URL,
            fetchImpl: async () => ({
                ok: true,
                json: async () => ({ version: "v-current" })
            }),
            reload: () => {
                reloadCalls.push(Date.now());
            },
            onVersionMismatch: (current, remote) => {
                mismatchCalls.push({ current, remote });
            },
            checkIntervalMs: 10,
            autoStart: false
        });
        try {
            const result = await controller.checkNow();
            assert.equal(result.reloaded, false, "check should not trigger a reload when versions match");
            assert.equal(reloadCalls.length, 0, "reload should not be invoked when versions match");
            assert.equal(mismatchCalls.length, 0, "onVersionMismatch should not run when versions match");
        } finally {
            controller.dispose();
        }
    });

    test("reloads when manifest version diverges from the active build", async () => {
        let reloadCount = 0;
        const mismatchCalls = [];
        const controller = initializeVersionRefresh({
            currentVersion: "v-current",
            manifestUrl: MANIFEST_URL,
            fetchImpl: async () => ({
                ok: true,
                json: async () => ({ version: "v-next" })
            }),
            reload: () => {
                reloadCount += 1;
            },
            onVersionMismatch: (current, remote) => {
                mismatchCalls.push({ current, remote });
            },
            checkIntervalMs: 10,
            autoStart: false
        });
        try {
            const result = await controller.checkNow();
            assert.equal(result.reloaded, true, "check should signal that a reload was triggered");
            assert.equal(reloadCount, 1, "reload should be invoked exactly once on version mismatch");
            assert.deepEqual(
                mismatchCalls,
                [{ current: "v-current", remote: "v-next" }],
                "onVersionMismatch should receive previous and remote versions"
            );
        } finally {
            controller.dispose();
        }
    });
});
