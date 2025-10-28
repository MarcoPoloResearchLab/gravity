import assert from "node:assert/strict";
import test from "node:test";

import {
    setEditorHost,
    getEditorHost,
    incrementFinalizeSuppression,
    decrementFinalizeSuppression,
    isFinalizeSuppressed,
    getSuppressionState,
    setSuppressionState,
    clearSuppressionState,
    getOrCreatePendingHeightFrames,
    clearPendingHeightFrames,
    disposeCardState
} from "../js/ui/card/cardState.js";

class StubElement {
    constructor() {
        this.parentElement = null;
        this.children = [];
        this.isConnected = true;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
    }
}

const originalHTMLElement = globalThis.HTMLElement;

test.before(() => {
    globalThis.HTMLElement = StubElement;
});

test.after(() => {
    globalThis.HTMLElement = originalHTMLElement;
});

test("cardState stores editor hosts", () => {
    const card = new StubElement();
    const host = { id: "editor-host" };

    setEditorHost(card, host);
    assert.equal(getEditorHost(card), host);

    disposeCardState(card);
    assert.equal(getEditorHost(card), null);
});

test("cardState tracks finalize suppression counts", () => {
    const card = new StubElement();

    assert.equal(isFinalizeSuppressed(card), false);
    incrementFinalizeSuppression(card);
    incrementFinalizeSuppression(card);
    assert.equal(isFinalizeSuppressed(card), true);

    decrementFinalizeSuppression(card);
    assert.equal(isFinalizeSuppressed(card), true);
    decrementFinalizeSuppression(card);
    assert.equal(isFinalizeSuppressed(card), false);
});

test("cardState stores suppression metadata", () => {
    const card = new StubElement();
    const metadata = { mode: "edit", wasEditing: true };

    setSuppressionState(card, metadata);
    assert.equal(getSuppressionState(card), metadata);

    clearSuppressionState(card);
    assert.equal(getSuppressionState(card), null);
});

test("cardState manages pending height frames", () => {
    const card = new StubElement();

    const handles = getOrCreatePendingHeightFrames(card);
    handles.push(1, 2, 3);
    assert.deepEqual(getOrCreatePendingHeightFrames(card), [1, 2, 3]);

    clearPendingHeightFrames(card);
    assert.deepEqual(getOrCreatePendingHeightFrames(card), []);
});
