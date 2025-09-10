export function nowIso() { return new Date().toISOString(); }

export function generateNoteId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const randomSegment = Math.random().toString(36).slice(2, 10);
    return `n-${Date.now()}-${randomSegment}`;
}

export function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
}

export function autoResize(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 5}px`;
}

export function clampEnum(value, allowed, fallback) {
    return (typeof value === "string" && allowed.includes(value)) ? value : fallback;
}

export function titleCase(text) {
    if (typeof text !== "string" || !text) return "";
    return text.toLowerCase().split(" ").filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function toTagToken(text) {
    if (typeof text !== "string") return "";
    return text.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "");
}
