import { nowIso, createElement, autoResize, copyToClipboard } from "../utils.js";
import { CLIPBOARD_METADATA_VERSION } from "../constants.js";
import { GravityStore } from "../store.js";
import { ClassifierClient } from "../classifier.js";
import {
    renderSanitizedMarkdown,
    getSanitizedRenderedHtml,
    getRenderedPlainText
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

const DIRECTION_PREVIOUS = -1;
const DIRECTION_NEXT = 1;
const ACTION_LABEL_DELETE = "🗑️";
const ACTION_ICON_VIEW = "👁️";
const ACTION_ICON_EDIT = "✏️";
const ACTION_ICON_COPY = "📋";

const CARET_PLACEMENT_START = "start";
const CARET_PLACEMENT_END = "end";

let currentEditingCard = null;
let mergeInProgress = false;
const editorHosts = new WeakMap();
const finalizeSuppression = new WeakMap();
const suppressionState = new WeakMap();

/** Public: render a persisted note card */
export function renderCard(record, { notesContainer }) {
    const card = createElement("div", "markdown-block");
    card.setAttribute("data-note-id", record.noteId);

    // Actions column
    const actions = createElement("div", "actions");
    let editorHostRef = null;

    const handleToggleMode = async () => {
        const host = editorHostRef;
        if (!host) return;
        if (host.getMode() === MARKDOWN_MODE_EDIT) {
            await finalizeCard(card, notesContainer);
            host.setMode(MARKDOWN_MODE_VIEW);
        } else {
            enableInPlaceEditing(card, notesContainer, { bubblePreviousCardToTop: false });
        }
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
            const attachments = collectReferencedAttachments(editor);
            const metadata = {
                version: CLIPBOARD_METADATA_VERSION,
                markdown: markdownValue
            };
            if (Object.keys(attachments).length > 0) {
                metadata.attachments = attachments;
            }

            let copied = false;
            const renderedHtml = getSanitizedRenderedHtml(preview);
            const renderedText = getRenderedPlainText(preview);

            if (host.getMode() === MARKDOWN_MODE_EDIT) {
                copied = await copyToClipboard({ text: markdownValue, html: renderedHtml, metadata });
            } else {
                copied = await copyToClipboard({ text: renderedText, html: renderedHtml, metadata });
            }
            if (!copied) throw new Error("Clipboard copy failed");
        } catch (error) {
            console.error(error);
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

    const btnToggleMode = button(ACTION_ICON_VIEW, () => handleToggleMode(), { extraClass: "action-button--icon" });
    btnToggleMode.dataset.action = "toggle-mode";

    const btnCopy = button(ACTION_ICON_COPY, () => handleCopy(), { extraClass: "action-button--icon" });
    btnCopy.dataset.action = "copy-note";

    const modeCopyGroup = createElement("div", "action-group action-group--row");
    modeCopyGroup.append(btnToggleMode, btnCopy);

    const btnMergeDown = button("Merge ↓", () => mergeDown(card, notesContainer), { variant: "merge" });
    btnMergeDown.dataset.action = "merge-down";

    const btnMergeUp   = button("Merge ↑", () => mergeUp(card, notesContainer), { variant: "merge" });
    btnMergeUp.dataset.action = "merge-up";

    const arrowRow = createElement("div", "action-group action-group--row");

    const btnUp        = button("▲", () => move(card, -1, notesContainer), { extraClass: "action-button--compact" });
    btnUp.dataset.action = "move-up";

    const btnDown      = button("▼", () => move(card,  1, notesContainer), { extraClass: "action-button--compact" });
    btnDown.dataset.action = "move-down";

    arrowRow.append(btnUp, btnDown);

    const btnDelete = button(ACTION_LABEL_DELETE, () => deleteCard(card, notesContainer), { extraClass: "action-button--icon" });
    btnDelete.dataset.action = "delete";

    actions.append(modeCopyGroup, btnMergeDown, btnMergeUp, arrowRow, btnDelete);

    // Chips + content
    const chips   = createElement("div", "meta-chips");
    applyChips(chips, record.classification);

    // IMPORTANT: div (not <p>) so tables/lists/headings render correctly
    const preview = createElement("div", "markdown-content");
    const initialAttachments = record.attachments || {};
    const initialPreviewMarkdown = transformMarkdownWithAttachments(record.markdownText, initialAttachments);
    renderSanitizedMarkdown(preview, initialPreviewMarkdown);

    const editor  = createElement("textarea", "markdown-editor");
    editor.value  = record.markdownText;
    editor.setAttribute("rows", "1");
    autoResize(editor);

    registerInitialAttachments(editor, initialAttachments);
    enableClipboardImagePaste(editor);

    const editorHost = createMarkdownEditorHost({
        container: card,
        textarea: editor,
        previewElement: preview,
        initialMode: MARKDOWN_MODE_EDIT,
        showToolbar: false
    });
    editorHostRef = editorHost;
    editorHosts.set(card, editorHost);
    card.__markdownHost = editorHost;
    card.dataset.initialValue = record.markdownText;

    const refreshPreview = () => {
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editorHost.getValue(), attachments);
        renderSanitizedMarkdown(preview, markdownWithAttachments);
        if (!editorHost.isEnhanced()) {
            autoResize(editor);
        }
    };

    const updateModeControls = () => {
        const mode = editorHost.getMode();
        if (mode === MARKDOWN_MODE_EDIT) {
            btnToggleMode.textContent = ACTION_ICON_VIEW;
            btnToggleMode.title = "Switch to rendered view";
            btnToggleMode.setAttribute("aria-label", "Switch to rendered view");
            btnCopy.title = "Copy Markdown";
            btnCopy.setAttribute("aria-label", "Copy Markdown");
        } else {
            btnToggleMode.textContent = ACTION_ICON_EDIT;
            btnToggleMode.title = "Switch to Markdown editor";
            btnToggleMode.setAttribute("aria-label", "Switch to Markdown editor");
            btnCopy.title = "Copy Rendered HTML";
            btnCopy.setAttribute("aria-label", "Copy Rendered HTML");
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

    // Switch to in-place editing on click (without changing order)
    preview.addEventListener("mousedown", () => enableInPlaceEditing(card, notesContainer));

    card.append(chips, preview, editor, actions);
    return card;
}

/** Public: re-evaluate which action buttons show/hide based on position */
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

function enableInPlaceEditing(card, notesContainer, options = {}) {
    const { bubblePreviousCardToTop = true } = options;
    if (currentEditingCard && currentEditingCard !== card && !mergeInProgress) {
        finalizeCard(currentEditingCard, notesContainer, { bubbleToTop: bubblePreviousCardToTop });
    }
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

    if (editorHost && !editorHost.isEnhanced() && editor) {
        const h = Math.max(preview.offsetHeight, 36);
        editor.style.height = `${h}px`;
        editor.style.minHeight = `${h}px`;
    }

    card.classList.add("editing-in-place");
    editorHost?.setMode(MARKDOWN_MODE_EDIT);

    // Focus after paint; then release the height lock
    requestAnimationFrame(() => {
        editorHost?.focus();
        if (editorHost && !editorHost.isEnhanced() && editor) {
            setTimeout(() => { editor.style.minHeight = ""; }, 120);
        }
    });

    updateActionButtons(notesContainer);
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
    // If cleared, delete the card entirely
    if (trimmed.length === 0) {
        const id = card.getAttribute("data-note-id");
        GravityStore.removeById(id);
        card.remove();
        editorHosts.delete(card);
        GravityStore.syncFromDom(notesContainer);
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

    GravityStore.syncFromDom(notesContainer);
    updateActionButtons(notesContainer);

    // Re-classify edited content
    triggerClassificationForCard(id, text, notesContainer);
}

function deleteCard(card, notesContainer) {
    if (!card) return;
    if (currentEditingCard === card) {
        currentEditingCard = null;
    }
    card.classList.remove("editing-in-place");
    const noteId = card.getAttribute("data-note-id");
    GravityStore.removeById(noteId);
    card.remove();
    GravityStore.syncFromDom(notesContainer);
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
    GravityStore.syncFromDom(notesContainer);
    updateActionButtons(notesContainer);
}

function mergeDown(card, notesContainer) {
    const below = card.nextElementSibling;
    if (!below) return;

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

    GravityStore.syncFromDom(notesContainer);
    updateActionButtons(notesContainer);
}

function mergeUp(card, notesContainer) {
    if (card !== notesContainer.lastElementChild || notesContainer.children.length < 2) return;

    const above = card.previousElementSibling;
    const editorAbove  = above.querySelector(".markdown-editor");
    const editorHere   = card.querySelector(".markdown-editor");
    const previewAbove = above.querySelector(".markdown-content");

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

    GravityStore.syncFromDom(notesContainer);
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

export function focusCardEditor(card, notesContainer, options = {}) {
    if (!(card instanceof HTMLElement)) return false;

    const {
        caretPlacement = CARET_PLACEMENT_START,
        bubblePreviousCardToTop = false
    } = options;

    enableInPlaceEditing(card, notesContainer, { bubblePreviousCardToTop });

    requestAnimationFrame(() => {
        const host = editorHosts.get(card);
        if (!host) return;
        host.setMode(MARKDOWN_MODE_EDIT);
        host.focus();
        host.setCaretPosition(caretPlacement === CARET_PLACEMENT_END ? "end" : "start");
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
        .catch(() => {});
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
