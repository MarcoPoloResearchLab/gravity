/* global ClipboardItem, atob */
// @ts-check

import {
    CLIPBOARD_DATA_ATTRIBUTE,
    CLIPBOARD_METADATA_DATA_URL_PREFIX,
    CLIPBOARD_MIME_NOTE
} from "../constants.js?build=2026-01-01T22:43:21Z";

const PLACEHOLDER_PATTERN = /!\[\[([^\[\]]+)\]\]/g;

/**
 * Copy text, sanitized HTML, and optional metadata/attachments to the system clipboard.
 * @param {{ text?: string, html?: string, metadata?: any, attachments?: Record<string, import("../types.d.js").AttachmentRecord> }} content
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(content = {}) {
    const { text = "", html = "", metadata = null, attachments = {} } = content;
    const safeText = typeof text === "string" ? text : "";
    const safeHtml = typeof html === "string" ? html : "";
    const hasHtml = safeHtml.trim().length > 0;
    const normalizedAttachments = normalizeAttachments(attachments);
    let metadataJson = "";

    if (metadata && typeof metadata === "object") {
        try {
            metadataJson = JSON.stringify(metadata);
        } catch (error) {
            metadataJson = "";
        }
    }

    const metadataDataUrl = metadataJson ? encodeMetadataDataUrl(metadataJson) : "";
    const textPayload = buildPlainTextClipboardPayload({ text: safeText, attachments: normalizedAttachments });
    const htmlPayload = hasHtml ? appendMetadataToHtml(safeHtml, metadataJson) : safeHtml;
    const canUseClipboardItem = navigator?.clipboard?.write && typeof ClipboardItem !== "undefined";
    const attachmentBlobs = createAttachmentBlobs(normalizedAttachments);

    if (canUseClipboardItem) {
        try {
            const primaryItem = {
                "text/plain": new Blob([textPayload], { type: "text/plain" })
            };
            if (hasHtml) {
                primaryItem["text/html"] = new Blob([htmlPayload], { type: "text/html" });
            }
            if (metadataJson) {
                primaryItem[CLIPBOARD_MIME_NOTE] = new Blob([metadataJson], { type: CLIPBOARD_MIME_NOTE });
            }
            const items = [new ClipboardItem(primaryItem)];
            for (const attachment of attachmentBlobs) {
                items.push(new ClipboardItem({ [attachment.type]: attachment.blob }));
            }
            await navigator.clipboard.write(items);
            return true;
        } catch {
            // fall back to degraded pathways
        }
    }

    if (!hasHtml && navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(textPayload);
            return true;
        } catch {
            // continue to execCommand fallback
        }
    }

    if (!document?.body) return false;

    const target = hasHtml ? document.createElement("div") : document.createElement("textarea");
    target.style.position = "fixed";
    target.style.top = "0";
    target.style.left = "-9999px";
    target.style.opacity = "0";
    target.style.pointerEvents = "none";
    target.style.userSelect = "text";
    target.setAttribute("aria-hidden", "true");

    if (hasHtml) {
        target.innerHTML = htmlPayload;
        target.setAttribute("contenteditable", "true");
    } else {
        target.value = textPayload;
        target.setAttribute("readonly", "true");
        target.style.fontSize = "12pt";
    }

    const handleCopyEvent = (event) => {
        if (!event?.clipboardData) return;
        event.clipboardData.setData("text/plain", textPayload);
        if (hasHtml) {
            event.clipboardData.setData("text/html", htmlPayload);
        }
        if (metadataJson) {
            event.clipboardData.setData(CLIPBOARD_MIME_NOTE, metadataJson);
        }
        if (metadataDataUrl) {
            event.clipboardData.setData("text/x-gravity-note", metadataDataUrl);
        }
        event.preventDefault();
    };

    target.addEventListener("copy", handleCopyEvent);
    document.body.appendChild(target);

    let success = false;
    if (hasHtml) {
        const selection = window.getSelection();
        const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
        const range = document.createRange();
        range.selectNodeContents(target);

        selection?.removeAllRanges();
        selection?.addRange(range);

        try {
            success = document.execCommand("copy");
        } catch {
            success = false;
        }

        selection?.removeAllRanges();
        if (previousRange) {
            selection?.addRange(previousRange);
        }
    } else if (target instanceof HTMLTextAreaElement) {
        target.select();
        target.setSelectionRange(0, target.value.length);
        try {
            success = document.execCommand("copy");
        } catch {
            success = false;
        }
    }

    document.body.removeChild(target);
    target.removeEventListener("copy", handleCopyEvent);
    return success;
}

/**
 * Build the plain text payload that accompanies clipboard writes.
 * @param {{ text: string, attachments: Record<string, import("../types.d.js").AttachmentRecord> }} params
 * @returns {string}
 */
