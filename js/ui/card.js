// @ts-check

import { nowIso, createElement, autoResize, copyToClipboard } from "../utils/index.js";
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
    LABEL_MERGE_DOWN,
    LABEL_MERGE_UP,
    LABEL_MOVE_DOWN,
    LABEL_MOVE_UP,
    MESSAGE_NOTE_COPIED
} from "../constants.js";
import { GravityStore } from "../core/store.js";
import { ClassifierClient } from "../core/classifier.js";
import { logging } from "../utils/logging.js";
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

const DIRECTION_PREVIOUS = -1;
const DIRECTION_NEXT = 1;
const CARET_PLACEMENT_START = "start";
const CARET_PLACEMENT_END = "end";
const TASK_LINE_REGEX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])([^\n]*)$/;
let currentEditingCard = null;
let mergeInProgress = false;
let expandedPreviewCard = null;
const editorHosts = new WeakMap();
const finalizeSuppression = new WeakMap();
const suppressionState = new WeakMap();
const copyFeedbackTimers = new WeakMap();
const COPY_FEEDBACK_DURATION_MS = 1800;
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

    // Actions column
    const actions = createElement("div", "actions");
    let editorHostRef = null;

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

    actions.append(btnCopy, btnMergeDown, btnMergeUp, arrowRow, btnDelete);

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

    card.append(chips, badges, previewWrapper, expandToggle, editor, actions);

    const handleCardInteraction = (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (target.closest && target.closest(".actions")) {
            return;
        }

        if (card.classList.contains("editing-in-place")) {
            return;
        }

        focusCardEditor(card, notesContainer, {
            caretPlacement: CARET_PLACEMENT_END,
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

    const refreshPreview = () => {
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editorHost.getValue(), attachments);
        const { previewMarkdown: nextPreviewMarkdown, meta: nextMeta } = buildDeterministicPreview(markdownWithAttachments);
        renderSanitizedMarkdown(preview, nextPreviewMarkdown);
        applyPreviewBadges(badges, nextMeta);
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
    editorHost.on("submit", () => finalizeCard(card, notesContainer));
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

        host.setValue(nextMarkdown);
        refreshPreview();
        persistCardState(card, notesContainer, nextMarkdown);
    }
}

/**
 * Re-evaluate which per-card action buttons should be visible based on list position.
 * @param {HTMLElement} notesContainer
 * @returns {void}
 */
export function updateActionButtons(notesContainer) {
    const cards = Array.from(notesContainer.children);
    const total = cards.length;
    cards.forEach((card, index) => {
        const mergeDown = card.querySelector('[data-action="merge-down"]');
        const mergeUp = card.querySelector('[data-action="merge-up"]');
        const up = card.querySelector('[data-action="move-up"]');
        const down = card.querySelector('[data-action="move-down"]');
        const isFirst = index === 0;
        const isLast  = index === total - 1;

        show(mergeDown, !isLast);
        show(mergeUp,   isLast && total > 1);
        show(up,        !isFirst);
        show(down,      !isLast);
    });
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

function show(el, yes) { if (el) el.style.display = yes ? "block" : "none"; }

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

function persistCardState(card, notesContainer, markdownText) {
    if (!(card instanceof HTMLElement) || typeof markdownText !== "string") {
        return;
    }
    const noteId = card.getAttribute("data-note-id");
    if (!noteId) {
        return;
    }
    const editor = /** @type {HTMLTextAreaElement|null} */ (card.querySelector(".markdown-editor"));
    if (!(editor instanceof HTMLTextAreaElement)) {
        return;
    }

    const timestamp = nowIso();
    const records = GravityStore.loadAllNotes();
    const existing = records.find((record) => record.noteId === noteId);
    const attachments = collectReferencedAttachments(editor);

    GravityStore.upsertNonEmpty({
        noteId,
        markdownText,
        createdAtIso: existing?.createdAtIso ?? timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        attachments
    });

    card.dataset.initialValue = markdownText;

    if (notesContainer instanceof HTMLElement) {
        const firstCard = notesContainer.firstElementChild;
        if (firstCard && firstCard !== card) {
            notesContainer.insertBefore(card, firstCard);
        }
        syncStoreFromDom(notesContainer);
        updateActionButtons(notesContainer);
    }

    triggerClassificationForCard(noteId, markdownText, notesContainer);
    showSaveFeedback();
}

function setCardExpanded(card, shouldExpand) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    const preview = /** @type {HTMLElement|null} */ (card.querySelector(".note-preview"));
    const content = /** @type {HTMLElement|null} */ (card.querySelector(".note-preview .markdown-content"));
    const toggle = /** @type {HTMLElement|null} */ (card.querySelector(".note-expand-toggle"));
    if (!preview || !content) {
        return;
    }

    if (shouldExpand) {
        if (expandedPreviewCard && expandedPreviewCard !== card) {
            setCardExpanded(expandedPreviewCard, false);
        }
        preview.classList.add("note-preview--expanded");
        if (toggle) {
            toggle.setAttribute("aria-expanded", "true");
            toggle.setAttribute("aria-label", LABEL_COLLAPSE_NOTE);
        }
        expandedPreviewCard = card;
    } else {
        preview.classList.remove("note-preview--expanded");
        if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
        }
        if (expandedPreviewCard === card) {
            expandedPreviewCard = null;
        }
    }
    scheduleOverflowCheck(preview, content, toggle);
}

