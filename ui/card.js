import { nowIso, createElement, autoResize } from "../utils.js";
import { GravityStore } from "../store.js";
import { ClassifierClient } from "../classifier.js";
import {
    enableClipboardImagePaste,
    waitForPendingImagePastes,
    registerInitialAttachments,
    getAllAttachments,
    collectReferencedAttachments,
    transformMarkdownWithAttachments
} from "./imagePaste.js";

const KEY_ARROW_UP = "ArrowUp";
const KEY_ARROW_DOWN = "ArrowDown";
const DIRECTION_PREVIOUS = -1;
const DIRECTION_NEXT = 1;
const LINE_BREAK = "\n";
const ACTION_LABEL_DELETE = "♻";

let currentEditingCard = null;
let mergeInProgress = false;

/** Public: render a persisted note card */
export function renderCard(record, { notesContainer }) {
    const card = createElement("div", "markdown-block");
    card.setAttribute("data-note-id", record.noteId);

    // Actions column
    const actions = createElement("div", "actions");
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

    actions.append(btnMergeDown, btnMergeUp, arrowRow, btnDelete);

    // Chips + content
    const chips   = createElement("div", "meta-chips");
    applyChips(chips, record.classification);

    // IMPORTANT: div (not <p>) so tables/lists/headings render correctly
    const preview = createElement("div", "markdown-content");
    const initialAttachments = record.attachments || {};
    const initialPreviewMarkdown = transformMarkdownWithAttachments(record.markdownText, initialAttachments);
    preview.innerHTML = marked.parse(initialPreviewMarkdown);

    const editor  = createElement("textarea", "markdown-editor");
    editor.value  = record.markdownText;
    editor.setAttribute("rows", "1");
    autoResize(editor);

    registerInitialAttachments(editor, initialAttachments);
    enableClipboardImagePaste(editor);

    // Live preview
    editor.addEventListener("input", () => {
        autoResize(editor);
        const attachments = getAllAttachments(editor);
        const markdownWithAttachments = transformMarkdownWithAttachments(editor.value, attachments);
        preview.innerHTML = marked.parse(markdownWithAttachments);
    });

    // Finalize on Enter (no Shift)
    editor.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            finalizeCard(card, notesContainer);
        }

        if (shouldNavigateToPreviousCard(ev, editor)) {
            const navigated = navigateToAdjacentCard(card, DIRECTION_PREVIOUS, notesContainer);
            if (navigated) {
                ev.preventDefault();
                return;
            }
        }

        if (shouldNavigateToNextCard(ev, editor)) {
            const navigated = navigateToAdjacentCard(card, DIRECTION_NEXT, notesContainer);
            if (navigated) {
                ev.preventDefault();
                return;
            }
        }
    });

    // Finalize on blur
    editor.addEventListener("blur", () => finalizeCard(card, notesContainer));

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

    // Remember original text so we can detect "no changes"
    card.dataset.initialValue = editor.value;

    // Lock height to preview height to avoid jump on entry
    const h = Math.max(preview.offsetHeight, 36);
    editor.style.height = `${h}px`;
    editor.style.minHeight = `${h}px`;

    card.classList.add("editing-in-place");

    // Focus after paint; then release the height lock
    requestAnimationFrame(() => {
        editor?.focus({ preventScroll: true });
        setTimeout(() => { editor.style.minHeight = ""; }, 120);
    });

    updateActionButtons(notesContainer);
}

async function finalizeCard(card, notesContainer, options = {}) {
    const { bubbleToTop = true } = options;
    if (!card || (currentEditingCard && currentEditingCard !== card) || mergeInProgress) return;
    if (!card.classList.contains("editing-in-place")) return;

    const editor  = card.querySelector(".markdown-editor");
    const preview = card.querySelector(".markdown-content");
    await waitForPendingImagePastes(editor);
    const text    = editor.value;
    const trimmed = text.trim();
    const was     = card.dataset.initialValue ?? text;
    const changed = text !== was; // only reorder/persist if user actually changed something
    const attachments = collectReferencedAttachments(editor);

    card.classList.remove("editing-in-place");
    currentEditingCard = null;

    // If cleared, delete the card entirely
    if (trimmed.length === 0) {
        const id = card.getAttribute("data-note-id");
        GravityStore.removeById(id);
        card.remove();
        GravityStore.syncFromDom(notesContainer);
        updateActionButtons(notesContainer);
        return;
    }

    // Update preview (safe either way)
    const markdownWithAttachments = transformMarkdownWithAttachments(text, attachments);
    preview.innerHTML = marked.parse(markdownWithAttachments);

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

    editorBelow.value = merged;
    registerInitialAttachments(editorBelow, mergedAttachments);
    const mergedMarkdown = transformMarkdownWithAttachments(merged, mergedAttachments);
    previewBelow.innerHTML = marked.parse(mergedMarkdown);
    autoResize(editorBelow);

    const idHere = card.getAttribute("data-note-id");
    GravityStore.removeById(idHere);
    card.remove();

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

    editorAbove.value = merged;
    registerInitialAttachments(editorAbove, mergedAttachments);
    const mergedMarkdown = transformMarkdownWithAttachments(merged, mergedAttachments);
    previewAbove.innerHTML = marked.parse(mergedMarkdown);
    autoResize(editorAbove);

    const idHere = card.getAttribute("data-note-id");
    GravityStore.removeById(idHere);
    card.remove();

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

function shouldNavigateToPreviousCard(event, editor) {
    if (event.key !== KEY_ARROW_UP) return false;
    if (hasModifierKey(event)) return false;
    if (!isSelectionCollapsed(editor)) return false;
    return isCaretOnFirstLine(editor);
}

function shouldNavigateToNextCard(event, editor) {
    if (event.key !== KEY_ARROW_DOWN) return false;
    if (hasModifierKey(event)) return false;
    if (!isSelectionCollapsed(editor)) return false;
    return isCaretOnLastLine(editor);
}

function hasModifierKey(event) {
    return event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
}

function isSelectionCollapsed(editor) {
    return editor.selectionStart === editor.selectionEnd;
}

function isCaretOnFirstLine(editor) {
    const caretPosition = editor.selectionStart ?? 0;
    const textBeforeCaret = editor.value.slice(0, caretPosition);
    return !textBeforeCaret.includes(LINE_BREAK);
}

function isCaretOnLastLine(editor) {
    const caretPosition = editor.selectionEnd ?? editor.value.length;
    const textAfterCaret = editor.value.slice(caretPosition);
    return !textAfterCaret.includes(LINE_BREAK);
}

function navigateToAdjacentCard(card, direction, notesContainer) {
    const targetCard = direction === DIRECTION_PREVIOUS ? card.previousElementSibling : card.nextElementSibling;
    if (!targetCard) return false;

    enableInPlaceEditing(targetCard, notesContainer, { bubblePreviousCardToTop: false });

    requestAnimationFrame(() => {
        const targetEditor = targetCard.querySelector(".markdown-editor");
        if (!targetEditor) return;
        const nextPosition = direction === DIRECTION_PREVIOUS ? targetEditor.value.length : 0;
        try {
            targetEditor.setSelectionRange(nextPosition, nextPosition);
        } catch {}
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
