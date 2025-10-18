// @ts-check

import { nowIso } from "../utils/datetime.js";
import { createElement, autoResize } from "../utils/dom.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { isNonBlankString } from "../utils/string.js";
import { updateActionButtons, insertCardRespectingPinned } from "./card/listControls.js";
import {
    ARIA_LABEL_COPY_MARKDOWN,
    ARIA_LABEL_COPY_RENDERED,
    BADGE_LABEL_CODE,
    LABEL_COLLAPSE_NOTE,
    LABEL_EXPAND_NOTE,
    CLIPBOARD_METADATA_VERSION,
    ERROR_CLIPBOARD_COPY_FAILED,
    ERROR_NOTES_CONTAINER_NOT_FOUND,
    LABEL_COPY_NOTE,
    LABEL_DELETE_NOTE,
    LABEL_PIN_NOTE,
    LABEL_MERGE_DOWN,
    LABEL_MERGE_UP,
    LABEL_MOVE_DOWN,
    LABEL_MOVE_UP,
    MESSAGE_NOTE_COPIED,
    ARIA_LABEL_PIN_NOTE,
    ARIA_LABEL_UNPIN_NOTE,
    EVENT_NOTE_UPDATE,
    EVENT_NOTE_DELETE,
    EVENT_NOTE_PIN_TOGGLE
} from "../constants.js";
import { GravityStore } from "../core/store.js";
import { ClassifierClient } from "../core/classifier.js";
import { logging } from "../utils/logging.js";
import {
    applyPinnedState,
    applyPinnedStateForToggle,
    configurePinnedLayout,
    enforcePinnedAnchor,
    handlePinnedLayoutRefresh,
    placeCardRespectingPinned
} from "./card/layout.js";
import {
    schedulePreviewBubble,
    bubbleCardToTop,
    refreshCardPreview,
    queuePreviewFocus,
    restorePreviewFocus,
    setCardExpanded,
    collapseExpandedPreview,
    collapseActivePreview,
    getExpandedPreviewCard,
    scheduleOverflowCheck,
    applyPreviewBadges
} from "./card/preview.js";
export { updateActionButtons, insertCardRespectingPinned } from "./card/listControls.js";
import {
    renderSanitizedMarkdown,
    getSanitizedRenderedHtml,
    getRenderedPlainText,
    buildDeterministicPreview
} from "./markdownPreview.js";
import {
    enableClipboardImagePaste,
    waitForPendingImagePastes,
    registerInitialAttachments,
    getAllAttachments,
    collectReferencedAttachments,
    transformMarkdownWithAttachments
} from "./imagePaste.js";
import { createMarkdownEditorHost, MARKDOWN_MODE_EDIT, MARKDOWN_MODE_VIEW } from "./markdownEditorHost.js";
import { syncStoreFromDom } from "./storeSync.js";
import { showSaveFeedback } from "./saveFeedback.js";
import { togglePinnedNote, clearPinnedNoteIfMatches } from "./notesState.js";
import { suppressTopEditorAutofocus } from "./focusManager.js";

const DIRECTION_PREVIOUS = -1;
const DIRECTION_NEXT = 1;
const CARET_PLACEMENT_START = "start";
const CARET_PLACEMENT_END = "end";
const TASK_LINE_REGEX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])([^\n]*)$/;
let currentEditingCard = null;
let mergeInProgress = false;
const editorHosts = new WeakMap();
const finalizeSuppression = new WeakMap();
const suppressionState = new WeakMap();
const copyFeedbackTimers = new WeakMap();
const COPY_FEEDBACK_DURATION_MS = 1800;
const LINE_ENDING_NORMALIZE_PATTERN = /\r\n/g;
const TRAILING_WHITESPACE_PATTERN = /[ \t]+$/;

function calculatePreviewTextOffset(previewElement, event) {
    if (!(previewElement instanceof HTMLElement)) {
        return null;
    }
    const doc = previewElement.ownerDocument;
    if (!doc) {
        return null;
    }

    let range = null;
    if (typeof doc.caretRangeFromPoint === "function") {
        range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    } else if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(event.clientX, event.clientY);
        if (position && position.offsetNode) {
            range = doc.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
        }
    }

    if (!range || !previewElement.contains(range.startContainer)) {
        return null;
    }

    const resolved = resolveRangeEndpoint(range.startContainer, range.startOffset, previewElement);
    if (!resolved) {
        return null;
    }

    const preRange = doc.createRange();
    preRange.selectNodeContents(previewElement);
    try {
        preRange.setEnd(resolved.container, resolved.offset);
    } catch {
        return null;
    }
    return preRange.toString().length;
}

/**
 * Normalize a DOM range endpoint to a concrete text position.
 * @param {Node} node
 * @param {number} offset
 * @param {HTMLElement} root
 * @returns {{ container: Node, offset: number }|null}
 */
function resolveRangeEndpoint(node, offset, root) {
    if (!node) {
        return null;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        const content = node.textContent ?? "";
        return {
            container: node,
            offset: clamp(offset, 0, content.length)
        };
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = /** @type {Element} */ (node);
        const childNodes = element.childNodes;
        const safeIndex = clamp(offset, 0, childNodes.length);
        const forwardNode = findFirstTextNode(childNodes[safeIndex] ?? null);
        if (forwardNode) {
            return {
                container: forwardNode,
                offset: 0
            };
        }
        for (let index = Math.min(childNodes.length - 1, safeIndex - 1); index >= 0; index -= 1) {
            const backwardNode = findLastTextNode(childNodes[index]);
            if (backwardNode) {
                const content = backwardNode.textContent ?? "";
                return {
                    container: backwardNode,
                    offset: content.length
                };
            }
        }
        if (element === root) {
            return {
                container: element,
                offset: safeIndex
            };
        }
    }
    const parent = node.parentNode;
    if (!parent || !(parent instanceof Node) || parent === node) {
        return null;
    }
    const parentChildren = parent.childNodes;
    const indexInParent = Array.prototype.indexOf.call(parentChildren, node);
    return resolveRangeEndpoint(parent, indexInParent >= 0 ? indexInParent : 0, root);
}

/**
 * Find the first descendant text node of the provided node.
 * @param {Node|null} node
 * @returns {Node|null}
 */
function findFirstTextNode(node) {
    if (!node) {
        return null;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return node;
    }
    const doc = node.ownerDocument;
    if (!doc) {
        return null;
    }
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const next = walker.nextNode();
    return next ?? null;
}

/**
 * Find the last descendant text node of the provided node.
 * @param {Node|null} node
 * @returns {Node|null}
 */
function findLastTextNode(node) {
    if (!node) {
        return null;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return node;
    }
    const doc = node.ownerDocument;
    if (!doc) {
        return null;
    }
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let last = null;
    while (walker.nextNode()) {
        last = walker.currentNode;
    }
    return last;
}

