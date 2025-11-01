// @ts-check

import { createElement } from "../utils/dom.js?build=2024-10-05T12:00:00Z";
import { copyToClipboard } from "../utils/clipboard.js?build=2024-10-05T12:00:00Z";
import { isNonBlankString } from "../utils/string.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";
import {
    ARIA_LABEL_COPY_MARKDOWN,
    ARIA_LABEL_COPY_RENDERED,
    ARIA_LABEL_PIN_NOTE,
    ARIA_LABEL_UNPIN_NOTE,
    BADGE_LABEL_CODE,
    CLIPBOARD_METADATA_VERSION,
    ERROR_CLIPBOARD_COPY_FAILED,
    ERROR_NOTES_CONTAINER_NOT_FOUND,
    LABEL_COLLAPSE_NOTE,
    LABEL_COPY_NOTE,
    LABEL_DELETE_NOTE,
    LABEL_EXPAND_NOTE,
    LABEL_MERGE_DOWN,
    LABEL_MERGE_UP,
    LABEL_MOVE_DOWN,
    LABEL_MOVE_UP,
    LABEL_PIN_NOTE,
    MESSAGE_NOTE_COPIED
} from "../constants.js?build=2024-10-05T12:00:00Z";
import { updateActionButtons, insertCardRespectingPinned } from "./card/listControls.js?build=2024-10-05T12:00:00Z";
export { updateActionButtons, insertCardRespectingPinned } from "./card/listControls.js?build=2024-10-05T12:00:00Z";
import {
    applyPinnedState,
    applyPinnedStateForToggle,
    configurePinnedLayout,
    enforcePinnedAnchor,
    handlePinnedLayoutRefresh,
    placeCardRespectingPinned
} from "./card/layout.js?build=2024-10-05T12:00:00Z";
import {
    scheduleHtmlViewBubble,
    bubbleCardToTop,
    queueHtmlViewFocus,
    restoreHtmlViewFocus,
    setHtmlViewExpanded,
    collapseExpandedHtmlView
} from "./card/htmlView.js?build=2024-10-05T12:00:00Z";
import {
    createHtmlView,
    deleteHtmlView,
    createMarkdownView,
    deleteMarkdownView,
    persistCardState,
    createAttachmentSignature,
    stripMarkdownImages
} from "./card/renderPipeline.js?build=2024-10-05T12:00:00Z";
import {
    captureViewportAnchor,
    shouldCenterCard,
    clamp
} from "./card/viewport.js?build=2024-10-05T12:00:00Z";
import {
    initializePointerTracking,
    shouldKeepEditingAfterBlur,
    shouldIgnoreCardPointerTarget,
    isPointerWithinInlineEditorSurface,
    clearLastPointerDownTarget
} from "./card/pointerTracking.js?build=2024-10-05T12:00:00Z";
import {
    renderHtmlViewToString,
    getHtmlViewPlainText
} from "./htmlView.js?build=2024-10-05T12:00:00Z";
import {
    enableClipboardImagePaste,
    waitForPendingImagePastes,
    registerInitialAttachments,
    getAllAttachments,
    collectReferencedAttachments,
    transformMarkdownWithAttachments
} from "./imagePaste.js?build=2024-10-05T12:00:00Z";
import { createMarkdownEditorHost, MARKDOWN_MODE_EDIT, MARKDOWN_MODE_VIEW } from "./markdownEditorHost.js?build=2024-10-05T12:00:00Z";
import { syncStoreFromDom } from "./storeSync.js?build=2024-10-05T12:00:00Z";
import { suppressTopEditorAutofocus } from "./focusManager.js?build=2024-10-05T12:00:00Z";
import { togglePinnedNote, clearPinnedNoteIfMatches } from "./notesState.js?build=2024-10-05T12:00:00Z";
import {
    setEditorHost,
    getEditorHost,
    getSuppressionState,
    setSuppressionState,
    clearSuppressionState,
    disposeCardState
} from "./card/cardState.js?build=2024-10-05T12:00:00Z";
import {
    clearCopyFeedbackTimer,
    storeCopyFeedbackTimer,
    hasCopyFeedbackTimer
} from "./card/copyFeedback.js?build=2024-10-05T12:00:00Z";
import {
    getCurrentEditingCard,
    runMergeAction,
    enableInPlaceEditing,
    finalizeCard,
    deleteCard,
    mergeDown,
    mergeUp,
    focusCardEditor,
    navigateToAdjacentCard,
    suppressFinalize,
    releaseFinalize,
    isFinalizeSuppressed
} from "./card/editLifecycle.js?build=2024-10-05T12:00:00Z";
import {
    dispatchNoteUpdate,
    dispatchNoteDelete,
    dispatchPinToggle
} from "./card/events.js?build=2024-10-05T12:00:00Z";
import {
    triggerClassificationForCard,
    applyChips
} from "./card/classification.js?build=2024-10-05T12:00:00Z";

