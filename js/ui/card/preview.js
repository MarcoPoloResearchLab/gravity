// @ts-check

import {
    LABEL_COLLAPSE_NOTE,
    LABEL_EXPAND_NOTE,
    BADGE_LABEL_CODE
} from "../../constants.js";
import { createElement } from "../../utils/dom.js";
import {
    buildDeterministicPreview,
    renderSanitizedMarkdown
} from "../markdownPreview.js";
import {
    collectReferencedAttachments,
    transformMarkdownWithAttachments
} from "../imagePaste.js";
import { placeCardRespectingPinned } from "./layout.js";
import { updateActionButtons } from "./listControls.js";
import { syncStoreFromDom } from "../storeSync.js";

/**
 * HTML view lifecycle is intentionally atomic:
 *  - `createHTMLView(card, …)` removes any existing preview DOM and rebuilds it
 *    from the supplied markdown source, wiring up the expand toggle and badges.
 *  - `deleteHTMLView(card)` tears the preview out of the DOM entirely. Edit mode
 *    always calls this so the editor surface is the only visible state.
 *  No incremental refresh helpers remain; callers choose one of these two
 *  operations based on the card mode.
 */
// HTML view lifecycle helpers – cards rebuild their visible HTML from markdown
// on demand (create) and tear it down entirely when switching to markdown view
// (delete). No refresh helpers remain by design.
const previewBubbleTimers = new WeakMap();
const previewFocusTargets = new WeakMap();

/**
 * Queue a preview bubble after a checkbox interaction.
 * @param {HTMLElement} card
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function schedulePreviewBubble(card, notesContainer) {
    if (!(card instanceof HTMLElement) || !(notesContainer instanceof HTMLElement)) {
        return;
    }
    const existing = previewBubbleTimers.get(card);
    if (existing) {
        clearTimeout(existing);
    }
    const delay = getPreviewCheckboxBubbleDelayMs();
    if (delay <= 0) {
        bubbleCardToTop(card, notesContainer);
        return;
    }
    const timer = setTimeout(() => {
        previewBubbleTimers.delete(card);
        bubbleCardToTop(card, notesContainer);
    }, delay);
    previewBubbleTimers.set(card, timer);
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
    const pending = previewBubbleTimers.get(card);
    if (pending) {
        clearTimeout(pending);
        previewBubbleTimers.delete(card);
    }
    placeCardRespectingPinned(card, notesContainer, { forcePinnedPosition: card.dataset.pinned === "true" });
    const overrides = overrideRecord && overrideRecord.noteId
        ? { [overrideRecord.noteId]: overrideRecord }
        : undefined;
    syncStoreFromDom(notesContainer, overrides);
    updateActionButtons(notesContainer);
    const badgesTarget = card.querySelector(".note-badges");
    let previewSource = markdownOverride;
    if (typeof previewSource !== "string") {
        const host = card.__markdownHost;
        const textarea = host && typeof host.getTextarea === "function"
            ? host.getTextarea()
            : /** @type {HTMLTextAreaElement|null} */ (card.querySelector(".markdown-editor"));
        const markdownValue = host && typeof host.getValue === "function"
            ? host.getValue()
            : textarea?.value ?? "";
        const attachments = textarea instanceof HTMLTextAreaElement ? collectReferencedAttachments(textarea) : {};
        previewSource = transformMarkdownWithAttachments(markdownValue, attachments);
    }
    createHTMLView(card, { markdownSource: previewSource, badgesTarget });
}

/**
 * Build a fresh HTML view for a card from the provided markdown source. Any
 * existing HTML view is removed first so only one rendered copy exists.
 *
 * @param {HTMLElement} card
 * @param {{ markdownSource: string, badgesTarget?: HTMLElement|null }} options
 * @returns {HTMLElement|null}
 */
export function createHTMLView(card, { markdownSource, badgesTarget }) {
    if (!(card instanceof HTMLElement) || typeof markdownSource !== "string") {
        return null;
    }
    deleteHTMLView(card);
    if (card.dataset.previewExpanded !== "true") {
        card.dataset.previewExpanded = "false";
    }
    const { previewMarkdown, meta } = buildDeterministicPreview(markdownSource);
    const wrapper = createElement("div", "note-preview");
    const content = createElement("div", "markdown-content");
    const expandToggle = createExpandToggle(card, wrapper);
    wrapper.append(content, expandToggle);
    insertPreviewWrapper(card, wrapper);
    renderSanitizedMarkdown(content, previewMarkdown);
    restorePreviewFocus(card);
    if (badgesTarget instanceof HTMLElement) {
        applyPreviewBadges(badgesTarget, meta);
    }
    scheduleOverflowCheck(wrapper, content, expandToggle);
    if (card.dataset.previewExpanded === "true") {
        requestAnimationFrame(() => {
            setCardExpanded(card, true);
        });
    }
    return wrapper;
}

/**
 * Remove the current HTML view for a card (no-op if none exists).
 * @param {HTMLElement} card
 */
export function deleteHTMLView(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const wrapper = card.querySelector(".note-preview");
    if (!(wrapper instanceof HTMLElement)) {
        return;
    }
    wrapper.remove();
}

