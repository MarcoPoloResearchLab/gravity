import assert from "node:assert/strict";
import test from "node:test";

import {
    initializePointerTracking,
    shouldIgnoreCardPointerTarget,
    shouldKeepEditingAfterBlur,
    isPointerWithinInlineEditorSurface,
    clearLastPointerDownTarget
} from "../js/ui/card/pointerTracking.js";

class ClassList {
    constructor(initial = []) {
        this._classes = new Set(initial);
    }

    add(...classes) {
        for (const value of classes) {
            this._classes.add(value);
        }
    }

    remove(...classes) {
        for (const value of classes) {
            this._classes.delete(value);
        }
    }

    contains(value) {
        return this._classes.has(value);
    }

    toArray() {
        return Array.from(this._classes.values());
    }
}

class StubElement {
    constructor(classes = []) {
        this.parentElement = null;
        this.children = [];
        this.classList = new ClassList(classes);
        this.isConnected = true;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
    }

    contains(node) {
        if (node === this) return true;
        return this.children.some(child => child.contains(node));
    }

    closest(selector) {
        if (typeof selector !== "string" || !selector.startsWith(".")) {
            return null;
        }
        if (this.classList.contains(selector.slice(1))) {
            return this;
        }
        return this.parentElement ? this.parentElement.closest(selector) : null;
    }
}

class DocumentStub {
    constructor() {
        this.listeners = new Map();
        this.activeElement = null;
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }
}

const originalGlobals = {
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    Element: globalThis.Element,
    document: globalThis.document
};

test.beforeEach(() => {
    globalThis.HTMLElement = StubElement;
    globalThis.Node = StubElement;
    globalThis.Element = StubElement;
    globalThis.document = new DocumentStub();
    clearLastPointerDownTarget();
});

test.afterEach(() => {
    globalThis.HTMLElement = originalGlobals.HTMLElement;
    globalThis.Node = originalGlobals.Node;
    if (originalGlobals.Element === undefined) {
        delete globalThis.Element;
    } else {
        globalThis.Element = originalGlobals.Element;
    }
    if (originalGlobals.document === undefined) {
        delete globalThis.document;
    } else {
        globalThis.document = originalGlobals.document;
    }
});

test("initializePointerTracking registers pointer handlers once", () => {
    initializePointerTracking();
    assert.equal(globalThis.document.listeners.size >= 2, true);
    const initialCount = globalThis.document.listeners.size;
    initializePointerTracking();
    assert.equal(globalThis.document.listeners.size, initialCount);
});

test("shouldIgnoreCardPointerTarget detects action surface", () => {
    const card = new StubElement(["markdown-editor-host"]);
    const actionsSurface = new StubElement(["actions"]);
    card.appendChild(actionsSurface);

    assert.equal(shouldIgnoreCardPointerTarget(actionsSurface), true);
    assert.equal(shouldIgnoreCardPointerTarget(card), false);
});

test("shouldKeepEditingAfterBlur honors active element containment", () => {
    const card = new StubElement(["markdown-editor-host", "editing-in-place"]);
    const editorSurface = new StubElement(["markdown-editor"]);
    card.appendChild(editorSurface);
    globalThis.document.activeElement = editorSurface;

    assert.equal(shouldKeepEditingAfterBlur(card), true);
});

test("isPointerWithinInlineEditorSurface matches markdown hosts", () => {
    const card = new StubElement(["markdown-editor-host"]);
    const editorContainer = new StubElement(["markdown-editor"]);
    const easyMdeContainer = new StubElement(["EasyMDEContainer"]);
    const codeMirror = new StubElement(["CodeMirror"]);
    const controlSurface = new StubElement(["actions"]);

    card.appendChild(editorContainer);
    editorContainer.appendChild(easyMdeContainer);
    easyMdeContainer.appendChild(codeMirror);
    card.appendChild(controlSurface);

    assert.equal(isPointerWithinInlineEditorSurface(card, codeMirror), true);
    assert.equal(isPointerWithinInlineEditorSurface(card, editorContainer), true);
    assert.equal(isPointerWithinInlineEditorSurface(card, controlSurface), false);
});