/**
 * Clamp a numeric value into the provided range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    if (Number.isNaN(value)) {
        return min;
    }
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

function mapPlainTextOffsetToMarkdown(source, plainOffset) {
    if (typeof source !== "string" || source.length === 0) {
        return 0;
    }
    const mapping = buildMarkdownPlainMapping(source);
    if (mapping.map.length === 0) {
        return 0;
    }
    const initialIndex = resolveMarkdownIndex(mapping, plainOffset);
    const adjustedPlainOffset = adjustPlainOffsetForListMarkers(source, initialIndex, plainOffset);
    if (adjustedPlainOffset !== plainOffset) {
        return resolveMarkdownIndex(mapping, adjustedPlainOffset);
    }
    return initialIndex;
}

function buildMarkdownPlainMapping(source) {
    const plainChars = [];
    const map = [];
    const closingRuns = new Map();

    const appendChar = (char, index) => {
        plainChars.push(char);
        map.push(index);
    };

    const processSegment = (start, end) => {
        let pointer = start;
        while (pointer < end) {
            if (closingRuns.has(pointer)) {
                pointer += closingRuns.get(pointer);
                continue;
            }

            const char = source[pointer];

            if (char === "\r") {
                pointer += 1;
                continue;
            }

            if (char === "\n") {
                appendChar("\n", pointer);
                pointer += 1;
                continue;
            }

            if (char === "\\" && pointer + 1 < end) {
                appendChar(source[pointer + 1], pointer + 1);
                pointer += 2;
                continue;
            }

            if (char === "`") {
                const fenceLength = countRunOfChar(source, pointer, "`");
                const closing = findClosingBackticks(source, pointer + fenceLength, fenceLength, end);
                if (closing === -1) {
                    appendChar(char, pointer);
                    pointer += 1;
                    continue;
                }
                pointer += fenceLength;
                while (pointer < closing) {
                    appendChar(source[pointer], pointer);
                    pointer += 1;
                }
                pointer = closing + fenceLength;
                continue;
            }

            if (char === "!" && pointer + 1 < end && source[pointer + 1] === "[") {
                const closing = findClosingBracket(source, pointer + 2, end, "[", "]");
                if (closing === -1) {
                    pointer += 1;
                    continue;
                }
                processSegment(pointer + 2, closing);
                pointer = closing + 1;
                if (source[pointer] === "(") {
                    const closingParen = findClosingBracket(source, pointer + 1, end, "(", ")");
                    pointer = closingParen === -1 ? end : closingParen + 1;
                }
                continue;
            }

            if (char === "[" && !isEscaped(source, pointer)) {
                const closing = findClosingBracket(source, pointer + 1, end, "[", "]");
                if (closing === -1) {
                    appendChar(char, pointer);
                    pointer += 1;
                    continue;
                }
                processSegment(pointer + 1, closing);
                pointer = closing + 1;
                if (source[pointer] === "(") {
                    const closingParen = findClosingBracket(source, pointer + 1, end, "(", ")");
                    pointer = closingParen === -1 ? end : closingParen + 1;
                } else if (source[pointer] === "[") {
                    const closingRef = findClosingBracket(source, pointer + 1, end, "[", "]");
                    pointer = closingRef === -1 ? end : closingRef + 1;
                }
                continue;
            }

            if ((char === "*" || char === "_" || char === "~") && !isEscaped(source, pointer)) {
                const runLength = countRunOfChar(source, pointer, char);
                const closing = findMatchingFormatting(source, pointer + runLength, char, runLength, end);
                if (closing !== -1) {
                    closingRuns.set(closing, runLength);
                    pointer += runLength;
                    continue;
                }
            }

            if (isListMarker(source, pointer, start)) {
                pointer = skipListMarker(source, pointer, end);
                continue;
            }

            if (isHeadingMarker(source, pointer, start)) {
                pointer = skipHeadingMarker(source, pointer, end);
                continue;
            }

            if (isBlockquoteMarker(source, pointer, start)) {
                pointer = skipBlockquoteMarker(source, pointer, end);
                continue;
            }

            if (isTableDelimiter(source, pointer, start, end)) {
                pointer += 1;
                continue;
            }

            appendChar(char, pointer);
            pointer += 1;
        }
    };

    processSegment(0, source.length);
    return {
        plain: plainChars.join(""),
        map,
        sourceLength: source.length
    };
}

function resolveMarkdownIndex(mapping, plainOffset) {
    const clamped = Math.max(0, Math.min(Math.floor(plainOffset), mapping.map.length));
    if (clamped === mapping.map.length) {
        return mapping.sourceLength;
    }
    const resolved = mapping.map[clamped];
    if (typeof resolved === "number" && !Number.isNaN(resolved)) {
        return resolved;
    }
    for (let index = clamped - 1; index >= 0; index -= 1) {
        const candidate = mapping.map[index];
        if (typeof candidate === "number" && !Number.isNaN(candidate)) {
            return candidate;
        }
    }
    return 0;
}

function adjustPlainOffsetForListMarkers(source, approxIndex, plainOffset) {
    if (!Number.isFinite(plainOffset) || plainOffset <= 0 || approxIndex <= 0) {
        return plainOffset;
    }
    const lineBreakIndex = source.lastIndexOf("\n", approxIndex - 1);
    const lineStart = lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
    const lineSlice = source.slice(lineStart);
    const match = lineSlice.match(/^(\s*)([*+-]|\d+[.)])(\s+)/);
    if (!match) {
        return plainOffset;
    }
    const markerSpan = match[0].length;
    if (approxIndex < lineStart + markerSpan) {
        return plainOffset;
    }
    const trailingSpaces = match[3].length;
    if (!trailingSpaces) {
        return plainOffset;
    }
    const adjustment = lineStart === 0
        ? Math.max(0, trailingSpaces - 1)
        : trailingSpaces;
    if (adjustment === 0) {
        return plainOffset;
    }
    const adjusted = plainOffset + adjustment;
    return adjusted > Number.MAX_SAFE_INTEGER ? plainOffset : adjusted;
}

function countRunOfChar(value, start, char) {
    let index = start;
    while (index < value.length && value[index] === char) {
        index += 1;
    }
    return index - start;
}

function findClosingBackticks(value, start, runLength, limit) {
    let index = start;
    while (index < limit) {
        if (value[index] === "`" && !isEscaped(value, index)) {
            const span = countRunOfChar(value, index, "`");
            if (span === runLength) {
                return index;
            }
            index += span;
            continue;
        }
        index += 1;
    }
    return -1;
}

function findClosingBracket(value, start, limit, openChar, closeChar) {
    let depth = 0;
    for (let index = start; index < limit; index += 1) {
        const current = value[index];
        if (current === "\\") {
            index += 1;
            continue;
        }
        if (current === openChar) {
            depth += 1;
            continue;
        }
        if (current === closeChar) {
            if (depth === 0) {
                return index;
            }
            depth -= 1;
        }
    }
    return -1;
}

function findMatchingFormatting(value, start, char, runLength, limit) {
    let index = start;
    while (index < limit) {
        if (value[index] === char && !isEscaped(value, index)) {
            const span = countRunOfChar(value, index, char);
            if (span === runLength) {
                return index;
            }
            index += span;
            continue;
        }
        index += 1;
    }
    return -1;
}

function isEscaped(value, index) {
    let preceding = index - 1;
    let count = 0;
    while (preceding >= 0 && value[preceding] === "\\") {
        count += 1;
        preceding -= 1;
    }
    return count % 2 === 1;
}

function isListMarker(value, index, segmentStart) {
    const atLineStart = index === segmentStart || value[index - 1] === "\n";
    if (!atLineStart) {
        return false;
    }
    const char = value[index];
    if (char === "-" || char === "+" || char === "*") {
        const next = value[index + 1];
        return next === " " || next === "\t";
    }
    if (char >= "0" && char <= "9") {
        let pointer = index;
        while (pointer < value.length && value[pointer] >= "0" && value[pointer] <= "9") {
            pointer += 1;
        }
        return value[pointer] === "." && (value[pointer + 1] === " " || value[pointer + 1] === "\t");
    }
    return false;
}

function skipListMarker(value, index, limit) {
    if (value[index] === "-" || value[index] === "+" || value[index] === "*") {
        index += 1;
        while (index < limit && (value[index] === " " || value[index] === "\t")) {
            index += 1;
        }
        return index;
    }
    if (value[index] >= "0" && value[index] <= "9") {
        while (index < limit && value[index] >= "0" && value[index] <= "9") {
            index += 1;
        }
        if (value[index] === ".") {
            index += 1;
        }
        while (index < limit && (value[index] === " " || value[index] === "\t")) {
            index += 1;
        }
        return index;
    }
    return index;
}

function isHeadingMarker(value, index, segmentStart) {
    const atLineStart = index === segmentStart || value[index - 1] === "\n";
    if (!atLineStart || value[index] !== "#") {
        return false;
    }
    return true;
}

function skipHeadingMarker(value, index, limit) {
    while (index < limit && value[index] === "#") {
        index += 1;
    }
    while (index < limit && value[index] === " ") {
        index += 1;
    }
    return index;
}

function isBlockquoteMarker(value, index, segmentStart) {
    const atLineStart = index === segmentStart || value[index - 1] === "\n";
    return atLineStart && value[index] === ">";
}

function skipBlockquoteMarker(value, index, limit) {
    index += 1;
    if (value[index] === " ") {
        index += 1;
    }
    return index;
}

function isTableDelimiter(value, index, segmentStart, segmentEnd) {
    if (value[index] !== "|") {
        return false;
    }
    let start = segmentStart;
    let end = segmentEnd;
    while (start > 0 && value[start - 1] !== "\n") start -= 1;
    while (end < value.length && value[end] !== "\n") end += 1;
    const row = value.slice(start, end);
    return row.includes("|");
}

/**
 * Update the pin button affordance for a specific card.
 * @param {HTMLElement} card
 * @param {boolean} pinned
 * @returns {void}
 */