function insertPreviewWrapper(card, wrapper) {
    const textarea = card.querySelector(".markdown-editor");
    if (textarea instanceof HTMLElement && textarea.parentElement === card) {
        card.insertBefore(wrapper, textarea);
    } else {
        card.appendChild(wrapper);
    }
}

function createExpandToggle(card, wrapper) {
    const toggle = createElement("button", "note-expand-toggle", "»");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
    toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isExpanded = wrapper.classList.contains("note-preview--expanded");
        setCardExpanded(card, !isExpanded);
    });
    return toggle;
}

/**
 * Remember focus targets so checkbox interactions can maintain focus.
 * @param {HTMLElement} card
 * @param {{ type: "checkbox", taskIndex: number, remaining: number }} spec
 * @returns {void}
 */
export function queuePreviewFocus(card, spec) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    previewFocusTargets.set(card, spec);
}

/**
 * Attempt to restore focus to a preview element after re-rendering.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function restorePreviewFocus(card) {
    const focusSpec = previewFocusTargets.get(card);
    if (!focusSpec) {
        return;
    }
    const nextRemaining = typeof focusSpec.remaining === "number" ? focusSpec.remaining - 1 : 0;
    if (nextRemaining <= 0) {
        previewFocusTargets.delete(card);
    } else {
        previewFocusTargets.set(card, { ...focusSpec, remaining: nextRemaining });
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
 * Expand or collapse a preview, ensuring only one card is expanded at a time.
 * @param {HTMLElement} card
 * @param {boolean} shouldExpand
 * @returns {void}
 */
export function setCardExpanded(card, shouldExpand) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const preview = /** @type {HTMLElement|null} */ (card.querySelector(".note-preview"));
    const content = /** @type {HTMLElement|null} */ (card.querySelector(".note-preview .markdown-content"));
    const toggle = /** @type {HTMLElement|null} */ (card.querySelector(".note-expand-toggle"));
    if (!preview || !content) {
        return;
    }

    const beforeViewportTop = shouldExpand === true && typeof window !== "undefined"
        ? preview.getBoundingClientRect().top
        : null;

    if (shouldExpand) {
        preview.classList.add("note-preview--expanded");
        card.dataset.previewExpanded = "true";
        if (toggle) {
            toggle.setAttribute("aria-expanded", "true");
            toggle.setAttribute("aria-label", LABEL_COLLAPSE_NOTE);
        }
    } else {
        preview.classList.remove("note-preview--expanded");
        card.dataset.previewExpanded = "false";
        if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
        }
    }
    scheduleOverflowCheck(preview, content, toggle);

    if (beforeViewportTop !== null && typeof window !== "undefined" && typeof window.scrollBy === "function") {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const afterRect = preview.getBoundingClientRect();
                const delta = afterRect.top - beforeViewportTop;
                if (Math.abs(delta) > 1) {
                    window.scrollBy({ top: delta, behavior: "auto" });
                }
            });
        });
    }
}

/**
 * Collapse the preview for a specific card.
 * @param {HTMLElement} card
 * @returns {void}
 */
export function collapseExpandedPreview(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    setCardExpanded(card, false);
}

/**
 * Measure overflow and toggle the expand affordance accordingly.
 * @param {HTMLElement|null} wrapper
 * @param {HTMLElement|null} content
 * @param {HTMLElement|null} toggle
 * @returns {void}
 */
export function scheduleOverflowCheck(wrapper, content, toggle) {
    if (!(wrapper instanceof HTMLElement) || !(content instanceof HTMLElement)) {
        if (toggle instanceof HTMLElement) {
            toggle.hidden = true;
        }
        return;
    }

    const card = /** @type {HTMLElement|null} */ (wrapper.closest(".markdown-block"));

    const applyMeasurements = () => {
        const isExpanded = wrapper.classList.contains("note-preview--expanded");
        const overflowDelta = content.scrollHeight - wrapper.clientHeight;
        const overflowing = isExpanded || overflowDelta > 0.5;
        wrapper.classList.toggle("note-preview--overflow", overflowing && !isExpanded);

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
            wrapper.classList.remove("note-preview--expanded");
            if (card instanceof HTMLElement) {
                card.dataset.previewExpanded = "false";
            }
            if (toggle instanceof HTMLElement) {
                toggle.setAttribute("aria-expanded", "false");
                toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
                toggle.style.display = "none";
            }
        }

        if (overflowing && card instanceof HTMLElement && card.dataset.previewExpanded === "true") {
            wrapper.classList.add("note-preview--expanded");
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
 * Apply badges to a preview container based on markdown metadata.
 * @param {HTMLElement|null} container
 * @param {{ hasCode?: boolean }|null} meta
 * @returns {void}
 */
export function applyPreviewBadges(container, meta) {
    if (!(container instanceof HTMLElement)) {
        return;
    }
    container.innerHTML = "";
    if (!meta) {
        return;
    }

    if (meta.hasCode) {
        const codeBadge = createBadge(BADGE_LABEL_CODE, "note-badge--code");
        container.appendChild(codeBadge);
    }
}

function getPreviewCheckboxBubbleDelayMs() {
    if (typeof globalThis !== "undefined") {
        const override = globalThis.__gravityPreviewBubbleDelayMs;
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
