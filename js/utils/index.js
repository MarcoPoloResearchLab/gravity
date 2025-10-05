/* global ClipboardItem, atob */
// @ts-check

import {
    CLIPBOARD_DATA_ATTRIBUTE,
    CLIPBOARD_METADATA_DATA_URL_PREFIX,
    CLIPBOARD_MIME_NOTE
} from "../constants.js";

const PLACEHOLDER_PATTERN = /!\[\[([^\[\]]+)\]\]/g;

/**
 * @returns {string}
 */
export function nowIso() {
    return new Date().toISOString();
}

/**
 * @returns {string}
 */
export function generateNoteId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const randomSegment = Math.random().toString(36).slice(2, 10);
    return `n-${Date.now()}-${randomSegment}`;
}

/**
 * @param {keyof HTMLElementTagNameMap} tag
 * @param {string} [className]
 * @param {string|null} [text]
 * @returns {HTMLElement}
 */
export function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
}

/**
 * Copy text, optional HTML, and optional metadata to the clipboard, using the async API
 * when available and falling back to execCommand for legacy browsers.
 * @param {{ text?: string, html?: string, metadata?: any, attachments?: Record<string, import("../types.d.js").AttachmentRecord> }} content
 * @returns {Promise<boolean>} resolves true when the copy succeeded
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
        } catch (error) {
            // fall through to degraded options
        }
    }

    if (!hasHtml && navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(textPayload);
            return true;
        } catch (error) {
            // fall through to execCommand fallback
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
        } catch (error) {
            success = false;
        }

        selection?.removeAllRanges();
        if (previousRange) {
            selection?.addRange(previousRange);
        }
    } else {
        target.select();
        target.setSelectionRange(0, target.value.length);
        try {
            success = document.execCommand("copy");
        } catch (error) {
            success = false;
        }
    }

    document.body.removeChild(target);
    target.removeEventListener("copy", handleCopyEvent);
    return success;
}

/**
 * Adjust a textarea's height so it fits its content without scrollbars.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ minHeightPx?: number, extraPaddingPx?: number }} [options]
 * @returns {void}
 */
export function autoResize(textarea, options = {}) {
    if (!textarea) return;
    const { minHeightPx = 0, extraPaddingPx = 5 } = options;
    textarea.style.height = "auto";
    const measured = textarea.scrollHeight + extraPaddingPx;
    const nextHeight = Math.max(measured, minHeightPx);
    textarea.style.height = `${nextHeight}px`;
}

/**
 * @template T
 * @param {string} value
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
export function clampEnum(value, allowed, fallback) {
    return (typeof value === "string" && allowed.includes(/** @type {T & string} */ (value))) ? /** @type {T} */ (value) : fallback;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function titleCase(text) {
    if (typeof text !== "string" || !text) return "";
    return text.toLowerCase().split(" ").filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

/**
 * @param {string} text
 * @returns {string}
 */
export function toTagToken(text) {
    if (typeof text !== "string") return "";
    return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "");
}

/**
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
 * @param {{ text: string, attachments: Record<string, import("../types.d.js").AttachmentRecord>, metadataDataUrl: string }} params
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
    } catch (error) {
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
        for (let i = 0; i < byteString.length; i += 1) {
            arrayBuffer[i] = byteString.charCodeAt(i);
        }
        return new Blob([arrayBuffer], { type: mime });
    } catch (error) {
        return null;
    }
}
