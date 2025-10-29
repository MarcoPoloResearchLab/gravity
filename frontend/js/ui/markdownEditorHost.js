// @ts-check

import { createElement } from "../utils/dom.js";
import {
    LABEL_EDIT_MARKDOWN,
    LABEL_VIEW_RENDERED,
    LABEL_EDITOR_SEARCH_PLACEHOLDER,
    ARIA_LABEL_EDITOR_SEARCH_INPUT,
    ARIA_LABEL_EDITOR_SEARCH_PREVIOUS,
    ARIA_LABEL_EDITOR_SEARCH_NEXT,
    ARIA_LABEL_EDITOR_SEARCH_RESULTS
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
const TASK_LIST_REGEX = /^\[(?: |x|X)\]\s+/;
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
    "'": "'",
    "`": "`"
});
const CLOSING_BRACKETS = new Set(Object.values(BRACKET_PAIRS));
let searchControlIdSequence = 0;

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
 *   htmlViewElement: HTMLElement,
 *   initialMode?: MarkdownEditorMode,
 *   showToolbar?: boolean,
 *   enableSearch?: boolean
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
    htmlViewElement,
    initialMode = MODE_VIEW,
    showToolbar = true,
    enableSearch = false
} = options;
    if (!(container instanceof HTMLElement)) throw new Error("Markdown editor host requires a container element.");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Markdown editor host requires a textarea element.");
    if (!(htmlViewElement instanceof HTMLElement)) throw new Error("Markdown editor host requires an HTML view element.");

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
    let searchUi = enableSearch ? createSearchUi() : null;
    let searchOverlay = null;
    let searchResizeObserver = null;
    const SEARCH_OVERLAY_GAP_PX = 6;
    const markdownEditorElement = textarea.closest(".markdown-editor");
    const overlayParent = searchOverlayTarget instanceof HTMLElement ? searchOverlayTarget : container;
    const updateSearchOffset = (offsetPx) => {
        const totalOffset = offsetPx > 0 ? offsetPx + SEARCH_OVERLAY_GAP_PX : 0;
        container.style.setProperty("--editor-search-offset", `${totalOffset}px`);
    };
    const positionSearchOverlay = () => {
        if (!searchOverlay) {
            return;
        }
        if (typeof window === "undefined") {
            return;
        }
        if (overlayParent !== container) {
            searchOverlay.style.removeProperty("top");
            searchOverlay.style.removeProperty("left");
            searchOverlay.style.removeProperty("right");
            searchOverlay.style.removeProperty("width");
            return;
        }
        const hostRect = container.getBoundingClientRect();
        const codeMirrorElement = container.querySelector?.(".CodeMirror") ?? null;
        const easyMdeContainer = container.querySelector?.(".EasyMDEContainer") ?? null;
        const editorFallback = markdownEditorElement ?? container;
        const referenceElement = codeMirrorElement ?? easyMdeContainer ?? editorFallback;
        if (!(referenceElement instanceof Element)) {
            return;
        }
        const referenceRect = referenceElement.getBoundingClientRect();
        const topOffset = referenceRect.top - hostRect.top;
        const leftOffset = referenceRect.left - hostRect.left;
        const normalizedTop = Number.isFinite(topOffset) ? Math.max(0, topOffset) : 0;
        const normalizedLeft = Number.isFinite(leftOffset) ? Math.max(0, leftOffset) : 0;
        searchOverlay.style.top = `${normalizedTop}px`;
        searchOverlay.style.left = `${normalizedLeft}px`;
        searchOverlay.style.removeProperty("right");
        const availableWidth = Math.max(0, hostRect.width - normalizedLeft);
        const referenceWidth = Number.isFinite(referenceRect.width) ? referenceRect.width : availableWidth;
        const measuredWidth = Math.min(referenceWidth, availableWidth);
        if (measuredWidth > 0) {
            searchOverlay.style.width = `${measuredWidth}px`;
        } else {
            searchOverlay.style.removeProperty("width");
        }
    };
    let setSearchOverlayVisibility = () => {};
    let measureSearchOverlay = () => {};

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
        if (searchUi) {
            utilityGroup.appendChild(searchUi.container);
        }
        toolbar.append(toggleGroup, utilityGroup);
        container.insertBefore(toolbar, container.firstChild);
    }

    if (!showToolbar && searchUi) {
        searchOverlay = createElement("div", "editor-search-layer");
        searchOverlay.setAttribute("data-search-hidden", "true");
        searchOverlay.hidden = true;
        searchOverlay.appendChild(searchUi.container);
        overlayParent.appendChild(searchOverlay);
        updateSearchOffset(0);
        searchUi.container.style.display = "none";
        if (typeof ResizeObserver === "function") {
            searchResizeObserver = new ResizeObserver(() => measureSearchOverlay());
            searchResizeObserver.observe(searchUi.container);
        }

        measureSearchOverlay = () => {
            if (!searchOverlay || !searchUi || searchOverlay.hasAttribute("data-search-hidden")) {
                updateSearchOffset(0);
                return;
            }
            positionSearchOverlay();
            if (overlayParent === container) {
                const rect = searchUi.container.getBoundingClientRect();
                updateSearchOffset(rect.height > 0 ? rect.height : 0);
            } else {
                updateSearchOffset(0);
            }
        };

        setSearchOverlayVisibility = (isVisible) => {
            if (!searchOverlay) {
                return;
            }
            if (isVisible) {
                searchOverlay.hidden = false;
                searchOverlay.removeAttribute("data-search-hidden");
                searchUi.container.style.display = "inline-flex";
                if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
                    window.requestAnimationFrame(measureSearchOverlay);
                } else {
                    measureSearchOverlay();
                }
            } else {
                searchOverlay.hidden = true;
                searchOverlay.setAttribute("data-search-hidden", "true");
                searchUi.container.style.display = "none";
                updateSearchOffset(0);
            }
        };
    } else if (searchUi) {
        setSearchOverlayVisibility = (isVisible) => {
            searchUi.container.style.display = isVisible ? "inline-flex" : "none";
        };
        measureSearchOverlay = () => {};
    }

    const easyMdeAvailable = typeof window !== "undefined" && typeof window.EasyMDE === "function";
    if (!easyMdeAvailable) {
        throw new Error("EasyMDE is required but was not found on window.");
    }

    let currentMode = sanitizeMode(initialMode);
    let skipNextEditorFocus = false;
    const easyMdeInstance = createEasyMdeInstance(textarea);
    const codeMirrorWrapper = easyMdeInstance?.codemirror?.getWrapperElement
        ? easyMdeInstance.codemirror.getWrapperElement()
        : null;
    let codeMirrorParent = codeMirrorWrapper?.parentElement ?? null;
    let codeMirrorNextSibling = codeMirrorWrapper?.nextSibling ?? null;
    let isCodeMirrorAttached = true;

    const detachCodeMirror = () => {
        if (!codeMirrorWrapper || !isCodeMirrorAttached) {
            return;
        }
        codeMirrorParent = codeMirrorWrapper.parentElement;
        codeMirrorNextSibling = codeMirrorWrapper.nextSibling;
        codeMirrorWrapper.remove();
        isCodeMirrorAttached = false;
    };

    const attachCodeMirror = () => {
        if (!codeMirrorWrapper || isCodeMirrorAttached) {
            return;
        }
        const parent = codeMirrorParent instanceof HTMLElement ? codeMirrorParent : container;
        if (codeMirrorNextSibling instanceof Node && parent.contains(codeMirrorNextSibling)) {
            parent.insertBefore(codeMirrorWrapper, codeMirrorNextSibling);
        } else {
            parent.appendChild(codeMirrorWrapper);
        }
        isCodeMirrorAttached = true;
    };
    let isProgrammaticUpdate = false;
    let isDestroyed = false;
    let isApplyingListAutoRenumber = false;
    let renumberEnhancedOrderedLists = null;
    const searchManager = searchUi
        ? createSearchManager({
            codemirror: easyMdeInstance.codemirror,
            input: searchUi.input,
            previousButton: searchUi.previousButton,
            nextButton: searchUi.nextButton,
            countElement: searchUi.countElement,
            onVisibilityChange: setSearchOverlayVisibility,
            onMetricsChange: measureSearchOverlay
        })
        : null;
    configureEasyMde(easyMdeInstance, { syncTextareaValue, searchManager });

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
        if (searchManager) {
            searchManager.setEnabled(safeMode === MODE_EDIT);
        }
    }

    function setMode(nextMode) {
        const safeMode = sanitizeMode(nextMode);
        if (currentMode === safeMode) return;
        currentMode = safeMode;
        applyMode(safeMode);
        if (safeMode === MODE_EDIT) {
            if (skipNextEditorFocus) {
                skipNextEditorFocus = false;
            } else {
                focusEditPane();
            }
        }
        emit("modechange", { mode: safeMode });
    }

    function getMode() {
        return currentMode;
    }

    function focusEditPane() {
        const { codemirror } = easyMdeInstance;
        const inputField = typeof codemirror.getInputField === "function"
            ? codemirror.getInputField()
            : null;
        if (inputField instanceof HTMLElement && typeof inputField.focus === "function") {
            try {
                inputField.focus({ preventScroll: true });
            } catch {
                inputField.focus();
            }
        } else if (typeof codemirror.focus === "function") {
            codemirror.focus();
        }
        codemirror.refresh();
    }

    /**
     * @param {{ selectAll?: boolean }} [options]
     * @returns {boolean}
     */
    function focusSearchInput(options = {}) {
        if (!searchManager) return false;
        const { selectAll = true } = options;
        if (currentMode !== MODE_EDIT) {
            skipNextEditorFocus = true;
            setMode(MODE_EDIT);
        }
        searchManager.setEnabled(true);
        return searchManager.focus({ selectAll });
    }

    /**
     * @param {number} delta
     * @returns {boolean}
     */
    function jumpSearch(delta) {
        if (!searchManager) return false;
        if (currentMode !== MODE_EDIT) {
            skipNextEditorFocus = true;
            setMode(MODE_EDIT);
        }
        searchManager.jump(delta);
        return true;
    }

    function getValue() {
        return easyMdeInstance.value();
    }

    function setValue(nextValue) {
        const safeValue = typeof nextValue === "string" ? nextValue : "";
        isProgrammaticUpdate = true;
        easyMdeInstance.value(safeValue);
        isProgrammaticUpdate = false;
        syncTextareaValue();
        if (searchManager) {
            searchManager.refresh({ maintainSelection: false });
        }
    }

    function syncTextareaValue() {
        const current = easyMdeInstance.value();
        if (textarea.value !== current) textarea.value = current;
    }

    function setCaretPosition(position) {
        if (typeof position === "number" && Number.isFinite(position)) {
            const safeIndex = Math.max(0, Math.min(Math.floor(position), getValue().length));
            const doc = easyMdeInstance.codemirror.getDoc();
            const cursor = doc.posFromIndex(safeIndex);
            doc.setCursor(cursor);
            try {
                textarea.selectionStart = safeIndex;
                textarea.selectionEnd = safeIndex;
            } catch {}
            return;
        }

        const target = position === "end" ? "end" : "start";
        const doc = easyMdeInstance.codemirror.getDoc();
        const value = doc.getValue();
        const index = target === "end" ? value.length : 0;
        const cursor = doc.posFromIndex(index);
        doc.setCursor(cursor);
        try {
            textarea.selectionStart = index;
            textarea.selectionEnd = index;
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
    }

    function emitChange() {
        if (isProgrammaticUpdate) return;
        emit("change", { value: getValue() });
    }

    function refresh() {
        easyMdeInstance.codemirror.refresh();
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
        if (searchManager) {
            searchManager.destroy();
        }
        easyMdeInstance.toTextArea();
        if (showToolbar && toolbar) {
            toolbar.remove();
        }
        if (searchResizeObserver) {
            searchResizeObserver.disconnect();
            searchResizeObserver = null;
        }
        if (!showToolbar && searchOverlay) {
            searchOverlay.remove();
            searchOverlay = null;
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
        return true;
    }

    function waitForPendingImages() {
        return waitForPendingImagePastes(textarea);
    }

    function normalizeOrderedLists() {
        if (typeof renumberEnhancedOrderedLists === "function") {
            renumberEnhancedOrderedLists();
            syncTextareaValue();
            return;
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
        getTextarea: () => textarea,
        attachCodeMirror,
        detachCodeMirror
    };

    /**
     * @returns {{
     *   container: HTMLElement,
     *   input: HTMLInputElement,
     *   previousButton: HTMLButtonElement,
     *   nextButton: HTMLButtonElement,
     *   countElement: HTMLElement
     * }}
     */
    function createSearchUi() {
        const controlId = `editor-search-${searchControlIdSequence += 1}`;
        const containerElement = createElement("div", "editor-search");
        const labelElement = createElement("label", "sr-only", LABEL_EDITOR_SEARCH_PLACEHOLDER);
        labelElement.setAttribute("for", controlId);

        const inputElement = /** @type {HTMLInputElement} */ (createElement("input", "editor-search__input"));
        inputElement.type = "search";
        inputElement.id = controlId;
        inputElement.placeholder = LABEL_EDITOR_SEARCH_PLACEHOLDER;
        inputElement.setAttribute("aria-label", ARIA_LABEL_EDITOR_SEARCH_INPUT);
        inputElement.autocomplete = "off";
        inputElement.dataset.test = "editor-search-input";

        const countElement = /** @type {HTMLElement} */ (createElement("span", "editor-search__count", "0/0"));
        countElement.dataset.test = "editor-search-count";
        countElement.setAttribute("aria-live", "polite");
        countElement.setAttribute("aria-label", `${ARIA_LABEL_EDITOR_SEARCH_RESULTS}: 0 of 0`);

        const previousButton = /** @type {HTMLButtonElement} */ (createElement("button", "editor-search__button", "↑"));
        previousButton.type = "button";
        previousButton.setAttribute("aria-label", ARIA_LABEL_EDITOR_SEARCH_PREVIOUS);
        previousButton.title = ARIA_LABEL_EDITOR_SEARCH_PREVIOUS;
        previousButton.dataset.test = "editor-search-previous";
        previousButton.disabled = true;

        const nextButton = /** @type {HTMLButtonElement} */ (createElement("button", "editor-search__button", "↓"));
        nextButton.type = "button";
        nextButton.setAttribute("aria-label", ARIA_LABEL_EDITOR_SEARCH_NEXT);
        nextButton.title = ARIA_LABEL_EDITOR_SEARCH_NEXT;
        nextButton.dataset.test = "editor-search-next";
        nextButton.disabled = true;

        containerElement.append(labelElement, inputElement, countElement, previousButton, nextButton);

        return {
            container: containerElement,
            input: inputElement,
            previousButton,
            nextButton,
            countElement
        };
    }

    /**
     * @param {{
     *   codemirror: any,
     *   input: HTMLInputElement,
     *   previousButton: HTMLButtonElement,
     *   nextButton: HTMLButtonElement,
     *   countElement: HTMLElement
     * }} params
     */
    function createSearchManager(params) {
        const {
            codemirror,
            input,
            previousButton,
            nextButton,
            countElement,
            onVisibilityChange = () => {},
            onMetricsChange = () => {}
        } = params;
        if (!codemirror || typeof codemirror.getDoc !== "function") {
            return {
                focus: () => false,
                jump: () => {},
                refresh: () => {},
                setEnabled: () => {},
                destroy: () => {}
            };
        }

        const doc = codemirror.getDoc();
        const setOverlayVisibility = typeof onVisibilityChange === "function" ? onVisibilityChange : () => {};
        const notifyOverlayMetrics = typeof onMetricsChange === "function" ? onMetricsChange : () => {};
        /** @type {Array<{ from: any, to: any, marker: any }>} */
        let matches = [];
        let currentIndex = -1;
        let query = "";
        let isEnabled = true;

        const clearExistingMarkers = () => {
            for (const entry of matches) {
                const marker = entry?.marker;
                if (marker && typeof marker.clear === "function") {
                    marker.clear();
                }
            }
            matches = [];
        };

        const getMatchCountLabel = (current, total) => `${ARIA_LABEL_EDITOR_SEARCH_RESULTS}: ${current} of ${total}`;

        const updateUi = () => {
            const total = matches.length;
            const displayIndex = total > 0 && currentIndex >= 0 ? currentIndex + 1 : 0;
            countElement.textContent = `${displayIndex}/${total}`;
            countElement.setAttribute("aria-label", getMatchCountLabel(displayIndex, total));

            if (!isEnabled) {
                input.setAttribute("aria-disabled", "true");
                previousButton.disabled = true;
                nextButton.disabled = true;
                setOverlayVisibility(false);
                return;
            }

            input.removeAttribute("aria-disabled");
            const disableNavigation = !query || total <= 1;
            previousButton.disabled = disableNavigation;
            nextButton.disabled = disableNavigation;
            const hasActiveQuery = query.length > 0;
            const hasFocus = typeof document !== "undefined" && document.activeElement === input;
            setOverlayVisibility(hasActiveQuery || hasFocus);
            notifyOverlayMetrics();
        };

        const revealCurrentMatch = ({ scroll } = { scroll: true }) => {
            if (matches.length === 0 || currentIndex < 0) {
                updateUi();
                return;
            }
            const match = matches[currentIndex];
            codemirror.operation(() => {
                doc.setSelection(match.from, match.to, { scroll: false });
                if (scroll) {
                    try {
                        codemirror.scrollIntoView({ from: match.from, to: match.to }, 80);
                    } catch {
                        codemirror.scrollIntoView(match.from, 80);
                    }
                }
            });
        };

        const refreshMatches = ({ maintainSelection = false } = {}) => {
            clearExistingMarkers();
            const rawValue = input.value ?? "";
            const trimmed = rawValue.trim();
            query = trimmed;
            if (trimmed.length === 0) {
                currentIndex = -1;
                updateUi();
                return;
            }

            const haystack = doc.getValue();
            const normalizedHaystack = typeof haystack === "string" ? haystack.toLocaleLowerCase() : "";
            const normalizedNeedle = trimmed.toLocaleLowerCase();
            const needleLength = trimmed.length;

            codemirror.operation(() => {
                let searchIndex = normalizedHaystack.indexOf(normalizedNeedle);
                while (searchIndex !== -1) {
                    const from = doc.posFromIndex(searchIndex);
                    const to = doc.posFromIndex(searchIndex + needleLength);
                    const marker = doc.markText(from, to, { className: "editor-search__highlight", clearOnEnter: false });
                    matches.push({ from, to, marker });
                    searchIndex = normalizedHaystack.indexOf(normalizedNeedle, searchIndex + needleLength);
                }
            });


            if (matches.length === 0) {
                currentIndex = -1;
                updateUi();
                return;
            }

            if (maintainSelection) {
                const selection = doc.listSelections()?.[0];
                if (selection) {
                    const anchorIndex = doc.indexFromPos(selection.anchor);
                    const headIndex = doc.indexFromPos(selection.head);
                    const selectionStart = Math.min(anchorIndex, headIndex);
                    const selectionEnd = Math.max(anchorIndex, headIndex);
                    const retainedIndex = matches.findIndex((match) => {
                        const matchStart = doc.indexFromPos(match.from);
                        const matchEnd = doc.indexFromPos(match.to);
                        return selectionStart >= matchStart && selectionEnd <= matchEnd;
                    });
                    if (retainedIndex !== -1) {
                        currentIndex = retainedIndex;
                    }
                }
            }

            if (currentIndex < 0 || currentIndex >= matches.length) {
                currentIndex = 0;
            }

            revealCurrentMatch({ scroll: !maintainSelection });
            if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(() => {
                    focusInput({ selectAll: false });
                });
            } else {
                focusInput({ selectAll: false });
            }
            updateUi();
        };

        const jumpToMatch = (delta) => {
            if (!isEnabled) {
                return;
            }

            if (!query || matches.length === 0) {
                refreshMatches({ maintainSelection: false });
            }

            if (matches.length === 0) {
                updateUi();
                return;
            }

            if (currentIndex < 0 || currentIndex >= matches.length) {
                currentIndex = delta >= 0 ? 0 : matches.length - 1;
            } else {
                currentIndex = (currentIndex + delta + matches.length) % matches.length;
            }
            revealCurrentMatch({ scroll: true });
            updateUi();
        };

        const focusInput = ({ selectAll = true } = {}) => {
            if (!isEnabled) {
                return false;
            }
            try {
                input.focus({ preventScroll: true });
            } catch {
                input.focus();
            }
            if (selectAll) {
                input.select();
            }
            setOverlayVisibility(true);
            return true;
        };

        const handleInput = () => {
            refreshMatches({ maintainSelection: false });
        };

        const handleKeyDown = (event) => {
            if (event.defaultPrevented) {
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                jumpToMatch(event.shiftKey ? -1 : 1);
                return;
            }
            if (event.key === "Escape") {
                if (input.value.length > 0) {
                    event.preventDefault();
                    input.value = "";
                    refreshMatches({ maintainSelection: false });
                }
            }
        };

        const handleBlur = () => {
            if (!query) {
                setOverlayVisibility(false);
            }
        };

        const handleFocus = () => {
            setOverlayVisibility(true);
            updateUi();
        };

        const handlePreviousClick = (event) => {
            event.preventDefault();
            jumpToMatch(-1);
        };

        input.addEventListener("input", handleInput);
        input.addEventListener("keydown", handleKeyDown);
        input.addEventListener("blur", handleBlur);
        input.addEventListener("focus", handleFocus);
        previousButton.addEventListener("click", handlePreviousClick);
        nextButton.addEventListener("click", handleNextClick);

        updateUi();

        return {
            focus: focusInput,
            jump: jumpToMatch,
            refresh: refreshMatches,
            setEnabled: (enabled) => {
                isEnabled = Boolean(enabled);
                input.disabled = !isEnabled;
                if (!isEnabled) {
                    input.blur();
                    setOverlayVisibility(false);
                }
                updateUi();
            },
            destroy: () => {
                input.removeEventListener("input", handleInput);
                input.removeEventListener("keydown", handleKeyDown);
                input.removeEventListener("blur", handleBlur);
                input.removeEventListener("focus", handleFocus);
                previousButton.removeEventListener("click", handlePreviousClick);
                nextButton.removeEventListener("click", handleNextClick);
                input.disabled = false;
                input.value = "";
                clearExistingMarkers();
                query = "";
                currentIndex = -1;
                setOverlayVisibility(false);
                updateUi();
            }
        };
    }

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
            nativeSpellcheck: true,
            inputStyle: "contenteditable",
            status: false,
            autofocus: false,
            toolbar: false,
            forceSync: true,
            autoCloseBrackets: true,
            autoCloseTags: true,
            minHeight: "2.2rem",
            previewRender: () => "",
            renderingConfig: { singleLineBreaks: false, codeSyntaxHighlighting: false },
            codemirror: {
                inputStyle: "contenteditable",
                spellcheck: true
            }
        });
    }

    function configureEasyMde(instance, { syncTextareaValue }) {
        const { codemirror } = instance;

        const ensureInputAttributes = () => {
            const inputField = typeof codemirror.getInputField === "function"
                ? codemirror.getInputField()
                : null;
            if (inputField instanceof HTMLElement) {
                inputField.setAttribute("spellcheck", "true");
                inputField.setAttribute("autocorrect", "on");
                inputField.setAttribute("autocapitalize", "sentences");
                inputField.setAttribute("data-gramm", "true");
            }
        };
        ensureInputAttributes();

        const htmlViewPane = instance?.gui?.preview;
        if (htmlViewPane instanceof HTMLElement) {
            htmlViewPane.remove();
            if (instance.gui) {
                instance.gui.preview = null;
            }
        }

        const syncTextareaSelectionFromCodeMirror = () => {
            const doc = codemirror.getDoc();
            const selections = doc.listSelections();
            if (!Array.isArray(selections) || selections.length === 0) {
                try {
                    textarea.selectionStart = 0;
                    textarea.selectionEnd = 0;
                } catch {}
                return;
            }
            const primary = selections[0];
            const anchorIndex = doc.indexFromPos(primary.anchor);
            const headIndex = doc.indexFromPos(primary.head);
            const start = Math.min(anchorIndex, headIndex);
            const end = Math.max(anchorIndex, headIndex);
            try {
                textarea.selectionStart = start;
                textarea.selectionEnd = end;
            } catch {}
        };

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

        const keyMap = {
            Enter: (cm) => {
                handleEnter(cm);
            },
            "Shift-Enter": () => {
                normalizeOrderedLists();
                emit("submit");
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
        };

        if (searchManager) {
            keyMap["Cmd-F"] = () => {
                focusSearchInput({ selectAll: true });
            };
            keyMap["Ctrl-F"] = () => {
                focusSearchInput({ selectAll: true });
            };
            keyMap["Cmd-G"] = () => {
                jumpSearch(1);
            };
            keyMap["Ctrl-G"] = () => {
                jumpSearch(1);
            };
            keyMap["Shift-Cmd-G"] = () => {
                jumpSearch(-1);
            };
            keyMap["Shift-Ctrl-G"] = () => {
                jumpSearch(-1);
            };
            keyMap.F3 = () => {
                jumpSearch(1);
            };
            keyMap["Shift-F3"] = () => {
                jumpSearch(-1);
            };
        }

        codemirror.addKeyMap(keyMap);

        codemirror.on("change", (cm, change) => {
            if (!isProgrammaticUpdate && !isApplyingListAutoRenumber) {
                if (maybeRenumberOrderedLists(cm, change)) {
                    syncTextareaValue();
                }
            }
            ensureInputAttributes();
            syncTextareaValue();
            if (searchManager) {
                searchManager.refresh({ maintainSelection: true });
            }
            emitChange();
        });

        codemirror.on("blur", () => {
            normalizeOrderedLists();
            emit("blur");
        });

        codemirror.on("refresh", ensureInputAttributes);

        codemirror.on("cursorActivity", () => {
            syncTextareaSelectionFromCodeMirror();
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
                const listInfo = parseListLine(lineText);
                if (!listInfo) {
                    cm.execCommand("newlineAndIndent");
                    return;
                }
                if (cursor.ch <= listInfo.leading.length) {
                    cm.execCommand("newlineAndIndent");
                    return;
                }

                cm.execCommand("newlineAndIndentContinueMarkdownList");
                if (listInfo.type === "unordered" && isTaskList(listInfo.rest)) {
                    const spacing = listInfo.spacing ?? " ";
                    const basePrefix = `${listInfo.leading}${listInfo.marker}${spacing}`;
                    const continuationPrefix = `${basePrefix}[ ] `;
                    const insertionCursor = cm.getCursor();
                    const newLineText = cm.getLine(insertionCursor.line);
                    if (
                        newLineText.startsWith(basePrefix)
                        && !newLineText.startsWith(`${basePrefix}[`)
                    ) {
                        const remainder = newLineText.slice(basePrefix.length).replace(/^\s*/, "");
                        const updatedLine = `${continuationPrefix}${remainder}`;
                        cm.replaceRange(
                            updatedLine,
                            { line: insertionCursor.line, ch: 0 },
                            { line: insertionCursor.line, ch: newLineText.length }
                        );
                        cm.setCursor({
                            line: insertionCursor.line,
                            ch: continuationPrefix.length
                        });
                    }
                }
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

function handleBracketAutoClose(cm, openChar, closeChar) {
    if (typeof closeChar !== "string") return false;
    const doc = typeof cm.getDoc === "function" ? cm.getDoc() : null;
    if (!doc) return false;
    const selections = doc.listSelections();
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
                const selectedText = doc.getRange(start, end);
                if (openChar === "`" && closeChar === "`") {
                    const requiredTicks = computeBacktickWrapperLength(selectedText);
                    const fence = "`".repeat(requiredTicks);
                    doc.replaceRange(`${fence}${selectedText}${fence}`, start, end, "+autoCloseBacktick");
                    const startIndex = doc.indexFromPos(start) + fence.length;
                    const endIndex = startIndex + selectedText.length;
                    const selectionStart = doc.posFromIndex(startIndex);
                    const selectionEnd = doc.posFromIndex(endIndex);
                    doc.setSelection(selectionStart, selectionEnd);
                } else {
                    doc.replaceRange(`${openChar}${selectedText}${closeChar}`, start, end, "+autoCloseBracket");
                    const startIndex = doc.indexFromPos(start) + openChar.length;
                    const endIndex = startIndex + selectedText.length;
                    const selectionStart = doc.posFromIndex(startIndex);
                    const selectionEnd = doc.posFromIndex(endIndex);
                    doc.setSelection(selectionStart, selectionEnd);
                }
                handled = true;
                continue;
            }

            const cursor = doc.getCursor();
            if (openChar === "`" && closeChar === "`") {
                continue;
            }
            const nextPosition = { line: cursor.line, ch: cursor.ch + closeChar.length };
            const nextChar = doc.getRange(cursor, nextPosition);
            if (nextChar === closeChar) {
                doc.setCursor(nextPosition);
                handled = true;
                continue;
            }

            if (isSquarePair) {
                const insertion = "[ ] ";
                doc.replaceRange(insertion, cursor, cursor, "+autoCloseBracket");
                doc.setCursor({ line: cursor.line, ch: cursor.ch + insertion.length });
            } else {
                doc.replaceRange(`${openChar}${closeChar}`, cursor, cursor, "+autoCloseBracket");
                doc.setCursor({ line: cursor.line, ch: cursor.ch + openChar.length });
            }
            handled = true;
        }
    });
    return handled;
}

