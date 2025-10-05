// @ts-check

import { appConfig } from "../core/config.js";
import { createElement } from "../utils/index.js";
import { LABEL_EDIT_MARKDOWN, LABEL_VIEW_RENDERED } from "../constants.js";
import { logging } from "../utils/logging.js";
import {
    insertAttachmentPlaceholders,
    waitForPendingImagePastes,
    extractGravityClipboardPayload,
    applyGravityClipboardPayload
} from "./imagePaste.js";

const MODE_EDIT = "edit";
const MODE_VIEW = "view";
export const MARKDOWN_MODE_EDIT = MODE_EDIT;
export const MARKDOWN_MODE_VIEW = MODE_VIEW;
const BULLET_NORMALIZATION_REGEX = /^\s*[•–—−∙·]\s+/;
const MALFORMED_BULLET_REGEX = /^\s*-\.\s+/;
const ORDERED_LIST_REGEX = /^\s*(\d+)\.\s+/;
const UNORDERED_LIST_REGEX = /^\s*[-*+]\s+/;
const TABLE_ROW_REGEX = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_REGEX = /^\s*\|?(?:-+:?\s*\|)+-*:?\s*\|?\s*$/;
const SOFT_BREAK = "  \n";
const IMAGE_TIFF_TYPES = new Set(["image/tiff", "image/x-tiff"]);

/**
 * @typedef {"edit" | "view"} MarkdownEditorMode
 */

/**
 * @typedef {"change" | "submit" | "blur" | "navigatePrevious" | "navigateNext" | "modechange" | "copymarkdown" | "copyhtml"} MarkdownEditorEvent
 */

/**
 * @typedef {{
 *   container: HTMLElement,
 *   textarea: HTMLTextAreaElement,
 *   previewElement: HTMLElement,
 *   initialMode?: MarkdownEditorMode,
 *   showToolbar?: boolean
 * }} MarkdownEditorOptions
 */

/**
 * @typedef {{
 *   on(event: MarkdownEditorEvent, handler: (detail?: any) => void): void,
 *   off(event: MarkdownEditorEvent, handler: (detail?: any) => void): void,
 *   focus(): void,
 *   getMode(): MarkdownEditorMode,
 *   setMode(mode: MarkdownEditorMode): void,
 *   getValue(): string,
 *   setValue(nextValue: string): void,
 *   refresh(): void,
 *   setCaretPosition(position: "start" | "end"): void,
 *   waitForPendingImages(): Promise<void>,
 *   isEnhanced(): boolean,
 *   destroy(): void,
 *   getTextarea(): HTMLTextAreaElement
 * }} MarkdownEditorHost
 */

/**
 * Create a Markdown editor host that wraps EasyMDE when enabled and falls back to the native textarea otherwise.
 * @param {MarkdownEditorOptions} options
 * @returns {MarkdownEditorHost}
 */
