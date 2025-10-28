// @ts-check

const timersByElement = new WeakMap();

/**
 * Clear any scheduled feedback timeout for the given element.
 * @param {HTMLElement} element
 */
export function clearCopyFeedbackTimer(element) {
    const existing = timersByElement.get(element);
    if (typeof existing === "number") {
        clearTimeout(existing);
    }
    timersByElement.delete(element);
}

/**
 * Track a newly scheduled feedback timeout.
 * @param {HTMLElement} element
 * @param {ReturnType<typeof setTimeout>} timer
 */
export function storeCopyFeedbackTimer(element, timer) {
    timersByElement.set(element, /** @type {number} */ (Number(timer)));
}

/**
 * Determine whether a feedback timeout is pending for an element.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function hasCopyFeedbackTimer(element) {
    return timersByElement.has(element);
}
