// @ts-check

import { createClassifierClient } from "../../core/classifier.js?build=2026-01-01T22:43:21Z";
import { GravityStore } from "../../core/store.js?build=2026-01-01T22:43:21Z";
import { nowIso } from "../../utils/datetime.js?build=2026-01-01T22:43:21Z";
import { logging } from "../../utils/logging.js?build=2026-01-01T22:43:21Z";
import { createElement } from "../../utils/dom.js?build=2026-01-01T22:43:21Z";

/**
 * Request a classification refresh for a note and update its chips on success.
 * @param {import("../../core/config.js").AppConfig} config
 * @param {string} noteId
 * @param {string} text
 * @param {HTMLElement|null} notesContainer
 * @returns {void}
 */
export function triggerClassificationForCard(config, noteId, text, notesContainer) {
    const firstLine = text.split("\n").find((line) => line.trim().length > 0) || "";
    const title = firstLine.replace(/^#\s*/, "").slice(0, 120).trim();

    const client = createClassifierClient({ config });
    client.classifyOrFallback(title, text)
        .then((classification) => {
            const records = GravityStore.loadAllNotes();
            const record = records.find((candidate) => candidate.noteId === noteId);
            if (!record) return;
            record.classification = classification;
            record.lastActivityIso = nowIso();
            GravityStore.saveAllNotes(records);

            if (!notesContainer) return;
            const card = notesContainer.querySelector(`.markdown-block[data-note-id="${noteId}"]`);
            if (!(card instanceof HTMLElement)) {
                return;
            }
            const chips = card.querySelector(".meta-chips");
            applyChips(chips, classification);
        })
        .catch((error) => {
            logging.error(error);
        });
}

/**
 * Render note classification chips.
 * @param {Element|null} container
 * @param {import("../../types.d.js").NoteClassification|undefined} classification
 * @returns {void}
 */
export function applyChips(container, classification) {
    if (!(container instanceof Element)) {
        return;
    }
    container.innerHTML = "";
    if (!classification) return;
    const { category, privacy, status, tags } = classification;
    if (category) container.appendChild(chip(category, "meta-chip meta-chip--cat"));
    if (status) container.appendChild(chip(status, "meta-chip meta-chip--status"));
    if (privacy) container.appendChild(chip(privacy, "meta-chip meta-chip--privacy"));
    if (Array.isArray(tags)) tags.slice(0, 6).forEach((tag) => container.appendChild(chip(`#${tag}`, "meta-chip")));
}

function chip(text, className) {
    return createElement("span", className, text);
}