export {
    focusCardEditor,
    navigateToAdjacentCard,
    suppressFinalize,
    releaseFinalize,
    isFinalizeSuppressed,
    triggerClassificationForCard
};

const DIRECTION_PREVIOUS = -1;
const DIRECTION_NEXT = 1;
const CARET_PLACEMENT_START = "start";
const CARET_PLACEMENT_END = "end";
const TASK_LINE_REGEX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])([^\n]*)$/;
const COPY_FEEDBACK_DURATION_MS = 1800;

/**
 * @typedef {{ top: number, bottom: number, height: number, viewportHeight: number }} ViewportAnchor
 */

function calculateHtmlViewTextOffset(htmlViewElement, event) {
    if (!(htmlViewElement instanceof HTMLElement)) {
        return null;
    }
    const doc = htmlViewElement.ownerDocument;
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

    if (!range || !htmlViewElement.contains(range.startContainer)) {
        return findNearestHtmlViewPlainOffset(htmlViewElement, event.clientX, event.clientY);
    }

    const resolved = resolveRangeEndpoint(range.startContainer, range.startOffset, htmlViewElement);
    if (!resolved) {
        return null;
    }

    const preRange = doc.createRange();
    preRange.selectNodeContents(htmlViewElement);
    try {
        preRange.setEnd(resolved.container, resolved.offset);
    } catch {
        return null;
    }
    return preRange.toString().length;
}

/**
 * Locate the nearest plain-text offset within the rendered htmlView relative to the provided coordinates.
 * @param {HTMLElement} root
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number|null}
 */