function updatePinButtonState(card, pinned) {
    const pinButton = card.querySelector('[data-action="toggle-pin"]');
    if (!(pinButton instanceof HTMLButtonElement)) {
        return;
    }
    pinButton.setAttribute("aria-pressed", pinned ? "true" : "false");
    pinButton.setAttribute("aria-label", pinned ? ARIA_LABEL_UNPIN_NOTE : ARIA_LABEL_PIN_NOTE);
    pinButton.classList.toggle("action-button--pressed", pinned);
}

/**
 * Dispatch a note update event so the composition root can persist or re-render.
 * @param {HTMLElement} target
 * @param {import("../types.d.js").NoteRecord} record
 * @param {{ storeUpdated?: boolean, shouldRender?: boolean }} [options]
 * @returns {void}
 */
function dispatchNoteUpdate(target, record, options = {}) {
    if (!(target instanceof HTMLElement) || !record) {
        return;
    }
    const { storeUpdated = true, shouldRender = false } = options;
    const event = new CustomEvent(EVENT_NOTE_UPDATE, {
        bubbles: true,
        detail: {
            record,
            noteId: record.noteId,
            storeUpdated,
            shouldRender
        }
    });
    target.dispatchEvent(event);
}

/**
 * Dispatch a note deletion request upstream.
 * @param {HTMLElement} target
 * @param {string} noteId
 * @param {{ storeUpdated?: boolean, shouldRender?: boolean }} [options]
 * @returns {void}
 */
function dispatchNoteDelete(target, noteId, options = {}) {
    if (!(target instanceof HTMLElement) || !isNonBlankString(noteId)) {
        return;
    }
    const { storeUpdated = true, shouldRender = true } = options;
    const event = new CustomEvent(EVENT_NOTE_DELETE, {
        bubbles: true,
        detail: {
            noteId,
            storeUpdated,
            shouldRender
        }
    });
    target.dispatchEvent(event);
}

/**
 * Dispatch a pin toggle notification upstream.
 * @param {HTMLElement} target
 * @param {string} noteId
 * @param {{ storeUpdated?: boolean, shouldRender?: boolean }} [options]
 * @returns {void}
 */
function dispatchPinToggle(target, noteId, options = {}) {
    if (!(target instanceof HTMLElement) || !isNonBlankString(noteId)) {
        return;
    }
    const { storeUpdated = true, shouldRender = true } = options;
    const event = new CustomEvent(EVENT_NOTE_PIN_TOGGLE, {
        bubbles: true,
        detail: {
            noteId,
            storeUpdated,
            shouldRender
        }
    });
    target.dispatchEvent(event);
}
/**
 * Render a persisted note card into the provided container.
 * @param {import("../types.d.js").NoteRecord} record
 * @param {{ notesContainer?: HTMLElement }} [options]
 * @returns {HTMLElement}
 */
