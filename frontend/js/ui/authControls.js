// @ts-check

import {
    LABEL_SIGN_OUT,
    LABEL_SIGN_IN_WITH_GOOGLE
} from "../constants.js?build=2024-10-05T12:00:00Z";

/**
 * @typedef {{
 *   container: HTMLElement,
 *   buttonElement: HTMLElement,
 *   profileContainer: HTMLElement,
 *   displayNameElement: HTMLElement,
 *   emailElement?: HTMLElement | null,
 *   avatarElement?: HTMLImageElement | null,
 *   statusElement?: HTMLElement | null,
 *   signOutButton?: HTMLButtonElement | null,
 *   menuWrapper?: HTMLElement | null,
 *   onSignOutRequested?: () => void
 * }} AuthControlsOptions
 */

/**
 * Initialize the auth controls block and return setters for downstream consumers.
 * @param {AuthControlsOptions} options
 * @returns {{
 *   getButtonHost(): HTMLElement,
 *   setButtonHostVisibility(isVisible: boolean): void,
 *   showSignedOut(): void,
 *   showSignedIn(user: { id: string, email: string|null, name: string|null, pictureUrl: string|null }): void,
 *   showError(message: string): void,
 *   clearError(): void
 * }}
 */
export function initializeAuthControls(options) {
    const {
        container,
        buttonElement,
        profileContainer,
        displayNameElement,
        emailElement = null,
        avatarElement = null,
        statusElement = null,
        signOutButton = null,
        menuWrapper = null,
        onSignOutRequested
    } = options;

    if (!(container instanceof HTMLElement)) {
        throw new Error("Auth controls require a container element.");
    }
    if (!(buttonElement instanceof HTMLElement)) {
        throw new Error("Auth controls require a button host element.");
    }
    if (!(profileContainer instanceof HTMLElement)) {
        throw new Error("Auth controls require a profile container element.");
    }
    if (!(displayNameElement instanceof HTMLElement)) {
        throw new Error("Auth controls require a display name element.");
    }
    const resolvedEmailElement = emailElement instanceof HTMLElement ? emailElement : null;

    const buttonParent = buttonElement.parentElement instanceof HTMLElement
        ? buttonElement.parentElement
        : container;
    const buttonAnchor = buttonElement.nextSibling;
    let buttonMounted = true;

    const signOutHandler = () => {
        if (typeof onSignOutRequested === "function") {
            onSignOutRequested();
        }
    };
    if (signOutButton instanceof HTMLButtonElement) {
        signOutButton.hidden = true;
        signOutButton.type = "button";
        signOutButton.textContent = LABEL_SIGN_OUT;
        signOutButton.addEventListener("click", (event) => {
            event.preventDefault();
            signOutHandler();
        });
    }

    if (statusElement) {
        statusElement.textContent = "";
        statusElement.hidden = true;
        statusElement.setAttribute("aria-hidden", "true");
        delete statusElement.dataset.status;
    }

    buttonElement.hidden = false;
    buttonElement.setAttribute("aria-label", LABEL_SIGN_IN_WITH_GOOGLE);

    showSignedOut();

    return Object.freeze({
        getButtonHost() {
            return buttonElement;
        },
        setButtonHostVisibility(isVisible) {
            toggleButtonHostVisibility(Boolean(isVisible));
        },
        showSignedOut,
        showSignedIn,
        showError(message) {
            if (statusElement) {
                statusElement.hidden = false;
                statusElement.setAttribute("aria-hidden", "false");
                statusElement.textContent = message;
                statusElement.dataset.status = "error";
            }
        },
        clearError() {
            if (statusElement) {
                statusElement.hidden = true;
                statusElement.textContent = "";
                statusElement.setAttribute("aria-hidden", "true");
                delete statusElement.dataset.status;
            }
        }
    });

    function showSignedOut() {
        profileContainer.hidden = true;
        toggleButtonHostVisibility(true);
        if (statusElement) {
            statusElement.hidden = true;
            statusElement.textContent = "";
            statusElement.setAttribute("aria-hidden", "true");
            delete statusElement.dataset.status;
        }
        if (signOutButton) {
            signOutButton.hidden = true;
        }
        if (menuWrapper) {
            menuWrapper.hidden = true;
        }
        clearProfile();
    }

    /**
     * @param {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }} user
     * @returns {void}
     */
    function showSignedIn(user) {
        profileContainer.hidden = false;
        toggleButtonHostVisibility(false);
        if (signOutButton) {
            signOutButton.hidden = false;
        }
        if (menuWrapper) {
            menuWrapper.hidden = false;
        }
        if (statusElement) {
            statusElement.hidden = true;
            statusElement.textContent = "";
            statusElement.setAttribute("aria-hidden", "true");
            delete statusElement.dataset.status;
        }
        applyProfile(user);
    }

    /**
     * @param {boolean} isVisible
     * @returns {void}
     */
    function toggleButtonHostVisibility(isVisible) {
        if (isVisible) {
            if (!buttonMounted && buttonParent) {
                if (buttonAnchor && buttonAnchor.parentNode === buttonParent) {
                    buttonParent.insertBefore(buttonElement, buttonAnchor);
                } else {
                    buttonParent.appendChild(buttonElement);
                }
                buttonMounted = true;
            }
            buttonElement.hidden = false;
            buttonElement.removeAttribute("aria-hidden");
            buttonElement.dataset.visibility = "visible";
        } else {
            buttonElement.hidden = true;
            buttonElement.setAttribute("aria-hidden", "true");
            buttonElement.dataset.visibility = "hidden";
            if (buttonMounted) {
                buttonElement.remove();
                buttonMounted = false;
            }
        }
    }

    function clearProfile() {
        displayNameElement.textContent = "";
        if (resolvedEmailElement) {
            resolvedEmailElement.textContent = "";
            resolvedEmailElement.hidden = true;
        }
        if (avatarElement) {
            avatarElement.hidden = true;
            avatarElement.removeAttribute("src");
            avatarElement.removeAttribute("alt");
        }
    }

    /**
     * @param {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }} user
     * @returns {void}
     */
    function applyProfile(user) {
        const fallbackName = user.name || user.email || user.id;
        displayNameElement.textContent = fallbackName;
        if (resolvedEmailElement) {
            resolvedEmailElement.textContent = "";
            resolvedEmailElement.hidden = true;
        }
        if (avatarElement) {
            if (user.pictureUrl) {
                avatarElement.hidden = false;
                avatarElement.src = user.pictureUrl;
                avatarElement.alt = fallbackName;
                avatarElement.referrerPolicy = "no-referrer";
            } else {
                avatarElement.hidden = true;
                avatarElement.removeAttribute("src");
                avatarElement.removeAttribute("alt");
            }
        }
    }
}
