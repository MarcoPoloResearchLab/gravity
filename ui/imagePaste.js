const PASTED_IMAGE_ALT_TEXT_PREFIX = "Pasted image";
const DOUBLE_LINE_BREAK = "\n\n";
const IMAGE_READ_ERROR_MESSAGE = "Failed to read pasted image";
const PLACEHOLDER_PREFIX = "pasted-image";
const PLACEHOLDER_OPEN = "![[";
const PLACEHOLDER_CLOSE = "]]";
const PLACEHOLDER_REGEX = /!\[\[([^\[\]]+)\]\]/g;
export const DATA_URL_PREFIX = "data:";

/**
 * @typedef {Object} AttachmentRecord
 * @property {string} dataUrl
 * @property {string} altText
 */

const attachmentsByTextarea = new WeakMap();
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
        reader.addEventListener("error", () => reject(new Error(IMAGE_READ_ERROR_MESSAGE)));
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
 * Insert Markdown text at the current caret location, ensuring blank lines around it.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} insertionText
 */
function insertMarkdownAtCaret(textarea, insertionText) {
    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;

    const textBeforeSelection = textarea.value.slice(0, selectionStart);
    const textAfterSelection = textarea.value.slice(selectionEnd);

    const needsPrefixBreak = textBeforeSelection.length > 0 && !textBeforeSelection.endsWith("\n") && !textBeforeSelection.endsWith(DOUBLE_LINE_BREAK);
    const prefixBreak = needsPrefixBreak ? DOUBLE_LINE_BREAK : "";

    let suffixBreak = DOUBLE_LINE_BREAK;
    if (textAfterSelection.startsWith(DOUBLE_LINE_BREAK)) suffixBreak = "";
    else if (textAfterSelection.startsWith("\n")) suffixBreak = "\n";

    const finalInsertion = `${prefixBreak}${insertionText}${suffixBreak}`;

    const nextValue = `${textBeforeSelection}${finalInsertion}${textAfterSelection}`;
    textarea.value = nextValue;

    const caretPosition = textBeforeSelection.length + finalInsertion.length;
    textarea.setSelectionRange(caretPosition, caretPosition);
}

/**
 * Sequentially read image files and insert them into the textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {File[]} files
 */
async function handleClipboardImages(textarea, files) {
    const attachmentMap = getOrCreateAttachmentMap(textarea);
    for (const file of files) {
        try {
            const dataUrl = await readFileAsDataUrl(file);
            if (!dataUrl || !dataUrl.startsWith(DATA_URL_PREFIX)) continue;
            const attachment = createAttachmentRecord(file, dataUrl);
            attachmentMap.set(attachment.filename, { dataUrl: attachment.dataUrl, altText: attachment.altText });
            const markdown = buildMarkdownPlaceholder(attachment.filename);
            insertMarkdownAtCaret(textarea, markdown);
        } catch (error) {
            console.error(error);
        }
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

const pendingInsertions = new WeakMap();

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
        if (!clipboardData || !clipboardData.items) return;

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
        const run = handleClipboardImages(textarea, imageFiles);
        const pending = pendingInsertions.get(textarea) ?? Promise.resolve();
        const next = pending.then(() => run);
        pendingInsertions.set(textarea, next.finally(() => {
            if (pendingInsertions.get(textarea) === next) {
                pendingInsertions.delete(textarea);
            }
        }));
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

function isAttachmentRecord(value) {
    return value && typeof value.dataUrl === "string" && value.dataUrl.startsWith(DATA_URL_PREFIX);
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