function findNearestHtmlViewPlainOffset(root, clientX, clientY) {
    const doc = root.ownerDocument;
    if (!doc) {
        return null;
    }

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let plainOffsetBase = 0;
    /** @type {{ distance: number, offset: number } | null} */
    let bestCandidate = null;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const textContent = typeof node.textContent === "string" ? node.textContent : "";
        const segmentLength = textContent.length;
        if (segmentLength === 0) {
            continue;
        }
        const range = doc.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        range.detach?.();
        if (rects.length === 0) {
            plainOffsetBase += segmentLength;
            continue;
        }

        rects.forEach((rect, index) => {
            const rectStart = plainOffsetBase + Math.floor(segmentLength * (index / rects.length));
            const rectEnd = plainOffsetBase + Math.floor(segmentLength * ((index + 1) / rects.length));
            const segmentStart = Math.min(rectStart, rectEnd);
            const segmentEnd = Math.max(rectStart, rectEnd, segmentStart + 1);

            const horizontalDistance = clientX < rect.left
                ? rect.left - clientX
                : clientX > rect.right
                    ? clientX - rect.right
                    : 0;
            const verticalDistance = clientY < rect.top
                ? rect.top - clientY
                : clientY > rect.bottom
                    ? clientY - rect.bottom
                    : 0;
            const distance = Math.hypot(horizontalDistance, verticalDistance);

            let projectedOffset = segmentStart;
            if (rect.width > 0) {
                const normalized = (clientX - rect.left) / rect.width;
                const clamped = Math.min(Math.max(normalized, 0), 1);
                projectedOffset = segmentStart + Math.floor(clamped * Math.max(segmentEnd - segmentStart - 1, 0));
            }

            if (!bestCandidate || distance < bestCandidate.distance) {
                bestCandidate = {
                    distance,
                    offset: Math.max(segmentStart, Math.min(projectedOffset, segmentEnd))
                };
            }
        });

        plainOffsetBase += segmentLength;
    }

    if (!bestCandidate) {
        return 0;
    }
    return Math.max(0, bestCandidate.offset);
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

    initializePointerTracking();

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
        finalizeCard(card, notesContainer, {
            bubbleToTop: false,
            suppressTopEditorAutofocus: true
        });
    };

    const handleCopy = async () => {
        const host = editorHostRef;
        if (!host) return;
        const htmlViewCandidate = card.querySelector(".markdown-content");
        const htmlViewElement = htmlViewCandidate instanceof HTMLElement ? htmlViewCandidate : null;
        const suppressedCards = new Set();
        const protectCard = (candidate) => {
            if (!(candidate instanceof HTMLElement)) {
                return;
            }
            const candidateHost = getEditorHost(candidate);
            const existingSuppression = getSuppressionState(candidate) || {};
            if (!existingSuppression.mode) {
                existingSuppression.mode = candidateHost?.getMode() ?? null;
                existingSuppression.wasEditing = candidate.classList.contains("editing-in-place");
                setSuppressionState(candidate, existingSuppression);
            }
            suppressedCards.add(candidate);
            suppressFinalize(candidate);
        };

        protectCard(card);
        const editingCard = getCurrentEditingCard();
        if (editingCard && editingCard !== card) {
            protectCard(editingCard);
        }
        try {
            const markdownValue = host.getValue();
            const attachments = getAllAttachments(editor);
            const markdownWithAttachments = transformMarkdownWithAttachments(markdownValue, attachments);
            const hasHtmlView = htmlViewElement instanceof HTMLElement;
            const renderedHtml = hasHtmlView ? renderHtmlViewToString(markdownWithAttachments) : undefined;
            const renderedText = hasHtmlView ? getHtmlViewPlainText(htmlViewElement) : "";
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
    const scheduleControlFinalize = () => {
        if (!card.classList.contains("editing-in-place")) {
            return;
        }
        const finalizeTask = () => {
            void finalizeCard(card, notesContainer, {
                bubbleToTop: false,
                suppressTopEditorAutofocus: true
            });
        };
        if (typeof setTimeout === "function") {
            setTimeout(finalizeTask, 0);
        } else if (typeof queueMicrotask === "function") {
            queueMicrotask(finalizeTask);
        } else {
            Promise.resolve().then(finalizeTask);
        }
    };

    actions.addEventListener("pointerdown", () => {
        scheduleControlFinalize();
    }, true);

    // Chips + content
    const badges = createElement("div", "note-badges");

    const initialAttachments = record.attachments || {};

    const editor  = createElement("textarea", "markdown-editor");
    editor.value  = record.markdownText;
    editor.setAttribute("rows", "1");

    const contentColumn = createElement("div", "card-content");
    contentColumn.append(badges, editor);

    const chips = createElement("div", "meta-chips");
    applyChips(chips, record.classification);

    const controlsColumn = createElement("div", "card-controls");
    controlsColumn.append(chips, actions);
    controlsColumn.addEventListener("pointerdown", () => {
        scheduleControlFinalize();
    }, true);

    registerInitialAttachments(editor, initialAttachments);
    enableClipboardImagePaste(editor);

    card.append(contentColumn, controlsColumn);

    const initialMarkdownWithAttachments = transformMarkdownWithAttachments(record.markdownText, initialAttachments);
    // Always build the HTML view from scratch when the card enters view mode.
    createHtmlView(card, {
        markdownSource: initialMarkdownWithAttachments,
        badgesTarget: badges
    });

    configurePinnedLayout(notesContainer);
    applyPinnedState(card, initialPinned, notesContainer, { setPinnedButtonState: updatePinButtonState });

    const COLLAPSE_DEBOUNCE_MS = 180;
    const cancelPendingCollapse = () => {
        if (typeof card.__pendingCollapseTimer === "number") {
            clearTimeout(card.__pendingCollapseTimer);
            card.__pendingCollapseTimer = null;
        }
    };

    const scheduleCollapse = () => {
        cancelPendingCollapse();
        if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
            setHtmlViewExpanded(card, false);
            return;
        }
        const timerId = window.setTimeout(() => {
            card.__pendingCollapseTimer = null;
            setHtmlViewExpanded(card, false);
        }, COLLAPSE_DEBOUNCE_MS);
        card.__pendingCollapseTimer = timerId;
    };

    const handleCardClick = (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (shouldIgnoreCardPointerTarget(target)) {
            return;
        }
        if (typeof event.detail === "number" && event.detail > 1) {
            return;
        }
        if (card.classList.contains("editing-in-place")) {
            return;
        }
        cancelPendingCollapse();
        const toggleTarget = target instanceof HTMLElement ? target.closest(".note-expand-toggle") : null;
        const htmlViewWrapper = card.querySelector(".note-html-view");
        if (!(htmlViewWrapper instanceof HTMLElement)) {
            return;
        }
        const shouldToggleExpansion = htmlViewWrapper.classList.contains("note-html-view--overflow")
            || htmlViewWrapper.classList.contains("note-html-view--expanded");
        if (toggleTarget instanceof HTMLElement) {
            if (!shouldToggleExpansion) {
                return;
            }
            const expandNext = !htmlViewWrapper.classList.contains("note-html-view--expanded");
            if (!expandNext) {
                scheduleCollapse();
                return;
            }
            setHtmlViewExpanded(card, true);
            return;
        }
        const host = getEditorHost(card);
        let caretPlacement = CARET_PLACEMENT_END;
        const htmlViewElement = card.querySelector(".markdown-content");
        if (htmlViewElement instanceof HTMLElement && host) {
            const offset = calculateHtmlViewTextOffset(htmlViewElement, event);
            if (offset !== null) {
                const markdownValue = host.getValue();
                caretPlacement = mapPlainTextOffsetToMarkdown(markdownValue, offset);
            }
        }
        if (shouldCenterCard(captureViewportAnchor(card))) {
            card.dataset.suppressHtmlViewScroll = "true";
        }
        setHtmlViewExpanded(card, true);
        focusCardEditor(card, notesContainer, {
            caretPlacement,
            bubblePreviousCardToTop: true
        });
    };

    const handleCardDoubleClick = (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (shouldIgnoreCardPointerTarget(target)) {
            return;
        }
        if (card.classList.contains("editing-in-place")) {
            return;
        }

        cancelPendingCollapse();

        let caretPlacement = CARET_PLACEMENT_END;
        const htmlViewElement = card.querySelector(".markdown-content");
        const host = getEditorHost(card);

        if (htmlViewElement instanceof HTMLElement && host) {
            const offset = calculateHtmlViewTextOffset(htmlViewElement, event);
            if (offset !== null) {
                const markdownValue = host.getValue();
                caretPlacement = mapPlainTextOffsetToMarkdown(markdownValue, offset);
            }
        }

        if (shouldCenterCard(captureViewportAnchor(card))) {
            card.dataset.suppressHtmlViewScroll = "true";
        }
        setHtmlViewExpanded(card, true);
        focusCardEditor(card, notesContainer, {
            caretPlacement,
            bubblePreviousCardToTop: true
        });
    };

    card.addEventListener("click", handleCardClick);
    card.addEventListener("dblclick", handleCardDoubleClick);
    card.addEventListener("click", handleHtmlViewInteraction);

    const htmlViewPlaceholder = createElement("div");

    const editorHost = createMarkdownEditorHost({
        container: card,
        textarea: editor,
        htmlViewElement: htmlViewPlaceholder,
        initialMode: MARKDOWN_MODE_VIEW,
        showToolbar: false
    });
    editor.classList.add("markdown-editor--enhanced");
    editor.style.removeProperty("display");
    editorHostRef = editorHost;
    setEditorHost(card, editorHost);
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

    editorHost.on("modechange", ({ mode }) => {
        updateModeControls();
        if (mode === MARKDOWN_MODE_EDIT) {
            deleteHtmlView(card);
            card.classList.add("editing-in-place");
            createMarkdownView(editorHost);
        } else {
            card.classList.remove("editing-in-place");
            deleteMarkdownView(editorHost);
            const attachments = getAllAttachments(editor);
            const markdownWithAttachments = transformMarkdownWithAttachments(editorHost.getValue(), attachments);
            createHtmlView(card, {
                markdownSource: markdownWithAttachments,
                badgesTarget: badges
            });
        }
    });
    editorHost.on("submit", () => finalizeCard(card, notesContainer, {
        forceBubble: true,
        suppressTopEditorAutofocus: true
    }));
    editorHost.on("blur", () => {
        if (typeof window === "undefined") {
            finalizeCard(card, notesContainer);
            return;
        }
        window.requestAnimationFrame(() => {
            const maintainEditing = shouldKeepEditingAfterBlur(card);
            clearLastPointerDownTarget();
            if (maintainEditing) {
                if (editorHost.getMode() !== MARKDOWN_MODE_EDIT) {
                    editorHost.setMode(MARKDOWN_MODE_EDIT);
                }
                editorHost.focus();
                return;
            }
            finalizeCard(card, notesContainer);
        });
    });
    editorHost.on("navigatePrevious", () => navigateToAdjacentCard(card, DIRECTION_PREVIOUS, notesContainer));
    editorHost.on("navigateNext", () => navigateToAdjacentCard(card, DIRECTION_NEXT, notesContainer));

    updateModeControls();

    return card;

    function handleHtmlViewInteraction(event) {
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

        const host = getEditorHost(card);
        if (!host) return;

        const currentMarkdown = host.getValue();
        const nextMarkdown = toggleTaskAtIndex(currentMarkdown, taskIndex);
        if (nextMarkdown === null) {
            return;
        }

        queueHtmlViewFocus(card, { type: "checkbox", taskIndex, remaining: 2 });
        host.setValue(nextMarkdown);
        const toggledAttachments = getAllAttachments(editor);
        const toggledHtmlViewSource = transformMarkdownWithAttachments(nextMarkdown, toggledAttachments);
        createHtmlView(card, {
            markdownSource: toggledHtmlViewSource,
            badgesTarget: badges
        });
        const shouldAnchorExpandedView = card.dataset.htmlViewExpanded === "true";
        const persisted = persistCardState(card, notesContainer, nextMarkdown, { bubbleToTop: false });
        if (persisted && !shouldAnchorExpandedView) {
            scheduleHtmlViewBubble(card, notesContainer);
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
            runMergeAction(handler);
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

function restoreSuppressedState(card) {
    const state = getSuppressionState(card);
    if (!state) return;
    clearSuppressionState(card);
    const host = getEditorHost(card);
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

    if (hasCopyFeedbackTimer(feedback)) {
        clearCopyFeedbackTimer(feedback);
    }

    const timer = setTimeout(() => {
        feedback.classList.remove("clipboard-feedback--visible");
        clearCopyFeedbackTimer(feedback);
        setTimeout(() => {
            if (feedback && !feedback.classList.contains("clipboard-feedback--visible")) {
                feedback.remove();
            }
        }, 220);
    }, COPY_FEEDBACK_DURATION_MS);

    storeCopyFeedbackTimer(feedback, timer);
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
