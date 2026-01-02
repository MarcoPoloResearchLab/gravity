// @ts-check

const URL_BLANKS_PATTERN = /\s/gu;

/**
 * Encode whitespace characters inside URLs to ensure there are no blanks.
 * @param {string} value
 * @returns {string}
 */
export function encodeUrlBlanks(value) {
    return value.replace(URL_BLANKS_PATTERN, (match) => encodeURIComponent(match));
}
