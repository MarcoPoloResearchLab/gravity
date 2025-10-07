// @ts-check

/**
 * Shared focus suppression state for the top editor so other modules can opt out of auto-focus.
 */
let topEditorAutofocusSuppressed = false;

/**
 * Prevent the top editor from reclaiming focus until the suppression is explicitly cleared.
 * @returns {void}
 */
export function suppressTopEditorAutofocus() {
    topEditorAutofocusSuppressed = true;
}

/**
 * Determine whether the top editor is currently prevented from auto-focusing.
 * @returns {boolean}
 */
export function isTopEditorAutofocusSuppressed() {
    return topEditorAutofocusSuppressed;
}

/**
 * Clear any outstanding auto-focus suppression so the top editor may reclaim focus again.
 * @returns {void}
 */
export function clearTopEditorAutofocusSuppression() {
    topEditorAutofocusSuppressed = false;
}
