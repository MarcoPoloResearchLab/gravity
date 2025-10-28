// @ts-check

const stateByCard = new WeakMap();

/**
 * @param {HTMLElement} card
 * @returns {{
 *   editorHost: any,
 *   finalizeSuppressionCount: number,
 *   suppression: Record<string, unknown> | null,
 *   pendingHeightFrames: number[]
 * }}
 */
function ensureState(card) {
    if (!(card instanceof HTMLElement)) {
        throw new Error("card_state.invalid_card_reference");
    }
    let state = stateByCard.get(card);
    if (!state) {
        state = {
            editorHost: null,
            finalizeSuppressionCount: 0,
            suppression: null,
            pendingHeightFrames: []
        };
        stateByCard.set(card, state);
    }
    return state;
}

/**
 * @param {HTMLElement} card
 * @param {unknown} host
 * @returns {void}
 */
export function setEditorHost(card, host) {
    ensureState(card).editorHost = host;
}

/**
 * @param {HTMLElement} card
 * @returns {unknown}
 */
export function getEditorHost(card) {
    return stateByCard.get(card)?.editorHost ?? null;
}

/**
 * @param {HTMLElement} card
 * @returns {void}
 */
export function clearEditorHost(card) {
    const state = stateByCard.get(card);
    if (state) {
        state.editorHost = null;
    }
}

/**
 * @param {HTMLElement} card
 * @returns {void}
 */
export function incrementFinalizeSuppression(card) {
    ensureState(card).finalizeSuppressionCount += 1;
}

/**
 * @param {HTMLElement} card
 * @returns {void}
 */
export function decrementFinalizeSuppression(card) {
    const state = ensureState(card);
    if (state.finalizeSuppressionCount > 0) {
        state.finalizeSuppressionCount -= 1;
    }
}

/**
 * @param {HTMLElement} card
 * @returns {boolean}
 */
export function isFinalizeSuppressed(card) {
    return (stateByCard.get(card)?.finalizeSuppressionCount ?? 0) > 0;
}

/**
 * @param {HTMLElement} card
 * @returns {Record<string, unknown> | null}
 */
export function getSuppressionState(card) {
    return stateByCard.get(card)?.suppression ?? null;
}

/**
 * @param {HTMLElement} card
 * @param {Record<string, unknown> | null} suppression
 * @returns {void}
 */
export function setSuppressionState(card, suppression) {
    ensureState(card).suppression = suppression;
}

/**
 * @param {HTMLElement} card
 * @returns {void}
 */
export function clearSuppressionState(card) {
    const state = stateByCard.get(card);
    if (state) {
        state.suppression = null;
    }
}

/**
 * @param {HTMLElement} card
 * @returns {number[]}
 */
export function getOrCreatePendingHeightFrames(card) {
    return ensureState(card).pendingHeightFrames;
}

/**
 * @param {HTMLElement} card
 * @returns {void}
 */
export function clearPendingHeightFrames(card) {
    const state = stateByCard.get(card);
    if (state) {
        state.pendingHeightFrames = [];
    }
}

/**
 * @param {HTMLElement} card
 * @returns {void}
 */
export function disposeCardState(card) {
    stateByCard.delete(card);
}
