// @ts-check

import { nowIso } from "../../utils/datetime.js?build=2026-01-01T22:43:21Z";
import { isNonBlankString } from "../../utils/string.js?build=2026-01-01T22:43:21Z";
import {
    bubbleCardToTop,
    createHtmlView as createHtmlViewBase,
    deleteHtmlView as deleteHtmlViewBase
} from "./htmlView.js?build=2026-01-01T22:43:21Z";
import {
    transformMarkdownWithAttachments,
    collectReferencedAttachments
} from "../imagePaste.js?build=2026-01-01T22:43:21Z";
import {
    MARKDOWN_MODE_EDIT,
    MARKDOWN_MODE_VIEW
} from "../markdownEditorHost.js?build=2026-01-01T22:43:21Z";
import { syncStoreFromDom } from "../storeSync.js?build=2026-01-01T22:43:21Z";
import { updateActionButtons } from "./listControls.js?build=2026-01-01T22:43:21Z";
import { maintainCardViewport, captureViewportAnchor } from "./viewport.js?build=2026-01-01T22:43:21Z";
import { getCardAnchor } from "./anchorState.js?build=2026-01-01T22:43:21Z";

const LINE_ENDING_NORMALIZE_PATTERN = /\r\n/g;
const TRAILING_WHITESPACE_PATTERN = /[ \t]+$/;

/**
 * Normalize Markdown text so that insignificant whitespace differences do not count as edits.
 * @param {string} value
 * @returns {string}
 */
