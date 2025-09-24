const PASTED_IMAGE_ALT_TEXT_PREFIX = "Pasted image";
const DOUBLE_LINE_BREAK = "\n\n";
const IMAGE_READ_ERROR_MESSAGE = "Failed to read pasted image";

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
 * Build a Markdown image snippet that references the provided data URL.
 * @param {string} dataUrl
 * @returns {string}
 */
function buildMarkdownForImage(dataUrl) {
    const timestamp = new Date().toISOString();
    const safeAltText = `${PASTED_IMAGE_ALT_TEXT_PREFIX} ${timestamp}`.replace(/[\[\]]/g, "");
    return `![${safeAltText}](${dataUrl})`;
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
    for (const file of files) {
        try {
            const dataUrl = await readFileAsDataUrl(file);
            if (!dataUrl) continue;
            const markdown = buildMarkdownForImage(dataUrl);
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
