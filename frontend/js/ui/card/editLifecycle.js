// @ts-check

import { logging } from "../../utils/logging.js?build=2024-10-05T12:00:00Z";
import { nowIso } from "../../utils/datetime.js?build=2024-10-05T12:00:00Z";
import { isNonBlankString } from "../../utils/string.js?build=2024-10-05T12:00:00Z";
import {
    captureViewportAnchor,
    shouldCenterCard,
    maintainCardViewport
} from "./viewport.js?build=2024-10-05T12:00:00Z";
import {
    createHtmlView,
    deleteHtmlView,
    createMarkdownView,
    deleteMarkdownView,
    lockEditingSurfaceHeight,
    releaseEditingSurfaceHeight,
    persistCardState,
    normalizeHeight
} from "./renderPipeline.js?build=2024-10-05T12:00:00Z";
import { collapseExpandedHtmlView } from "./htmlView.js?build=2024-10-05T12:00:00Z";
import { enforcePinnedAnchor } from "./layout.js?build=2024-10-05T12:00:00Z";
import {
    getEditorHost,
    incrementFinalizeSuppression,
    decrementFinalizeSuppression,
    isFinalizeSuppressed as isCardFinalizeSuppressed,
    disposeCardState
} from "./cardState.js?build=2024-10-05T12:00:00Z";
import {
    transformMarkdownWithAttachments,
    collectReferencedAttachments,
    registerInitialAttachments,
    waitForPendingImagePastes
} from "../imagePaste.js?build=2024-10-05T12:00:00Z";
import { syncStoreFromDom } from "../storeSync.js?build=2024-10-05T12:00:00Z";
import { updateActionButtons } from "./listControls.js?build=2024-10-05T12:00:00Z";
import { togglePinnedNote, clearPinnedNoteIfMatches } from "../notesState.js?build=2024-10-05T12:00:00Z";
import { suppressTopEditorAutofocus } from "../focusManager.js?build=2024-10-05T12:00:00Z";
import { showSaveFeedback } from "../saveFeedback.js?build=2024-10-05T12:00:00Z";
import {
    dispatchNoteUpdate,
    dispatchNoteDelete,
    dispatchPinToggle
} from "./events.js?build=2024-10-05T12:00:00Z";
import { triggerClassificationForCard } from "./classification.js?build=2024-10-05T12:00:00Z";
import {
    storeCardAnchor,
    getCardAnchor,
    rememberExpandedHeight,
    releaseExpandedHeight,
    clearCardAnchor
} from "./anchorState.js?build=2024-10-05T12:00:00Z";
import { clearPlainTextMapping } from "./textMapping.js?build=2024-10-05T12:00:00Z";

let currentEditingCard = /** @type {HTMLElement|null} */ (null);
let mergeInProgress = false;

/**
 * Retrieve the card currently in inline edit mode.
 * @returns {HTMLElement|null}
 */
export function getCurrentEditingCard() {
    return currentEditingCard;
}

/**
 * Execute a merge handler while guarding inline finalize hooks.
 * @param {() => void} handler
 * @returns {void}
 */
export function runMergeAction(handler) {
    mergeInProgress = true;
    try {
        handler();
    } finally {
        setTimeout(() => {
            mergeInProgress = false;
        }, 50);
    }
}

/**
 * Enable inline editing for a card.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @param {{ bubblePreviousCardToTop?: boolean, bubbleSelfToTop?: boolean }} [options]
 * @returns {void}
 */