export function buildPlainTextClipboardPayload({ text, attachments }) {
    const segments = [];
    const inline = inlineAttachmentsInText(text, attachments);
    const inlineHasContent = inline.trim().length > 0;
    if (inlineHasContent) {
        segments.push(inline);
    }

    if (!inlineHasContent) {
        const attachmentUrls = collectAttachmentDataUrls(attachments);
        if (attachmentUrls.length > 0) {
            segments.push(attachmentUrls.join("\n"));
        }
    }

    if (!segments.length && typeof text === "string" && text.length > 0) {
        segments.push(text);
    }

    return segments.join("\n\n");
}

/**
 * Attach metadata markers to HTML payloads so downstream consumers can recover structured data.
 * @param {string} html
 * @param {string} metadataJson
 * @returns {string}
 */
function appendMetadataToHtml(html, metadataJson) {
    if (!metadataJson) return html;
    const container = document.createElement("div");
    container.innerHTML = html;
    const marker = document.createElement("span");
    marker.setAttribute(CLIPBOARD_DATA_ATTRIBUTE, "1");
    marker.style.display = "none";
    marker.style.setProperty("display", "none", "important");
    marker.style.setProperty("white-space", "pre", "important");
    marker.textContent = metadataJson;
    container.appendChild(marker);
    return container.innerHTML;
}

/**
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} attachments
 * @returns {string[]}
 */
function collectAttachmentDataUrls(attachments) {
    if (!attachments || typeof attachments !== "object") return [];
    const urls = [];
    for (const value of Object.values(attachments)) {
        if (!value || typeof value.dataUrl !== "string") continue;
        urls.push(value.dataUrl);
    }
    return urls;
}

/**
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} attachments
 * @returns {Record<string, import("../types.d.js").AttachmentRecord>}
 */
function normalizeAttachments(attachments) {
    if (!attachments || typeof attachments !== "object") return {};
    const normalized = {};
    for (const [key, value] of Object.entries(attachments)) {
        if (typeof key !== "string") continue;
        if (!value || typeof value.dataUrl !== "string") continue;
        normalized[key] = {
            dataUrl: value.dataUrl,
            altText: typeof value.altText === "string" ? value.altText : ""
        };
    }
    return normalized;
}

/**
 * @param {string} text
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} attachments
 * @returns {string}
 */
function inlineAttachmentsInText(text, attachments) {
    if (typeof text !== "string" || text.length === 0) return "";
    if (!attachments || typeof attachments !== "object") return text;
    return text.replace(PLACEHOLDER_PATTERN, (match, key) => {
        const record = attachments[key];
        if (!record || typeof record.dataUrl !== "string") return match;
        return record.dataUrl;
    });
}

/**
 * Encode metadata as a data URL so downstream clipboard consumers can parse it.
 * @param {string} metadataJson
 * @returns {string}
 */
function encodeMetadataDataUrl(metadataJson) {
    if (typeof metadataJson !== "string" || metadataJson.length === 0) return "";
    try {
        const encoded = typeof btoa === "function"
            ? btoa(metadataJson)
            : (typeof Buffer !== "undefined" ? Buffer.from(metadataJson, "utf8").toString("base64") : "");
        if (!encoded) return "";
        return `${CLIPBOARD_METADATA_DATA_URL_PREFIX}${encoded}`;
    } catch {
        return "";
    }
}

/**
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} attachments
 * @returns {{ name: string, type: string, blob: Blob }[]}
 */
function createAttachmentBlobs(attachments) {
    if (!attachments || typeof attachments !== "object") return [];
    const blobs = [];
    for (const [key, value] of Object.entries(attachments)) {
        if (!value || typeof value.dataUrl !== "string") continue;
        const blob = dataUrlToBlob(value.dataUrl);
        if (!blob) continue;
        blobs.push({ name: key, type: blob.type || "application/octet-stream", blob });
    }
    return blobs;
}

/**
 * Convert a data URL into a Blob instance.
 * @param {string} dataUrl
 * @returns {Blob|null}
 */
function dataUrlToBlob(dataUrl) {
    try {
        const [header, data] = dataUrl.split(",");
        if (!header || !data) return null;
        const matches = header.match(/data:(.*?)(;base64)?$/);
        const mime = matches && matches[1] ? matches[1] : "application/octet-stream";
        const isBase64 = header.includes(";base64");
        let byteString;
        if (isBase64) {
            byteString = atob(data);
        } else {
            byteString = decodeURIComponent(data);
        }
        const arrayBuffer = new Uint8Array(byteString.length);
        for (let index = 0; index < byteString.length; index += 1) {
            arrayBuffer[index] = byteString.charCodeAt(index);
        }
        return new Blob([arrayBuffer], { type: mime });
    } catch {
        return null;
    }
}
