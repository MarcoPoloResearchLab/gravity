// @ts-check

let pointerTrackingInitialized = false;
let lastPointerDownTarget = /** @type {Node|null} */ (null);

const NON_EDITABLE_CARD_SURFACE_SELECTORS = Object.freeze([
    ".actions",
    ".card-controls",
    ".meta-chips",
    ".note-expand-toggle"
]);

const INLINE_EDITOR_SURFACE_SELECTORS = Object.freeze([
    ".markdown-editor",
    ".EasyMDEContainer",
    ".CodeMirror"
]);

/**
 * Ensure global pointer tracking is registered only once per document.
 */
export function initializePointerTracking() {
    if (pointerTrackingInitialized || typeof document === "undefined") {
        return;
    }

    document.addEventListener(
        "pointerdown",
        (event) => {
            lastPointerDownTarget = event && event.target instanceof Node ? event.target : null;
        },
        true
    );

    document.addEventListener(
        "mousedown",
        (event) => {
            if (event && event.target instanceof Node) {
                lastPointerDownTarget = event.target;
            }
        },
        true
    );

    pointerTrackingInitialized = true;
}

/**
 * Determine whether inline editing should persist after a blur.
 * @param {HTMLElement} card
 * @returns {boolean}
 */
export function shouldKeepEditingAfterBlur(card) {
    if (!(card instanceof HTMLElement) || typeof document === "undefined") {
        return false;
    }
    if (!card.isConnected || !card.classList.contains("editing-in-place")) {
        return false;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && card.contains(activeElement)) {
        return true;
    }

    if (lastPointerDownTarget instanceof Node && card.contains(lastPointerDownTarget)) {
        return isPointerWithinInlineEditorSurface(card, lastPointerDownTarget);
    }

    return false;
}

/**
 * Determine whether the pointer target falls outside editable surfaces.
 * @param {HTMLElement} target
 * @returns {boolean}
 */
export function shouldIgnoreCardPointerTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    for (const selector of NON_EDITABLE_CARD_SURFACE_SELECTORS) {
        if (target.closest(selector)) {
            return true;
        }
    }

    if (target.closest(".note-task-checkbox")) {
        return true;
    }

    return false;
}

/**
 * Check if the pointer target resides within the inline editor surface.
 * @param {HTMLElement} card
 * @param {Node} pointerTarget
 * @returns {boolean}
 */
export function isPointerWithinInlineEditorSurface(card, pointerTarget) {
    if (!(card instanceof HTMLElement) || !(pointerTarget instanceof Node)) {
        return false;
    }
    if (!card.contains(pointerTarget)) {
        return false;
    }

    const elementTarget = pointerTarget instanceof Element ? pointerTarget : pointerTarget.parentElement;
    if (!(elementTarget instanceof Element)) {
        return false;
    }

    for (const selector of NON_EDITABLE_CARD_SURFACE_SELECTORS) {
        if (elementTarget.closest(selector)) {
            return false;
        }
    }

    const inlineHost = elementTarget.closest(".markdown-editor-host");
    if (inlineHost !== card) {
        return false;
    }

    for (const selector of INLINE_EDITOR_SURFACE_SELECTORS) {
        const surface = /** @type {HTMLElement | null} */ (elementTarget.closest(selector));
        if (!(surface instanceof HTMLElement)) {
            continue;
        }
        const host = surface.closest(".markdown-editor-host");
        if (host !== card) {
            continue;
        }
        if (selector === ".EasyMDEContainer") {
            const containedCodeMirror = /** @type {HTMLElement | null} */ (surface.querySelector(".CodeMirror"));
            if (containedCodeMirror instanceof HTMLElement && !containedCodeMirror.contains(elementTarget)) {
                continue;
            }
        }
        return true;
    }

    return false;
}

/**
 * Reset the cached pointer target. Useful after programmatic focus changes.
 */
export function clearLastPointerDownTarget() {
    lastPointerDownTarget = null;
}