export function enableInPlaceEditing(card, notesContainer, options = {}) {
    const {
        bubblePreviousCardToTop = true,
        bubbleSelfToTop = false
    } = options;
    const viewportAnchor = !bubbleSelfToTop ? captureViewportAnchor(card) : null;
    if (viewportAnchor) {
        storeCardAnchor(card, viewportAnchor);
    }
    const centerCardOnEntry = !bubbleSelfToTop && shouldCenterCard(viewportAnchor);

    const wasEditing = card.classList.contains("editing-in-place");
    const htmlViewWrapper = card.querySelector(".note-html-view");
    const wasHtmlViewExpanded = htmlViewWrapper instanceof HTMLElement && htmlViewWrapper.classList.contains("note-html-view--expanded");
    const expandedCardHeight = wasHtmlViewExpanded ? card.getBoundingClientRect().height : null;
    const expandedContentHeight = wasHtmlViewExpanded && htmlViewWrapper instanceof HTMLElement
        ? htmlViewWrapper.getBoundingClientRect().height
        : null;
    if (Number.isFinite(expandedContentHeight) && expandedContentHeight > 0) {
        rememberExpandedHeight(card, expandedContentHeight);
    }
    if (wasHtmlViewExpanded) {
        card.dataset.htmlViewExpanded = "true";
    }
    if (currentEditingCard && currentEditingCard !== card && !mergeInProgress) {
        void finalizeCard(currentEditingCard, notesContainer, { bubbleToTop: bubblePreviousCardToTop });
    }
    currentEditingCard = card;

    const allCards = notesContainer.querySelectorAll(".markdown-block");
    allCards.forEach((candidate) => {
        if (candidate === card) {
            return;
        }
        candidate.classList.remove("editing-in-place");
        const candidateHost = getEditorHost(candidate);
        if (candidateHost && candidateHost.getMode() !== "view") {
            candidateHost.setMode("view");
        }
        const candidateTextarea = candidateHost && typeof candidateHost.getTextarea === "function"
            ? candidateHost.getTextarea()
            : /** @type {HTMLTextAreaElement|null} */ (candidate.querySelector(".markdown-editor"));
        const candidateMarkdown = candidateHost && typeof candidateHost.getValue === "function"
            ? candidateHost.getValue()
            : candidateTextarea?.value ?? "";
        const candidateAttachments = candidateTextarea instanceof HTMLTextAreaElement ? collectReferencedAttachments(candidateTextarea) : {};
        const candidateHtmlViewSource = transformMarkdownWithAttachments(candidateMarkdown, candidateAttachments);
        createHtmlView(candidate, {
            markdownSource: candidateHtmlViewSource,
            badgesTarget: candidate.querySelector(".note-badges")
        });
    });

    const editor = card.querySelector(".markdown-editor");
    const badges = card.querySelector(".note-badges");
    const editorHost = getEditorHost(card);

    const initialValue = editorHost ? editorHost.getValue() : editor?.value ?? "";
    card.dataset.initialValue = initialValue;

    releaseExpandedHeight(card);
    deleteHtmlView(card);
    card.classList.add("editing-in-place");
    createMarkdownView(editorHost);
    lockEditingSurfaceHeight(card, {
        cardHeight: expandedCardHeight,
        contentHeight: expandedContentHeight
    });

    if (editorHost && typeof editorHost.on === "function" && typeof editorHost.off === "function") {
        if (typeof card.__editingHeightCleanup === "function") {
            try {
                card.__editingHeightCleanup();
            } catch (error) {
                logging.error(error);
            }
            card.__editingHeightCleanup = null;
        }
        const synchronizeEditingHeight = () => {
            const rect = card.getBoundingClientRect();
            const currentCardHeight = normalizeHeight(rect?.height);
            lockEditingSurfaceHeight(card, {
                cardHeight: currentCardHeight > 0 ? currentCardHeight : expandedCardHeight,
                contentHeight: 0
            });
        };
        editorHost.on("change", synchronizeEditingHeight);
        card.__editingHeightCleanup = () => {
            editorHost.off("change", synchronizeEditingHeight);
        };
    }

    if (bubbleSelfToTop) {
        const firstCard = notesContainer.firstElementChild;
        if (firstCard && firstCard !== card) {
            notesContainer.insertBefore(card, firstCard);
            syncStoreFromDom(notesContainer);
            updateActionButtons(notesContainer);
        }
    }

    requestAnimationFrame(() => {
        editorHost?.focus();
        if (!bubbleSelfToTop) {
            maintainCardViewport(card, {
                behavior: centerCardOnEntry ? "center" : "preserve",
                anchor: viewportAnchor ?? null,
                anchorCompensation: !centerCardOnEntry && Boolean(viewportAnchor)
            });
        }
    });

    updateActionButtons(notesContainer);
    if (!wasEditing) {
        const host = getEditorHost(card);
        if (host && typeof host.refresh === "function") {
            try {
                host.refresh();
            } catch (error) {
                logging.error(error);
            }
        }
    }
    if (typeof badges === "object" && badges) {
        badges.setAttribute("aria-hidden", "true");
    }
}

