// @ts-check

import { createElement } from "../utils/dom.js?build=2024-10-05T12:00:00Z";
import {
    LABEL_KEYBOARD_SHORTCUTS,
    LABEL_CLOSE_KEYBOARD_SHORTCUTS,
    LABEL_SHORTCUT_SAVE_NOTE,
    LABEL_SHORTCUT_SOFT_BREAK,
    LABEL_SHORTCUT_INDENT,
    LABEL_SHORTCUT_OUTDENT,
    LABEL_SHORTCUT_NAVIGATE_PREVIOUS,
    LABEL_SHORTCUT_NAVIGATE_NEXT,
    LABEL_SHORTCUT_OPEN_HELP,
    LABEL_SHORTCUT_DELETE_LINE,
    LABEL_SHORTCUT_DUPLICATE_LINE
} from "../constants.js?build=2024-10-05T12:00:00Z";

const OVERLAY_CLASS = "keyboard-shortcuts-overlay";
const MODAL_CLASS = "keyboard-shortcuts-modal";
const TITLE_CLASS = "keyboard-shortcuts-title";
const CLOSE_BUTTON_CLASS = "keyboard-shortcuts-close";
const LIST_CLASS = "keyboard-shortcuts-list";
const ITEM_CLASS = "keyboard-shortcut";
const DESCRIPTION_CLASS = "keyboard-shortcut-description";
const KEYS_CLASS = "keyboard-shortcut-keys";
const KEYS_GROUP_CLASS = "keyboard-shortcut-keys-group";
const KEYS_PLUS_CLASS = "keyboard-shortcut-keys-plus";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** @returns {boolean} */
function detectMacPlatform() {
    if (typeof navigator === "undefined") {
        return false;
    }
    const platform = navigator.platform || navigator.userAgentData?.platform || navigator.userAgent || "";
    return /mac|ipad|iphone|ipod/i.test(platform);
}

/**
 * Initialize the global keyboard shortcuts modal.
 * @returns {void}
 */
