// @ts-check

import {
    LABEL_SIGN_OUT,
    LABEL_SIGN_IN_WITH_GOOGLE
} from "../constants.js";

/**
 * @typedef {{
 *   container: HTMLElement,
 *   buttonElement: HTMLElement,
 *   profileContainer: HTMLElement,
 *   displayNameElement: HTMLElement,
 *   emailElement: HTMLElement,
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
 *   clearError(): void,
 *   showUnavailable(message: string): void,
 *   clearAvailability(): void
 * }}
 */
export function initializeAuthControls(options) {
    const {
        container,
        buttonElement,
        profileContainer,
        displayNameElement,
        emailElement,
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
    if (!(emailElement instanceof HTMLElement)) {
        throw new Error("Auth controls require an email element.");
    }

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
            setStatus("error", message);
        },
        clearError() {
            clearStatus();
        },
        showUnavailable(message) {
            toggleButtonHostVisibility(true);
            buttonElement.dataset.googleSignIn = "unavailable";
            buttonElement.setAttribute("aria-disabled", "true");
            setStatus("unavailable", message);
        },
        clearAvailability() {
            clearAvailabilityIndicators();
        }
    });

    function showSignedOut() {
        profileContainer.hidden = true;
        toggleButtonHostVisibility(true);
        clearAvailabilityIndicators();
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
        clearAvailabilityIndicators();
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
        emailElement.textContent = "";
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
        if (user.email && user.email !== fallbackName) {
            emailElement.textContent = user.email;
            emailElement.hidden = false;
        } else if (user.email) {
            emailElement.textContent = user.email;
            emailElement.hidden = false;
        } else {
            emailElement.textContent = "";
            emailElement.hidden = true;
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

    /**
     * @param {"error"|"unavailable"} status
     * @param {string} message
     * @returns {void}
     */
    function setStatus(status, message) {
        if (!statusElement) {
            return;
        }
        statusElement.hidden = false;
        statusElement.setAttribute("aria-hidden", "false");
        statusElement.textContent = message;
        statusElement.dataset.status = status;
    }

    /**
     * @returns {void}
     */
    function clearStatus() {
        if (!statusElement) {
            return;
        }
        statusElement.hidden = true;
        statusElement.textContent = "";
        statusElement.setAttribute("aria-hidden", "true");
        delete statusElement.dataset.status;
    }

    /**
     * @returns {void}
     */
    function clearAvailabilityIndicators() {
        clearStatus();
        delete buttonElement.dataset.googleSignIn;
        buttonElement.removeAttribute("aria-disabled");
    }
}
