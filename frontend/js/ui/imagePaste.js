// @ts-check

import {
    CLIPBOARD_MIME_NOTE,
    CLIPBOARD_DATA_ATTRIBUTE,
    CLIPBOARD_METADATA_VERSION,
    CLIPBOARD_METADATA_DATA_URL_PREFIX,
    DATA_URL_PREFIX,
    ERROR_IMAGE_READ_FAILED,
    PASTED_IMAGE_ALT_TEXT_PREFIX
} from "../constants.js?build=2026-01-01T21:20:40Z";
import { sanitizeAttachmentDictionary, isAttachmentRecord } from "../core/attachments.js?build=2026-01-01T21:20:40Z";
import { logging } from "../utils/logging.js?build=2026-01-01T21:20:40Z";

const DOUBLE_LINE_BREAK = "\n\n";
const PLACEHOLDER_PREFIX = "pasted-image";
const PLACEHOLDER_OPEN = "![[";
const PLACEHOLDER_CLOSE = "]]";
const PLACEHOLDER_REGEX = /!\[\[([^\[\]]+)\]\]/g;

const attachmentsByTextarea = new WeakMap();
const pendingInsertions = new WeakMap();
let placeholderSequence = 0;

/**
 * Convert a File into a data URL so it can be embedded in Markdown.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : ""));
        reader.addEventListener("error", () => reject(new Error(ERROR_IMAGE_READ_FAILED)));
        reader.readAsDataURL(file);
    });
}

/**
 * Build a Markdown image placeholder that will be resolved against stored attachments.
 * @param {string} filename
 * @returns {string}
 */
function buildMarkdownPlaceholder(filename) {
    return `${PLACEHOLDER_OPEN}${filename}${PLACEHOLDER_CLOSE}`;
}

/**
 * Compute the Markdown insertion string and next selection position.
 * @param {object} params
 * @param {string} params.existingText
 * @param {number} params.selectionStart
 * @param {number} params.selectionEnd
 * @param {string} params.insertionText
 * @returns {{ nextText: string, caretIndex: number, insertedText: string }}
 */
export function buildMarkdownInsertion({ existingText, selectionStart, selectionEnd, insertionText }) {
    const safeExistingText = typeof existingText === "string" ? existingText : "";
    const start = Math.max(0, Math.min(Number(selectionStart) || 0, safeExistingText.length));
    const end = Math.max(start, Math.min(Number(selectionEnd) || start, safeExistingText.length));

    const textBeforeSelection = safeExistingText.slice(0, start);
    const textAfterSelection = safeExistingText.slice(end);

    const needsPrefixBreak = textBeforeSelection.length > 0
        && !textBeforeSelection.endsWith("\n")
        && !textBeforeSelection.endsWith(DOUBLE_LINE_BREAK);
    const prefixBreak = needsPrefixBreak ? DOUBLE_LINE_BREAK : "";

    let suffixBreak = DOUBLE_LINE_BREAK;
    if (textAfterSelection.startsWith(DOUBLE_LINE_BREAK)) suffixBreak = "";
    else if (textAfterSelection.startsWith("\n")) suffixBreak = "\n";

    const insertedText = `${prefixBreak}${insertionText}${suffixBreak}`;
    const nextText = `${textBeforeSelection}${insertedText}${textAfterSelection}`;
    const caretIndex = textBeforeSelection.length + insertedText.length;

    return { nextText, caretIndex, insertedText };
}

/**
 * Insert Markdown text at the current caret location, ensuring blank lines around it.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} insertionText
 */
function insertMarkdownAtCaret(textarea, insertionText) {
    const { nextText, caretIndex } = buildMarkdownInsertion({
        existingText: textarea.value,
        selectionStart: textarea.selectionStart ?? textarea.value.length,
        selectionEnd: textarea.selectionEnd ?? textarea.selectionStart ?? textarea.value.length,
        insertionText
    });
    textarea.value = nextText;
    textarea.setSelectionRange(caretIndex, caretIndex);
}

async function processAttachmentFiles(textarea, files) {
    const map = getOrCreateAttachmentMap(textarea);
    let selectionStart = textarea.selectionStart ?? textarea.value.length;
    let selectionEnd = textarea.selectionEnd ?? selectionStart;
    let currentText = textarea.value ?? "";
    const inserted = [];

    for (const file of files) {
        try {
            const dataUrl = await readFileAsDataUrl(file);
            if (!dataUrl || !dataUrl.startsWith(DATA_URL_PREFIX)) continue;
            const attachment = createAttachmentRecord(file, dataUrl);
            map.set(attachment.filename, { dataUrl: attachment.dataUrl, altText: attachment.altText });
            const markdown = buildMarkdownPlaceholder(attachment.filename);
            const { nextText, caretIndex, insertedText } = buildMarkdownInsertion({
                existingText: currentText,
                selectionStart,
                selectionEnd,
                insertionText: markdown
            });
            currentText = nextText;
            selectionStart = caretIndex;
            selectionEnd = caretIndex;
            inserted.push({ placeholder: markdown, filename: attachment.filename, altText: attachment.altText, insertedText });
        } catch (error) {
            logging.error(error);
        }
    }

    textarea.value = currentText;
    textarea.setSelectionRange(selectionStart, selectionEnd);

    return { text: currentText, caretIndex: selectionStart, inserted };
}

