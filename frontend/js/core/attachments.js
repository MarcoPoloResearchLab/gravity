// @ts-check

import { DATA_URL_PREFIX, PASTED_IMAGE_ALT_TEXT_PREFIX } from "../constants.js?build=2026-01-01T21:20:40Z";

/**
 * @param {unknown} candidate
 * @returns {candidate is import("../types.d.js").AttachmentRecord}
 */
export function isAttachmentRecord(candidate) {
    return Boolean(candidate)
        && typeof candidate === "object"
        && typeof /** @type {{ dataUrl?: unknown }} */ (candidate).dataUrl === "string"
        && /** @type {{ dataUrl: string }} */ (candidate).dataUrl.startsWith(DATA_URL_PREFIX);
}

/**
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} attachments
 * @returns {Record<string, import("../types.d.js").AttachmentRecord>}
 */
export function sanitizeAttachmentDictionary(attachments) {
    if (!attachments || typeof attachments !== "object") return {};
    const result = {};
    for (const [key, value] of Object.entries(attachments)) {
        if (typeof key !== "string") continue;
        if (!isAttachmentRecord(value)) continue;
        const fallbackAlt = `${PASTED_IMAGE_ALT_TEXT_PREFIX} ${key}`;
        const altTextSource = typeof value.altText === "string" && value.altText.trim().length > 0
            ? value.altText
            : fallbackAlt;
        const altText = altTextSource.replace(/[\[\]]/g, "");
        result[key] = { dataUrl: value.dataUrl, altText };
    }
    return result;
}
