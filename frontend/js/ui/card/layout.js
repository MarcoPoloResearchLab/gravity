// @ts-check

import { isNonBlankString } from "../../utils/string.js?build=2026-01-01T21:20:40Z";

let pinnedLayoutContainer = /** @type {HTMLElement|null} */ (null);
let pinnedLayoutResizeListenerAttached = false;
let topEditorResizeObserver = /** @type {ResizeObserver|null} */ (null);

/**
 * Ensure pinned cards stay offset beneath the header/top editor stack.
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function configurePinnedLayout(notesContainer) {
    if (!(notesContainer instanceof HTMLElement)) {
        return;
    }
    pinnedLayoutContainer = notesContainer;
    if (typeof window !== "undefined" && !pinnedLayoutResizeListenerAttached) {
        window.addEventListener("resize", handlePinnedLayoutRefresh, { passive: true });
        pinnedLayoutResizeListenerAttached = true;
    }
    if (typeof ResizeObserver !== "undefined" && !topEditorResizeObserver) {
        const topEditorBlock = document.querySelector("#top-editor .markdown-block");
        if (topEditorBlock instanceof HTMLElement) {
            topEditorResizeObserver = new ResizeObserver(handlePinnedLayoutRefresh);
            topEditorResizeObserver.observe(topEditorBlock);
        }
    }
}

/**
 * Apply UI state when a pin toggle occurs, ensuring only one pinned card.
 * @param {HTMLElement} notesContainer
 * @param {string|null} pinnedNoteId
 * @param {string|null} previousPinnedNoteId
 * @param {(container: HTMLElement, noteId: string) => void} notifyUnpinned
 * @returns {void}
 */
export function applyPinnedStateForToggle(notesContainer, pinnedNoteId, previousPinnedNoteId, options = {}) {
    if (!(notesContainer instanceof HTMLElement)) {
        return;
    }
    const { setPinnedButtonState } = options;

    if (isNonBlankString(previousPinnedNoteId) && previousPinnedNoteId !== pinnedNoteId) {
        const previousCard = findCardById(notesContainer, previousPinnedNoteId);
        if (previousCard) {
            applyPinnedState(previousCard, false, notesContainer, { setPinnedButtonState });
        }
    }

    if (isNonBlankString(pinnedNoteId)) {
        const pinnedCard = findCardById(notesContainer, pinnedNoteId);
        if (pinnedCard) {
            applyPinnedState(pinnedCard, true, notesContainer, { setPinnedButtonState });
            placeCardRespectingPinned(pinnedCard, notesContainer, { forcePinnedPosition: true });
        }
    }

    enforcePinnedAnchor(notesContainer);
}

/**
 * Apply pinned styles to a card and refresh layout offsets.
 * @param {HTMLElement} card
 * @param {boolean} pinned
 * @param {HTMLElement} [notesContainer]
 * @param {{ setPinnedButtonState?: (card: HTMLElement, pinned: boolean) => void }} [options]
 * @returns {void}
 */
export function applyPinnedState(card, pinned, notesContainer, options = {}) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const { setPinnedButtonState } = options;
    card.dataset.pinned = pinned ? "true" : "false";
    card.classList.toggle("markdown-block--pinned", pinned);
    if (typeof setPinnedButtonState === "function") {
        setPinnedButtonState(card, pinned);
    }
    if (pinned) {
        if (notesContainer) {
            configurePinnedLayout(notesContainer);
        }
        handlePinnedLayoutRefresh();
    } else {
        card.style.removeProperty("--pinned-top-offset");
    }
}

/**
 * Keep the pinned card anchored when the list mutates.
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function enforcePinnedAnchor(notesContainer) {
    if (!(notesContainer instanceof HTMLElement)) {
        return;
    }
    const anchorCard = notesContainer.querySelector('.markdown-block[data-pinned="true"]');
    if (anchorCard instanceof HTMLElement) {
        placeCardRespectingPinned(anchorCard, notesContainer, { forcePinnedPosition: true });
    }
    handlePinnedLayoutRefresh();
}

/**
 * Insert a card into the correct position relative to the pinned note.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @param {{ forcePinnedPosition?: boolean }} [options]
 * @returns {void}
 */
export function placeCardRespectingPinned(card, notesContainer, options = {}) {
    if (!(card instanceof HTMLElement) || !(notesContainer instanceof HTMLElement)) {
        return;
    }
    const { forcePinnedPosition = false } = options;
    const isPinned = forcePinnedPosition || card.dataset.pinned === "true";
    const pinnedCard = notesContainer.querySelector('.markdown-block[data-pinned="true"]');

    if (isPinned) {
        const firstCard = notesContainer.firstElementChild;
        if (firstCard !== card) {
            notesContainer.insertBefore(card, firstCard ?? null);
        }
        handlePinnedLayoutRefresh();
        return;
    }

    if (pinnedCard instanceof HTMLElement && pinnedCard !== card) {
        const reference = pinnedCard.nextElementSibling;
        if (reference !== card) {
            notesContainer.insertBefore(card, reference ?? null);
        }
        handlePinnedLayoutRefresh();
        return;
    }

    const firstCard = notesContainer.firstElementChild;
    if (firstCard !== card) {
        notesContainer.insertBefore(card, firstCard ?? null);
    }
    handlePinnedLayoutRefresh();
}

/**
 * Manual refresh hook for pinned layout calculations.
 * @returns {void}
 */
export function handlePinnedLayoutRefresh() {
    if (!pinnedLayoutContainer) {
        return;
    }
    refreshPinnedLayout(pinnedLayoutContainer);
}

/**
 * Locate a rendered card by identifier.
 * @param {HTMLElement} notesContainer
 * @param {string|null} noteId
 * @returns {HTMLElement|null}
 */
export function findCardById(notesContainer, noteId) {
    if (!(notesContainer instanceof HTMLElement) || !isNonBlankString(noteId)) {
        return null;
    }
    const selector = `.markdown-block[data-note-id="${escapeNoteIdSelector(noteId)}"]`;
    const candidate = notesContainer.querySelector(selector);
    return candidate instanceof HTMLElement ? candidate : null;
}

function refreshPinnedLayout(notesContainer) {
    if (!(notesContainer instanceof HTMLElement)) {
        return;
    }
    const pinnedCard = notesContainer.querySelector('.markdown-block[data-pinned="true"]');
    if (!(pinnedCard instanceof HTMLElement)) {
        return;
    }
    const header = document.querySelector(".app-header");
    const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
    const topEditorBlock = document.querySelector("#top-editor .markdown-block");
    const topEditorHeight = topEditorBlock instanceof HTMLElement ? topEditorBlock.getBoundingClientRect().height : 0;
    const spacing = 12;
    const offset = Math.max(headerHeight + topEditorHeight + spacing, 0);
    pinnedCard.style.setProperty("--pinned-top-offset", `${offset}px`);
}

function escapeNoteIdSelector(noteId) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(noteId);
    }
    return noteId.replace(/"/g, '\\"');
}