export function renderCard(record, options = {}) {
    const notesContainer = options.notesContainer ?? document.getElementById("notes-container");
    if (!notesContainer) {
        throw new Error(ERROR_NOTES_CONTAINER_NOT_FOUND);
    }
    const card = createElement("div", "markdown-block");
    card.setAttribute("data-note-id", record.noteId);
    const initialPinned = record.pinned === true;
    card.dataset.pinned = initialPinned ? "true" : "false";
    if (initialPinned) {
        card.classList.add("markdown-block--pinned");
    }

    // Actions column
    const actions = createElement("div", "actions");
    let editorHostRef = null;

    const handlePinToggle = () => {
        if (!notesContainer) return;
        const { pinnedNoteId, previousPinnedNoteId } = togglePinnedNote(record.noteId);
        applyPinnedStateForToggle(notesContainer, pinnedNoteId, previousPinnedNoteId, {
            setPinnedButtonState: updatePinButtonState
        });
        syncStoreFromDom(notesContainer);
        updateActionButtons(notesContainer);
        dispatchPinToggle(notesContainer, record.noteId, { storeUpdated: true, shouldRender: false });
    };

    const handleCopy = async () => {
        const host = editorHostRef;
        if (!host) return;
        const suppressedCards = new Set();
        const protectCard = (candidate) => {
            if (!candidate) return;
            const host = editorHosts.get(candidate);
            const cardSuppression = suppressionState.get(candidate) || {}; // { mode, wasEditClass }
            if (!cardSuppression.mode) {
                cardSuppression.mode = host?.getMode() ?? null;
                cardSuppression.wasEditing = candidate.classList.contains("editing-in-place");
                suppressionState.set(candidate, cardSuppression);
            }
            suppressedCards.add(candidate);
            suppressFinalize(candidate);
        };

        protectCard(card);
        protectCard(currentEditingCard);
        try {
            const markdownValue = host.getValue();
            const attachments = getAllAttachments(editor);
            const markdownWithAttachments = transformMarkdownWithAttachments(markdownValue, attachments);
            const renderedHtml = getSanitizedRenderedHtml(preview);
            const renderedText = getRenderedPlainText(preview);
            const attachmentDataUrls = Object.values(attachments)
                .map((value) => value?.dataUrl)
                .filter((value) => typeof value === "string" && value.length > 0);
            let plainTextPayload;
            if (attachmentDataUrls.length > 0) {
                plainTextPayload = attachmentDataUrls.join("\n");
            } else {
                plainTextPayload = stripMarkdownImages(markdownWithAttachments || renderedText || markdownValue);
            }
            const metadata = {
                version: CLIPBOARD_METADATA_VERSION,
                markdown: markdownValue,
                markdownExpanded: markdownWithAttachments,
                attachments
            };

            const copied = await copyToClipboard({ text: plainTextPayload, html: renderedHtml, metadata, attachments });
            if (!copied) throw new Error(ERROR_CLIPBOARD_COPY_FAILED);
            showClipboardFeedback(actions, MESSAGE_NOTE_COPIED);
        } catch (error) {
            logging.error(error);
        } finally {
            suppressedCards.forEach((item) => {
                restoreSuppressedState(item);
                releaseFinalize(item);
            });
            requestAnimationFrame(() => {
                if (host?.getMode() === MARKDOWN_MODE_EDIT) {
                    host.focus();
                }
            });
        }
    };

    const btnPin = button(LABEL_PIN_NOTE, handlePinToggle, { extraClass: "action-button--icon action-button--toggle action-button--pin" });
    btnPin.dataset.action = "toggle-pin";

    const btnCopy = button(LABEL_COPY_NOTE, () => handleCopy(), { extraClass: "action-button--icon" });
    btnCopy.dataset.action = "copy-note";

    const btnMergeDown = button(LABEL_MERGE_DOWN, () => mergeDown(card, notesContainer), { variant: "merge" });
    btnMergeDown.dataset.action = "merge-down";

    const btnMergeUp   = button(LABEL_MERGE_UP, () => mergeUp(card, notesContainer), { variant: "merge" });
    btnMergeUp.dataset.action = "merge-up";

    const arrowRow = createElement("div", "action-group action-group--row");

    const btnUp        = button(LABEL_MOVE_UP, () => move(card, -1, notesContainer), { extraClass: "action-button--compact" });
    btnUp.dataset.action = "move-up";

    const btnDown      = button(LABEL_MOVE_DOWN, () => move(card,  1, notesContainer), { extraClass: "action-button--compact" });
    btnDown.dataset.action = "move-down";

    arrowRow.append(btnUp, btnDown);

    const btnDelete = button(LABEL_DELETE_NOTE, () => deleteCard(card, notesContainer), { extraClass: "action-button--icon" });
    btnDelete.dataset.action = "delete";

    actions.append(btnPin, btnCopy, btnMergeDown, btnMergeUp, arrowRow, btnDelete);

    // Chips + content
    const chips = createElement("div", "meta-chips");
    applyChips(chips, record.classification);

    const badges = createElement("div", "note-badges");

    const previewWrapper = createElement("div", "note-preview");
    const preview = createElement("div", "markdown-content");
    previewWrapper.appendChild(preview);

    const expandToggle = createElement("button", "note-expand-toggle", "»");
    expandToggle.type = "button";
    expandToggle.setAttribute("aria-expanded", "false");
    expandToggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
    expandToggle.hidden = true;
    expandToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isExpanded = previewWrapper.classList.contains("note-preview--expanded");
        setCardExpanded(card, isExpanded ? false : true);
    });
    previewWrapper.appendChild(expandToggle);

    const initialAttachments = record.attachments || {};
    const initialPreviewMarkdown = transformMarkdownWithAttachments(record.markdownText, initialAttachments);
    const { previewMarkdown, meta } = buildDeterministicPreview(initialPreviewMarkdown);
    renderSanitizedMarkdown(preview, previewMarkdown);
    scheduleOverflowCheck(previewWrapper, preview, expandToggle);
    applyPreviewBadges(badges, meta);

    const editor  = createElement("textarea", "markdown-editor");
    editor.value  = record.markdownText;
    editor.setAttribute("rows", "1");
    autoResize(editor);

    registerInitialAttachments(editor, initialAttachments);
    enableClipboardImagePaste(editor);

    card.append(chips, badges, previewWrapper, editor, actions);

    configurePinnedLayout(notesContainer);
    applyPinnedState(card, initialPinned, notesContainer, { setPinnedButtonState: updatePinButtonState });

    const handleCardInteraction = (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (target.closest && target.closest(".actions")) {
            return;
        }

        if (card.classList.contains("editing-in-place")) {
            return;
        }

        let caretPlacement = CARET_PLACEMENT_END;
        const previewElement = card.querySelector(".markdown-content");
        const host = editorHosts.get(card);

        if (previewElement instanceof HTMLElement && host && previewElement.contains(target)) {
            const offset = calculatePreviewTextOffset(previewElement, event);
            if (offset !== null) {
                const markdownValue = host.getValue();
                caretPlacement = mapPlainTextOffsetToMarkdown(markdownValue, offset);
            }
        }

        focusCardEditor(card, notesContainer, {
            caretPlacement,
            bubblePreviousCardToTop: true
        });
    };

    card.addEventListener("click", handleCardInteraction);
    preview.addEventListener("click", handlePreviewInteraction);

    const editorHost = createMarkdownEditorHost({
        container: card,
        textarea: editor,
        previewElement: preview,
        initialMode: MARKDOWN_MODE_VIEW,
        showToolbar: false
    });
    editor.style.removeProperty("display");
    editorHostRef = editorHost;
    editorHosts.set(card, editorHost);
    card.__markdownHost = editorHost;
    card.dataset.initialValue = record.markdownText;
    card.dataset.attachmentsSignature = createAttachmentSignature(initialAttachments);
    if (isNonBlankString(record.createdAtIso)) {
        card.dataset.createdAtIso = record.createdAtIso;
    }
    if (isNonBlankString(record.updatedAtIso)) {
        card.dataset.updatedAtIso = record.updatedAtIso;
    }
    if (isNonBlankString(record.lastActivityIso)) {
        card.dataset.lastActivityIso = record.lastActivityIso;
    }

    const refreshPreview = () => {
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editorHost.getValue(), attachments);
        const { previewMarkdown: nextPreviewMarkdown, meta: nextMeta } = buildDeterministicPreview(markdownWithAttachments);
        renderSanitizedMarkdown(preview, nextPreviewMarkdown);
        applyPreviewBadges(badges, nextMeta);
        restorePreviewFocus(card);
        scheduleOverflowCheck(previewWrapper, preview, expandToggle);
        if (!editorHost.isEnhanced()) {
            autoResize(editor);
        }
    };

    const updateModeControls = () => {
        const mode = editorHost.getMode();
        if (mode === MARKDOWN_MODE_EDIT) {
            btnCopy.title = ARIA_LABEL_COPY_MARKDOWN;
            btnCopy.setAttribute("aria-label", ARIA_LABEL_COPY_MARKDOWN);
        } else {
            btnCopy.title = ARIA_LABEL_COPY_RENDERED;
            btnCopy.setAttribute("aria-label", ARIA_LABEL_COPY_RENDERED);
        }
    };

    editorHost.on("change", refreshPreview);
    editorHost.on("modechange", ({ mode }) => {
        updateModeControls();
        if (mode === MARKDOWN_MODE_VIEW) {
            card.classList.remove("editing-in-place");
        }
    });
    editorHost.on("submit", () => finalizeCard(card, notesContainer, {
        forceBubble: true,
        suppressTopEditorAutofocus: true
    }));
    editorHost.on("blur", () => finalizeCard(card, notesContainer));
    editorHost.on("navigatePrevious", () => navigateToAdjacentCard(card, DIRECTION_PREVIOUS, notesContainer));
    editorHost.on("navigateNext", () => navigateToAdjacentCard(card, DIRECTION_NEXT, notesContainer));

    refreshPreview();
    updateModeControls();

    return card;

    function handlePreviewInteraction(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        suppressTopEditorAutofocus();

        const taskIndex = Number(target.dataset.taskIndex);
        if (!Number.isInteger(taskIndex) || taskIndex < 0) {
            return;
        }

        const host = editorHosts.get(card);
        if (!host) return;

        const currentMarkdown = host.getValue();
        const nextMarkdown = toggleTaskAtIndex(currentMarkdown, taskIndex);
        if (nextMarkdown === null) {
            return;
        }

        queuePreviewFocus(card, { type: "checkbox", taskIndex, remaining: 2 });
        host.setValue(nextMarkdown);
        refreshPreview();
        const persisted = persistCardState(card, notesContainer, nextMarkdown, { bubbleToTop: false });
        if (persisted) {
            schedulePreviewBubble(card, notesContainer);
        }
    }
}

