import assert from "node:assert/strict";
import test from "node:test";

import { hasActiveAuthenticationSession } from "../js/core/authState.js";

test("hasActiveAuthenticationSession identifies active sessions", () => {
    const cases = [
        {
            name: "returns false when authUser is null",
            authUser: null,
            credential: "credential-token",
            expected: false
        },
        {
            name: "returns false when user identifier is empty",
            authUser: { id: "" },
            credential: "credential-token",
            expected: false
        },
        {
            name: "returns false when credential is missing",
            authUser: { id: "user-123" },
            credential: "",
            expected: false
        },
        {
            name: "returns true when user and credential are present",
            authUser: { id: "user-123" },
            credential: "credential-token",
            expected: true
        }
    ];

    for (const scenario of cases) {
        const actual = hasActiveAuthenticationSession(scenario.authUser, scenario.credential);
        assert.equal(actual, scenario.expected, scenario.name);
    }
});