/**
 * Insert image files by creating attachment placeholders for the textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {File[]} files
 * @returns {Promise<{ text: string, caretIndex: number, inserted: Array<{ placeholder: string, filename: string, altText: string }> }>}
 */
export async function insertAttachmentPlaceholders(textarea, files) {
    if (!textarea || !Array.isArray(files) || files.length === 0) {
        return { text: textarea?.value ?? "", caretIndex: textarea?.selectionEnd ?? 0, inserted: [] };
    }

    const pending = pendingInsertions.get(textarea) ?? Promise.resolve();
    const run = () => processAttachmentFiles(textarea, files);
    const next = pending.then(run);
    pendingInsertions.set(textarea, next.finally(() => {
        if (pendingInsertions.get(textarea) === next) {
            pendingInsertions.delete(textarea);
        }
    }));
    return next;
}

/**
 * Sequentially read image files and insert them into the textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {File[]} files
 */
async function handleClipboardImages(textarea, files) {
    await insertAttachmentPlaceholders(textarea, files);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function waitForPendingImagePastes(textarea) {
    if (!textarea) return;
    const pending = pendingInsertions.get(textarea);
    if (!pending) return;
    try {
        await pending;
    } finally {
        if (pendingInsertions.get(textarea) === pending) {
            pendingInsertions.delete(textarea);
        }
    }
}

/**
 * Attach clipboard listeners so that pasted images become Markdown image links.
 * @param {HTMLTextAreaElement} textarea
 */
export function enableClipboardImagePaste(textarea) {
    if (!textarea) return;
    textarea.addEventListener("paste", (event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return;

        const gravityPayload = extractGravityClipboardPayload(clipboardData);
        if (gravityPayload) {
            event.preventDefault();
            applyGravityClipboardPayload(textarea, gravityPayload);
            return;
        }

        if (!clipboardData.items) return;

        const imageFiles = Array.from(clipboardData.items)
            .filter((item) => typeof item.type === "string" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file) => {
                if (!file) return false;
                if (typeof File === "function") return file instanceof File;
                return true;
            });

        if (imageFiles.length === 0) return;

        event.preventDefault();
        handleClipboardImages(textarea, imageFiles);
    });
}

function getOrCreateAttachmentMap(textarea) {
    if (!textarea) return new Map();
    let map = attachmentsByTextarea.get(textarea);
    if (!map) {
        map = new Map();
        attachmentsByTextarea.set(textarea, map);
    }
    return map;
}

export function extractGravityClipboardPayload(clipboardData) {
    if (!clipboardData) return null;

    let raw = clipboardData.getData(CLIPBOARD_MIME_NOTE);
    if (typeof raw !== "string" || raw.trim().length === 0) {
        const metadataDataUrl = clipboardData.getData("text/x-gravity-note");
        raw = extractGravityPayloadFromDataUrl(metadataDataUrl);
    }

    if (typeof raw !== "string" || raw.trim().length === 0) {
        const html = clipboardData.getData("text/html");
        raw = extractGravityPayloadFromHtml(html);
    }

    if (typeof raw !== "string" || raw.trim().length === 0) {
        const plain = clipboardData.getData("text/plain");
        raw = extractGravityPayloadFromPlainText(plain);
    }

    if (typeof raw !== "string" || raw.trim().length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const markdown = typeof parsed.markdown === "string" ? parsed.markdown : "";
        const version = Number(parsed.version ?? 1);
        if (!markdown) return null;
        if (Number.isFinite(version) && version > CLIPBOARD_METADATA_VERSION) return null;
        return {
            markdown,
            attachments: typeof parsed.attachments === "object" && parsed.attachments ? parsed.attachments : {}
        };
    } catch (error) {
        return null;
    }
}

function extractGravityPayloadFromHtml(html) {
    if (typeof html !== "string" || html.trim().length === 0) return "";
    if (typeof DOMParser !== "function") return "";
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const marker = doc.querySelector(`[${CLIPBOARD_DATA_ATTRIBUTE}]`);
        return marker?.textContent || "";
    } catch (error) {
        return "";
    }
}

function extractGravityPayloadFromDataUrl(dataUrl) {
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) return "";
    if (!dataUrl.startsWith(CLIPBOARD_METADATA_DATA_URL_PREFIX)) return "";
    const encoded = dataUrl.slice(CLIPBOARD_METADATA_DATA_URL_PREFIX.length);
    return decodeClipboardMetadata(encoded);
}

