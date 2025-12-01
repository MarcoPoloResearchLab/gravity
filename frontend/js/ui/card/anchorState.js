// @ts-check

import { VIEWPORT_ANCHOR_MARGIN_PX } from "./viewport.js?build=2024-10-05T12:00:00Z";

/**
 * @typedef {import("./viewport.js").ViewportAnchor} ViewportAnchor
 */

const anchorStore = new WeakMap();
const expandedHeightStore = new WeakMap();
const trackedCards = new Set();
const CLEAR_DISTANCE_PX = VIEWPORT_ANCHOR_MARGIN_PX * 2;
let scrollMonitorRegistered = false;

/**
 * Persist the viewport anchor for a card until the user scrolls away.
 * @param {HTMLElement} card
 * @param {ViewportAnchor|null} anchor
 * @returns {void}
 */
export function storeCardAnchor(card, anchor) {
    if (!(card instanceof HTMLElement) || !anchor) {
        return;
    }
    anchorStore.set(card, anchor);
    trackCard(card);
}

/**
 * Retrieve the stored anchor for a card.
 * @param {HTMLElement} card
 * @returns {ViewportAnchor|null}
 */
export function getCardAnchor(card) {
    if (!(card instanceof HTMLElement)) {
        return null;
    }
    return anchorStore.get(card) ?? null;
}

/**
 * Remove stored anchor + expanded height state for a card.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function clearCardAnchor(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    anchorStore.delete(card);
    releaseExpandedHeight(card);
    trackedCards.delete(card);
}

/**
 * Capture the last edit-mode height for a card so HTML view can persist it.
 * @param {HTMLElement} card
 * @param {number|null} height
 * @returns {void}
 */
export function rememberExpandedHeight(card, height) {
    if (!(card instanceof HTMLElement) || !Number.isFinite(height) || height === null) {
        return;
    }
    expandedHeightStore.set(card, height);
    trackCard(card);
}

/**
 * Peek at the stored expanded height without clearing it.
 * @param {HTMLElement} card
 * @returns {number|null}
 */
export function getStoredExpandedHeight(card) {
    if (!(card instanceof HTMLElement)) {
        return null;
    }
    const value = expandedHeightStore.get(card);
    return typeof value === "number" ? value : null;
}

/**
 * Apply a stored expanded height to an HTML wrapper.
 * @param {HTMLElement} card
 * @param {HTMLElement} wrapper
 * @returns {void}
 */
export function applyStoredExpandedHeight(card, wrapper) {
    if (!(card instanceof HTMLElement) || !(wrapper instanceof HTMLElement)) {
        return;
    }
    const expandedHeight = getStoredExpandedHeight(card);
    if (expandedHeight === null || expandedHeight <= 0) {
        resetWrapperHeight(wrapper);
        return;
    }
    const cardRect = card.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    if (!Number.isFinite(cardRect.height) || !Number.isFinite(wrapperRect.height)) {
        resetWrapperHeight(wrapper);
        return;
    }
    const chromeHeight = Math.max(cardRect.height - wrapperRect.height, 0);
    const targetWrapperHeight = Math.max(expandedHeight - chromeHeight, 0);
    if (targetWrapperHeight <= 0) {
        resetWrapperHeight(wrapper);
        return;
    }
    wrapper.style.minHeight = `${targetWrapperHeight}px`;
    wrapper.style.maxHeight = `${targetWrapperHeight}px`;
    wrapper.style.height = `${targetWrapperHeight}px`;
    wrapper.classList.add("note-html-view--persist-expanded");
}

/**
 * Release any stored expanded height and cleanup card styling.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function releaseExpandedHeight(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    expandedHeightStore.delete(card);
    const htmlView = card.querySelector(".note-html-view");
    if (htmlView instanceof HTMLElement) {
        resetWrapperHeight(htmlView);
    }
}

function trackCard(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    trackedCards.add(card);
    ensureScrollMonitor();
}

function ensureScrollMonitor() {
    if (scrollMonitorRegistered || typeof window === "undefined") {
        return;
    }
    window.addEventListener("scroll", handleViewportDrift, { passive: true });
    scrollMonitorRegistered = true;
}

function handleViewportDrift() {
    trackedCards.forEach((card) => {
        if (!(card instanceof HTMLElement) || !card.isConnected) {
            trackedCards.delete(card);
            anchorStore.delete(card);
            expandedHeightStore.delete(card);
            return;
        }
        const anchor = anchorStore.get(card);
        if (!anchor) {
            if (!expandedHeightStore.has(card)) {
                trackedCards.delete(card);
            }
            return;
        }
        const rect = card.getBoundingClientRect();
        if (!Number.isFinite(rect.top)) {
            return;
        }
        const delta = Math.abs(rect.top - anchor.top);
        if (delta > CLEAR_DISTANCE_PX) {
            anchorStore.delete(card);
            releaseExpandedHeight(card);
            trackedCards.delete(card);
        }
    });
}

function resetWrapperHeight(wrapper) {
    wrapper.style.removeProperty("minHeight");
    wrapper.style.removeProperty("maxHeight");
    wrapper.style.removeProperty("height");
    wrapper.classList.remove("note-html-view--persist-expanded");
}