/* ----------------- Internals ----------------- */

function button(label, handler, options = {}) {
    const { extraClass = "", variant = "default" } = options;
    const classNames = ["action-button"];
    if (extraClass) classNames.push(extraClass);
    const element = createElement("button", classNames.join(" "), label);

    if (variant === "merge") {
        element.addEventListener("mousedown", (event) => {
            event.preventDefault();
            mergeInProgress = true;
            try {
                handler();
            } finally {
                setTimeout(() => (mergeInProgress = false), 50);
            }
        });
        return element;
    }

    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
    });

    return element;
}

function suppressFinalize(card) {
    if (!card) return;
    const count = finalizeSuppression.get(card) || 0;
    finalizeSuppression.set(card, count + 1);
}

function releaseFinalize(card) {
    if (!card) return;
    const count = finalizeSuppression.get(card) || 0;
    if (count <= 1) finalizeSuppression.delete(card);
    else finalizeSuppression.set(card, count - 1);
}

function isFinalizeSuppressed(card) {
    if (!card) return false;
    return (finalizeSuppression.get(card) || 0) > 0;
}

function restoreSuppressedState(card) {
    const state = suppressionState.get(card);
    if (!state) return;
    suppressionState.delete(card);
    const host = editorHosts.get(card);
    if (!host) return;
    if (state.mode) {
        host.setMode(state.mode);
    }
    if (state.wasEditing) {
        card.classList.add("editing-in-place");
    }
}

function showClipboardFeedback(container, message) {
    if (!container || typeof message !== "string") return;
    let feedback = container.querySelector(".clipboard-feedback");
    if (!feedback) {
        feedback = createElement("div", "clipboard-feedback");
        container.appendChild(feedback);
    }

    feedback.textContent = message;
    feedback.classList.add("clipboard-feedback--visible");

    if (copyFeedbackTimers.has(feedback)) {
        clearTimeout(copyFeedbackTimers.get(feedback));
    }

    const timer = setTimeout(() => {
        feedback.classList.remove("clipboard-feedback--visible");
        copyFeedbackTimers.delete(feedback);
        setTimeout(() => {
            if (feedback && !feedback.classList.contains("clipboard-feedback--visible")) {
                feedback.remove();
            }
        }, 220);
    }, COPY_FEEDBACK_DURATION_MS);

    copyFeedbackTimers.set(feedback, timer);
}


function persistCardState(card, notesContainer, markdownText, options = {}) {
    const { bubbleToTop = true } = options;
    if (!(card instanceof HTMLElement) || typeof markdownText !== "string") {
        return false;
    }
    const noteId = card.getAttribute("data-note-id");
    if (!isNonBlankString(noteId)) {
        return false;
    }
    const editor = /** @type {HTMLTextAreaElement|null} */ (card.querySelector(".markdown-editor"));
    if (!(editor instanceof HTMLTextAreaElement)) {
        return false;
    }

    const attachments = collectReferencedAttachments(editor);
    const normalizedNext = normalizeMarkdownForComparison(markdownText);
    const previousValue = typeof card.dataset.initialValue === "string" ? card.dataset.initialValue : "";
    const normalizedPrevious = normalizeMarkdownForComparison(previousValue);
    const nextAttachmentsSignature = createAttachmentSignature(attachments);
    const previousAttachmentsSignature = typeof card.dataset.attachmentsSignature === "string"
        ? card.dataset.attachmentsSignature
        : "";

    if (normalizedNext === normalizedPrevious && nextAttachmentsSignature === previousAttachmentsSignature) {
        return false;
    }

    const timestamp = nowIso();

    const createdAtIso = isNonBlankString(card.dataset.createdAtIso)
        ? card.dataset.createdAtIso
        : timestamp;
    const record = {
        noteId,
        markdownText,
        createdAtIso,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        attachments,
        pinned: card.dataset.pinned === "true"
    };

    card.dataset.initialValue = markdownText;
    card.dataset.createdAtIso = createdAtIso;
    card.dataset.updatedAtIso = timestamp;
    card.dataset.lastActivityIso = timestamp;
    card.dataset.attachmentsSignature = nextAttachmentsSignature;

    if (notesContainer instanceof HTMLElement) {
        if (bubbleToTop) {
            bubbleCardToTop(card, notesContainer, markdownText, record);
        } else {
            refreshCardPreview(card, markdownText);
            syncStoreFromDom(notesContainer, { [noteId]: record });
            updateActionButtons(notesContainer);
        }
    } else {
        refreshCardPreview(card, markdownText);
    }

    triggerClassificationForCard(noteId, markdownText, notesContainer);
    showSaveFeedback();
    const preview = card.querySelector(".markdown-content");
    const previewWrapper = card.querySelector(".note-preview");
    const toggle = card.querySelector(".note-expand-toggle");
    scheduleOverflowCheck(previewWrapper, preview, toggle);
    dispatchNoteUpdate(card, record, { storeUpdated: true, shouldRender: false });
    return true;
}

