import { CLIPBOARD_MIME_NOTE, CLIPBOARD_DATA_ATTRIBUTE } from "./constants.js";

export function nowIso() { return new Date().toISOString(); }

export function generateNoteId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const randomSegment = Math.random().toString(36).slice(2, 10);
    return `n-${Date.now()}-${randomSegment}`;
}

export function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
}

/**
 * Copy text, optional HTML, and optional metadata to the clipboard, using the async API
 * when available and falling back to execCommand for legacy browsers.
 * @param {{text?: string, html?: string, metadata?: any}} content
 * @returns {Promise<boolean>} resolves true when the copy succeeded
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

export async function copyToClipboard(content = {}) {
    const { text = "", html = "", metadata = null } = content;
    const safeText = typeof text === "string" ? text : "";
    const safeHtml = typeof html === "string" ? html : "";
    const hasHtml = safeHtml.trim().length > 0;
    let metadataJson = "";

    if (metadata && typeof metadata === "object") {
        try {
            metadataJson = JSON.stringify(metadata);
        } catch (error) {
            metadataJson = "";
        }
    }

    const htmlPayload = hasHtml ? appendMetadataToHtml(safeHtml, metadataJson) : safeHtml;
    const canUseClipboardItem = navigator?.clipboard?.write && typeof ClipboardItem !== "undefined";

    if (canUseClipboardItem) {
        try {
            const clipboardItemInput = {
                "text/plain": new Blob([safeText], { type: "text/plain" })
            };
            if (hasHtml) {
                clipboardItemInput["text/html"] = new Blob([htmlPayload], { type: "text/html" });
            }
            if (metadataJson) {
                clipboardItemInput[CLIPBOARD_MIME_NOTE] = new Blob([metadataJson], { type: CLIPBOARD_MIME_NOTE });
            }
            await navigator.clipboard.write([new ClipboardItem(clipboardItemInput)]);
            return true;
        } catch (error) {
            // fall through to degraded options
        }
    }

    if (!hasHtml && navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(safeText);
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
        target.value = safeText;
        target.setAttribute("readonly", "true");
        target.style.fontSize = "12pt";
    }

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
    return success;
}

export function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 5}px`;
}

export function clampEnum(value, allowed, fallback) {
    return (typeof value === "string" && allowed.includes(value)) ? value : fallback;
}

export function titleCase(text) {
    if (typeof text !== "string" || !text) return "";
    return text.toLowerCase().split(" ").filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function toTagToken(text) {
    if (typeof text !== "string") return "";
    return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "");
}
