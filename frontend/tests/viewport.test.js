import assert from "node:assert/strict";
import test from "node:test";

import {
    clamp,
    captureViewportAnchor,
    shouldCenterCard,
    computeCenteredCardTop,
    maintainCardViewport
} from "../js/ui/card/viewport.js";

class StubHTMLElement {
    constructor(top = 0, height = 100) {
        this._top = top;
        this.height = height;
        this.isConnected = true;
    }

    getBoundingClientRect() {
        return {
            top: this._top,
            bottom: this._top + this.height,
            height: this.height
        };
    }

    setTop(nextTop) {
        this._top = nextTop;
    }
}

const originalGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    HTMLElement: globalThis.HTMLElement
};

test.beforeEach(() => {
    globalThis.window = {
        innerHeight: 600,
        scrollY: 0,
        scrollTo: (x, y) => {
            globalThis.window.scrollY = y;
        }
    };
    const scroller = new StubHTMLElement();
    scroller.scrollHeight = 2000;
    globalThis.document = {
        scrollingElement: scroller,
        documentElement: scroller
    };
    globalThis.requestAnimationFrame = (callback) => {
        callback();
        return 1;
    };
    globalThis.HTMLElement = StubHTMLElement;
});

test.afterEach(() => {
    if (originalGlobals.window === undefined) {
        delete globalThis.window;
    } else {
        globalThis.window = originalGlobals.window;
    }
    if (originalGlobals.document === undefined) {
        delete globalThis.document;
    } else {
        globalThis.document = originalGlobals.document;
    }
    if (originalGlobals.requestAnimationFrame === undefined) {
        delete globalThis.requestAnimationFrame;
    } else {
        globalThis.requestAnimationFrame = originalGlobals.requestAnimationFrame;
    }
    if (originalGlobals.HTMLElement === undefined) {
        delete globalThis.HTMLElement;
    } else {
        globalThis.HTMLElement = originalGlobals.HTMLElement;
    }
});

test("clamp enforces numeric boundaries", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-2, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
});

test("captureViewportAnchor reports bounding metrics", () => {
    const card = new StubHTMLElement(120, 140);
    const anchor = captureViewportAnchor(card);
    assert.ok(anchor);
    assert.equal(anchor?.top, 120);
    assert.equal(anchor?.bottom, 260);
    assert.equal(anchor?.height, 140);
    assert.equal(anchor?.viewportHeight, 600);
});

test("shouldCenterCard reflects viewport proximity", () => {
    const anchorNearTop = { top: 5, bottom: 205, height: 200, viewportHeight: 600 };
    const anchorCentered = { top: 200, bottom: 420, height: 220, viewportHeight: 600 };
    assert.equal(shouldCenterCard(anchorNearTop), true);
    assert.equal(shouldCenterCard(anchorCentered), false);
});

test("computeCenteredCardTop stays within margins", () => {
    const centered = computeCenteredCardTop(200, 600);
    assert.equal(centered >= -24, true);
    assert.equal(centered <= 600 - 200 - 24, true);
});

test("maintainCardViewport scrolls card towards anchor", () => {
    const card = new StubHTMLElement(420, 160);
    const anchor = {
        top: 180,
        bottom: 340,
        height: 160,
        viewportHeight: 600
    };
    globalThis.window.scrollTo = (x, y) => {
        globalThis.window.scrollY = y;
        card.setTop(anchor.top);
    };

    maintainCardViewport(card, { anchor });

    assert.equal(globalThis.window.scrollY, 240);
    assert.equal(card.getBoundingClientRect().top, anchor.top);
});
