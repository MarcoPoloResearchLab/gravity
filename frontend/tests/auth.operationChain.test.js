import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests for auth operation serialization in app.js.
 * These tests verify that concurrent auth events are properly serialized
 * and that stale operations bail out when superseded by newer operations.
 */

/**
 * Creates a minimal mock of the auth operation handling logic from gravityApp.
 * This isolates the serialization behavior for testing without requiring
 * the full Alpine component or GravityStore with IndexedDB.
 */
function createAuthOperationHandler() {
    let authOperationChain = Promise.resolve();
    let authOperationId = 0;
    let authUser = null;
    let authState = "loading";

    const operations = [];

    /**
     * Mock GravityStore with controllable async hydration.
     */
    const mockStore = {
        currentScope: null,
        hydrateDelay: 0,
        setUserScope(userId) {
            this.currentScope = userId;
        },
        async hydrateActiveScope() {
            if (this.hydrateDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, this.hydrateDelay));
            }
        }
    };

    function setAuthState(state) {
        authState = state;
    }

    function initializeNotes() {
        operations.push({ type: "initializeNotes", scope: mockStore.currentScope });
    }

    function handleAuthAuthenticated(profile) {
        if (!profile || !profile.id) {
            setAuthState("unauthenticated");
            return Promise.resolve();
        }
        if (authUser?.id === profile.id) {
            return Promise.resolve();
        }

        const operationId = ++authOperationId;
        operations.push({ type: "authenticated:start", operationId, userId: profile.id });

        const runOperation = async () => {
            mockStore.setUserScope(profile.id);
            await mockStore.hydrateActiveScope();
            if (authOperationId !== operationId) {
                operations.push({ type: "authenticated:cancelled", operationId, userId: profile.id });
                return;
            }
            authUser = profile;
            setAuthState("authenticated");
            initializeNotes();
            operations.push({ type: "authenticated:complete", operationId, userId: profile.id });
        };

        const operation = authOperationChain
            .then(runOperation)
            .catch((error) => operations.push({ type: "error", error: error.message }));
        authOperationChain = operation;
        return operation;
    }

    function handleAuthUnauthenticated() {
        const operationId = ++authOperationId;
        operations.push({ type: "unauthenticated:start", operationId });

        const runOperation = async () => {
            authUser = null;
            setAuthState("unauthenticated");
            mockStore.setUserScope(null);
            await mockStore.hydrateActiveScope();
            if (authOperationId !== operationId) {
                operations.push({ type: "unauthenticated:cancelled", operationId });
                return;
            }
            initializeNotes();
            operations.push({ type: "unauthenticated:complete", operationId });
        };

        const operation = authOperationChain
            .then(runOperation)
            .catch((error) => operations.push({ type: "error", error: error.message }));
        authOperationChain = operation;
        return operation;
    }

    return {
        handleAuthAuthenticated,
        handleAuthUnauthenticated,
        mockStore,
        operations,
        getAuthUser: () => authUser,
        getAuthState: () => authState,
        getAuthOperationId: () => authOperationId,
        waitForChain: () => authOperationChain
    };
}

test("single authenticated operation completes normally", async () => {
    const handler = createAuthOperationHandler();
    const user = { id: "user-1", email: "user1@example.com" };

    await handler.handleAuthAuthenticated(user);

    assert.equal(handler.getAuthUser()?.id, "user-1");
    assert.equal(handler.getAuthState(), "authenticated");
    assert.ok(handler.operations.some(o => o.type === "authenticated:complete" && o.operationId === 1));
    assert.ok(handler.operations.some(o => o.type === "initializeNotes" && o.scope === "user-1"));
});

test("single unauthenticated operation completes normally", async () => {
    const handler = createAuthOperationHandler();

    await handler.handleAuthUnauthenticated();

    assert.equal(handler.getAuthUser(), null);
    assert.equal(handler.getAuthState(), "unauthenticated");
    assert.ok(handler.operations.some(o => o.type === "unauthenticated:complete" && o.operationId === 1));
    assert.ok(handler.operations.some(o => o.type === "initializeNotes" && o.scope === null));
});

test("second auth operation supersedes first - only second calls initializeNotes", async () => {
    const handler = createAuthOperationHandler();
    const user1 = { id: "user-1", email: "user1@example.com" };
    const user2 = { id: "user-2", email: "user2@example.com" };

    // Start both operations (second supersedes first)
    const op1 = handler.handleAuthAuthenticated(user1);
    const op2 = handler.handleAuthAuthenticated(user2);

    // Wait for both to complete
    await op1;
    await op2;

    // First should be cancelled, second should complete
    assert.ok(
        handler.operations.some(o => o.type === "authenticated:cancelled" && o.operationId === 1),
        "First operation should be cancelled"
    );
    assert.ok(
        handler.operations.some(o => o.type === "authenticated:complete" && o.operationId === 2),
        "Second operation should complete"
    );

    // Only one initializeNotes call
    const initCalls = handler.operations.filter(o => o.type === "initializeNotes");
    assert.equal(initCalls.length, 1, "initializeNotes should only be called once");
    assert.equal(initCalls[0].scope, "user-2", "initializeNotes should use second user's scope");

    // Final state
    assert.equal(handler.getAuthUser()?.id, "user-2");
});