function toggleTaskAtIndex(markdown, targetIndex) {
    if (typeof markdown !== "string") {
        return null;
    }
    if (!Number.isInteger(targetIndex) || targetIndex < 0) {
        return null;
    }

    const lines = markdown.split("\n");
    let matchIndex = -1;
    let mutated = false;
    const nextLines = lines.map((line) => {
        const match = line.match(TASK_LINE_REGEX);
        if (!match) {
            return line;
        }
        matchIndex += 1;
        if (matchIndex !== targetIndex) {
            return line;
        }
        mutated = true;
        const nextState = match[2].toLowerCase() === "x" ? " " : "x";
        return `${match[1]}${nextState}${match[3]}${match[4]}`;
    });

    if (!mutated) {
        return null;
    }
    return nextLines.join("\n");
}

function enableInPlaceEditing(card, notesContainer, options = {}) {
    const {
        bubblePreviousCardToTop = true,
        bubbleSelfToTop = false
    } = options;
    const wasEditing = card.classList.contains("editing-in-place");
    if (currentEditingCard && currentEditingCard !== card && !mergeInProgress) {
        finalizeCard(currentEditingCard, notesContainer, { bubbleToTop: bubblePreviousCardToTop });
    }
    const activeExpanded = getExpandedPreviewCard();
    if (activeExpanded && activeExpanded !== card) {
        collapseExpandedPreview(activeExpanded);
    }
    collapseExpandedPreview(card);
    currentEditingCard = card;

    // Remove edit mode from others
    const all = notesContainer.querySelectorAll(".markdown-block");
    all.forEach((candidate) => {
        if (candidate === card) {
            return;
        }
        candidate.classList.remove("editing-in-place");
        const candidateHost = editorHosts.get(candidate);
        if (candidateHost && candidateHost.getMode() === MARKDOWN_MODE_EDIT) {
            candidateHost.setMode(MARKDOWN_MODE_VIEW);
        }
    });

    const editor  = card.querySelector(".markdown-editor");
    const preview = card.querySelector(".markdown-content");
    const editorHost = editorHosts.get(card);

    // Remember original text so we can detect "no changes"
    const initialValue = editorHost ? editorHost.getValue() : editor?.value ?? "";
    card.dataset.initialValue = initialValue;

    if (!wasEditing && editorHost && !editorHost.isEnhanced() && editor) {
        const h = Math.max(preview.offsetHeight, 36);
        editor.style.height = `${h}px`;
        editor.style.minHeight = `${h}px`;
    }

    card.classList.add("editing-in-place");
    editorHost?.setMode(MARKDOWN_MODE_EDIT);

    if (editorHost && !editorHost.isEnhanced() && editor) {
        autoResize(editor);
    }

    if (bubbleSelfToTop) {
        const firstCard = notesContainer.firstElementChild;
        if (firstCard && firstCard !== card) {
            notesContainer.insertBefore(card, firstCard);
            syncStoreFromDom(notesContainer);
            updateActionButtons(notesContainer);
        }
    }

    // Focus after paint; then release the height lock
    requestAnimationFrame(() => {
        editorHost?.focus();
        if (editorHost && !editorHost.isEnhanced() && editor) {
            autoResize(editor);
            setTimeout(() => { editor.style.minHeight = ""; }, 120);
        }
    });

    updateActionButtons(notesContainer);
}

function stripMarkdownImages(markdown) {
    if (typeof markdown !== "string" || markdown.length === 0) return markdown || "";
    return markdown.replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, "$1");
}

async function finalizeCard(card, notesContainer, options = {}) {
    const {
        bubbleToTop = true,
        forceBubble = false,
        suppressTopEditorAutofocus: shouldSuppressTopEditorAutofocus = false
    } = options;
    if (!card || mergeInProgress) return;
    if (isFinalizeSuppressed(card)) return;

    const editorHost = editorHosts.get(card);
    const isEditMode = card.classList.contains("editing-in-place") || editorHost?.getMode() === MARKDOWN_MODE_EDIT;
    if (!isEditMode) return;

    if (shouldSuppressTopEditorAutofocus) {
        suppressTopEditorAutofocus();
        const activeElement = typeof document !== "undefined" ? document.activeElement : null;
        if (activeElement instanceof HTMLElement && card.contains(activeElement)) {
            activeElement.blur();
        }
        if (typeof document !== "undefined" && typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => {
                const { body } = document;
                if (!(body instanceof HTMLElement)) {
                    return;
                }
                const hadTabIndex = body.hasAttribute("tabindex");
                if (!hadTabIndex) {
                    body.setAttribute("tabindex", "-1");
                }
                try {
                    body.focus({ preventScroll: true });
                } catch {
                    body.focus();
                }
                if (!hadTabIndex) {
                    setTimeout(() => body.removeAttribute("tabindex"), 0);
                }
            });
        }
    }

    const editor  = card.querySelector(".markdown-editor");
    const preview = card.querySelector(".markdown-content");
    await (editorHost ? editorHost.waitForPendingImages() : waitForPendingImagePastes(editor));
    const text    = editorHost ? editorHost.getValue() : editor.value;
    const trimmed = text.trim();
    const noteId = card.getAttribute("data-note-id");
    const existingRecord = typeof noteId === "string" ? GravityStore.getById(noteId) : null;
    const previousText = typeof card.dataset.initialValue === "string"
        ? card.dataset.initialValue
        : (existingRecord?.markdownText ?? text);
    const previousAttachments = existingRecord?.attachments ?? {};
    const normalizedPrevious = normalizeMarkdownForComparison(previousText);
    const normalizedNext = normalizeMarkdownForComparison(text);
    const attachments = collectReferencedAttachments(editor);
    const attachmentsChanged = !areAttachmentDictionariesEqual(attachments, previousAttachments);
    const changed = normalizedNext !== normalizedPrevious || attachmentsChanged;

    if (card.classList.contains("editing-in-place")) {
        card.classList.remove("editing-in-place");
    }
    if (currentEditingCard === card) {
        currentEditingCard = null;
    }
    if (editorHost) {
        editorHost.setMode(MARKDOWN_MODE_VIEW);
    }
    if (editor instanceof HTMLTextAreaElement) {
        editor.style.height = "";
        editor.style.minHeight = "";
    }
    // If cleared, delete the card entirely
    if (trimmed.length === 0) {
        collapseExpandedPreview(card);
        const id = card.getAttribute("data-note-id");
        clearPinnedNoteIfMatches(id);
        card.remove();
        editorHosts.delete(card);
        syncStoreFromDom(notesContainer);
        updateActionButtons(notesContainer);
        dispatchNoteDelete(notesContainer ?? card, id, { storeUpdated: true, shouldRender: false });
        return;
    }

    const previewWrapper = card.querySelector(".note-preview");
    const expandToggle = card.querySelector(".note-expand-toggle");
    if (!changed) {
        const baselineMarkdown = transformMarkdownWithAttachments(previousText, attachments);
        renderSanitizedMarkdown(preview, baselineMarkdown);
        scheduleOverflowCheck(previewWrapper, preview, expandToggle);
        if (editorHost) {
            editorHost.setValue(previousText);
        } else if (editor instanceof HTMLTextAreaElement) {
            editor.value = previousText;
        }
        return;
    }

    const markdownWithAttachments = transformMarkdownWithAttachments(text, attachments);
    renderSanitizedMarkdown(preview, markdownWithAttachments);
    scheduleOverflowCheck(previewWrapper, preview, expandToggle);

    const shouldBubble = forceBubble || bubbleToTop;
    persistCardState(card, notesContainer, text, { bubbleToTop: shouldBubble });

    if (typeof requestAnimationFrame === "function") {
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }
}