export function initializeKeyboardShortcutsModal() {
    if (typeof document === "undefined" || typeof window === "undefined") {
        return;
    }

    let overlay = null;
    let isOpen = false;
    let lastFocusedElement = /** @type {HTMLElement|null} */ (null);
    let previousBodyOverflow = "";

    const isMac = detectMacPlatform();
    const primaryKeyLabel = isMac ? "⌘" : "Ctrl";

    /** @type {Record<string, string>} */
    const keyLabelMap = {
        primary: primaryKeyLabel,
        Shift: "Shift",
        Enter: "Enter",
        Tab: "Tab",
        ArrowUp: "↑",
        ArrowDown: "↓",
        S: "S",
        D: "D",
        F1: "F1"
    };

    const shortcutDefinitions = Object.freeze([
        { label: LABEL_SHORTCUT_SAVE_NOTE, combos: [ ["primary", "Enter"], ["primary", "S"] ] },
        { label: LABEL_SHORTCUT_SOFT_BREAK, combos: [ ["Shift", "Enter"] ] },
        { label: LABEL_SHORTCUT_INDENT, combos: [ ["Tab"] ] },
        { label: LABEL_SHORTCUT_OUTDENT, combos: [ ["Shift", "Tab"] ] },
        { label: LABEL_SHORTCUT_DELETE_LINE, combos: [ ["primary", "Shift", "K"] ] },
        { label: LABEL_SHORTCUT_DUPLICATE_LINE, combos: [ ["primary", "Shift", "D"] ] },
        { label: LABEL_SHORTCUT_NAVIGATE_PREVIOUS, combos: [ ["ArrowUp"] ] },
        { label: LABEL_SHORTCUT_NAVIGATE_NEXT, combos: [ ["ArrowDown"] ] },
        { label: LABEL_SHORTCUT_OPEN_HELP, combos: [ ["F1"] ] }
    ]);

    const ensureOverlay = () => {
        if (overlay) {
            return overlay;
        }
        overlay = buildOverlay();
        document.body.appendChild(overlay);
        return overlay;
    };

    const openModal = () => {
        const element = ensureOverlay();
        if (isOpen) {
            return;
        }
        isOpen = true;
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        previousBodyOverflow = document.body.style.overflow;
        document.body.classList.add("keyboard-shortcuts-open");
        document.body.style.overflow = "hidden";
        element.hidden = false;
        const closeButton = element.querySelector(`.${CLOSE_BUTTON_CLASS}`);
        if (closeButton instanceof HTMLElement) {
            closeButton.focus();
        }
    };

    const closeModal = () => {
        if (!overlay || !isOpen) {
            return;
        }
        overlay.hidden = true;
        isOpen = false;
        document.body.classList.remove("keyboard-shortcuts-open");
        document.body.style.overflow = previousBodyOverflow;
        if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
            lastFocusedElement.focus({ preventScroll: true });
        }
    };

    const buildOverlay = () => {
        const overlayElement = createElement("div", OVERLAY_CLASS);
        overlayElement.setAttribute("role", "dialog");
        overlayElement.setAttribute("aria-modal", "true");
        overlayElement.hidden = true;

        const modal = createElement("div", MODAL_CLASS);

        const title = createElement("h2", TITLE_CLASS, LABEL_KEYBOARD_SHORTCUTS);
        title.id = "keyboard-shortcuts-title";
        modal.appendChild(title);

        const closeButton = createElement("button", CLOSE_BUTTON_CLASS, "×");
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", LABEL_CLOSE_KEYBOARD_SHORTCUTS);
        closeButton.addEventListener("click", () => closeModal());
        modal.appendChild(closeButton);

        const list = createElement("ul", LIST_CLASS);
        for (const definition of shortcutDefinitions) {
            const item = createElement("li", ITEM_CLASS);
            const description = createElement("p", DESCRIPTION_CLASS, definition.label);
            const keyContainer = createElement("div", KEYS_CLASS);

            definition.combos.forEach((combo, index) => {
                const group = createElement("span", KEYS_GROUP_CLASS);
                combo.forEach((token, tokenIndex) => {
                    if (tokenIndex > 0) {
                        const plus = createElement("span", KEYS_PLUS_CLASS, "+");
                        group.appendChild(plus);
                    }
                    group.appendChild(createElement("kbd", "", getKeyLabel(token)));
                });
                keyContainer.appendChild(group);
                if (index < definition.combos.length - 1) {
                    const spacer = createElement("span", KEYS_PLUS_CLASS, "/");
                    spacer.setAttribute("aria-hidden", "true");
                    keyContainer.appendChild(spacer);
                }
            });

            item.appendChild(description);
            item.appendChild(keyContainer);
            list.appendChild(item);
        }

        modal.appendChild(list);
        overlayElement.appendChild(modal);

        overlayElement.addEventListener("click", (event) => {
            if (event.target === overlayElement) {
                closeModal();
            }
        });

        overlayElement.addEventListener("keydown", (event) => {
            if (event.key === "Tab") {
                handleFocusTrap(event, overlayElement);
            }
        });

        return overlayElement;
    };

    const getKeyLabel = (token) => keyLabelMap[token] ?? token.toUpperCase();

    const handleFocusTrap = (event, container) => {
        const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => element instanceof HTMLElement);
        if (focusable.length === 0) {
            event.preventDefault();
            return;
        }
        const first = /** @type {HTMLElement} */ (focusable[0]);
        const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);
        const active = document.activeElement;
        if (event.shiftKey) {
            if (active === first || !container.contains(active)) {
                event.preventDefault();
                last.focus();
            }
        } else if (active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    document.addEventListener("keydown", (event) => {
        if (event.key === "F1" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            openModal();
            return;
        }
        if (event.key === "Escape" && isOpen) {
            event.preventDefault();
            closeModal();
        }
    });

    window.addEventListener("blur", () => {
        if (isOpen && document.visibilityState === "hidden") {
            closeModal();
        }
    });
}
