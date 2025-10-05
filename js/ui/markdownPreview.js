/* global DOMPurify, marked */
// @ts-check

import { DATA_ATTRIBUTE_RENDERED_HTML } from "../constants.js";

const PREVIEW_RENDERED_HTML_DATASET_KEY = DATA_ATTRIBUTE_RENDERED_HTML;
const EMPTY_MARKDOWN_FALLBACK = "";

/**
 * Render Markdown to sanitized HTML inside the provided preview element.
 * The sanitized HTML is also stored on the element for future access by
 * rendered-mode views or clipboard utilities.
 *
 * @param {HTMLElement} previewElement Target element that receives the HTML.
 * @param {string} markdownSource Markdown text to render.
 * @returns {string} Sanitized HTML string applied to the preview element.
 */
export function renderSanitizedMarkdown(previewElement, markdownSource) {
    if (!(previewElement instanceof HTMLElement)) {
        return EMPTY_MARKDOWN_FALLBACK;
    }

    const safeMarkdownSource = typeof markdownSource === "string" ? markdownSource : EMPTY_MARKDOWN_FALLBACK;
    const parsedHtml = typeof marked !== "undefined" && typeof marked.parse === "function"
        ? marked.parse(safeMarkdownSource)
        : safeMarkdownSource;
    const sanitizedHtml = typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function"
        ? DOMPurify.sanitize(parsedHtml)
        : parsedHtml;

    previewElement.innerHTML = sanitizedHtml;
    previewElement.dataset[PREVIEW_RENDERED_HTML_DATASET_KEY] = sanitizedHtml;
    return sanitizedHtml;
}

/**
 * Retrieve the most recently rendered sanitized HTML from a preview element.
 *
 * @param {HTMLElement} previewElement Target element to inspect.
 * @returns {string} Sanitized HTML string previously rendered for the element.
 */
export function getSanitizedRenderedHtml(previewElement) {
    if (!(previewElement instanceof HTMLElement)) {
        return EMPTY_MARKDOWN_FALLBACK;
    }

    return previewElement.dataset?.[PREVIEW_RENDERED_HTML_DATASET_KEY] ?? EMPTY_MARKDOWN_FALLBACK;
}

/**
 * Retrieve the plain text representation of the most recently rendered preview.
 * @param {HTMLElement} previewElement
 * @returns {string}
 */
export function getRenderedPlainText(previewElement) {
    if (!(previewElement instanceof HTMLElement)) {
        return EMPTY_MARKDOWN_FALLBACK;
    }

    return previewElement.textContent ?? EMPTY_MARKDOWN_FALLBACK;
}

export { PREVIEW_RENDERED_HTML_DATASET_KEY };
