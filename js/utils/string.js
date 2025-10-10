// @ts-check

/**
 * Convert text to title case (first letter uppercase per word).
 * @param {string} text
 * @returns {string}
 */
export function titleCase(text) {
    if (typeof text !== "string" || text.length === 0) {
        return "";
    }
    return text
        .toLowerCase()
        .split(" ")
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

/**
 * Normalise arbitrary text into a tag-friendly token.
 * @param {string} text
 * @returns {string}
 */
export function toTagToken(text) {
    if (typeof text !== "string") {
        return "";
    }
    return text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-|-$/g, "");
}

/**
 * Determine whether a value is a non-empty string after trimming.
 * @param {unknown} value
 * @returns {value is string}
 */
export function isNonBlankString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
