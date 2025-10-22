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