/**
 * Finalize inline editing for a card.
 * @param {HTMLElement} card
 * @param {HTMLElement|null} notesContainer
 * @param {{ bubbleToTop?: boolean, forceBubble?: boolean, suppressTopEditorAutofocus?: boolean }} [options]
 * @returns {Promise<{ status: "deleted" | "unchanged" | "updated", record: import("../../types.d.js").NoteRecord | null }>}
 */
export async function finalizeCard(card, notesContainer, options = {}) {
    const {
        bubbleToTop = true,
        forceBubble = false,
        suppressTopEditorAutofocus: shouldSuppressTopEditorAutofocus = false
    } = options;
    if (!card || mergeInProgress) return { status: "unchanged", record: null };
    if (isCardFinalizeSuppressed(card)) return { status: "unchanged", record: null };

    const editorHost = getEditorHost(card);
    const isEditMode = card.classList.contains("editing-in-place") || editorHost?.getMode() === "edit";
    const badgesContainer = card.querySelector(".note-badges");
    const badgesTarget = badgesContainer instanceof HTMLElement ? badgesContainer : null;
    if (!isEditMode) return { status: "unchanged", record: null };

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

    const editor = card.querySelector(".markdown-editor");
    await (editorHost ? editorHost.waitForPendingImages() : waitForPendingImagePastes(editor));
    const text = editorHost ? editorHost.getValue() : editor?.value ?? "";
    const trimmed = text.trim();
    const noteId = card.getAttribute("data-note-id");

    const existingAttachments = collectReferencedAttachments(editor);
    const previousValue = typeof card.dataset.initialValue === "string"
        ? card.dataset.initialValue
        : text;
    const attachmentsChanged = false; // handled by persistCardState

    const exitEditingMode = () => {
        card.classList.remove("editing-in-place");
        releaseEditingSurfaceHeight(card);
        if (currentEditingCard === card) {
            currentEditingCard = null;
        }
        deleteMarkdownView(editorHost);
        if (editor instanceof HTMLTextAreaElement) {
            editor.style.height = "";
            editor.style.minHeight = "";
        }
    };

    if (trimmed.length === 0) {
        exitEditingMode();
        collapseExpandedHtmlView(card);
        const id = card.getAttribute("data-note-id");
        clearPinnedNoteIfMatches(id);
        clearCardAnchor(card);
        releaseExpandedHeight(card);
        clearPlainTextMapping(card);
        card.remove();
        disposeCardState(card);
        if (notesContainer instanceof HTMLElement) {
            syncStoreFromDom(notesContainer);
            updateActionButtons(notesContainer);
        }
        dispatchNoteDelete(notesContainer ?? card, id ?? "", { storeUpdated: true, shouldRender: false });
        return { status: "deleted", record: null };
    }

    const shouldBubble = forceBubble || bubbleToTop;
    const resultRecord = persistCardState(card, notesContainer, text, { bubbleToTop: shouldBubble });

    exitEditingMode();
    const markdownWithAttachments = transformMarkdownWithAttachments(text, existingAttachments);
    createHtmlView(card, {
        markdownSource: markdownWithAttachments,
        badgesTarget
    });

    if (typeof requestAnimationFrame === "function") {
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }

    if (resultRecord) {
        showSaveFeedback();
        dispatchNoteUpdate(card, resultRecord, { storeUpdated: true, shouldRender: false });
        if (typeof noteId === "string" && notesContainer instanceof HTMLElement) {
            triggerClassificationForCard(noteId, text, notesContainer);
        }
        return { status: "updated", record: resultRecord };
    }

    return { status: "unchanged", record: null };
}