function deleteCard(card, notesContainer) {
    if (!card) return;
    collapseExpandedPreview(card);
    if (currentEditingCard === card) {
        currentEditingCard = null;
    }
    card.classList.remove("editing-in-place");
    const noteId = card.getAttribute("data-note-id");
    if (noteId) {
        clearPinnedNoteIfMatches(noteId);
    }
    card.remove();
    enforcePinnedAnchor(notesContainer);
    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);
    if (noteId) {
        dispatchNoteDelete(notesContainer ?? card, noteId, { storeUpdated: true, shouldRender: false });
    }
}

function move(card, direction, notesContainer) {
    const list = Array.from(notesContainer.children);
    const i = list.indexOf(card);
    const target = i + direction;
    if (i < 0 || target < 0 || target >= list.length) return;
    const ref = list[target];
    if (direction === -1) notesContainer.insertBefore(card, ref);
    else notesContainer.insertBefore(card, ref.nextSibling);
    enforcePinnedAnchor(notesContainer);
    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);
}

function mergeDown(card, notesContainer) {
    const below = card.nextElementSibling;
    if (!below) return;

    collapseExpandedPreview(card);
    if (below instanceof HTMLElement) {
        collapseExpandedPreview(below);
    }

    const editorHere  = card.querySelector(".markdown-editor");
    const editorBelow = below.querySelector(".markdown-editor");
    const previewBelow = below.querySelector(".markdown-content");

    const a = editorHere.value.trim();
    const b = editorBelow.value.trim();
    const merged = a && b ? `${a}\n\n${b}` : (a || b);

    const attachmentsHere = getAllAttachments(editorHere);
    const attachmentsBelow = getAllAttachments(editorBelow);
    const mergedAttachments = { ...attachmentsBelow, ...attachmentsHere };

    editorHosts.get(card)?.setValue("");
    const hostBelow = editorHosts.get(below);
    hostBelow?.setValue(merged);
    registerInitialAttachments(editorBelow, mergedAttachments);
    const mergedMarkdown = transformMarkdownWithAttachments(merged, mergedAttachments);
    renderSanitizedMarkdown(previewBelow, mergedMarkdown);
    if (!hostBelow || !hostBelow.isEnhanced()) {
        autoResize(editorBelow);
    }

    const idHere = card.getAttribute("data-note-id");
    if (idHere) {
        clearPinnedNoteIfMatches(idHere);
    }
    if (card === currentEditingCard) {
        card.classList.remove("editing-in-place");
        delete card.dataset.initialValue;
        currentEditingCard = null;
    }
    card.remove();
    editorHosts.delete(card);

    const idBelow = below.getAttribute("data-note-id");
    const ts = nowIso();
    const createdAtBelow = isNonBlankString(below.dataset.createdAtIso)
        ? below.dataset.createdAtIso
        : ts;
    const attachmentsUpdated = collectReferencedAttachments(editorBelow);
    below.dataset.initialValue = merged;
    below.dataset.createdAtIso = createdAtBelow;
    below.dataset.updatedAtIso = ts;
    below.dataset.lastActivityIso = ts;

    const recordBelow = idBelow ? {
        noteId: idBelow,
        markdownText: merged,
        createdAtIso: createdAtBelow,
        updatedAtIso: ts,
        lastActivityIso: ts,
        attachments: attachmentsUpdated,
        pinned: below.dataset.pinned === "true"
    } : null;

    enforcePinnedAnchor(notesContainer);
    syncStoreFromDom(notesContainer, recordBelow ? { [recordBelow.noteId]: recordBelow } : undefined);
    updateActionButtons(notesContainer);

    if (idHere) {
        dispatchNoteDelete(notesContainer ?? card, idHere, { storeUpdated: true, shouldRender: false });
    }
    if (recordBelow) {
        dispatchNoteUpdate(below, recordBelow, { storeUpdated: true, shouldRender: false });
    }
}

function mergeUp(card, notesContainer) {
    if (card !== notesContainer.lastElementChild || notesContainer.children.length < 2) return;

    const above = card.previousElementSibling;
    const editorAbove  = above.querySelector(".markdown-editor");
    const editorHere   = card.querySelector(".markdown-editor");
    const previewAbove = above.querySelector(".markdown-content");

    collapseExpandedPreview(card);
    if (above instanceof HTMLElement) {
        collapseExpandedPreview(above);
    }

    const a = editorAbove.value.trim();
    const b = editorHere.value.trim();
    const merged = a && b ? `${a}\n\n${b}` : (a || b);

    const attachmentsAbove = getAllAttachments(editorAbove);
    const attachmentsHere = getAllAttachments(editorHere);
    const mergedAttachments = { ...attachmentsAbove, ...attachmentsHere };

    editorHosts.get(card)?.setValue("");
    const hostAbove = editorHosts.get(above);
    hostAbove?.setValue(merged);
    registerInitialAttachments(editorAbove, mergedAttachments);
    const mergedMarkdown = transformMarkdownWithAttachments(merged, mergedAttachments);
    renderSanitizedMarkdown(previewAbove, mergedMarkdown);
    if (!hostAbove || !hostAbove.isEnhanced()) {
        autoResize(editorAbove);
    }

    const idHere = card.getAttribute("data-note-id");
    if (idHere) {
        clearPinnedNoteIfMatches(idHere);
    }
    if (card === currentEditingCard) {
        card.classList.remove("editing-in-place");
        delete card.dataset.initialValue;
        currentEditingCard = null;
    }
    card.remove();
    editorHosts.delete(card);

    const idAbove = above.getAttribute("data-note-id");
    const ts = nowIso();
    const createdAtAbove = isNonBlankString(above.dataset.createdAtIso)
        ? above.dataset.createdAtIso
        : ts;
    const attachmentsUpdated = collectReferencedAttachments(editorAbove);
    above.dataset.initialValue = merged;
    above.dataset.createdAtIso = createdAtAbove;
    above.dataset.updatedAtIso = ts;
    above.dataset.lastActivityIso = ts;

    const recordAbove = idAbove ? {
        noteId: idAbove,
        markdownText: merged,
        createdAtIso: createdAtAbove,
        updatedAtIso: ts,
        lastActivityIso: ts,
        attachments: attachmentsUpdated,
        pinned: above.dataset.pinned === "true"
    } : null;

    syncStoreFromDom(notesContainer, recordAbove ? { [recordAbove.noteId]: recordAbove } : undefined);
    updateActionButtons(notesContainer);

    if (idHere) {
        dispatchNoteDelete(notesContainer ?? card, idHere, { storeUpdated: true, shouldRender: false });
    }
    if (recordAbove) {
        dispatchNoteUpdate(above, recordAbove, { storeUpdated: true, shouldRender: false });
    }
}

