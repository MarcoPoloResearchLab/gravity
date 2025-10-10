// @ts-check

/**
 * Constrain a value to a whitelist, returning a fallback when it does not match.
 * @template T
 * @param {string} value
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
export function clampEnum(value, allowed, fallback) {
    return (typeof value === "string" && allowed.includes(/** @type {T & string} */ (value)))
        ? /** @type {T} */ (value)
        : fallback;
}
