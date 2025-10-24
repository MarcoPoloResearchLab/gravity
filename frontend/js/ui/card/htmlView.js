// @ts-check

import {
    LABEL_COLLAPSE_NOTE,
    LABEL_EXPAND_NOTE,
    BADGE_LABEL_CODE
} from "../../constants.js";
import { createElement } from "../../utils/dom.js";
import {
    buildHtmlViewSource,
    renderHtmlView
} from "../htmlView.js";
import {
    collectReferencedAttachments,
    transformMarkdownWithAttachments
} from "../imagePaste.js";
import { placeCardRespectingPinned } from "./layout.js";
import { updateActionButtons } from "./listControls.js";
import { syncStoreFromDom } from "../storeSync.js";

/**
 * HTML view lifecycle is intentionally atomic:
 *  - `createHtmlView(card, …)` removes any existing HTML view DOM and rebuilds it
 *    from the supplied markdown source, wiring up the expand toggle and badges.
 *  - `deleteHtmlView(card)` tears the HTML view out of the DOM entirely. Edit mode
 *    always calls this so the editor surface is the only visible state.
 *  No incremental refresh helpers remain; callers choose one of these two
 *  operations based on the card mode.
 */
// HTML view lifecycle helpers – cards rebuild their visible HTML from markdown
// on demand (create) and tear it down entirely when switching to markdown view
// (delete). No refresh helpers remain by design.
const htmlViewBubbleTimers = new WeakMap();
const htmlViewFocusTargets = new WeakMap();

/**
 * Queue an HTML view bubble after a checkbox interaction.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function scheduleHtmlViewBubble(card, notesContainer) {
    if (!(card instanceof HTMLElement) || !(notesContainer instanceof HTMLElement)) {
        return;
    }
    const existing = htmlViewBubbleTimers.get(card);
    if (existing) {
        clearTimeout(existing);
    }
    const delay = getHtmlViewCheckboxBubbleDelayMs();
    if (delay <= 0) {
        bubbleCardToTop(card, notesContainer);
        return;
    }
    const timer = setTimeout(() => {
        htmlViewBubbleTimers.delete(card);
        bubbleCardToTop(card, notesContainer);
    }, delay);
    htmlViewBubbleTimers.set(card, timer);
}

/**
 * Move a card to the appropriate position after content interaction.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @param {string} [markdownOverride]
 * @param {import("../../types.d.js").NoteRecord} [overrideRecord]
 * @returns {void}
 */
export function bubbleCardToTop(card, notesContainer, markdownOverride, overrideRecord) {
    if (!(card instanceof HTMLElement) || !(notesContainer instanceof HTMLElement)) {
        return;
    }
    const pending = htmlViewBubbleTimers.get(card);
    if (pending) {
        clearTimeout(pending);
        htmlViewBubbleTimers.delete(card);
    }
    placeCardRespectingPinned(card, notesContainer, { forcePinnedPosition: card.dataset.pinned === "true" });
    const overrides = overrideRecord && overrideRecord.noteId
        ? { [overrideRecord.noteId]: overrideRecord }
        : undefined;
    syncStoreFromDom(notesContainer, overrides);
    updateActionButtons(notesContainer);
    const badgesTarget = card.querySelector(".note-badges");
    let htmlViewSource = markdownOverride;
    if (typeof htmlViewSource !== "string") {
        const host = card.__markdownHost;
        const textarea = host && typeof host.getTextarea === "function"
            ? host.getTextarea()
            : /** @type {HTMLTextAreaElement|null} */ (card.querySelector(".markdown-editor"));
        const markdownValue = host && typeof host.getValue === "function"
            ? host.getValue()
            : textarea?.value ?? "";
        const attachments = textarea instanceof HTMLTextAreaElement ? collectReferencedAttachments(textarea) : {};
        htmlViewSource = transformMarkdownWithAttachments(markdownValue, attachments);
    }
    createHtmlView(card, { markdownSource: htmlViewSource, badgesTarget });
}

/**
 * Build a fresh HTML view for a card from the provided markdown source. Any
 * existing HTML view is removed first so only one rendered copy exists.
 *
 * @param {HTMLElement} card
 * @param {{ markdownSource: string, badgesTarget?: HTMLElement|null }} options
 * @returns {HTMLElement|null}
 */