function navigateToAdjacentCard(card, direction, notesContainer) {
    const targetCard = direction === DIRECTION_PREVIOUS ? card.previousElementSibling : card.nextElementSibling;
    if (targetCard instanceof HTMLElement && targetCard.classList.contains("markdown-block")) {
        const caretPlacement = direction === DIRECTION_PREVIOUS ? CARET_PLACEMENT_END : CARET_PLACEMENT_START;
        return focusCardEditor(targetCard, notesContainer, {
            caretPlacement,
            bubblePreviousCardToTop: true
        });
    }

    if (direction === DIRECTION_PREVIOUS) {
        return focusTopEditorFromCard(card, notesContainer);
    }

    return false;
}

/**
 * Focus the editor for a specific card.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @param {{ caretPlacement?: typeof CARET_PLACEMENT_START | typeof CARET_PLACEMENT_END | number, bubblePreviousCardToTop?: boolean }} [options]
 * @returns {boolean}
 */
export function focusCardEditor(card, notesContainer, options = {}) {
    if (!(card instanceof HTMLElement)) return false;

    const {
        caretPlacement = CARET_PLACEMENT_START,
        bubblePreviousCardToTop = false
    } = options;

    enableInPlaceEditing(card, notesContainer, { bubblePreviousCardToTop, bubbleSelfToTop: false });

    requestAnimationFrame(() => {
        const host = editorHosts.get(card);
        if (!host) return;

        const textarea = typeof host.getTextarea === "function" ? host.getTextarea() : null;
        const isNumericPlacement = typeof caretPlacement === "number" && Number.isFinite(caretPlacement);
        const currentValue = typeof textarea?.value === "string" ? textarea.value : host.getValue();
        const valueLength = typeof currentValue === "string" ? currentValue.length : 0;
        const desiredIndex = isNumericPlacement
            ? Math.max(0, Math.min(Math.floor(caretPlacement), valueLength))
            : caretPlacement === CARET_PLACEMENT_END
                ? valueLength
                : 0;
        const selectionStart = textarea && typeof textarea.selectionStart === "number"
            ? textarea.selectionStart
            : null;
        const selectionEnd = textarea && typeof textarea.selectionEnd === "number"
            ? textarea.selectionEnd
            : null;
        const selectionDefined = selectionStart !== null && selectionEnd !== null;
        const expectedDefaultIndex = isNumericPlacement
            ? desiredIndex
            : caretPlacement === CARET_PLACEMENT_END
                ? 0
                : valueLength;
        const selectionAtDefault = selectionDefined
            && selectionStart === selectionEnd
            && selectionStart === expectedDefaultIndex;
        const shouldRespectExistingCaret = !isNumericPlacement && selectionDefined && !selectionAtDefault;

        host.setMode(MARKDOWN_MODE_EDIT);
        host.focus();
        // Respect caret adjustments made before this frame (e.g. user repositioning the cursor)
        if (!shouldRespectExistingCaret) {
            if (isNumericPlacement) {
                host.setCaretPosition(desiredIndex);
            } else {
                host.setCaretPosition(caretPlacement === CARET_PLACEMENT_END ? "end" : "start");
            }
        }
    });

    return true;
}

function focusTopEditorFromCard(card, notesContainer) {
    const topWrapper = document.querySelector("#top-editor .markdown-block.top-editor");
    const topHost = topWrapper?.__markdownHost;
    if (!topHost) return false;

    finalizeCard(card, notesContainer, { bubbleToTop: false });

    requestAnimationFrame(() => {
        topHost.setMode(MARKDOWN_MODE_EDIT);
        topHost.focus();
        topHost.setCaretPosition("end");
    });

    return true;
}

/**
 * Normalize Markdown text so that insignificant whitespace differences do not count as edits.
 * @param {string} value
 * @returns {string}
 */
function normalizeMarkdownForComparison(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value
        .replace(LINE_ENDING_NORMALIZE_PATTERN, "\n")
        .split("\n")
        .map((line) => line.replace(TRAILING_WHITESPACE_PATTERN, ""))
        .join("\n")
        .trim();
}

/**
 * Compare attachment dictionaries for equality.
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} current
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} previous
 * @returns {boolean}
 */
function areAttachmentDictionariesEqual(current, previous) {
    const currentEntries = Object.entries(current || {});
    const previousEntries = Object.entries(previous || {});
    if (currentEntries.length !== previousEntries.length) {
        return false;
    }

    currentEntries.sort(([a], [b]) => a.localeCompare(b));
    previousEntries.sort(([a], [b]) => a.localeCompare(b));

    for (let index = 0; index < currentEntries.length; index += 1) {
        const [currentKey, currentRecord] = currentEntries[index];
        const [previousKey, previousRecord] = previousEntries[index];
        if (currentKey !== previousKey) {
            return false;
        }
        if (!currentRecord || !previousRecord) {
            return false;
        }
        if (currentRecord.dataUrl !== previousRecord.dataUrl) {
            return false;
        }
        const currentAlt = typeof currentRecord.altText === "string" ? currentRecord.altText : "";
        const previousAlt = typeof previousRecord.altText === "string" ? previousRecord.altText : "";
        if (currentAlt !== previousAlt) {
            return false;
        }
    }

    return true;
}

/**
 * Create a stable signature for attachments to detect content changes.
 * @param {Record<string, import("../types.d.js").AttachmentRecord>} attachments
 * @returns {string}
 */
function createAttachmentSignature(attachments) {
    const entries = Object.entries(attachments || {});
    if (entries.length === 0) {
        return "";
    }
    entries.sort(([a], [b]) => a.localeCompare(b));
    return entries
        .map(([key, record]) => {
            const dataLength = record && typeof record.dataUrl === "string" ? record.dataUrl.length : 0;
            const altText = record && typeof record.altText === "string" ? record.altText : "";
            return `${key}:${dataLength}:${altText}`;
        })
        .join("|");
}

/* ---------- Chips & classification ---------- */

/**
 * Request a classification refresh for a note and update its chips on success.
 * @param {string} noteId
 * @param {string} text
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function triggerClassificationForCard(noteId, text, notesContainer) {
    const firstLine = text.split("\n").find((l) => l.trim().length > 0) || "";
    const title = firstLine.replace(/^#\s*/, "").slice(0, 120).trim();

    ClassifierClient.classifyOrFallback(title, text)
        .then((classification) => {
            const records = GravityStore.loadAllNotes();
            const rec = records.find((r) => r.noteId === noteId);
            if (!rec) return;
            rec.classification = classification;
            rec.lastActivityIso = nowIso();
            GravityStore.saveAllNotes(records);

            const card = notesContainer.querySelector(`.markdown-block[data-note-id="${noteId}"]`);
            if (card) {
                const chips = card.querySelector(".meta-chips");
                applyChips(chips, classification);
            }
        })
        .catch((error) => {
            logging.error(error);
        });
}

function applyChips(container, classification) {
    container.innerHTML = "";
    if (!classification) return;
    const { category, privacy, status, tags } = classification;
    if (category) container.appendChild(chip(category, "meta-chip meta-chip--cat"));
    if (status)   container.appendChild(chip(status,   "meta-chip meta-chip--status"));
    if (privacy)  container.appendChild(chip(privacy,  "meta-chip meta-chip--privacy"));
    if (Array.isArray(tags)) tags.slice(0, 6).forEach((t) => container.appendChild(chip(`#${t}`, "meta-chip")));
}

function chip(text, className) {
    return createElement("span", className, text);
}