function collapseExpandedPreview(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    setCardExpanded(card, false);
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
    if (expandedPreviewCard && expandedPreviewCard !== card) {
        collapseExpandedPreview(expandedPreviewCard);
    }
    collapseExpandedPreview(card);
    currentEditingCard = card;

    // Remove edit mode from others
    const all = notesContainer.querySelectorAll(".markdown-block");
    for (const c of all) c.classList.remove("editing-in-place");

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
    const { bubbleToTop = true } = options;
    if (!card || mergeInProgress) return;
    if (isFinalizeSuppressed(card)) return;

    const editorHost = editorHosts.get(card);
    const isEditMode = card.classList.contains("editing-in-place") || editorHost?.getMode() === MARKDOWN_MODE_EDIT;
    if (!isEditMode) return;

    const editor  = card.querySelector(".markdown-editor");
    const preview = card.querySelector(".markdown-content");
    await (editorHost ? editorHost.waitForPendingImages() : waitForPendingImagePastes(editor));
    const text    = editorHost ? editorHost.getValue() : editor.value;
    const trimmed = text.trim();
    const was     = card.dataset.initialValue ?? text;
    const changed = text !== was; // only reorder/persist if user actually changed something
    const attachments = collectReferencedAttachments(editor);

    if (card.classList.contains("editing-in-place")) {
        card.classList.remove("editing-in-place");
    }
    if (currentEditingCard === card) {
        currentEditingCard = null;
    }
    if (editorHost) {
        editorHost.setMode(MARKDOWN_MODE_VIEW);
    }
    // If cleared, delete the card entirely
    if (trimmed.length === 0) {
        collapseExpandedPreview(card);
        const id = card.getAttribute("data-note-id");
        GravityStore.removeById(id);
        card.remove();
        editorHosts.delete(card);
        syncStoreFromDom(notesContainer);
        updateActionButtons(notesContainer);
        return;
    }

    // Update preview (safe either way)
    const markdownWithAttachments = transformMarkdownWithAttachments(text, attachments);
    renderSanitizedMarkdown(preview, markdownWithAttachments);
    if (!editorHost || !editorHost.isEnhanced()) {
        autoResize(editor);
    }

    if (!changed) {
        // Keep position; nothing else to do
        return;
    }

    // Persist changes and bubble to top
    const id = card.getAttribute("data-note-id");
    const ts = nowIso();
    const records = GravityStore.loadAllNotes();
    const existing = records.find(r => r.noteId === id);

    GravityStore.upsertNonEmpty({
        noteId: id,
        markdownText: text,
        createdAtIso: existing?.createdAtIso ?? ts, // preserve creation time
        updatedAtIso: ts,
        lastActivityIso: ts,
        attachments
    });

    card.dataset.initialValue = text;

    if (bubbleToTop) {
        const first = notesContainer.firstElementChild;
        if (first) notesContainer.insertBefore(card, first);
    }

    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);

    // Re-classify edited content
    triggerClassificationForCard(id, text, notesContainer);
    showSaveFeedback();
}

function deleteCard(card, notesContainer) {
    if (!card) return;
    collapseExpandedPreview(card);
    if (currentEditingCard === card) {
        currentEditingCard = null;
    }
    card.classList.remove("editing-in-place");
    const noteId = card.getAttribute("data-note-id");
    GravityStore.removeById(noteId);
    card.remove();
    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);
}