export function createHtmlView(card, { markdownSource, badgesTarget }) {
    if (!(card instanceof HTMLElement) || typeof markdownSource !== "string") {
        return null;
    }
    deleteHtmlView(card);
    if (card.dataset.htmlViewExpanded !== "true") {
        card.dataset.htmlViewExpanded = "false";
    }
    const { htmlViewMarkdown, meta } = buildHtmlViewSource(markdownSource);
    const wrapper = createElement("div", "note-html-view");
    const content = createElement("div", "markdown-content");
    const expandToggle = createExpandToggle(card, wrapper);
    wrapper.append(content, expandToggle);
    insertHtmlViewWrapper(card, wrapper);
    renderHtmlView(content, htmlViewMarkdown);
    restoreHtmlViewFocus(card);
    if (badgesTarget instanceof HTMLElement) {
        applyHtmlViewBadges(badgesTarget, meta);
    }
    scheduleHtmlViewOverflowCheck(wrapper, content, expandToggle);
    if (card.dataset.htmlViewExpanded === "true") {
        requestAnimationFrame(() => {
            setHtmlViewExpanded(card, true);
        });
    }
    return wrapper;
}

/**
 * Remove the current HTML view for a card (no-op if none exists).
 * @param {HTMLElement} card
 */
export function deleteHtmlView(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const wrapper = card.querySelector(".note-html-view");
    if (!(wrapper instanceof HTMLElement)) {
        return;
    }
    wrapper.remove();
}

function insertHtmlViewWrapper(card, wrapper) {
    const textarea = card.querySelector(".markdown-editor");
    if (!(textarea instanceof HTMLElement)) {
        card.appendChild(wrapper);
        return;
    }
    const parent = textarea.parentElement;
    if (parent instanceof HTMLElement) {
        parent.insertBefore(wrapper, textarea);
        return;
    }
    card.appendChild(wrapper);
}

function createExpandToggle(card, wrapper) {
    const toggle = createElement("button", "note-expand-toggle", "»");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
    toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isExpanded = wrapper.classList.contains("note-html-view--expanded");
        setHtmlViewExpanded(card, !isExpanded);
    });
    return toggle;
}

/**
 * Remember focus targets so checkbox interactions can maintain focus.
 * @param {HTMLElement} card
 * @param {{ type: "checkbox", taskIndex: number, remaining: number }} spec
 * @returns {void}
 */
export function queueHtmlViewFocus(card, spec) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    htmlViewFocusTargets.set(card, spec);
}

/**
 * Attempt to restore focus to the HTML view element after re-rendering.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function restoreHtmlViewFocus(card) {
    const focusSpec = htmlViewFocusTargets.get(card);
    if (!focusSpec) {
        return;
    }
    const nextRemaining = typeof focusSpec.remaining === "number" ? focusSpec.remaining - 1 : 0;
    if (nextRemaining <= 0) {
        htmlViewFocusTargets.delete(card);
    } else {
        htmlViewFocusTargets.set(card, { ...focusSpec, remaining: nextRemaining });
    }
    if (focusSpec.type === "checkbox" && typeof focusSpec.taskIndex === "number") {
        requestAnimationFrame(() => {
            const selector = `input[type="checkbox"][data-task-index="${focusSpec.taskIndex}"]`;
            const checkbox = card.querySelector(selector);
            if (checkbox instanceof HTMLInputElement) {
                try {
                    checkbox.focus({ preventScroll: true });
                } catch {
                    checkbox.focus();
                }
            }
        });
    }
}

/**
 * Expand or collapse the HTML view, ensuring only one card is expanded at a time.
 * @param {HTMLElement} card
 * @param {boolean} shouldExpand
 * @returns {void}
 */
export function setHtmlViewExpanded(card, shouldExpand) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const viewElement = /** @type {HTMLElement|null} */ (card.querySelector(".note-html-view"));
    const content = /** @type {HTMLElement|null} */ (card.querySelector(".note-html-view .markdown-content"));
    const toggle = /** @type {HTMLElement|null} */ (card.querySelector(".note-expand-toggle"));
    if (!viewElement || !content) {
        return;
    }

    const beforeViewportTop = shouldExpand === true && typeof window !== "undefined"
        ? viewElement.getBoundingClientRect().top
        : null;

    if (shouldExpand) {
        viewElement.classList.add("note-html-view--expanded");
        card.dataset.htmlViewExpanded = "true";
        if (toggle) {
            toggle.setAttribute("aria-expanded", "true");
            toggle.setAttribute("aria-label", LABEL_COLLAPSE_NOTE);
        }
        const viewRect = viewElement.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const targetHeight = Math.max(
            Math.round(viewElement.scrollHeight),
            Math.round(viewRect.height),
            Math.round(cardRect.height)
        );
        if (targetHeight > 0) {
            viewElement.style.minHeight = `${targetHeight}px`;
        }
    } else {
        viewElement.classList.remove("note-html-view--expanded");
        card.dataset.htmlViewExpanded = "false";
        if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
        }
        viewElement.style.minHeight = "";
    }
    scheduleHtmlViewOverflowCheck(viewElement, content, toggle);

    if (beforeViewportTop !== null && typeof window !== "undefined" && typeof window.scrollBy === "function") {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const afterRect = viewElement.getBoundingClientRect();
                const delta = afterRect.top - beforeViewportTop;
                if (Math.abs(delta) > 1) {
                    window.scrollBy({ top: delta, behavior: "auto" });
                }
            });
        });
    }
}