/**
 * Delete a card from the grid.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function deleteCard(card, notesContainer) {
    if (!card) return;
    collapseExpandedHtmlView(card);
    if (currentEditingCard === card) {
        currentEditingCard = null;
    }
    card.classList.remove("editing-in-place");
    const noteId = card.getAttribute("data-note-id");
    if (noteId) {
        clearPinnedNoteIfMatches(noteId);
    }
    clearCardAnchor(card);
    releaseExpandedHeight(card);
    clearPlainTextMapping(card);
    card.remove();
    enforcePinnedAnchor(notesContainer);
    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);
    if (noteId) {
        dispatchNoteDelete(notesContainer ?? card, noteId, { storeUpdated: true, shouldRender: false });
    }
}

/**
 * Merge the current card with the one below it.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function mergeDown(card, notesContainer) {
    const below = card.nextElementSibling;
    if (!(below instanceof HTMLElement)) return;

    collapseExpandedHtmlView(card);
    collapseExpandedHtmlView(below);

    const editorHere = card.querySelector(".markdown-editor");
    const editorBelow = below.querySelector(".markdown-editor");
    const a = editorHere?.value.trim() ?? "";
    const b = editorBelow?.value.trim() ?? "";
    const merged = a && b ? `${a}\n\n${b}` : (a || b);

    const attachmentsHere = collectReferencedAttachments(editorHere);
    const attachmentsBelow = collectReferencedAttachments(editorBelow);
    const mergedAttachments = { ...attachmentsBelow, ...attachmentsHere };

    getEditorHost(card)?.setValue("");
    const hostBelow = getEditorHost(below);
    hostBelow?.setValue(merged);
    if (editorBelow instanceof HTMLTextAreaElement) {
        registerInitialAttachments(editorBelow, mergedAttachments);
    }
    const mergedHtmlViewSource = transformMarkdownWithAttachments(merged, mergedAttachments);
    createHtmlView(below, {
        markdownSource: mergedHtmlViewSource,
        badgesTarget: below.querySelector(".note-badges")
    });

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
    disposeCardState(card);

    const idBelow = below.getAttribute("data-note-id");
    const timestamp = nowIso();
    const createdAtBelow = isNonBlankString(below.dataset.createdAtIso)
        ? below.dataset.createdAtIso
        : timestamp;
    const attachmentsUpdated = collectReferencedAttachments(editorBelow);
    below.dataset.initialValue = merged;
    below.dataset.createdAtIso = createdAtBelow;
    below.dataset.updatedAtIso = timestamp;
    below.dataset.lastActivityIso = timestamp;

    const recordBelow = idBelow ? {
        noteId: idBelow,
        markdownText: merged,
        createdAtIso: createdAtBelow,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
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

/**
 * Merge the current card with the one above it.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function mergeUp(card, notesContainer) {
    if (card !== notesContainer.lastElementChild || notesContainer.children.length < 2) return;

    const above = card.previousElementSibling;
    if (!(above instanceof HTMLElement)) return;
    const editorAbove = above.querySelector(".markdown-editor");
    const editorHere = card.querySelector(".markdown-editor");
    collapseExpandedHtmlView(card);
    collapseExpandedHtmlView(above);

    const a = editorAbove?.value.trim() ?? "";
    const b = editorHere?.value.trim() ?? "";
    const merged = a && b ? `${a}\n\n${b}` : (a || b);

    const attachmentsAbove = collectReferencedAttachments(editorAbove);
    const attachmentsHere = collectReferencedAttachments(editorHere);
    const mergedAttachments = { ...attachmentsAbove, ...attachmentsHere };

    getEditorHost(card)?.setValue("");
    const hostAbove = getEditorHost(above);
    hostAbove?.setValue(merged);
    if (editorAbove instanceof HTMLTextAreaElement) {
        registerInitialAttachments(editorAbove, mergedAttachments);
    }
    const mergedHtmlViewSource = transformMarkdownWithAttachments(merged, mergedAttachments);
    createHtmlView(above, {
        markdownSource: mergedHtmlViewSource,
        badgesTarget: above.querySelector(".note-badges")
    });

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
    disposeCardState(card);

    const idAbove = above.getAttribute("data-note-id");
    const timestamp = nowIso();
    const createdAtAbove = isNonBlankString(above.dataset.createdAtIso)
        ? above.dataset.createdAtIso
        : timestamp;
    const attachmentsUpdated = collectReferencedAttachments(editorAbove);
    above.dataset.initialValue = merged;
    above.dataset.createdAtIso = createdAtAbove;
    above.dataset.updatedAtIso = timestamp;
    above.dataset.lastActivityIso = timestamp;

    const recordAbove = idAbove ? {
        noteId: idAbove,
        markdownText: merged,
        createdAtIso: createdAtAbove,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
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

/**
 * Focus the editor for a specific card.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @param {{ caretPlacement?: "start" | "end" | number, bubblePreviousCardToTop?: boolean }} [options]
 * @returns {boolean}
 */
