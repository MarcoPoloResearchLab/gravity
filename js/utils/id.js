// @ts-check

/**
 * Generate a stable identifier for new notes.
 * @returns {string}
 */
export function generateNoteId() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }
    const randomSegment = Math.random().toString(36).slice(2, 10);
    return `n-${Date.now()}-${randomSegment}`;
}
