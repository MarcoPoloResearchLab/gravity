/* global DOMPurify, marked */
// @ts-check

const INLINE_CODE_PATTERN = /`[^`]+`/;
const FENCED_CODE_PATTERN = /(^|\n)\s*(```+|~~~+)/;
const SANITIZE_CONFIG = Object.freeze({
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "disabled", "aria-checked", "class"]
});

const EMPTY_MARKDOWN_FALLBACK = "";

/**
 * Render Markdown to sanitized HTML inside the provided HTML view container.
 * The sanitized markup is stored on the element for downstream consumers.
 *
 * @param {HTMLElement} container Target element that receives the HTML.
 * @param {string} markdownSource Markdown text to render.
 * @returns {string} Sanitized HTML string applied to the HTML view container.
 */
export function renderHtmlView(container, markdownSource) {
    if (!(container instanceof HTMLElement)) {
        return EMPTY_MARKDOWN_FALLBACK;
    }

    const sanitizedHtml = renderHtmlViewToString(markdownSource);
    container.innerHTML = sanitizedHtml;
    decorateTaskCheckboxes(container);
    return sanitizedHtml;
}

/**
 * Generate sanitized HTML for the provided markdown without mutating the DOM.
 * @param {string} markdownSource
 * @returns {string}
 */
export function renderHtmlViewToString(markdownSource) {
    const safeMarkdownSource = typeof markdownSource === "string" ? markdownSource : EMPTY_MARKDOWN_FALLBACK;
    const parsedHtml = typeof marked !== "undefined" && typeof marked.parse === "function"
        ? marked.parse(safeMarkdownSource)
        : safeMarkdownSource;
    return typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function"
        ? DOMPurify.sanitize(parsedHtml, SANITIZE_CONFIG)
        : parsedHtml;
}

/**
 * Retrieve the most recently rendered sanitized HTML from an HTML view container.
 *
 * @param {HTMLElement} container Target element to inspect.
 * @returns {string} Sanitized HTML string previously rendered for the element.
 */
/**
 * Retrieve the plain text representation of the most recently rendered HTML view.
 * @param {HTMLElement} container
 * @returns {string}
 */
export function getHtmlViewPlainText(container) {
    if (!(container instanceof HTMLElement)) {
        return EMPTY_MARKDOWN_FALLBACK;
    }

    return container.textContent ?? EMPTY_MARKDOWN_FALLBACK;
}

/**
 * @typedef {{ hasCode: boolean }} HtmlViewMeta
 */

/**
 * For the grid view we now surface the full markdown, letting CSS clamp the
 * viewport. This helper simply normalises metadata used for badges.
 * @param {string} markdownSource
 * @returns {{ htmlViewMarkdown: string, meta: HtmlViewMeta }}
 */
export function buildHtmlViewSource(markdownSource) {
    const safeSource = typeof markdownSource === "string" ? markdownSource : EMPTY_MARKDOWN_FALLBACK;
    return {
        htmlViewMarkdown: safeSource,
        meta: {
            hasCode: hasAnyCode(safeSource)
        }
    };
}

function hasAnyCode(source) {
    if (!source) {
        return false;
    }
    return INLINE_CODE_PATTERN.test(source) || FENCED_CODE_PATTERN.test(source);
}

function decorateTaskCheckboxes(container) {
    if (!(container instanceof HTMLElement)) {
        return;
    }
    const listItems = container.querySelectorAll("li");
    listItems.forEach((item) => {
        if (!(item instanceof HTMLElement)) {
            return;
        }
        const existingCheckbox = item.querySelector("input[type=\"checkbox\"]");
        if (existingCheckbox) {
            return;
        }
        const rawText = (item.textContent || "").trim();
        if (rawText !== "[ ]" && rawText.toLowerCase() !== "[x]") {
            return;
        }
        const checkbox = item.ownerDocument?.createElement("input");
        if (!(checkbox instanceof HTMLInputElement)) {
            return;
        }
        checkbox.type = "checkbox";
        if (rawText.toLowerCase() === "[x]") {
            checkbox.checked = true;
        }
        item.textContent = "";
        item.appendChild(checkbox);
    });
    const checkboxNodes = container.querySelectorAll("input");
    let taskIndex = 0;
    checkboxNodes.forEach((node) => {
        if (!(node instanceof HTMLInputElement)) {
            node.remove();
            return;
        }
        if ((node.getAttribute("type") || "").toLowerCase() !== "checkbox") {
            node.remove();
            return;
        }
        node.removeAttribute("disabled");
        node.removeAttribute("name");
        node.removeAttribute("value");
        node.setAttribute("data-task-index", String(taskIndex));
        node.classList.add("note-task-checkbox");
        node.tabIndex = -1;
        taskIndex += 1;
    });
}
