// @ts-check

const BASE64_CHUNK_SIZE = 16384;
const EMPTY_UINT8_ARRAY = new Uint8Array(0);

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase64(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new Error("base64.encode.invalid_bytes");
    }
    if (bytes.length === 0) {
        return "";
    }
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    if (typeof btoa !== "function") {
        throw new Error("base64.encode.unavailable");
    }
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
        const slice = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);
        binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function decodeBase64(value) {
    if (typeof value !== "string" || value.length === 0) {
        return EMPTY_UINT8_ARRAY;
    }
    if (typeof Buffer !== "undefined") {
        return Uint8Array.from(Buffer.from(value, "base64"));
    }
    if (typeof atob !== "function") {
        throw new Error("base64.decode.unavailable");
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
