// @ts-check

import { placeCardRespectingPinned } from "./layout.js";

/**
 * Update per-card action button visibility based on placement within the list.
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function updateActionButtons(notesContainer) {
    if (!(notesContainer instanceof HTMLElement)) {
        return;
    }
    const cards = Array.from(notesContainer.children);
    const total = cards.length;
    cards.forEach((card, index) => {
        const mergeDown = card.querySelector('[data-action="merge-down"]');
        const mergeUp = card.querySelector('[data-action="merge-up"]');
        const up = card.querySelector('[data-action="move-up"]');
        const down = card.querySelector('[data-action="move-down"]');
        const isFirst = index === 0;
        const isLast = index === total - 1;
        const isPinned = card instanceof HTMLElement && card.dataset.pinned === "true";

        setDisplay(mergeDown, !isLast);
        setDisplay(mergeUp, isLast && total > 1);
        if (isPinned) {
            setDisplay(up, false);
            setDisplay(down, false);
        } else {
            setDisplay(up, !isFirst);
            setDisplay(down, !isLast);
        }
    });
}

/**
 * Insert a card while respecting the pinned anchor rules.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function insertCardRespectingPinned(card, notesContainer) {
    placeCardRespectingPinned(card, notesContainer);
}

function setDisplay(node, visible) {
    if (node instanceof HTMLElement) {
        node.style.display = visible ? "block" : "none";
    }
}
