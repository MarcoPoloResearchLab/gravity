// @ts-check

import { appConfig } from "../core/config.js";
import { createElement } from "../utils/index.js";
import {
    LABEL_EDIT_MARKDOWN,
    LABEL_VIEW_RENDERED
} from "../constants.js";
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
const CODE_FENCE_REGEX = /^(\s*)(`{3,}|~{3,})([^`~]*)$/;
const SOFT_BREAK = "  \n";
const IMAGE_TIFF_TYPES = new Set(["image/tiff", "image/x-tiff"]);
const BRACKET_PAIRS = Object.freeze({
    "(": ")",
    "[": "]",
    "{": "}",
    '"': '"',
    "'": "'"
});
const CLOSING_BRACKETS = new Set(Object.values(BRACKET_PAIRS));

/**
 * @typedef {"edit" | "view"} MarkdownEditorMode
 */

/**
 * @typedef {"change" | "submit" | "blur" | "navigatePrevious" | "navigateNext" | "modechange"} MarkdownEditorEvent
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
        if (event === "submit" || event === "blur" || event === "navigatePrevious" || event === "navigateNext") {
            normalizeOrderedLists();
        }
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
    let isApplyingListAutoRenumber = false;
    let renumberEnhancedOrderedLists = null;

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
        renumberEnhancedOrderedLists = null;
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

    function normalizeOrderedLists() {
        if (easyMdeInstance && typeof renumberEnhancedOrderedLists === "function") {
            renumberEnhancedOrderedLists();
            syncTextareaValue();
            return;
        }
        if (!easyMdeInstance) {
            const mutated = normalizeOrderedListsTextarea(textarea);
            if (mutated) {
                emit("change", { value: textarea.value });
            }
        }
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
            autoCloseBrackets: true,
            autoCloseTags: true,
            renderingConfig: { singleLineBreaks: false, codeSyntaxHighlighting: false }
        });
    }

    function configureEasyMde(instance, { syncTextareaValue }) {
        const { codemirror } = instance;

        const executeUndo = (cm) => {
            if (!cm) return;
            if (typeof cm.execCommand === "function") {
                cm.execCommand("undo");
                return;
            }
            if (typeof cm.undo === "function") {
                cm.undo();
            }
        };

        const executeRedo = (cm) => {
            if (!cm) return;
            if (typeof cm.execCommand === "function") {
                cm.execCommand("redo");
                return;
            }
            if (typeof cm.redo === "function") {
                cm.redo();
            }
        };

        const executeDeleteLine = (cm) => {
            if (!cm) return;
            if (typeof cm.execCommand === "function") {
                cm.execCommand("deleteLine");
                return;
            }
            if (typeof cm.removeLine === "function") {
                cm.removeLine(cm.getCursor().line);
            }
        };

        const executeDuplicateLine = (cm) => {
            if (!cm) return;
            const doc = typeof cm.getDoc === "function" ? cm.getDoc() : null;
            if (!doc) return;
            cm.operation(() => {
                const selections = doc.listSelections();
                const ranges = selections.length > 0 ? selections : [{ anchor: doc.getCursor(), head: doc.getCursor() }];
                const updates = ranges.map((range) => {
                    const anchorBeforeHead = range.anchor.line < range.head.line
                        || (range.anchor.line === range.head.line && range.anchor.ch <= range.head.ch);
                    const start = anchorBeforeHead ? range.anchor : range.head;
                    const end = anchorBeforeHead ? range.head : range.anchor;
                    const startLine = Math.min(start.line, end.line);
                    const endLine = Math.max(start.line, end.line);
                    const from = { line: startLine, ch: 0 };
                    const to = { line: endLine, ch: doc.getLine(endLine)?.length ?? 0 };
                    const segment = doc.getRange(from, to);
                    const insertPos = { line: endLine, ch: doc.getLine(endLine)?.length ?? 0 };
                    const caretColumn = start.ch;
                    return { insertPos, segment, caretColumn, startLine, endLine };
                });

                for (let index = updates.length - 1; index >= 0; index -= 1) {
                    const update = updates[index];
                    doc.replaceRange(`\n${update.segment}`, update.insertPos, undefined, "+duplicateLine");
                }

                if (updates.length > 0) {
                    const primary = updates[0];
                    const targetLine = primary.insertPos.line + 1;
                    const targetCh = Math.min(primary.caretColumn, doc.getLine(targetLine)?.length ?? 0);
                    doc.setCursor({ line: targetLine, ch: targetCh });
                }
            });
        };

        codemirror.addKeyMap({
            Enter: (cm) => {
                handleEnter(cm);
            },
            "Shift-Enter": (cm) => {
                cm.replaceSelection(SOFT_BREAK, "end");
            },
            "Cmd-Enter": () => {
                normalizeOrderedLists();
                emit("submit");
            },
            "Ctrl-Enter": () => {
                normalizeOrderedLists();
                emit("submit");
            },
            "Cmd-S": () => {
                normalizeOrderedLists();
                emit("submit");
            },
            "Ctrl-S": () => {
                normalizeOrderedLists();
                emit("submit");
            },
            "Cmd-Z": (cm) => {
                executeUndo(cm);
            },
            "Ctrl-Z": (cm) => {
                executeUndo(cm);
            },
            "Cmd-Shift-Z": (cm) => {
                executeRedo(cm);
            },
            "Ctrl-Shift-Z": (cm) => {
                executeRedo(cm);
            },
            "Shift-Cmd-Z": (cm) => {
                executeRedo(cm);
            },
            "Shift-Ctrl-Z": (cm) => {
                executeRedo(cm);
            },
            "Cmd-Y": (cm) => {
                executeRedo(cm);
            },
            "Ctrl-Y": (cm) => {
                executeRedo(cm);
            },
            "Cmd-Shift-K": (cm) => {
                executeDeleteLine(cm);
                normalizeOrderedLists();
            },
            "Ctrl-Shift-K": (cm) => {
                executeDeleteLine(cm);
                normalizeOrderedLists();
            },
            "Shift-Cmd-K": (cm) => {
                executeDeleteLine(cm);
                normalizeOrderedLists();
            },
            "Shift-Ctrl-K": (cm) => {
                executeDeleteLine(cm);
                normalizeOrderedLists();
            },
            "Cmd-Shift-D": (cm) => {
                executeDuplicateLine(cm);
                normalizeOrderedLists();
            },
            "Ctrl-Shift-D": (cm) => {
                executeDuplicateLine(cm);
                normalizeOrderedLists();
            },
            "Shift-Cmd-D": (cm) => {
                executeDuplicateLine(cm);
                normalizeOrderedLists();
            },
            "Shift-Ctrl-D": (cm) => {
                executeDuplicateLine(cm);
                normalizeOrderedLists();
            }
        });

        codemirror.on("change", (cm, change) => {
            if (!isProgrammaticUpdate && !isApplyingListAutoRenumber) {
                if (maybeRenumberOrderedLists(cm, change)) {
                    syncTextareaValue();
                }
            }
            syncTextareaValue();
            emitChange();
        });

        codemirror.on("blur", () => {
            normalizeOrderedLists();
            emit("blur");
        });

        codemirror.on("keydown", (cm, event) => {
            if (event.defaultPrevented) return;

            const isModifier = event.metaKey || event.ctrlKey;
            if (isModifier && (event.key === "Enter" || event.key === "s" || event.key === "S")) {
                event.preventDefault();
                emit("submit");
                return;
            }

            if (!isNavigationKey(event)) return;
            if (!isSelectionCollapsed(cm)) return;

            if (event.key === "ArrowUp" && isCaretOnFirstLine(cm)) {
                event.preventDefault();
                normalizeOrderedLists();
                emit("navigatePrevious");
                return;
            }

            if (event.key === "ArrowDown" && isCaretOnLastLine(cm)) {
                event.preventDefault();
                normalizeOrderedLists();
                emit("navigateNext");
            }
        });

        codemirror.on("keypress", (cm, event) => {
            if (event.defaultPrevented) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;

            const closing = BRACKET_PAIRS[event.key];
            if (closing) {
                const handled = handleBracketAutoClose(cm, event.key, closing);
                if (handled) {
                    event.preventDefault();
                    return;
                }
            }

            if (CLOSING_BRACKETS.has(event.key)) {
                const skipped = skipExistingClosingBracket(cm, event.key);
                if (skipped) {
                    event.preventDefault();
                }
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

            if (handleCodeFenceInCodeMirror(cm, cursor, lineText)) {
                return;
            }

            if (isTableRow(lineText) && !isTableSeparator(lineText)) {
                insertTableRow(cm, cursor.line, lineText);
                return;
            }

            if (isListLine(lineText)) {
                cm.execCommand("newlineAndIndentContinueMarkdownList");
                withListAutoRenumber(() => {
                    autoRenumberOrderedList(cm, cm.getCursor().line);
                });
                return;
            }

            cm.execCommand("newlineAndIndent");
        }

        function maybeRenumberOrderedLists(cm, change) {
            if (!change) return false;
            let adjusted = false;
            let pointer = change;
            const processedBlocks = new Set();

            while (pointer) {
                if (!shouldInspectChange(pointer)) {
                    pointer = pointer.next;
                    continue;
                }

                const candidateLines = collectCandidateListLines(cm, pointer);
                for (const line of candidateLines) {
                    const bounds = findOrderedListBounds(cm, line);
                    if (!bounds) {
                        continue;
                    }
                    const key = `${bounds.start}:${bounds.end}`;
                    if (processedBlocks.has(key)) {
                        continue;
                    }
                    withListAutoRenumber(() => {
                        autoRenumberOrderedList(cm, line);
                    });
                    processedBlocks.add(key);
                    adjusted = true;
                }

                pointer = pointer.next;
            }

            return adjusted;
        }

        function shouldInspectChange(change) {
            if (!change) return false;
            const inserted = Array.isArray(change.text) ? change.text : [];
            const removed = Array.isArray(change.removed) ? change.removed : [];
            if (change.origin === "paste" || change.origin === "paste+") return true;
            if (inserted.length > 1 || removed.length > 1) return true;
            if (inserted.some((line) => ORDERED_LIST_REGEX.test(line))) return true;
            if (removed.some((line) => ORDERED_LIST_REGEX.test(line))) return true;
            return false;
        }

        function collectCandidateListLines(cm, change) {
            const lineCount = cm.lineCount();
            const range = new Set();
            const insertedLength = Array.isArray(change.text) ? change.text.length : 0;
            const baseLine = change.from?.line ?? 0;
            const startLine = Math.max(baseLine - 1, 0);
            const endLine = Math.min(lineCount - 1, baseLine + Math.max(insertedLength, 1));
            for (let line = startLine; line <= endLine; line += 1) {
                range.add(line);
            }

            const removed = Array.isArray(change.removed) ? change.removed : [];
            removed.forEach((lineText, index) => {
                if (!ORDERED_LIST_REGEX.test(lineText)) {
                    return;
                }
                const candidateLine = baseLine + index;
                if (candidateLine >= 0 && candidateLine < lineCount) {
                    range.add(candidateLine);
                }
                if (candidateLine - 1 >= 0) {
                    range.add(candidateLine - 1);
                }
            });

            return Array.from(range).filter((line) => {
                const content = safeGetLine(cm, line);
                return ORDERED_LIST_REGEX.test(content);
            });
        }

        function findOrderedListBounds(cm, line) {
            const content = safeGetLine(cm, line);
            if (!ORDERED_LIST_REGEX.test(content)) {
                return null;
            }
            let start = line;
            while (start > 0 && ORDERED_LIST_REGEX.test(safeGetLine(cm, start - 1))) {
                start -= 1;
            }
            let end = line;
            while (end + 1 < cm.lineCount() && ORDERED_LIST_REGEX.test(safeGetLine(cm, end + 1))) {
                end += 1;
            }
            return { start, end };
        }

        function safeGetLine(cm, lineIndex) {
            if (typeof lineIndex !== "number") return "";
            if (lineIndex < 0 || lineIndex >= cm.lineCount()) return "";
            return cm.getLine(lineIndex) ?? "";
        }

        function withListAutoRenumber(action) {
            if (typeof action !== "function") {
                return;
            }
            if (isApplyingListAutoRenumber) {
                action();
                return;
            }
            isApplyingListAutoRenumber = true;
            try {
                action();
            } finally {
                isApplyingListAutoRenumber = false;
            }
        }

        function renumberAllOrderedListsInCodeMirror(cm) {
            if (!cm) return;
            withListAutoRenumber(() => {
                let line = 0;
                const lineCount = cm.lineCount();
                while (line < lineCount) {
                    if (!ORDERED_LIST_REGEX.test(safeGetLine(cm, line))) {
                        line += 1;
                        continue;
                    }
                    const content = safeGetLine(cm, line);
                    const adjusted = typeof content === "string"
                        ? content.replace(/^(\s*)(\d+)(\.\s+)/, (_, leading = "", _num, separator = ". ") => `${leading}1${separator}`)
                        : content;
                    if (adjusted !== content) {
                        cm.replaceRange(adjusted, { line, ch: 0 }, { line, ch: content.length }, "+autoRenumber");
                    }
                    autoRenumberOrderedList(cm, line);
                    while (line < lineCount && ORDERED_LIST_REGEX.test(safeGetLine(cm, line))) {
                        line += 1;
                    }
                }
            });
        }

        renumberEnhancedOrderedLists = () => renumberAllOrderedListsInCodeMirror(codemirror);
    }

    function setupFallbackTextarea(el, emitFn) {
        el.addEventListener("input", () => {
            if (el.__gravityHandlingInput) {
                return;
            }
            if (el.__gravityLastKey === "Enter") {
                el.__gravityHandlingInput = true;
                const previousValue = typeof el.__gravityPrevValue === "string" ? el.__gravityPrevValue : el.value;
                const previousCaret = typeof el.__gravityPrevSelectionStart === "number"
                    ? el.__gravityPrevSelectionStart
                    : (el.selectionStart ?? previousValue.length);
                el.value = previousValue;
                el.setSelectionRange(previousCaret, previousCaret);
                handleTextareaEnter(el);
                el.__gravityLastKey = undefined;
                delete el.__gravityPrevValue;
                delete el.__gravityPrevSelectionStart;
                el.__gravityHandlingInput = false;
                emitFn("change", { value: el.value });
                return;
            }
            emitFn("change", { value: el.value });
        });
        el.addEventListener("blur", () => {
            normalizeOrderedLists();
            emitFn("blur");
        });
        el.addEventListener("keydown", (event) => {
            const isModifier = event.metaKey || event.ctrlKey;

            if (!isModifier && !event.altKey && BRACKET_PAIRS[event.key]) {
                event.preventDefault();
                applyBracketPair(el, event.key, BRACKET_PAIRS[event.key]);
                emitFn("change", { value: el.value });
                return;
            }

            if (!isModifier && !event.altKey && CLOSING_BRACKETS.has(event.key)) {
                const skipped = skipExistingClosingBracketTextarea(el, event.key);
                if (skipped) {
                    event.preventDefault();
                    return;
                }
            }

            if (isModifier && event.shiftKey && (event.key === "k" || event.key === "K")) {
                event.preventDefault();
                deleteCurrentLineTextarea(el);
                normalizeOrderedLists();
                emitFn("change", { value: el.value });
                return;
            }

            if (isModifier && event.shiftKey && (event.key === "d" || event.key === "D")) {
                event.preventDefault();
                duplicateCurrentLineTextarea(el);
                normalizeOrderedLists();
                emitFn("change", { value: el.value });
                return;
            }

            if (!isModifier && !event.altKey && !event.shiftKey && event.key === "Enter") {
                el.__gravityPrevValue = el.value;
                el.__gravityPrevSelectionStart = el.selectionStart ?? el.value.length;
                el.__gravityLastKey = "Enter";
            } else {
                el.__gravityLastKey = undefined;
            }

            if ((event.key === "Enter" || event.key === "s" || event.key === "S") && isModifier) {
                event.preventDefault();
                normalizeOrderedLists();
                emitFn("submit");
                return;
            }

            if (event.key === "Enter" && event.shiftKey && !isModifier) {
                event.preventDefault();
                insertSoftBreak(el);
                emitFn("change", { value: el.value });
                return;
            }

            if (event.key === "Tab" && !isModifier && !event.altKey) {
                event.preventDefault();
                if (event.shiftKey) {
                    applyOutdent(el);
                } else {
                    applyIndent(el);
                }
                emitFn("change", { value: el.value });
                return;
            }

            if (!isNavigationKey(event)) return;
            if (event.key === "ArrowUp" && isTextareaCaretOnFirstLine(el)) {
                event.preventDefault();
                normalizeOrderedLists();
                emitFn("navigatePrevious");
            }
            if (event.key === "ArrowDown" && isTextareaCaretOnLastLine(el)) {
                event.preventDefault();
                normalizeOrderedLists();
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
        const initialMatch = initial?.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
        const initialIndent = initialMatch ? (initialMatch[1] ?? "").length : 0;
        const initialNumber = initialMatch ? Number.parseInt(initialMatch[2], 10) : 1;
        const stack = [{
            indent: initialIndent,
            counter: Number.isFinite(initialNumber) ? initialNumber : 1
        }];

        cm.operation(() => {
            for (let line = start; line <= end; line += 1) {
                const content = cm.getLine(line);
                const parsed = content.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
                if (!parsed) continue;
                const leading = parsed[1] ?? "";
                const indentLength = leading.length;

                while (stack.length > 0 && indentLength < stack[stack.length - 1].indent) {
                    stack.pop();
                }

                if (stack.length === 0) {
                    stack.push({ indent: indentLength, counter: 1 });
                }

                let frame = stack[stack.length - 1];
                if (indentLength > frame.indent) {
                    frame = { indent: indentLength, counter: 1 };
                    stack.push(frame);
                } else if (indentLength < frame.indent) {
                    frame = { indent: indentLength, counter: 1 };
                    stack.push(frame);
                }

                const currentNumber = frame.counter;
                frame.counter += 1;

                const separator = parsed[3] ?? ". ";
                const rest = parsed[4] ?? "";
                const updated = `${leading}${currentNumber}${separator}${rest}`;
                if (updated !== content) {
                    cm.replaceRange(updated, { line, ch: 0 }, { line, ch: content.length });
                }
            }
        });
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

const INDENT_SEQUENCE = "    ";



function insertSoftBreak(textarea) {
    const { selectionStart = 0, selectionEnd = 0, value } = textarea;
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);
    const nextValue = `${before}${SOFT_BREAK}${after}`;
    textarea.value = nextValue;
    const caret = selectionStart + SOFT_BREAK.length;
    textarea.setSelectionRange(caret, caret);
}

function applyBracketPair(textarea, openChar, closeChar) {
    if (typeof closeChar !== "string") return;
    const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
    const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const selected = textarea.value.slice(start, end);
    const isSquarePair = openChar === "[" && closeChar === "]";

    if (isSquarePair && start === end) {
        const insertion = "[ ] ";
        textarea.value = `${before}${insertion}${after}`;
        const caretAfterClose = start + insertion.length;
        textarea.setSelectionRange(caretAfterClose, caretAfterClose);
        return;
    }

    textarea.value = `${before}${openChar}${selected}${closeChar}${after}`;
    const nextStart = start + 1;
    const nextEnd = end + 1;
    if (start === end) {
        textarea.setSelectionRange(nextStart, nextStart);
    } else {
        textarea.setSelectionRange(nextStart, nextEnd);
    }
}

function skipExistingClosingBracketTextarea(textarea, closeChar) {
    if (typeof closeChar !== "string") return false;
    const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
    const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
    if (start !== end) return false;
    if (textarea.value.charAt(start) !== closeChar) return false;
    const nextCaret = start + 1;
    try {
        textarea.setSelectionRange(nextCaret, nextCaret);
    } catch {
        return false;
    }
    return true;
}

function handleBracketAutoClose(cm, openChar, closeChar) {
    if (typeof closeChar !== "string") return false;
    const selections = cm.listSelections();
    if (!Array.isArray(selections) || selections.length === 0) return false;
    let handled = false;
    cm.operation(() => {
        for (const selection of selections) {
            const { anchor, head } = selection;
            const anchorBeforeHead = anchor.line < head.line
                || (anchor.line === head.line && anchor.ch <= head.ch);
            const start = anchorBeforeHead ? anchor : head;
            const end = anchorBeforeHead ? head : anchor;
            const isEmpty = start.line === end.line && start.ch === end.ch;
            const isSquarePair = openChar === "[" && closeChar === "]";

            if (!isEmpty) {
                const selectedText = cm.getRange(start, end);
                cm.replaceRange(`${openChar}${selectedText}${closeChar}`, start, end, "+autoCloseBracket");
                const startCursor = { line: start.line, ch: start.ch + 1 };
                const endCursor = { line: startCursor.line, ch: startCursor.ch + selectedText.length };
                cm.setSelection(startCursor, endCursor);
                handled = true;
                continue;
            }

            const cursor = cm.getCursor();
            const nextChar = cm.getRange(cursor, { line: cursor.line, ch: cursor.ch + 1 });
            if (nextChar === closeChar) {
                cm.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
                handled = true;
                continue;
            }

            if (isSquarePair) {
                const insertion = "[ ] ";
                cm.replaceRange(insertion, cursor, cursor, "+autoCloseBracket");
                cm.setCursor({ line: cursor.line, ch: cursor.ch + insertion.length });
            } else {
                cm.replaceRange(`${openChar}${closeChar}`, cursor, cursor, "+autoCloseBracket");
                cm.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
            }
            handled = true;
        }
    });
    return handled;
}

function skipExistingClosingBracket(cm, closeChar) {
    if (typeof closeChar !== "string") return false;
    let moved = false;
    cm.operation(() => {
        const selections = cm.listSelections();
        for (const selection of selections) {
            const { anchor, head } = selection;
            const anchorBeforeHead = anchor.line < head.line
                || (anchor.line === head.line && anchor.ch <= head.ch);
            const start = anchorBeforeHead ? anchor : head;
            const end = anchorBeforeHead ? head : anchor;
            const isCollapsed = start.line === end.line && start.ch === end.ch;
            if (!isCollapsed) {
                continue;
            }
            const nextPosition = { line: start.line, ch: start.ch + 1 };
            const nextChar = cm.getRange(start, nextPosition);
            if (nextChar === closeChar) {
                cm.setCursor(nextPosition);
                moved = true;
            }
        }
    });
    return moved;
}

function deleteCurrentLineTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const anchor = Math.min(selectionStart, selectionEnd);
    const head = Math.max(selectionStart, selectionEnd);
    let deleteStart = findLineStart(value, anchor);
    let deleteEnd = findLineEnd(value, head);

    if (deleteEnd < value.length) {
        deleteEnd += 1;
    } else if (deleteStart > 0) {
        deleteStart = findLineStart(value, deleteStart - 1);
    }

    const before = value.slice(0, deleteStart);
    const after = value.slice(deleteEnd);
    textarea.value = `${before}${after}`;
    const nextCaret = Math.min(deleteStart, textarea.value.length);
    try {
        textarea.setSelectionRange(nextCaret, nextCaret);
    } catch {}
}

function duplicateCurrentLineTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const anchor = Math.min(selectionStart, selectionEnd);
    const head = Math.max(selectionStart, selectionEnd);
    const lineStart = findLineStart(value, anchor);
    const lineEnd = findLineEnd(value, head);
    const plainSegment = value.slice(lineStart, lineEnd);
    const hasTrailingNewline = value.charAt(lineEnd) === "\n";

    let nextValue;
    let duplicateStart;
    if (hasTrailingNewline) {
        const before = value.slice(0, lineEnd + 1);
        const insertion = value.slice(lineStart, lineEnd + 1);
        const after = value.slice(lineEnd + 1);
        nextValue = `${before}${insertion}${after}`;
        duplicateStart = before.length;
    } else {
        const before = value.slice(0, lineEnd);
        const after = value.slice(lineEnd);
        const insertion = `\n${plainSegment}`;
        nextValue = `${before}${insertion}${after}`;
        duplicateStart = before.length + 1;
    }

    textarea.value = nextValue;
    const duplicateEnd = Math.min(duplicateStart + plainSegment.length, textarea.value.length);
    try {
        textarea.setSelectionRange(duplicateStart, duplicateEnd);
    } catch {}
}

function handleCodeFenceInCodeMirror(cm, cursor, lineText) {
    const parsed = parseCodeFence(lineText);
    if (!parsed) return false;
    if (cursor.ch !== lineText.length) return false;
    if (!isOpeningFenceInCodeMirror(cm, cursor.line, parsed.marker)) return false;
    const nextLine = cm.getLine(cursor.line + 1);
    if (isFenceLineWithMarker(nextLine, parsed.marker)) return false;

    const insertion = `\n${parsed.leading}\n${parsed.leading}${parsed.fence}`;
    cm.operation(() => {
        cm.replaceRange(insertion, cursor, cursor, "+input");
        cm.setCursor({ line: cursor.line + 1, ch: parsed.leading.length });
    });
    return true;
}

function handleCodeFenceEnterTextarea(textarea, context) {
    const { caret, lineStart, lineEnd, lineText } = context;
    const parsed = parseCodeFence(lineText);
    if (!parsed) return false;
    if (caret !== lineEnd) return false;
    if (!isOpeningFenceInText(textarea.value.slice(0, lineStart), parsed.marker)) return false;

    const nextLineStart = lineEnd + 1;
    const nextLineEnd = findLineEnd(textarea.value, nextLineStart);
    const nextLine = textarea.value.slice(nextLineStart, nextLineEnd);
    if (isFenceLineWithMarker(nextLine, parsed.marker)) return false;

    const before = textarea.value.slice(0, caret);
   const after = textarea.value.slice(caret);
   const insertion = `\n${parsed.leading}\n${parsed.leading}${parsed.fence}`;
   textarea.value = `${before}${insertion}${after}`;
   const caretIndex = before.length + 1 + parsed.leading.length;
   textarea.setSelectionRange(caretIndex, caretIndex);
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            try {
                textarea.setSelectionRange(caretIndex, caretIndex);
            } catch {}
        });
    }
   return true;
}

function parseCodeFence(lineText) {
    if (typeof lineText !== "string") return null;
    const match = lineText.match(CODE_FENCE_REGEX);
    if (!match) return null;
    const sequence = match[2] ?? "";
    if (sequence.length < 3) return null;
    const marker = sequence.charAt(0);
    return {
        leading: match[1] ?? "",
        fence: sequence,
        info: (match[3] ?? "").trim(),
        marker
    };
}

function isOpeningFenceInCodeMirror(cm, lineNumber, marker) {
    let parity = 0;
    for (let lineIndex = 0; lineIndex < lineNumber; lineIndex += 1) {
        const candidate = parseCodeFence(cm.getLine(lineIndex));
        if (candidate && candidate.marker === marker) {
            parity = parity === 0 ? 1 : 0;
        }
    }
    return parity === 0;
}

function isOpeningFenceInText(text, marker) {
    if (!text) return true;
    const lines = text.split(/\n/);
    let parity = 0;
    for (const line of lines) {
        const candidate = parseCodeFence(line);
        if (candidate && candidate.marker === marker) {
            parity = parity === 0 ? 1 : 0;
        }
    }
    return parity === 0;
}

function isFenceLineWithMarker(lineText, marker) {
    if (typeof lineText !== "string") return false;
    const parsed = parseCodeFence(lineText.trimEnd());
    if (!parsed) return false;
    if (parsed.marker !== marker) return false;
    return parsed.info.length === 0;
}

function handleTextareaEnter(textarea) {
    const caret = textarea.selectionStart ?? 0;
    const lineStart = findLineStart(textarea.value, caret);
    const lineEnd = findLineEnd(textarea.value, caret);
    const lineText = textarea.value.slice(lineStart, lineEnd);

    if (handleCodeFenceEnterTextarea(textarea, { caret, lineStart, lineEnd, lineText })) {
        return;
    }

    if (isTableRow(lineText) && !isTableSeparator(lineText)) {
        insertTableRowTextarea(textarea, lineEnd, lineText);
        return;
    }

    if (isListLine(lineText)) {
        handleListEnter(textarea, { caret, lineStart, lineEnd, lineText });
        return;
    }

    insertPlainNewline(textarea, caret);
}

function insertPlainNewline(textarea, caret) {
    const { value } = textarea;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    textarea.value = `${before}\n${after}`;
    const nextCaret = before.length + 1;
    textarea.setSelectionRange(nextCaret, nextCaret);
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

function insertTableRowTextarea(textarea, lineEnd, lineText) {
    const pipeCount = (lineText.match(/\|/g) || []).length;
    const cellCount = Math.max(pipeCount - 1, 1);
    const cells = Array.from({ length: cellCount }, () => " ");
    const newRow = `\n| ${cells.join(" | ")} |`;
    const before = textarea.value.slice(0, lineEnd);
    const after = textarea.value.slice(lineEnd);
    textarea.value = `${before}${newRow}${after}`;
    const nextCaret = before.length + 3; // newline + "| "
    textarea.setSelectionRange(nextCaret, nextCaret);
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            try {
                textarea.setSelectionRange(nextCaret, nextCaret);
            } catch {}
        });
    }
}

function handleListEnter(textarea, context) {
    const { caret, lineStart, lineEnd, lineText } = context;
    const listInfo = parseListLine(lineText);
    if (!listInfo) {
        insertPlainNewline(textarea, caret);
        return;
    }

    const prefix = listInfo.type === "ordered"
        ? `${listInfo.leading}${listInfo.number}${listInfo.separator}`
        : `${listInfo.leading}${listInfo.marker} `;
    const contentAfterPrefix = lineText.slice(prefix.length);
    const caretInLine = caret - lineStart;
    const trailingAfterCaret = lineText.slice(caretInLine).trim().length > 0;

    if (contentAfterPrefix.trim().length === 0 && !trailingAfterCaret) {
        const indentation = listInfo.leading;
        const before = textarea.value.slice(0, lineStart);
        const after = textarea.value.slice(lineEnd);
        textarea.value = `${before}${indentation}${after}`;
        const nextCaret = before.length + indentation.length;
        textarea.setSelectionRange(nextCaret, nextCaret);
        return;
    }

    const nextPrefix = listInfo.type === "ordered"
        ? `${listInfo.leading}${listInfo.number + 1}${listInfo.separator}`
        : `${listInfo.leading}${listInfo.marker} `;

    const selectionStart = textarea.selectionStart ?? caret;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;

    if (selectionStart === selectionEnd) {
        const collapsedCaret = selectionStart;
        let caretInLine = collapsedCaret - lineStart;
        if (caretInLine < 0) caretInLine = 0;
        if (caretInLine > lineText.length) caretInLine = lineText.length;

        const prefixLength = listInfo.type === "ordered"
            ? `${listInfo.number}${listInfo.separator}`.length + listInfo.leading.length
            : `${listInfo.marker} `.length + listInfo.leading.length;
        const content = lineText.slice(prefixLength);
        let caretInContent = caretInLine - prefixLength;
        if (caretInContent <= 0) caretInContent = content.length;
        if (caretInContent > content.length) caretInContent = content.length;

        const headContent = content.slice(0, caretInContent);
        const tailContent = content.slice(caretInContent);

        const beforeLine = textarea.value.slice(0, lineStart);
        const afterLine = textarea.value.slice(lineEnd);
        const currentPrefix = listInfo.type === "ordered"
            ? `${listInfo.leading}${listInfo.number}${listInfo.separator}`
            : `${listInfo.leading}${listInfo.marker} `;
        const updatedCurrentLine = `${currentPrefix}${headContent}`;
        const newLine = `${nextPrefix}${tailContent}`;

        textarea.value = `${beforeLine}${updatedCurrentLine}\n${newLine}${afterLine}`;

        let caretIndex = beforeLine.length + updatedCurrentLine.length + 1 + nextPrefix.length;
        if (listInfo.type === "ordered") {
            caretIndex = renumberOrderedListTextarea(textarea, caretIndex);
        }
        textarea.setSelectionRange(caretIndex, caretIndex);
        return;
    }

    textarea.setRangeText(`\n${nextPrefix}`, selectionStart, selectionEnd, "end");
    let caretIndex = textarea.selectionStart ?? (selectionStart + nextPrefix.length + 1);

    if (listInfo.type === "ordered") {
        caretIndex = renumberOrderedListTextarea(textarea, caretIndex);
    }

    textarea.setSelectionRange(caretIndex, caretIndex);
}

function parseListLine(lineText) {
    const orderedMatch = lineText.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
    if (orderedMatch) {
        return {
            type: "ordered",
            leading: orderedMatch[1] ?? "",
            number: Number.parseInt(orderedMatch[2], 10) || 1,
            separator: orderedMatch[3] ?? ". ",
            rest: orderedMatch[4] ?? ""
        };
    }
    const unorderedMatch = lineText.match(/^(\s*)([-*+])\s+.*$/);
    if (unorderedMatch) {
        return {
            type: "unordered",
            leading: unorderedMatch[1] ?? "",
            marker: unorderedMatch[2] ?? "-"
        };
    }
    return null;
}

function renumberOrderedListTextarea(textarea, caretIndex) {
    const lines = textarea.value.split("\n");
    let runningIndex = 0;
    let insertedLineIndex = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineLength = line.length;
        if (caretIndex <= runningIndex + lineLength) {
            insertedLineIndex = i;
            break;
        }
        runningIndex += lineLength + 1;
    }

    let start = insertedLineIndex;
    while (start > 0 && ORDERED_LIST_REGEX.test(lines[start - 1])) start -= 1;
    let end = insertedLineIndex;
    while (end + 1 < lines.length && ORDERED_LIST_REGEX.test(lines[end + 1])) end += 1;

    const firstMatch = lines[start]?.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
    const initialIndent = firstMatch ? (firstMatch[1] ?? "").length : 0;
    const initialNumber = firstMatch ? Number.parseInt(firstMatch[2], 10) : 1;
    const stack = [{
        indent: initialIndent,
        counter: Number.isFinite(initialNumber) ? initialNumber : 1
    }];
    for (let lineIdx = start; lineIdx <= end; lineIdx += 1) {
        const content = lines[lineIdx];
        const parsed = content.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
        if (!parsed) continue;
        const leading = parsed[1] ?? "";
        const indentLength = leading.length;

        while (stack.length > 0 && indentLength < stack[stack.length - 1].indent) {
            stack.pop();
        }

        if (stack.length === 0) {
            stack.push({ indent: indentLength, counter: 1 });
        }

        let frame = stack[stack.length - 1];
        if (indentLength > frame.indent) {
            frame = { indent: indentLength, counter: 1 };
            stack.push(frame);
        } else if (indentLength < frame.indent) {
            frame = { indent: indentLength, counter: 1 };
            stack.push(frame);
        }

        const currentNumber = frame.counter;
        frame.counter += 1;

        const separator = parsed[3] ?? ". ";
        const rest = parsed[4] ?? "";
        lines[lineIdx] = `${leading}${currentNumber}${separator}${rest}`;
    }

    textarea.value = lines.join("\n");

    let newCaret = 0;
    for (let i = 0; i < insertedLineIndex; i += 1) {
        newCaret += lines[i].length + 1;
    }
    const currentLine = lines[insertedLineIndex] ?? "";
    const caretMatch = currentLine.match(/^(\s*)(\d+)(\.\s+)/);
    const prefixLength = caretMatch
        ? (caretMatch[1]?.length ?? 0) + (caretMatch[2]?.length ?? 0) + (caretMatch[3]?.length ?? 0)
        : 0;
    newCaret += prefixLength;
    return newCaret;
}

function normalizeOrderedListsTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const computeCaretIndex = (rows, targetLine) => {
        let offset = 0;
        for (let i = 0; i < targetLine && i < rows.length; i += 1) {
            offset += rows[i].length;
            if (i < rows.length - 1) offset += 1;
        }
        return offset;
    };

    let lines = textarea.value.split("\n");
    let mutated = false;
    let lineIndex = 0;

    while (lineIndex < lines.length) {
        if (!ORDERED_LIST_REGEX.test(lines[lineIndex])) {
            lineIndex += 1;
            continue;
        }

        const blockStart = lineIndex;
        while (lineIndex < lines.length && ORDERED_LIST_REGEX.test(lines[lineIndex])) {
            lineIndex += 1;
        }

        const firstLine = lines[blockStart] ?? "";
        const adjustedFirstLine = firstLine.replace(/^(\s*)(\d+)(\.\s+)/, (_, leading = "", _num, separator = ". ") => `${leading}1${separator}`);
        if (adjustedFirstLine !== firstLine) {
            lines[blockStart] = adjustedFirstLine;
            textarea.value = lines.join("\n");
            mutated = true;
            lines = textarea.value.split("\n");
        }

        const caretIndex = computeCaretIndex(lines, blockStart);
        const beforeValue = textarea.value;
        renumberOrderedListTextarea(textarea, caretIndex);
        if (textarea.value !== beforeValue) {
            mutated = true;
        }

        lines = textarea.value.split("\n");
        lineIndex = blockStart;
        while (lineIndex < lines.length && ORDERED_LIST_REGEX.test(lines[lineIndex])) {
            lineIndex += 1;
        }
    }

    if (mutated) {
        try {
            const caret = textarea.value.length;
            textarea.setSelectionRange(caret, caret);
        } catch {}
    }

    return mutated;
}

function applyIndent(textarea) {
    const { selectionStart, selectionEnd, value } = textarea;
    const start = findLineStart(value, selectionStart);
    const end = findLineEnd(value, selectionEnd);
    const segment = value.slice(start, end);
    const lines = segment.split(/\n/);
    const indented = lines.map((line) => `${INDENT_SEQUENCE}${line}`).join("\n");
    const before = value.slice(0, start);
    const after = value.slice(end);
    textarea.value = `${before}${indented}${after}`;
    let caretAfterIndent = null;
    if (selectionStart === selectionEnd) {
        const caretOffset = selectionStart - start;
        const nextCaret = start + INDENT_SEQUENCE.length + caretOffset;
        textarea.setSelectionRange(nextCaret, nextCaret);
        caretAfterIndent = nextCaret;
    } else {
        textarea.setSelectionRange(start, start + indented.length);
    }

    if (lines.some((line) => ORDERED_LIST_REGEX.test(line))) {
        const targetCaret = caretAfterIndent ?? (start + indented.length);
        const adjustedCaret = renumberOrderedListTextarea(textarea, targetCaret);
        if (caretAfterIndent !== null) {
            textarea.setSelectionRange(adjustedCaret, adjustedCaret);
        }
    }
}

function applyOutdent(textarea) {
    const { selectionStart, selectionEnd, value } = textarea;
    const start = findLineStart(value, selectionStart);
    const end = findLineEnd(value, selectionEnd);
    const segment = value.slice(start, end);
    const lines = segment.split(/\n/);
    let removedFromFirstLine = 0;
    const outdented = lines.map((line, index) => {
        const { text, removed } = outdentLine(line);
        if (index === 0) removedFromFirstLine = removed;
        return text;
    }).join("\n");

    const before = value.slice(0, start);
    const after = value.slice(end);
    textarea.value = `${before}${outdented}${after}`;

    let caretAfterOutdent = null;
    if (selectionStart === selectionEnd) {
        const caretOffset = selectionStart - start;
        const nextCaret = start + Math.max(caretOffset - removedFromFirstLine, 0);
        textarea.setSelectionRange(nextCaret, nextCaret);
        caretAfterOutdent = nextCaret;
    } else {
        textarea.setSelectionRange(start, start + outdented.length);
    }

    if (lines.some((line) => ORDERED_LIST_REGEX.test(line))) {
        const targetCaret = caretAfterOutdent ?? (start + outdented.length);
        const adjustedCaret = renumberOrderedListTextarea(textarea, targetCaret);
        if (caretAfterOutdent !== null) {
            textarea.setSelectionRange(adjustedCaret, adjustedCaret);
        }
    }
}

function outdentLine(line) {
    if (!line) {
        return { text: line, removed: 0 };
    }
    if (line.startsWith("\t")) {
        return { text: line.slice(1), removed: 1 };
    }
    if (line.startsWith(INDENT_SEQUENCE)) {
        return { text: line.slice(INDENT_SEQUENCE.length), removed: INDENT_SEQUENCE.length };
    }
    const spacesMatch = line.match(/^ +/);
    if (spacesMatch) {
        const count = Math.min(spacesMatch[0].length, INDENT_SEQUENCE.length);
        return { text: line.slice(count), removed: count };
    }
    return { text: line, removed: 0 };
}

function findLineStart(text, index) {
    const safeIndex = Math.max(0, Math.min(index ?? 0, text.length));
    let cursor = safeIndex;
    while (cursor > 0 && text.charAt(cursor - 1) !== "\n") {
        cursor -= 1;
    }
    return cursor;
}

function findLineEnd(text, index) {
    const safeIndex = Math.max(0, Math.min(index ?? text.length, text.length));
    let cursor = safeIndex;
    while (cursor < text.length && text.charAt(cursor) !== "\n") {
        cursor += 1;
    }
    return cursor;
}