test("unauthenticated supersedes authenticated operation", async () => {
    const handler = createAuthOperationHandler();
    const user = { id: "user-1", email: "user1@example.com" };

    const authOp = handler.handleAuthAuthenticated(user);
    const unauthOp = handler.handleAuthUnauthenticated();

    await authOp;
    await unauthOp;

    // Auth should be cancelled
    assert.ok(
        handler.operations.some(o => o.type === "authenticated:cancelled" && o.operationId === 1),
        "Authenticated operation should be cancelled"
    );

    // Unauth should complete
    assert.ok(
        handler.operations.some(o => o.type === "unauthenticated:complete" && o.operationId === 2),
        "Unauthenticated operation should complete"
    );

    // Only unauth's initializeNotes
    const initCalls = handler.operations.filter(o => o.type === "initializeNotes");
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].scope, null);

    // Final state
    assert.equal(handler.getAuthUser(), null);
    assert.equal(handler.getAuthState(), "unauthenticated");
});

test("authenticated supersedes unauthenticated operation", async () => {
    const handler = createAuthOperationHandler();
    const user = { id: "user-1", email: "user1@example.com" };

    const unauthOp = handler.handleAuthUnauthenticated();
    const authOp = handler.handleAuthAuthenticated(user);

    await unauthOp;
    await authOp;

    // Unauth should be cancelled
    assert.ok(
        handler.operations.some(o => o.type === "unauthenticated:cancelled" && o.operationId === 1),
        "Unauthenticated operation should be cancelled"
    );

    // Auth should complete
    assert.ok(
        handler.operations.some(o => o.type === "authenticated:complete" && o.operationId === 2),
        "Authenticated operation should complete"
    );

    // Only auth's initializeNotes
    const initCalls = handler.operations.filter(o => o.type === "initializeNotes");
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].scope, "user-1");

    // Final state
    assert.equal(handler.getAuthUser()?.id, "user-1");
    assert.equal(handler.getAuthState(), "authenticated");
});

test("rapid sequence auth->unauth->auth - only final operation completes", async () => {
    const handler = createAuthOperationHandler();
    const user1 = { id: "user-1", email: "user1@example.com" };
    const user2 = { id: "user-2", email: "user2@example.com" };

    const op1 = handler.handleAuthAuthenticated(user1);
    const op2 = handler.handleAuthUnauthenticated();
    const op3 = handler.handleAuthAuthenticated(user2);

    await op1;
    await op2;
    await op3;

    // First two should be cancelled
    assert.ok(handler.operations.some(o => o.type === "authenticated:cancelled" && o.operationId === 1));
    assert.ok(handler.operations.some(o => o.type === "unauthenticated:cancelled" && o.operationId === 2));

    // Third should complete
    assert.ok(handler.operations.some(o => o.type === "authenticated:complete" && o.operationId === 3));

    // Only one initializeNotes call (from op3)
    const initCalls = handler.operations.filter(o => o.type === "initializeNotes");
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].scope, "user-2");

    // Final state
    assert.equal(handler.getAuthUser()?.id, "user-2");
});

test("same user auth is deduplicated", async () => {
    const handler = createAuthOperationHandler();
    const user = { id: "user-1", email: "user1@example.com" };

    // First auth completes
    await handler.handleAuthAuthenticated(user);
    assert.equal(handler.getAuthUser()?.id, "user-1");

    // Second auth for same user is ignored
    await handler.handleAuthAuthenticated({ ...user });

    // Only one operation started
    const startEvents = handler.operations.filter(o => o.type === "authenticated:start");
    assert.equal(startEvents.length, 1, "Second auth for same user should be ignored");
});

test("invalid profile does not start operation", async () => {
    const handler = createAuthOperationHandler();

    await handler.handleAuthAuthenticated(null);
    assert.equal(handler.getAuthOperationId(), 0);
    assert.equal(handler.getAuthState(), "unauthenticated");

    await handler.handleAuthAuthenticated({ email: "test@example.com" });
    assert.equal(handler.getAuthOperationId(), 0);
});

test("operations are serialized - second waits for first to complete", async () => {
    const handler = createAuthOperationHandler();
    handler.mockStore.hydrateDelay = 10; // Add small delay to make timing visible

    const user1 = { id: "user-1", email: "user1@example.com" };
    const user2 = { id: "user-2", email: "user2@example.com" };

    const startTime = Date.now();
    const timestamps = [];

    // Wrap to capture timing
    const originalHydrate = handler.mockStore.hydrateActiveScope.bind(handler.mockStore);
    handler.mockStore.hydrateActiveScope = async function() {
        timestamps.push({ event: "hydrate:start", elapsed: Date.now() - startTime });
        await originalHydrate();
        timestamps.push({ event: "hydrate:end", elapsed: Date.now() - startTime });
    };

    const op1 = handler.handleAuthAuthenticated(user1);
    const op2 = handler.handleAuthAuthenticated(user2);

    await op1;
    await op2;

    // Both hydrations should have run (one for each operation)
    const hydrateStarts = timestamps.filter(t => t.event === "hydrate:start");
    assert.equal(hydrateStarts.length, 2, "Both operations should have called hydrateActiveScope");

    // Second hydrate should start after first ends (serialization)
    const firstEnd = timestamps.find(t => t.event === "hydrate:end");
    const secondStart = timestamps.filter(t => t.event === "hydrate:start")[1];
    assert.ok(
        secondStart.elapsed >= firstEnd.elapsed,
        "Second operation should wait for first to complete"
    );
});
