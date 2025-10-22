// @ts-check

/**
 * Retrieve the current timestamp in ISO-8601 format.
 * @returns {string}
 */
export function nowIso() {
    return new Date().toISOString();
}