/**
 * Collapse the HTML view for a specific card.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function collapseExpandedHtmlView(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    setHtmlViewExpanded(card, false);
}

/**
 * Measure overflow and toggle the expand affordance accordingly.
 * @param {HTMLElement|null} wrapper
 * @param {HTMLElement|null} content
 * @param {HTMLElement|null} toggle
 * @returns {void}
 */
export function scheduleHtmlViewOverflowCheck(wrapper, content, toggle) {
    if (!(wrapper instanceof HTMLElement) || !(content instanceof HTMLElement)) {
        if (toggle instanceof HTMLElement) {
            toggle.hidden = true;
        }
        return;
    }

    const card = /** @type {HTMLElement|null} */ (wrapper.closest(".markdown-block"));

    const applyMeasurements = () => {
        const isExpanded = wrapper.classList.contains("note-html-view--expanded");
        const overflowDelta = content.scrollHeight - wrapper.clientHeight;
        const overflowing = isExpanded || overflowDelta > 0.5;
        wrapper.classList.toggle("note-html-view--overflow", overflowing && !isExpanded);

        if (toggle instanceof HTMLElement) {
            toggle.hidden = !overflowing;
            toggle.style.display = overflowing ? "flex" : "none";
            if (toggle.hidden) {
                toggle.setAttribute("aria-expanded", "false");
                toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
            } else if (isExpanded) {
                toggle.setAttribute("aria-expanded", "true");
                toggle.setAttribute("aria-label", LABEL_COLLAPSE_NOTE);
            } else {
                toggle.setAttribute("aria-expanded", "false");
                toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
            }
        }

        if (!overflowing && isExpanded) {
            wrapper.classList.remove("note-html-view--expanded");
            if (card instanceof HTMLElement) {
                card.dataset.htmlViewExpanded = "false";
            }
            if (toggle instanceof HTMLElement) {
                toggle.setAttribute("aria-expanded", "false");
                toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
                toggle.style.display = "none";
            }
        }

        if (overflowing && card instanceof HTMLElement && card.dataset.htmlViewExpanded === "true") {
            wrapper.classList.add("note-html-view--expanded");
            if (toggle instanceof HTMLElement) {
                toggle.setAttribute("aria-expanded", "true");
                toggle.setAttribute("aria-label", LABEL_COLLAPSE_NOTE);
                toggle.style.display = "flex";
                toggle.hidden = false;
            }
        }
    };

    if (toggle instanceof HTMLElement) {
        toggle.hidden = true;
        toggle.style.display = "none";
    }

    if (wrapper.clientHeight > 0) {
        applyMeasurements();
    }

    requestAnimationFrame(() => {
        applyMeasurements();
        requestAnimationFrame(applyMeasurements);
    });
}

/**
 * Apply badges to an HTML view container based on markdown metadata.
 * @param {HTMLElement|null} container
 * @param {{ hasCode?: boolean }|null} meta
 * @returns {void}
 */
export function applyHtmlViewBadges(container, meta) {
    if (!(container instanceof HTMLElement)) {
        return;
    }
    const card = container.closest(".markdown-block");
    container.innerHTML = "";
    if (!meta) {
        if (card instanceof HTMLElement) {
            card.classList.remove("card--has-badges");
        }
        return;
    }

    if (meta.hasCode) {
        const codeBadge = createBadge(BADGE_LABEL_CODE, "note-badge--code");
        container.appendChild(codeBadge);
    }
    if (card instanceof HTMLElement) {
        card.classList.toggle("card--has-badges", container.childElementCount > 0);
    }
}

function getHtmlViewCheckboxBubbleDelayMs() {
    if (typeof globalThis !== "undefined") {
        const override = globalThis.__gravityHtmlViewBubbleDelayMs;
        const numeric = typeof override === "number" ? override : Number(override);
        if (Number.isFinite(numeric) && numeric >= 0) {
            return numeric;
        }
    }
    return 900;
}

function createBadge(label, extraClass = "") {
    const badge = createElement("span", "note-badge", label);
    if (extraClass) {
        badge.classList.add(extraClass);
    }
    return badge;
}
