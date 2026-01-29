// @ts-check

/**
 * Profile field keys for multi-format support.
 * Profiles from different sources (Google, TAuth, mpr-ui) may use different field names.
 * @type {Readonly<{
 *   USER_ID: "user_id",
 *   USER_EMAIL: "user_email",
 *   DISPLAY: "display",
 *   USER_DISPLAY: "user_display",
 *   USER_DISPLAY_NAME: "user_display_name",
 *   AVATAR_URL: "avatar_url",
 *   USER_AVATAR_URL: "user_avatar_url"
 * }>}
 */
export const PROFILE_KEYS = Object.freeze({
    USER_ID: "user_id",
    USER_EMAIL: "user_email",
    DISPLAY: "display",
    USER_DISPLAY: "user_display",
    USER_DISPLAY_NAME: "user_display_name",
    AVATAR_URL: "avatar_url",
    USER_AVATAR_URL: "user_avatar_url"
});

/**
 * Keys to check for display name, in priority order.
 */
const DISPLAY_NAME_KEYS = Object.freeze([
    PROFILE_KEYS.DISPLAY,
    PROFILE_KEYS.USER_DISPLAY,
    PROFILE_KEYS.USER_DISPLAY_NAME,
    "name",
    "displayName",
    "given_name"
]);

/**
 * Keys to check for avatar URL, in priority order.
 */
const AVATAR_URL_KEYS = Object.freeze([
    PROFILE_KEYS.AVATAR_URL,
    PROFILE_KEYS.USER_AVATAR_URL,
    "picture",
    "avatarUrl",
    "photoURL"
]);

/**
 * Keys to check for user ID, in priority order.
 */
const USER_ID_KEYS = Object.freeze([
    PROFILE_KEYS.USER_ID,
    "id",
    "sub",
    "userId"
]);

/**
 * Keys to check for email, in priority order.
 */
const EMAIL_KEYS = Object.freeze([
    PROFILE_KEYS.USER_EMAIL,
    "email",
    "userEmail"
]);

/**
 * Select the first non-empty string value from a record using a list of keys.
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} keys
 * @returns {string|null}
 */
function selectString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}

/**
 * Normalize an auth profile from various sources to the mpr-ui compatible format.
 * This handles profiles from Google Identity Services, TAuth, and mpr-ui components.
 *
 * @param {unknown} profile - The profile object from any authentication source
 * @returns {{ user_id: string|null, user_email: string|null, display: string|null, avatar_url: string|null }|null}
 */
export function normalizeProfileForMprUi(profile) {
    if (!profile || typeof profile !== "object") {
        return null;
    }
    const record = /** @type {Record<string, unknown>} */ (profile);

    const userId = selectString(record, USER_ID_KEYS);
    const email = selectString(record, EMAIL_KEYS);
    const display = selectString(record, DISPLAY_NAME_KEYS) || email || userId;
    const avatarUrl = selectString(record, AVATAR_URL_KEYS);

    return {
        user_id: userId,
        user_email: email,
        display: display,
        avatar_url: avatarUrl
    };
}

/**
 * Normalize an auth profile to the Gravity app format.
 * This is used internally by app.js for sync manager and storage operations.
 *
 * @param {unknown} profile - The profile object from any authentication source
 * @returns {{ id: string|null, email: string|null, name: string|null, pictureUrl: string|null }|null}
 */
export function normalizeProfileForApp(profile) {
    if (!profile || typeof profile !== "object") {
        return null;
    }
    const record = /** @type {Record<string, unknown>} */ (profile);

    return {
        id: selectString(record, USER_ID_KEYS),
        email: selectString(record, EMAIL_KEYS),
        name: selectString(record, DISPLAY_NAME_KEYS),
        pictureUrl: selectString(record, AVATAR_URL_KEYS)
    };
}
