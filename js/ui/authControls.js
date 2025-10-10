// @ts-check

import {
    LABEL_AUTH_STATUS_SIGNED_IN,
    LABEL_AUTH_STATUS_SIGNED_OUT,
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
 *   onSignOutRequested?: () => void
 * }} AuthControlsOptions
 */

/**
 * Initialize the auth controls block and return setters for downstream consumers.
 * @param {AuthControlsOptions} options
 * @returns {{
 *   getButtonHost(): HTMLElement,
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
        emailElement,
        avatarElement = null,
        statusElement = null,
        signOutButton = null,
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
        statusElement.textContent = LABEL_AUTH_STATUS_SIGNED_OUT;
    }

    buttonElement.hidden = false;
    buttonElement.setAttribute("aria-label", LABEL_SIGN_IN_WITH_GOOGLE);

    showSignedOut();

    return Object.freeze({
        getButtonHost() {
            return buttonElement;
        },
        showSignedOut,
        showSignedIn,
        showError(message) {
            if (statusElement) {
                statusElement.textContent = message;
                statusElement.dataset.status = "error";
            }
        },
        clearError() {
            if (statusElement) {
                statusElement.textContent = LABEL_AUTH_STATUS_SIGNED_OUT;
                delete statusElement.dataset.status;
            }
        }
    });

    function showSignedOut() {
        profileContainer.hidden = true;
        buttonElement.hidden = false;
        if (statusElement) {
            statusElement.textContent = LABEL_AUTH_STATUS_SIGNED_OUT;
            statusElement.dataset.status = "signed-out";
        }
        if (signOutButton) {
            signOutButton.hidden = true;
        }
        clearProfile();
    }

    /**
     * @param {{ id: string, email: string|null, name: string|null, pictureUrl: string|null }} user
     * @returns {void}
     */
    function showSignedIn(user) {
        profileContainer.hidden = false;
        buttonElement.hidden = true;
        if (signOutButton) {
            signOutButton.hidden = false;
        }
        if (statusElement) {
            statusElement.textContent = LABEL_AUTH_STATUS_SIGNED_IN;
            statusElement.dataset.status = "signed-in";
        }
        applyProfile(user);
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
}
