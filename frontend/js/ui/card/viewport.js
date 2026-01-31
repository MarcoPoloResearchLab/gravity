// @ts-check

export const VIEWPORT_ANCHOR_MARGIN_PX = 24;
export const VIEWPORT_STABILITY_ATTEMPTS = 12;

/**
 * @typedef {{ top: number, bottom: number, height: number, viewportHeight: number }} ViewportAnchor
 */

/**
 * Clamp a numeric value into the provided range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    if (Number.isNaN(value)) {
        return min;
    }
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

/**
 * Capture basic viewport metrics for a card prior to layout changes.
 * @param {HTMLElement} card
 * @returns {ViewportAnchor|null}
 */
export function captureViewportAnchor(card) {
    if (!(card instanceof HTMLElement) || typeof window === "undefined") {
        return null;
    }
    const rect = card.getBoundingClientRect();
    const viewportHeight = typeof window.innerHeight === "number"
        ? window.innerHeight
        : document.documentElement?.clientHeight ?? 0;
    return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        viewportHeight
    };
}

/**
 * Decide whether a card should be centered when entering edit mode.
 * @param {ViewportAnchor|null} anchor
 * @returns {boolean}
 */
export function shouldCenterCard(anchor) {
    if (!anchor) {
        return true;
    }
    const viewportHeight = anchor.viewportHeight;
    if (viewportHeight <= 0) {
        return true;
    }
    const margin = Math.max(viewportHeight * 0.05, VIEWPORT_ANCHOR_MARGIN_PX);
    const effectiveViewportHeight = viewportHeight - margin * 2;
    const topThreshold = margin;
    if (!Number.isFinite(anchor.height) || anchor.height <= 0) {
        return anchor.top <= topThreshold;
    }
    if (effectiveViewportHeight <= 0 || anchor.height >= effectiveViewportHeight) {
        return false;
    }
    const bottomOverflow = Number.isFinite(anchor.bottom)
        && anchor.bottom >= viewportHeight + VIEWPORT_ANCHOR_MARGIN_PX;
    if (bottomOverflow) {
        return true;
    }
    return anchor.top <= topThreshold;
}

/**
 * Compute a centered top offset for a card given the viewport height.
 * @param {number} cardHeight
 * @param {number} viewportHeight
 * @returns {number}
 */
export function computeCenteredCardTop(cardHeight, viewportHeight) {
    if (!Number.isFinite(cardHeight) || !Number.isFinite(viewportHeight)) {
        return 0;
    }
    const minTop = VIEWPORT_ANCHOR_MARGIN_PX * -1;
    const maxTop = Math.max(viewportHeight - cardHeight - VIEWPORT_ANCHOR_MARGIN_PX, minTop);
    const centered = (viewportHeight - cardHeight) / 2;
    return clamp(centered, minTop, maxTop);
}

/**
 * Adjust the viewport so the provided card maintains its intended position.
 * @param {HTMLElement} card
 * @param {{ behavior?: "center"|"preserve", baselineTop?: number|null, anchor?: ViewportAnchor|null, attempts?: number, anchorCompensation?: boolean }} [options]
 * @returns {void}
 */
export function maintainCardViewport(card, options = {}) {
    if (!(card instanceof HTMLElement) || typeof window === "undefined") {
        return;
    }
    const {
        behavior = "preserve",
        anchor = null,
        baselineTop = null,
        attempts = VIEWPORT_STABILITY_ATTEMPTS,
        anchorCompensation = false
    } = options;
    const scroller = document.scrollingElement || document.documentElement || document.body;
    if (!(scroller instanceof HTMLElement)) {
        return;
    }
    let remaining = Math.max(attempts, 1);
    const adjust = () => {
        if (!card.isConnected) {
            return;
        }
        const viewportHeight = typeof window.innerHeight === "number"
            ? window.innerHeight
            : document.documentElement?.clientHeight ?? 0;
        if (viewportHeight <= 0) {
            return;
        }
        const rect = card.getBoundingClientRect();
        let targetTop;
        if (anchorCompensation && anchor && Number.isFinite(anchor.top)) {
            targetTop = anchor.top;
        } else if (behavior === "center") {
            targetTop = computeCenteredCardTop(rect.height, viewportHeight);
        } else if (anchor && typeof anchor === "object") {
            const anchorViewportHeight = Number.isFinite(anchor.viewportHeight) ? anchor.viewportHeight : viewportHeight;
            const margin = Math.max(anchorViewportHeight * 0.05, VIEWPORT_ANCHOR_MARGIN_PX);
            const anchoredToBottom = Number.isFinite(anchor.bottom)
                && Number.isFinite(anchor.top)
                && anchor.bottom >= anchorViewportHeight - margin
                && anchor.top >= margin;
            if (anchoredToBottom) {
                const bottomOffset = anchorViewportHeight - anchor.bottom;
                targetTop = viewportHeight - bottomOffset - rect.height;
            } else if (Number.isFinite(anchor.top)) {
                targetTop = anchor.top;
            } else if (typeof baselineTop === "number") {
                targetTop = baselineTop;
            } else {
                targetTop = rect.top;
            }
        } else if (typeof baselineTop === "number") {
            targetTop = baselineTop;
        } else {
            targetTop = rect.top;
        }
        const currentScroll = window.scrollY || window.pageYOffset || 0;
        const maxScroll = Math.max(0, scroller.scrollHeight - viewportHeight);
        const margin = Math.max(viewportHeight * 0.05, VIEWPORT_ANCHOR_MARGIN_PX);
        const minTop = margin * -1;
        const maxTop = Math.max(viewportHeight - rect.height - margin, minTop);
        let clampedTargetTop = targetTop;
        if (!anchorCompensation) {
            clampedTargetTop = clamp(targetTop, minTop, maxTop);
        }
        let delta = rect.top - clampedTargetTop;
        if (anchorCompensation && anchor && Number.isFinite(delta)) {
            const desiredScroll = currentScroll + delta;
            if (desiredScroll < 0 || desiredScroll > maxScroll) {
                delta = clamp(desiredScroll, 0, maxScroll) - currentScroll;
            }
        }
        if (Math.abs(delta) > 0.5) {
            const nextScroll = clamp(currentScroll + delta, 0, maxScroll);
            if (nextScroll !== currentScroll) {
                window.scrollTo(0, nextScroll);
            }
        }
        remaining -= 1;
        if (remaining > 0) {
            requestAnimationFrame(adjust);
        }
    };

    requestAnimationFrame(adjust);
}