export function normalizeMarkdownForComparison(value) {
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
 * @param {Record<string, import("../../types.d.js").AttachmentRecord>} current
 * @param {Record<string, import("../../types.d.js").AttachmentRecord>} previous
 * @returns {boolean}
 */
export function areAttachmentDictionariesEqual(current, previous) {
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
 * @param {Record<string, import("../../types.d.js").AttachmentRecord>} attachments
 * @returns {string}
 */
export function createAttachmentSignature(attachments) {
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

/**
 * Persist card state and rebuild the HTML view when appropriate.
 * Returns the updated record when a change is persisted.
 * @param {HTMLElement} card
 * @param {HTMLElement|null} notesContainer
 * @param {string} markdownText
 * @param {{ bubbleToTop?: boolean }} [options]
 * @returns {import("../../types.d.js").NoteRecord|null}
 */
export function persistCardState(card, notesContainer, markdownText, options = {}) {
    const { bubbleToTop = true } = options;
    if (!(card instanceof HTMLElement) || typeof markdownText !== "string") {
        return null;
    }
    const noteId = card.getAttribute("data-note-id");
    if (!isNonBlankString(noteId)) {
        return null;
    }
    const editor = /** @type {HTMLTextAreaElement|null} */ (card.querySelector(".markdown-editor"));
    if (!(editor instanceof HTMLTextAreaElement)) {
        return null;
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
        return null;
    }

    const storedViewportAnchor = getCardAnchor(card);
    const viewportAnchor = bubbleToTop && card.classList.contains("editing-in-place")
        ? storedViewportAnchor ?? captureViewportAnchor(card)
        : storedViewportAnchor;

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

    const badgesElement = card.querySelector(".note-badges");

    if (notesContainer instanceof HTMLElement) {
        if (bubbleToTop) {
            const htmlViewSource = transformMarkdownWithAttachments(markdownText, attachments);
            bubbleCardToTop(card, notesContainer, htmlViewSource, record);
            if (viewportAnchor) {
                maintainCardViewport(card, {
                    behavior: "preserve",
                    anchor: viewportAnchor,
                    anchorCompensation: true
                });
            }
        } else {
            const htmlViewSource = transformMarkdownWithAttachments(markdownText, attachments);
            createHtmlView(card, {
                markdownSource: htmlViewSource,
                badgesTarget: badgesElement
            });
            if (viewportAnchor) {
                maintainCardViewport(card, {
                    behavior: "preserve",
                    anchor: viewportAnchor,
                    anchorCompensation: true
                });
            }
            syncStoreFromDom(notesContainer, { [noteId]: record });
            updateActionButtons(notesContainer);
        }
    } else {
        const htmlViewSource = transformMarkdownWithAttachments(markdownText, attachments);
        createHtmlView(card, {
            markdownSource: htmlViewSource,
            badgesTarget: badgesElement
        });
    }

    return record;
}

/**
 * Create the HTML representation for a card by delegating to the base helper.
 * @param {HTMLElement} card
 * @param {{ markdownSource: string, badgesTarget?: HTMLElement|null }} options
 * @returns {HTMLElement|null}
 */
export function createHtmlView(card, options) {
    return createHtmlViewBase(card, options);
}

/**
 * Delete the HTML view for a card.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function deleteHtmlView(card) {
    deleteHtmlViewBase(card);
}

/**
 * Ensure the EasyMDE host uses edit mode.
 * @param {import("../markdownEditorHost.js").MarkdownEditorHost|null} host
 * @returns {void}
 */
export function createMarkdownView(host) {
    if (host && host.getMode() !== MARKDOWN_MODE_EDIT) {
        host.setMode(MARKDOWN_MODE_EDIT);
    }
}

/**
 * Ensure the EasyMDE host uses view mode.
 * @param {import("../markdownEditorHost.js").MarkdownEditorHost|null} host
 * @returns {void}
 */
export function deleteMarkdownView(host) {
    if (host && host.getMode() !== MARKDOWN_MODE_VIEW) {
        host.setMode(MARKDOWN_MODE_VIEW);
    }
}

/**
 * Lock the editing surface height so the card stays stable during edits.
 * @param {HTMLElement} card
 * @param {{ cardHeight: number|null, contentHeight: number|null }} measurements
 * @returns {void}
 */
export function lockEditingSurfaceHeight(card, measurements) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const normalizedCardHeight = normalizeHeight(measurements?.cardHeight);
    const normalizedContentHeight = normalizeHeight(measurements?.contentHeight);
    if (normalizedCardHeight <= 0) {
        releaseEditingSurfaceHeight(card);
        return;
    }
    const computedStyle = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(card)
        : null;
    const paddingTop = computedStyle ? Number.parseFloat(computedStyle.paddingTop || "0") || 0 : 0;
    const paddingBottom = computedStyle ? Number.parseFloat(computedStyle.paddingBottom || "0") || 0 : 0;
    const verticalPadding = paddingTop + paddingBottom;
    const interiorCardHeight = normalizedCardHeight > 0 ? Math.max(normalizedCardHeight - verticalPadding, 0) : 0;
    const resolvedContentHeightBase = normalizedContentHeight > 0 ? normalizedContentHeight : interiorCardHeight;
    const apply = (syncToContent = false) => {
        if (!card.classList.contains("editing-in-place")) {
            return;
        }
        const codeMirrorScroll = card.querySelector(".CodeMirror-scroll");
        const codeMirror = card.querySelector(".CodeMirror");
        const textarea = card.querySelector(".markdown-editor");
        let contentHeight = resolvedContentHeightBase;
        if (syncToContent) {
            let naturalHeight = 0;
            if (codeMirrorScroll instanceof HTMLElement) {
                naturalHeight = normalizeHeight(codeMirrorScroll.scrollHeight);
            } else if (codeMirror instanceof HTMLElement) {
                naturalHeight = normalizeHeight(codeMirror.scrollHeight);
            } else if (textarea instanceof HTMLElement) {
                naturalHeight = normalizeHeight(textarea.scrollHeight);
            }
            if (naturalHeight > 0 && naturalHeight > contentHeight) {
                contentHeight = naturalHeight;
            }
        }
        const resolvedContentHeight = contentHeight > 0 ? contentHeight : 0;
        const targetCardHeight = resolvedContentHeight > 0 ? resolvedContentHeight + verticalPadding : normalizedCardHeight;
        card.style.setProperty("--note-expanded-edit-height", `${targetCardHeight}px`);
        card.style.minHeight = `${targetCardHeight}px`;
        card.style.maxHeight = "";
        card.style.height = `${targetCardHeight}px`;
        if (codeMirrorScroll instanceof HTMLElement) {
            codeMirrorScroll.style.setProperty("min-height", `${contentHeight}px`, "important");
            codeMirrorScroll.style.maxHeight = "";
            codeMirrorScroll.style.setProperty("height", `${contentHeight}px`, "important");
            codeMirrorScroll.style.overflowY = "";
        }
        if (codeMirror instanceof HTMLElement) {
            codeMirror.style.setProperty("min-height", `${contentHeight}px`, "important");
            codeMirror.style.maxHeight = "";
            codeMirror.style.setProperty("height", `${contentHeight}px`, "important");
        }
        if (textarea instanceof HTMLElement) {
            textarea.style.minHeight = `${contentHeight}px`;
            textarea.style.maxHeight = "";
            textarea.style.height = `${contentHeight}px`;
        }
    };
    cancelPendingHeightFrames(card);

    apply();
    apply(true);
    if (typeof requestAnimationFrame === "function") {
        const firstFrame = requestAnimationFrame(() => {
            if (!card.classList.contains("editing-in-place")) {
                return;
            }
            apply();
            if (typeof requestAnimationFrame === "function") {
                const secondFrame = requestAnimationFrame(() => {
                    if (!card.classList.contains("editing-in-place")) {
                        return;
                    }
                    apply(true);
                });
                registerPendingHeightFrame(card, secondFrame);
            } else {
                apply(true);
            }
        });
        registerPendingHeightFrame(card, firstFrame);
    } else {
        apply(true);
    }
}

/**
 * Release the editing surface height lock.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function releaseEditingSurfaceHeight(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    cancelPendingHeightFrames(card);
    card.style.removeProperty("--note-expanded-edit-height");
    card.style.minHeight = "";
    card.style.maxHeight = "";
    card.style.height = "";
    const codeMirrorScroll = card.querySelector(".CodeMirror-scroll");
    if (codeMirrorScroll instanceof HTMLElement) {
        codeMirrorScroll.style.removeProperty("min-height");
        codeMirrorScroll.style.maxHeight = "";
        codeMirrorScroll.style.removeProperty("height");
        codeMirrorScroll.style.overflowY = "";
    }
    const codeMirror = card.querySelector(".CodeMirror");
    if (codeMirror instanceof HTMLElement) {
        codeMirror.style.removeProperty("min-height");
        codeMirror.style.maxHeight = "";
        codeMirror.style.removeProperty("height");
    }
    const textarea = card.querySelector(".markdown-editor");
    if (textarea instanceof HTMLElement) {
        textarea.style.minHeight = "";
        textarea.style.maxHeight = "";
        textarea.style.height = "";
    }

    if (typeof card.__pendingCollapseTimer === "number") {
        clearTimeout(card.__pendingCollapseTimer);
        card.__pendingCollapseTimer = null;
    }

    if (typeof card.__editingHeightCleanup === "function") {
        try {
            card.__editingHeightCleanup();
        } finally {
            card.__editingHeightCleanup = null;
        }
    }
}

/**
 * Strip Markdown images while keeping embedded data URLs available.
 * @param {string} markdown
 * @returns {string}
 */
export function stripMarkdownImages(markdown) {
    if (typeof markdown !== "string" || markdown.length === 0) return markdown || "";
    return markdown.replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, "$1");
}

function registerPendingHeightFrame(card, frameId) {
    if (typeof frameId !== "number") {
        return;
    }
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const handles = getOrCreatePendingHeightFrames(card);
    handles.push(frameId);
}

function cancelPendingHeightFrames(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const handles = getOrCreatePendingHeightFrames(card);
    if (handles.length > 0 && typeof cancelAnimationFrame === "function") {
        for (const handle of handles) {
            cancelAnimationFrame(handle);
        }
    }
    clearPendingHeightFrames(card);
}

/**
 * Normalize height values to integers.
 * @param {number|null|undefined} value
 * @returns {number}
 */
export function normalizeHeight(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : 0;
}

/**
 * Retrieve or create the pending height frame list for a card.
 * @param {HTMLElement} card
 * @returns {number[]}
 */
function getOrCreatePendingHeightFrames(card) {
    if (!(card instanceof HTMLElement)) {
        return [];
    }
    if (!Array.isArray(card.__pendingHeightFrames)) {
        Object.defineProperty(card, "__pendingHeightFrames", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: []
        });
    }
    return card.__pendingHeightFrames;
}

/**
 * Clear the stored pending height frames metadata.
 * @param {HTMLElement} card
 * @returns {void}
 */
function clearPendingHeightFrames(card) {
    if (card && Array.isArray(card.__pendingHeightFrames)) {
        card.__pendingHeightFrames.length = 0;
    }
}