function computeBacktickWrapperLength(selectedText) {
    if (typeof selectedText !== "string" || selectedText.length === 0) {
        return 1;
    }
    let longestRun = 0;
    let currentRun = 0;
    for (const character of selectedText) {
        if (character === "`") {
            currentRun += 1;
            if (currentRun > longestRun) {
                longestRun = currentRun;
            }
        } else {
            currentRun = 0;
        }
    }
    return Math.max(1, longestRun + 1);
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
            if (closeChar === "]" && start.ch >= 3) {
                const suffixStart = { line: start.line, ch: start.ch - 3 };
                const preceding = cm.getRange(suffixStart, start);
                if (preceding === " ] ") {
                    moved = true;
                    continue;
                }
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

function isFenceLineWithMarker(lineText, marker) {
    if (typeof lineText !== "string") return false;
    const parsed = parseCodeFence(lineText.trimEnd());
    if (!parsed) return false;
    if (parsed.marker !== marker) return false;
    return parsed.info.length === 0;
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
    const unorderedMatch = lineText.match(/^(\s*)([-*+])(\s+)(.*)$/);
    if (unorderedMatch) {
        return {
            type: "unordered",
            leading: unorderedMatch[1] ?? "",
            marker: unorderedMatch[2] ?? "-",
            spacing: unorderedMatch[3] ?? " ",
            rest: unorderedMatch[4] ?? ""
        };
    }
    return null;
}

function isTaskList(rest) {
    if (typeof rest !== "string") {
        return false;
    }
    return TASK_LIST_REGEX.test(rest.trimStart());
}