function extractGravityPayloadFromPlainText(plainText) {
    if (typeof plainText !== "string" || plainText.trim().length === 0) return "";
    const index = plainText.lastIndexOf(CLIPBOARD_METADATA_DATA_URL_PREFIX);
    if (index === -1) return "";
    const encodedSection = plainText.slice(index + CLIPBOARD_METADATA_DATA_URL_PREFIX.length);
    const match = encodedSection.match(/^([A-Za-z0-9+/=]+)/);
    if (!match) return "";
    return decodeClipboardMetadata(match[1]);
}

function decodeClipboardMetadata(encoded) {
    if (typeof encoded !== "string" || encoded.length === 0) return "";
    try {
        if (typeof atob === "function") {
            return atob(encoded);
        }
        if (typeof Buffer !== "undefined") {
            return Buffer.from(encoded, "base64").toString("utf8");
        }
        return "";
    } catch (error) {
        return "";
    }
}

export function applyGravityClipboardPayload(textarea, payload, options = {}) {
    if (!textarea || !payload) return;
    const { codemirror } = options;
    const sanitizedAttachments = sanitizeAttachmentDictionary(payload.attachments);
    const hasAttachments = Object.keys(sanitizedAttachments).length > 0;
    const placeholderMarkdown = typeof payload.markdown === "string" ? payload.markdown : "";
    const expandedMarkdown = typeof payload.markdownExpanded === "string" ? payload.markdownExpanded : "";
    const preferredMarkdown = hasAttachments
        ? (placeholderMarkdown.includes("![[") ? placeholderMarkdown : expandedMarkdown)
        : expandedMarkdown || placeholderMarkdown;
    const markdown = preferredMarkdown || expandedMarkdown || placeholderMarkdown;
    if (!markdown) return;

    if (Object.keys(sanitizedAttachments).length > 0) {
        const existing = getAllAttachments(textarea);
        const merged = { ...existing, ...sanitizedAttachments };
        registerInitialAttachments(textarea, merged);
    }

    if (codemirror && typeof codemirror.replaceSelection === "function") {
        codemirror.replaceSelection(markdown, "end");
    } else {
        replaceSelectionWith(textarea, markdown);
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function replaceSelectionWith(textarea, insertionText) {
    const safeText = typeof insertionText === "string" ? insertionText : "";
    const value = typeof textarea.value === "string" ? textarea.value : "";
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    const boundedStart = Math.max(0, Math.min(start, value.length));
    const boundedEnd = Math.max(boundedStart, Math.min(end, value.length));
    const before = value.slice(0, boundedStart);
    const after = value.slice(boundedEnd);
    textarea.value = `${before}${safeText}${after}`;
    const nextCaret = boundedStart + safeText.length;
    textarea.setSelectionRange(nextCaret, nextCaret);
}

function sanitizeFilenameComponent(component) {
    return component.replace(/[^a-z0-9\-_.]/gi, "-");
}

function createAttachmentRecord(file, dataUrl) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = determineExtension(file?.type) || "png";
    placeholderSequence += 1;
    const filename = `${PLACEHOLDER_PREFIX}-${timestamp}-${placeholderSequence}.${extension}`;
    const safeFilename = sanitizeFilenameComponent(filename);
    const altText = `${PASTED_IMAGE_ALT_TEXT_PREFIX} ${timestamp}`.replace(/[\[\]]/g, "");
    return { filename: safeFilename, dataUrl, altText };
}

function determineExtension(mimeType) {
    if (typeof mimeType !== "string") return "";
    const match = mimeType.match(/image\/([a-z0-9.+-]+)/i);
    return match ? match[1].toLowerCase() : "";
}

export function registerInitialAttachments(textarea, attachments) {
    const map = getOrCreateAttachmentMap(textarea);
    map.clear();
    const sanitized = sanitizeAttachmentDictionary(attachments);
    for (const [key, value] of Object.entries(sanitized)) {
        map.set(key, value);
    }
}

export function resetAttachments(textarea) {
    const map = getOrCreateAttachmentMap(textarea);
    map.clear();
}

export function getAllAttachments(textarea) {
    const map = getOrCreateAttachmentMap(textarea);
    return sanitizeAttachmentDictionary(Object.fromEntries(map.entries()));
}

export function collectReferencedAttachments(textarea) {
    if (!textarea) return {};
    const text = textarea.value || "";
    const map = getOrCreateAttachmentMap(textarea);
    const result = {};
    for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
        const name = match[1];
        if (!name || result[name]) continue;
        const record = map.get(name);
        if (isAttachmentRecord(record)) {
            result[name] = { ...record };
        }
    }
    return sanitizeAttachmentDictionary(result);
}

export function transformMarkdownWithAttachments(markdown, attachments) {
    if (typeof markdown !== "string" || markdown.length === 0) return markdown;
    if (!attachments || typeof attachments !== "object") return markdown;
    return markdown.replace(PLACEHOLDER_REGEX, (match, filename) => {
        const record = attachments[filename];
        if (!isAttachmentRecord(record)) return match;
        const altText = (record.altText || `${PASTED_IMAGE_ALT_TEXT_PREFIX} ${filename}`).replace(/[\[\]]/g, "");
        return `![${altText}](${record.dataUrl})`;
    });
}
