// @ts-check

/**
 * Create an element with optional class name and text content.
 * @param {keyof HTMLElementTagNameMap} tag
 * @param {string} [className]
 * @param {string|null} [text]
 * @returns {HTMLElement}
 */
export function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text != null) {
        element.textContent = text;
    }
    return element;
}

/**
 * Adjust a textarea's height to match its content.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ minHeightPx?: number, extraPaddingPx?: number }} [options]
 * @returns {void}
 */
export function autoResize(textarea, options = {}) {
    if (!(textarea instanceof HTMLTextAreaElement)) {
        return;
    }
    const { minHeightPx = 0, extraPaddingPx = 5 } = options;
    textarea.style.height = "auto";
    const measured = textarea.scrollHeight + extraPaddingPx;
    const nextHeight = Math.max(measured, minHeightPx);
    textarea.style.height = `${nextHeight}px`;
}
