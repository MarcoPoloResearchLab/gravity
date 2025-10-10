// @ts-check

/**
 * @typedef {{
 *   triggerElement: HTMLElement,
 *   menuElement: HTMLElement,
 *   onOpen?: () => void,
 *   onClose?: () => void
 * }} AvatarMenuOptions
 */

/**
 * Create an imperative controller for the avatar dropdown menu.
 * @param {AvatarMenuOptions} options
 * @returns {{
 *   setEnabled(isEnabled: boolean): void,
 *   close(options?: { focusTrigger?: boolean }): void,
 *   dispose(): void
 * }}
 */
export function createAvatarMenu(options) {
    const { triggerElement, menuElement, onOpen, onClose } = options;

    if (!(triggerElement instanceof HTMLElement)) {
        throw new Error("Avatar menu requires a trigger element.");
    }
    if (!(menuElement instanceof HTMLElement)) {
        throw new Error("Avatar menu requires a menu element.");
    }

    let isEnabled = false;
    let isOpen = false;
    let documentBound = false;

    menuElement.hidden = true;
    menuElement.dataset.open = "false";
    triggerElement.setAttribute("aria-expanded", "false");
    triggerElement.dataset.open = "false";
    menuElement.tabIndex = -1;

    const handleTriggerClick = /** @param {MouseEvent} event */ (event) => {
        if (!isEnabled) return;
        event.preventDefault();
        if (isOpen) {
            closeMenu({ focusTrigger: false });
        } else {
            openMenu();
        }
    };

    const handleTriggerKeyDown = /** @param {KeyboardEvent} event */ (event) => {
        if (!isEnabled) return;
        const openKey = event.key === "Enter" || event.key === " ";
        const arrowDownKey = event.key === "ArrowDown";
        if (openKey || arrowDownKey) {
            event.preventDefault();
            if (!isOpen) {
                openMenu();
            }
            focusFirstItem();
        }
    };

    const handleMenuKeyDown = /** @param {KeyboardEvent} event */ (event) => {
        if (!isOpen) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu({ focusTrigger: true });
        }
    };

    const handleDocumentPointerDown = /** @param {PointerEvent} event */ (event) => {
        if (!isOpen) return;
        const target = /** @type {Node|null} */ (event.target ?? null);
        if (!target) return;
        if (menuElement.contains(target) || triggerElement.contains(target)) {
            return;
        }
        closeMenu({ focusTrigger: false });
    };

    const handleDocumentFocusIn = /** @param {FocusEvent} event */ (event) => {
        if (!isOpen) return;
        const target = /** @type {Node|null} */ (event.target ?? null);
        if (!target) return;
        if (menuElement.contains(target) || triggerElement.contains(target)) {
            return;
        }
        closeMenu({ focusTrigger: false });
    };

    triggerElement.addEventListener("click", handleTriggerClick);
    triggerElement.addEventListener("keydown", handleTriggerKeyDown);
    menuElement.addEventListener("keydown", handleMenuKeyDown);

    return Object.freeze({
        setEnabled(value) {
            const nextEnabled = value === true;
            if (!nextEnabled) {
                closeMenu({ focusTrigger: false });
                triggerElement.dataset.open = "false";
                triggerElement.setAttribute("aria-expanded", "false");
                triggerElement.setAttribute("aria-disabled", "true");
            }
            if (nextEnabled) {
                triggerElement.removeAttribute("aria-disabled");
                triggerElement.dataset.open = "false";
                triggerElement.setAttribute("aria-expanded", "false");
            }
            isEnabled = nextEnabled;
        },
        close(options) {
            closeMenu({
                focusTrigger: Boolean(options?.focusTrigger)
            });
        },
        dispose() {
            closeMenu({ focusTrigger: false });
            removeDocumentListeners();
            triggerElement.removeEventListener("click", handleTriggerClick);
            triggerElement.removeEventListener("keydown", handleTriggerKeyDown);
            menuElement.removeEventListener("keydown", handleMenuKeyDown);
        }
    });

    /**
     * @returns {void}
     */
    function openMenu() {
        if (!isEnabled || isOpen) {
            return;
        }
        isOpen = true;
        menuElement.hidden = false;
        menuElement.dataset.open = "true";
        triggerElement.dataset.open = "true";
        triggerElement.setAttribute("aria-expanded", "true");
        bindDocumentListeners();
        if (typeof onOpen === "function") {
            onOpen();
        }
    }

    /**
     * @param {{ focusTrigger: boolean }} options
     * @returns {void}
     */
    function closeMenu(options) {
        menuElement.hidden = true;
        menuElement.dataset.open = "false";
        triggerElement.dataset.open = "false";
        triggerElement.setAttribute("aria-expanded", "false");
        if (!isOpen) {
            return;
        }
        isOpen = false;
        removeDocumentListeners();
        if (options.focusTrigger) {
            focusTrigger();
        }
        if (typeof onClose === "function") {
            onClose();
        }
    }

    /**
     * @returns {void}
     */
    function bindDocumentListeners() {
        if (documentBound || typeof document === "undefined") {
            return;
        }
        document.addEventListener("pointerdown", handleDocumentPointerDown, true);
        document.addEventListener("focusin", handleDocumentFocusIn, true);
        documentBound = true;
    }

    /**
     * @returns {void}
     */
    function removeDocumentListeners() {
        if (!documentBound || typeof document === "undefined") {
            return;
        }
        document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
        document.removeEventListener("focusin", handleDocumentFocusIn, true);
        documentBound = false;
    }

    /**
     * @returns {void}
     */
    function focusFirstItem() {
        const selector = [
            "button:not([disabled]):not([hidden])",
            "[href]:not([aria-disabled='true'])",
            "[tabindex]:not([tabindex='-1'])"
        ].join(", ");
        const candidate = menuElement.querySelector(selector);
        if (candidate instanceof HTMLElement) {
            candidate.focus();
            return;
        }
        menuElement.focus();
    }

    /**
     * @returns {void}
     */
    function focusTrigger() {
        if (triggerElement instanceof HTMLElement) {
            triggerElement.focus();
        }
    }
}