export function createMarkdownEditorHost(options) {
    const {
        container,
        textarea,
        previewElement,
        initialMode = MODE_VIEW,
        showToolbar = true
    } = options;
    if (!(container instanceof HTMLElement)) throw new Error("Markdown editor host requires a container element.");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Markdown editor host requires a textarea element.");
    if (!(previewElement instanceof HTMLElement)) throw new Error("Markdown editor host requires a preview element.");

    const listeners = new Map();
    /**
     * @param {MarkdownEditorEvent} event
     * @param {any} detail
     */
    const emit = (event, detail) => {
        const handlers = listeners.get(event);
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                handler(detail);
            } catch (error) {
                logging.error(error);
            }
        }
    };

    /**
     * @param {MarkdownEditorEvent} event
     * @param {(detail?: any) => void} handler
     */
    const on = (event, handler) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
    };

    /**
     * @param {MarkdownEditorEvent} event
     * @param {(detail?: any) => void} handler
     */
    const off = (event, handler) => {
        const handlers = listeners.get(event);
        if (!handlers) return;
        handlers.delete(handler);
        if (handlers.size === 0) listeners.delete(event);
    };

    container.classList.add("markdown-editor-host");

    let toolbar = null;
    let editButton = null;
    let viewButton = null;

    if (showToolbar) {
        toolbar = createElement("div", "editor-mode-toolbar");
        const toggleGroup = createElement("div", "editor-mode-toggle-group");
        const utilityGroup = createElement("div", "editor-mode-utility-group");

        editButton = createButton(LABEL_EDIT_MARKDOWN, () => setMode(MODE_EDIT));
        viewButton = createButton(LABEL_VIEW_RENDERED, () => setMode(MODE_VIEW));
        editButton.classList.add("editor-mode-toggle");
        viewButton.classList.add("editor-mode-toggle");
        editButton.setAttribute("type", "button");
        viewButton.setAttribute("type", "button");

        toggleGroup.append(editButton, viewButton);
        toolbar.append(toggleGroup, utilityGroup);
        container.insertBefore(toolbar, container.firstChild);
    }

    const wantsEnhanced = determineEnhancedPreference();
    const easyMdeAvailable = typeof window !== "undefined" && typeof window.EasyMDE === "function";
    const enhanceWithEasyMde = wantsEnhanced && easyMdeAvailable;

    let currentMode = sanitizeMode(initialMode);
    let easyMdeInstance = null;
    let isProgrammaticUpdate = false;
    let isDestroyed = false;

    if (enhanceWithEasyMde) {
        easyMdeInstance = createEasyMdeInstance(textarea);
        configureEasyMde(easyMdeInstance, { syncTextareaValue });
    } else {
        setupFallbackTextarea(textarea, emit);
    }

    applyMode(currentMode);

    function sanitizeMode(mode) {
        return mode === MODE_EDIT ? MODE_EDIT : MODE_VIEW;
    }

    function applyMode(mode) {
        const safeMode = sanitizeMode(mode);
        container.classList.toggle("markdown-editor-host--edit", safeMode === MODE_EDIT);
        container.classList.toggle("markdown-editor-host--view", safeMode === MODE_VIEW);
        if (showToolbar) {
            editButton.classList.toggle("is-active", safeMode === MODE_EDIT);
            viewButton.classList.toggle("is-active", safeMode === MODE_VIEW);
            editButton.setAttribute("aria-pressed", safeMode === MODE_EDIT ? "true" : "false");
            viewButton.setAttribute("aria-pressed", safeMode === MODE_VIEW ? "true" : "false");
        }
    }

    function determineEnhancedPreference() {
        if (typeof globalThis !== "undefined" && typeof globalThis.__gravityForceMarkdownEditor === "boolean") {
            return globalThis.__gravityForceMarkdownEditor;
        }
        return Boolean(appConfig.useMarkdownEditor);
    }

    function setMode(nextMode) {
        const safeMode = sanitizeMode(nextMode);
        if (currentMode === safeMode) return;
        currentMode = safeMode;
        applyMode(safeMode);
        if (safeMode === MODE_EDIT) focusEditPane();
        emit("modechange", { mode: safeMode });
    }

    function getMode() {
        return currentMode;
    }

    function focusEditPane() {
        if (easyMdeInstance) {
            easyMdeInstance.codemirror.focus();
            easyMdeInstance.codemirror.refresh();
        } else {
            textarea.focus();
        }
    }

    function getValue() {
        if (easyMdeInstance) return easyMdeInstance.value();
        return textarea.value;
    }

    function setValue(nextValue) {
        const safeValue = typeof nextValue === "string" ? nextValue : "";
        if (easyMdeInstance) {
            isProgrammaticUpdate = true;
            easyMdeInstance.value(safeValue);
            isProgrammaticUpdate = false;
            syncTextareaValue();
        } else {
            textarea.value = safeValue;
        }
    }

    function syncTextareaValue() {
        if (!easyMdeInstance) return;
        const current = easyMdeInstance.value();
        if (textarea.value !== current) textarea.value = current;
    }

    function setCaretPosition(position) {
        const target = position === "end" ? "end" : "start";
        if (easyMdeInstance) {
            const doc = easyMdeInstance.codemirror.getDoc();
            const value = doc.getValue();
            const index = target === "end" ? value.length : 0;
            const cursor = doc.posFromIndex(index);
            doc.setCursor(cursor);
            return;
        }
        const caretIndex = target === "end" ? textarea.value.length : 0;
        try {
            textarea.setSelectionRange(caretIndex, caretIndex);
        } catch {}
    }

    async function insertImagesFromFiles(files) {
        const fileList = Array.isArray(files) ? files : [];
        if (fileList.length === 0) return;

        const normalized = [];
        for (const file of fileList) {
            if (!(file instanceof File)) continue;
            if (!file.type || !file.type.startsWith("image/")) continue;
            if (IMAGE_TIFF_TYPES.has(file.type)) {
                const converted = await convertTiffToPng(file);
                if (converted) normalized.push(converted);
            } else {
                normalized.push(file);
            }
        }

        if (normalized.length === 0) return;

        if (easyMdeInstance) {
            const cm = easyMdeInstance.codemirror;
            const doc = cm.getDoc();
            const selection = doc.listSelections()[0] ?? { anchor: doc.getCursor("from"), head: doc.getCursor("to") };
            const { start, end } = orderSelection(selection);
            const startIndex = doc.indexFromPos(start);
            const endIndex = doc.indexFromPos(end);

            textarea.value = doc.getValue();
            textarea.selectionStart = startIndex;
            textarea.selectionEnd = endIndex;

            const result = await insertAttachmentPlaceholders(textarea, normalized);
            const insertedText = result.text.slice(startIndex, result.caretIndex);

            doc.replaceRange(insertedText, start, end);
            const nextCursor = doc.posFromIndex(result.caretIndex);
            doc.setCursor(nextCursor);
            syncTextareaValue();
            emitChange();
        } else {
            const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
            const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
            textarea.selectionStart = start;
            textarea.selectionEnd = end;
            await insertAttachmentPlaceholders(textarea, normalized);
            emitChange();
        }
    }

    function emitChange() {
        if (isProgrammaticUpdate) return;
        emit("change", { value: getValue() });
    }

    function refresh() {
        if (easyMdeInstance) {
            easyMdeInstance.codemirror.refresh();
        }
    }

    function focus() {
        if (currentMode === MODE_VIEW) {
            setMode(MODE_EDIT);
        }
        focusEditPane();
    }

    function destroy() {
        if (isDestroyed) return;
        isDestroyed = true;
        listeners.clear();
        if (easyMdeInstance) {
            easyMdeInstance.toTextArea();
        }
        if (showToolbar && toolbar) {
            toolbar.remove();
        }
    }

    /** @param {{ anchor: { line: number, ch: number }, head: { line: number, ch: number } }} selection */
    function orderSelection(selection) {
        const { anchor, head } = selection;
        if (anchor.line < head.line) return { start: anchor, end: head };
        if (anchor.line > head.line) return { start: head, end: anchor };
        return anchor.ch <= head.ch ? { start: anchor, end: head } : { start: head, end: anchor };
    }

    function isEnhanced() {
        return Boolean(easyMdeInstance);
    }

    function waitForPendingImages() {
        return waitForPendingImagePastes(textarea);
    }

    return {
        on,
        off,
        focus,
        getMode,
        setMode,
        getValue,
        setValue,
        refresh,
        setCaretPosition,
        waitForPendingImages,
        isEnhanced,
        destroy,
        getTextarea: () => textarea
    };

    function createButton(label, handler) {
        const button = createElement("button", "editor-button", label);
        button.addEventListener("click", (event) => {
            event.preventDefault();
            handler();
        });
        return button;
    }

    function createEasyMdeInstance(element) {
        return new window.EasyMDE({
            element,
            autoDownloadFontAwesome: false,
            spellChecker: false,
            status: false,
            autofocus: false,
            toolbar: false,
            forceSync: true,
            renderingConfig: { singleLineBreaks: false, codeSyntaxHighlighting: false }
        });
    }

    function configureEasyMde(instance, { syncTextareaValue }) {
        const { codemirror } = instance;

        codemirror.addKeyMap({
            Enter: (cm) => handleEnter(cm),
            "Shift-Enter": (cm) => {
                cm.replaceSelection(SOFT_BREAK, "end");
            }
        });

        codemirror.on("change", () => {
            syncTextareaValue();
            emitChange();
        });

        codemirror.on("blur", () => emit("blur"));

        codemirror.on("keydown", (cm, event) => {
            if (event.defaultPrevented) return;
            if (!isNavigationKey(event)) return;
            if (!isSelectionCollapsed(cm)) return;

            if (event.key === "ArrowUp" && isCaretOnFirstLine(cm)) {
                event.preventDefault();
                emit("navigatePrevious");
                return;
            }

            if (event.key === "ArrowDown" && isCaretOnLastLine(cm)) {
                event.preventDefault();
                emit("navigateNext");
            }
        });

        codemirror.on("inputRead", (cm, change) => {
            const { line } = cm.getCursor();
            normalizeBullet(cm, line);
            if (change?.text && change.text.length > 1) {
                for (let i = change.from.line; i <= change.to.line; i += 1) {
                    normalizeBullet(cm, i);
                }
            }
        });

        codemirror.on("paste", async (cm, event) => {
            const clipboardData = event?.clipboardData;
            const gravityPayload = extractGravityClipboardPayload(clipboardData);
            if (gravityPayload) {
                event.preventDefault();
                applyGravityClipboardPayload(textarea, gravityPayload, { codemirror: cm });
                return;
            }

            const items = clipboardData?.items || [];
            const files = [];
            for (const item of items) {
                if (item.kind === "file") {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length === 0) return;
            event.preventDefault();
            await insertImagesFromFiles(files);
        });

        const wrapper = codemirror.getWrapperElement();
        wrapper.addEventListener("dragover", (event) => {
            if (hasImageFile(event.dataTransfer)) {
                event.preventDefault();
            }
        });

        wrapper.addEventListener("drop", async (event) => {
            const fileList = Array.from(event.dataTransfer?.files ?? []);
            const imageFiles = fileList.filter((file) => file?.type?.startsWith("image/"));
            if (imageFiles.length === 0) return;
            event.preventDefault();
            await insertImagesFromFiles(imageFiles);
        });

        function handleEnter(cm) {
            const cursor = cm.getCursor();
            const lineText = cm.getLine(cursor.line);

            if (isTableRow(lineText) && !isTableSeparator(lineText)) {
                insertTableRow(cm, cursor.line, lineText);
                return;
            }

            if (isListLine(lineText)) {
                cm.execCommand("newlineAndIndentContinueMarkdownList");
                autoRenumberOrderedList(cm, cm.getCursor().line);
                return;
            }

            emit("submit");
        }
    }

    function setupFallbackTextarea(el, emitFn) {
        el.addEventListener("input", () => emitFn("change", { value: el.value }));
        el.addEventListener("blur", () => emitFn("blur"));
        el.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                emitFn("submit");
                return;
            }
            if (!isNavigationKey(event)) return;
            if (event.key === "ArrowUp" && isTextareaCaretOnFirstLine(el)) {
                event.preventDefault();
                emitFn("navigatePrevious");
            }
            if (event.key === "ArrowDown" && isTextareaCaretOnLastLine(el)) {
                event.preventDefault();
                emitFn("navigateNext");
            }
        });
    }

    function isNavigationKey(event) {
        return (event.key === "ArrowUp" || event.key === "ArrowDown")
            && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    }

    function isSelectionCollapsed(cm) {
        const doc = cm.getDoc();
        const anchor = doc.getCursor("anchor");
        const head = doc.getCursor("head");
        return anchor.line === head.line && anchor.ch === head.ch;
    }

    function isCaretOnFirstLine(cm) {
        const doc = cm.getDoc();
        const head = doc.getCursor("head");
        const index = doc.indexFromPos(head);
        return !cm.getValue().slice(0, index).includes("\n");
    }

    function isCaretOnLastLine(cm) {
        const doc = cm.getDoc();
        const head = doc.getCursor("head");
        const index = doc.indexFromPos(head);
        return !cm.getValue().slice(index).includes("\n");
    }

    function isTextareaCaretOnFirstLine(el) {
        const caret = el.selectionStart ?? 0;
        return !el.value.slice(0, caret).includes("\n");
    }

    function isTextareaCaretOnLastLine(el) {
        const caret = el.selectionEnd ?? el.value.length;
        return !el.value.slice(caret).includes("\n");
    }

    function hasImageFile(dataTransfer) {
        if (!dataTransfer) return false;
        const files = Array.from(dataTransfer.files ?? []);
        return files.some(file => file?.type?.startsWith("image/"));
    }

    function normalizeBullet(cm, lineNumber) {
        if (lineNumber < 0 || lineNumber >= cm.lineCount()) return;
        const text = cm.getLine(lineNumber);
        const normalized = text
            .replace(BULLET_NORMALIZATION_REGEX, "- ")
            .replace(MALFORMED_BULLET_REGEX, "- ");
        if (normalized !== text) {
            cm.replaceRange(normalized, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: text.length });
        }
    }

    function autoRenumberOrderedList(cm, atLine) {
        let start = atLine;
        while (start > 0 && ORDERED_LIST_REGEX.test(cm.getLine(start - 1))) start -= 1;
        let end = atLine;
        while (end + 1 < cm.lineCount() && ORDERED_LIST_REGEX.test(cm.getLine(end + 1))) end += 1;
        const initial = cm.getLine(start);
        const match = initial.match(ORDERED_LIST_REGEX);
        const baseNumber = match ? Number.parseInt(match[1], 10) : 1;
        let nextNumber = Number.isFinite(baseNumber) ? baseNumber : 1;
        cm.operation(() => {
            for (let line = start; line <= end; line += 1) {
                const content = cm.getLine(line);
                const parsed = content.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
                if (!parsed) continue;
                const leading = parsed[1] ?? "";
                const separator = parsed[3] ?? ". ";
                const rest = parsed[4] ?? "";
                const updated = `${leading}${nextNumber}${separator}${rest}`;
                if (updated !== content) {
                    cm.replaceRange(updated, { line, ch: 0 }, { line, ch: content.length });
                }
                nextNumber += 1;
            }
        });
    }

    function isListLine(lineText) {
        return ORDERED_LIST_REGEX.test(lineText) || UNORDERED_LIST_REGEX.test(lineText);
    }

    function isTableRow(lineText) {
        return TABLE_ROW_REGEX.test(lineText);
    }

    function isTableSeparator(lineText) {
        return TABLE_SEPARATOR_REGEX.test(lineText);
    }

    function insertTableRow(cm, lineNumber, lineText) {
        const pipeCount = (lineText.match(/\|/g) || []).length;
        const cellCount = Math.max(pipeCount - 1, 1);
        const cells = Array.from({ length: cellCount }, () => " ");
        const newRow = `\n| ${cells.join(" | ")} |`;
        const lineLength = lineText.length;
        cm.replaceRange(newRow, { line: lineNumber, ch: lineLength });
        cm.setCursor({ line: lineNumber + 1, ch: 2 });
        autoRenumberOrderedList(cm, lineNumber + 1);
    }
}

async function convertTiffToPng(file) {
    const dataUrl = await fileToDataUrl(file);
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const baseName = file.name ? file.name.replace(/\.[^.]+$/, "") : "pasted-image";
    return new File([blob], `${baseName}.png`, { type: "image/png" });
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : ""));
        reader.addEventListener("error", () => reject(reader.error ?? new Error("Unable to read file")));
        reader.readAsDataURL(file);
    });
}

function loadImage(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener("load", () => resolve(image));
        image.addEventListener("error", () => reject(new Error("Unable to decode image")));
        image.src = source;
    });
}
