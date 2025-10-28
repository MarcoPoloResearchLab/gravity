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

export function setEditorHost(card, host) {
    ensureState(card).editorHost = host;
}

export function getEditorHost(card) {
    return stateByCard.get(card)?.editorHost ?? null;
}

export function clearEditorHost(card) {
    const state = stateByCard.get(card);
    if (state) {
        state.editorHost = null;
    }
}

export function incrementFinalizeSuppression(card) {
    ensureState(card).finalizeSuppressionCount += 1;
}

export function decrementFinalizeSuppression(card) {
    const state = ensureState(card);
    if (state.finalizeSuppressionCount > 0) {
        state.finalizeSuppressionCount -= 1;
    }
}

export function isFinalizeSuppressed(card) {
    return (stateByCard.get(card)?.finalizeSuppressionCount ?? 0) > 0;
}

export function getSuppressionState(card) {
    return stateByCard.get(card)?.suppression ?? null;
}

export function setSuppressionState(card, suppression) {
    ensureState(card).suppression = suppression;
}

export function clearSuppressionState(card) {
    const state = stateByCard.get(card);
    if (state) {
        state.suppression = null;
    }
}

export function getOrCreatePendingHeightFrames(card) {
    return ensureState(card).pendingHeightFrames;
}

export function clearPendingHeightFrames(card) {
    const state = stateByCard.get(card);
    if (state) {
        state.pendingHeightFrames = [];
    }
}

export function disposeCardState(card) {
    stateByCard.delete(card);
}
