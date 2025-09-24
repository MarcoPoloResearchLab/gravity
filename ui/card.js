import { nowIso, createElement, autoResize } from "../utils.js";
import { GravityStore } from "../store.js";
import { ClassifierClient } from "../classifier.js";
import { enableClipboardImagePaste } from "./imagePaste.js";

let currentEditingCard = null;
let mergeInProgress = false;

/** Public: render a persisted note card */
export function renderCard(record, { notesContainer }) {
    const card = createElement("div", "markdown-block");
    card.setAttribute("data-note-id", record.noteId);

    // Actions column
    const actions = createElement("div", "actions");
    const btnMergeDown = button("Merge ↓", () => mergeDown(card, notesContainer));
    const btnMergeUp   = button("Merge ↑", () => mergeUp(card, notesContainer));
    const btnUp        = button("▲",       () => move(card, -1, notesContainer));
    const btnDown      = button("▼",       () => move(card,  1, notesContainer));
    actions.append(btnMergeDown, btnMergeUp, btnUp, btnDown);

    // Chips + content
    const chips   = createElement("div", "meta-chips");
    applyChips(chips, record.classification);

    // IMPORTANT: div (not <p>) so tables/lists/headings render correctly
    const preview = createElement("div", "markdown-content");
    preview.innerHTML = marked.parse(record.markdownText);

    const editor  = createElement("textarea", "markdown-editor");
    editor.value  = record.markdownText;
    editor.setAttribute("rows", "1");
    autoResize(editor);

    enableClipboardImagePaste(editor);

    // Live preview
    editor.addEventListener("input", () => {
        autoResize(editor);
        preview.innerHTML = marked.parse(editor.value);
    });

    // Finalize on Enter (no Shift)
    editor.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            finalizeCard(card, notesContainer);
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
        const [mergeDown, mergeUp, up, down] = card.querySelectorAll(".action-button");
        const isFirst = index === 0;
        const isLast  = index === total - 1;

        show(mergeDown, !isLast);
        show(mergeUp,   isLast && total > 1);
        show(up,        !isFirst);
        show(down,      !isLast);
    });
}

/* ----------------- Internals ----------------- */

function button(label, handler) {
    const b = createElement("button", "action-button", label);
    // Prevent “blur finalize” mid-merge for merge buttons
    b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        mergeInProgress = true;
        try { handler(); } finally { setTimeout(() => (mergeInProgress = false), 50); }
    });
    if (!/Merge/.test(label)) b.addEventListener("click", (e) => { e.stopPropagation(); handler(); });
    return b;
}

function show(el, yes) { if (el) el.style.display = yes ? "block" : "none"; }

function enableInPlaceEditing(card, notesContainer) {
    if (currentEditingCard && currentEditingCard !== card && !mergeInProgress) {
        finalizeCard(currentEditingCard, notesContainer);
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

function finalizeCard(card, notesContainer) {
    if (!card || (currentEditingCard && currentEditingCard !== card) || mergeInProgress) return;
    if (!card.classList.contains("editing-in-place")) return;

    const editor  = card.querySelector(".markdown-editor");
    const preview = card.querySelector(".markdown-content");
    const text    = editor.value;
    const trimmed = text.trim();
    const was     = card.dataset.initialValue ?? text;
    const changed = text !== was; // only reorder/persist if user actually changed something

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
    preview.innerHTML = marked.parse(text);

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
        lastActivityIso: ts
    });

    const first = notesContainer.firstElementChild;
    if (first) notesContainer.insertBefore(card, first);

    GravityStore.syncFromDom(notesContainer);
    updateActionButtons(notesContainer);

    // Re-classify edited content
    triggerClassificationForCard(id, text, notesContainer);
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

    editorBelow.value = merged;
    previewBelow.innerHTML = marked.parse(merged);
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
        lastActivityIso: ts
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

    editorAbove.value = merged;
    previewAbove.innerHTML = marked.parse(merged);
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
        lastActivityIso: ts
    });

    GravityStore.syncFromDom(notesContainer);
    updateActionButtons(notesContainer);
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