export function focusCardEditor(card, notesContainer, options = {}) {
    if (!(card instanceof HTMLElement)) return false;

    const {
        caretPlacement = "start",
        bubblePreviousCardToTop = false
    } = options;

    enableInPlaceEditing(card, notesContainer, { bubblePreviousCardToTop, bubbleSelfToTop: false });

    requestAnimationFrame(() => {
        const host = getEditorHost(card);
        if (!host) return;

        const textarea = typeof host.getTextarea === "function" ? host.getTextarea() : null;
        const isNumericPlacement = typeof caretPlacement === "number" && Number.isFinite(caretPlacement);
        const currentValue = typeof textarea?.value === "string" ? textarea.value : host.getValue();
        const valueLength = typeof currentValue === "string" ? currentValue.length : 0;
        const desiredIndex = isNumericPlacement
            ? Math.max(0, Math.min(Math.floor(caretPlacement), valueLength))
            : caretPlacement === "end"
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
            : caretPlacement === "end"
                ? 0
                : valueLength;
        const selectionAtDefault = selectionDefined
            && selectionStart === selectionEnd
            && selectionStart === expectedDefaultIndex;
        const shouldRespectExistingCaret = !isNumericPlacement && selectionDefined && !selectionAtDefault;

        host.setMode("edit");
        host.focus();
        if (!shouldRespectExistingCaret) {
            if (isNumericPlacement) {
                host.setCaretPosition(desiredIndex);
            } else {
                host.setCaretPosition(caretPlacement === "end" ? "end" : "start");
            }
        }
    });

    return true;
}

/**
 * Focus the top editor from within a card.
 * @param {HTMLElement} card
 * @param {HTMLElement|null} notesContainer
 * @returns {boolean}
 */
export function focusTopEditorFromCard(card, notesContainer) {
    const topWrapper = document.querySelector("#top-editor .markdown-block.top-editor");
    const topHost = topWrapper?.__markdownHost;
    if (!topHost) return false;

    void finalizeCard(card, notesContainer, { bubbleToTop: false });

    requestAnimationFrame(() => {
        topHost.setMode("edit");
        topHost.focus();
        topHost.setCaretPosition("end");
    });

    return true;
}

/**
 * Navigate to an adjacent card.
 * @param {HTMLElement} card
 * @param {number} direction
 * @param {HTMLElement} notesContainer
 * @returns {boolean}
 */
export function navigateToAdjacentCard(card, direction, notesContainer) {
    const targetCard = direction < 0 ? card.previousElementSibling : card.nextElementSibling;
    if (targetCard instanceof HTMLElement && targetCard.classList.contains("markdown-block")) {
        const caretPlacement = direction < 0 ? "end" : "start";
        return focusCardEditor(targetCard, notesContainer, {
            caretPlacement,
            bubblePreviousCardToTop: true
        });
    }

    if (direction < 0) {
        return focusTopEditorFromCard(card, notesContainer);
    }

    return false;
}

/**
 * Increment the finalize suppression counter.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function suppressFinalize(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    incrementFinalizeSuppression(card);
}

/**
 * Release the finalize suppression counter.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function releaseFinalize(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    decrementFinalizeSuppression(card);
}

/**
 * Determine whether finalize is suppressed for a card.
 * @param {HTMLElement} card
 * @returns {boolean}
 */
export function isFinalizeSuppressed(card) {
    return Boolean(card && isCardFinalizeSuppressed(card));
}