function move(card, direction, notesContainer) {
    const list = Array.from(notesContainer.children);
    const i = list.indexOf(card);
    const target = i + direction;
    if (i < 0 || target < 0 || target >= list.length) return;
    const ref = list[target];
    if (direction === -1) notesContainer.insertBefore(card, ref);
    else notesContainer.insertBefore(card, ref.nextSibling);
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
    GravityStore.removeById(idHere);
    if (card === currentEditingCard) {
        card.classList.remove("editing-in-place");
        delete card.dataset.initialValue;
        currentEditingCard = null;
    }
    card.remove();
    editorHosts.delete(card);

    const idBelow = below.getAttribute("data-note-id");
    const ts = nowIso();
    const records = GravityStore.loadAllNotes();
    const existing = records.find(r => r.noteId === idBelow);

    GravityStore.upsertNonEmpty({
        noteId: idBelow,
        markdownText: merged,
        createdAtIso: existing?.createdAtIso ?? ts,
        updatedAtIso: ts,
        lastActivityIso: ts,
        attachments: collectReferencedAttachments(editorBelow)
    });

    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);
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
    GravityStore.removeById(idHere);
    if (card === currentEditingCard) {
        card.classList.remove("editing-in-place");
        delete card.dataset.initialValue;
        currentEditingCard = null;
    }
    card.remove();
    editorHosts.delete(card);

    const idAbove = above.getAttribute("data-note-id");
    const ts = nowIso();
    const records = GravityStore.loadAllNotes();
    const existing = records.find(r => r.noteId === idAbove);

    GravityStore.upsertNonEmpty({
        noteId: idAbove,
        markdownText: merged,
        createdAtIso: existing?.createdAtIso ?? ts,
        updatedAtIso: ts,
        lastActivityIso: ts,
        attachments: collectReferencedAttachments(editorAbove)
    });

    syncStoreFromDom(notesContainer);
    updateActionButtons(notesContainer);
}

function navigateToAdjacentCard(card, direction, notesContainer) {
    const targetCard = direction === DIRECTION_PREVIOUS ? card.previousElementSibling : card.nextElementSibling;
    if (targetCard instanceof HTMLElement && targetCard.classList.contains("markdown-block")) {
        const caretPlacement = direction === DIRECTION_PREVIOUS ? CARET_PLACEMENT_END : CARET_PLACEMENT_START;
        return focusCardEditor(targetCard, notesContainer, {
            caretPlacement,
            bubblePreviousCardToTop: false
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
 * @param {{ caretPlacement?: typeof CARET_PLACEMENT_START | typeof CARET_PLACEMENT_END, bubblePreviousCardToTop?: boolean }} [options]
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
        const selectionStart = textarea && typeof textarea.selectionStart === "number"
            ? textarea.selectionStart
            : null;
        const selectionEnd = textarea && typeof textarea.selectionEnd === "number"
            ? textarea.selectionEnd
            : null;
        const targetPosition = caretPlacement === CARET_PLACEMENT_END ? "end" : "start";
        const expectedDefaultIndex = caretPlacement === CARET_PLACEMENT_END
            ? 0
            : (textarea?.value.length ?? 0);
        const selectionDefined = selectionStart !== null && selectionEnd !== null;
        const selectionAtDefault = selectionDefined
            && selectionStart === selectionEnd
            && selectionStart === expectedDefaultIndex;
        const shouldRespectExistingCaret = selectionDefined && !selectionAtDefault;

        host.setMode(MARKDOWN_MODE_EDIT);
        host.focus();
        // Respect caret adjustments made before this frame (e.g. user repositioning the cursor)
        if (!shouldRespectExistingCaret) {
            host.setCaretPosition(targetPosition);
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

function applyPreviewBadges(container, meta) {
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

function scheduleOverflowCheck(wrapper, content, toggle) {
    if (!(wrapper instanceof HTMLElement) || !(content instanceof HTMLElement)) {
        if (toggle instanceof HTMLElement) {
            toggle.hidden = true;
        }
        return;
    }
    requestAnimationFrame(() => {
        const isExpanded = wrapper.classList.contains("note-preview--expanded");
        const overflowing = isExpanded || content.scrollHeight > wrapper.clientHeight + 1;
        wrapper.classList.toggle("note-preview--overflow", overflowing && !isExpanded);

        if (toggle instanceof HTMLElement) {
            toggle.hidden = !overflowing;
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
            if (toggle instanceof HTMLElement) {
                toggle.setAttribute("aria-expanded", "false");
                toggle.setAttribute("aria-label", LABEL_EXPAND_NOTE);
            }
            const card = wrapper.closest(".markdown-block");
            if (expandedPreviewCard === card) {
                expandedPreviewCard = null;
            }
        }
    });
}

function createBadge(label, extraClass = "") {
    const badge = createElement("span", "note-badge", label);
    if (extraClass) {
        badge.classList.add(extraClass);
    }
    return badge;
}
