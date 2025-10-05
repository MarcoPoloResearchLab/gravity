// @ts-check

export const LABEL_EXPORT_NOTES = "Export";
export const LABEL_IMPORT_NOTES = "Import";
export const LABEL_MERGE_DOWN = "Merge ↓";
export const LABEL_MERGE_UP = "Merge ↑";
export const LABEL_MOVE_UP = "▲";
export const LABEL_MOVE_DOWN = "▼";
export const LABEL_DELETE_NOTE = "🗑️";
export const LABEL_COPY_NOTE = "📋";
export const LABEL_EDIT_MARKDOWN = "Edit (Markdown)";
export const LABEL_VIEW_RENDERED = "View (Rendered)";
export const LABEL_NEW_NOTE = "New note";
export const LABEL_APP_TITLE = "Gravity Notes";
export const LABEL_APP_SUBTITLE = "Append anywhere · Bubble to top · Auto-organize";
export const ARIA_LABEL_NEW_NOTE = "New note";
export const ARIA_LABEL_COPY_MARKDOWN = "Copy Markdown";
export const ARIA_LABEL_COPY_RENDERED = "Copy Rendered HTML";
export const BADGE_LABEL_CODE = "code";
export const LABEL_EXPAND_NOTE = "Expand note";
export const LABEL_COLLAPSE_NOTE = "Collapse note";

export const MESSAGE_NOTE_SAVED = "Saved";

export const FILENAME_EXPORT_NOTES_JSON = "gravity-notes.json";
export const ACCEPT_IMPORT_NOTES_JSON = "application/json";

export const ERROR_IMPORT_INVALID_PAYLOAD = "Imported file must contain a JSON array of notes.";
export const ERROR_IMPORT_READ_FAILED = "Unable to read the selected import file.";
export const ERROR_NOTES_CONTAINER_NOT_FOUND = "Notes container not found";
export const ERROR_CLIPBOARD_COPY_FAILED = "Clipboard copy failed";
export const ERROR_IMAGE_READ_FAILED = "Failed to read pasted image";
export const ERROR_TOP_EDITOR_NOT_FOUND = "Top editor host not found";

export const CLIPBOARD_MIME_NOTE = "application/x-gravity-note+json";
export const CLIPBOARD_DATA_ATTRIBUTE = "data-gravity-note-payload";
export const CLIPBOARD_METADATA_VERSION = 1;
export const CLIPBOARD_METADATA_DATA_URL_PREFIX = `data:${CLIPBOARD_MIME_NOTE};base64,`;
export const MESSAGE_NOTE_COPIED = "Copied to clipboard";
export const PASTED_IMAGE_ALT_TEXT_PREFIX = "Pasted image";

export const CLASSIFIER_ALLOWED_HANDLES = Object.freeze(["@self", "@alice", "@peter", "@nat"]);
export const CLASSIFIER_KNOWN_PROJECTS = Object.freeze(["Moving Maps", "Blanket"]);
export const CLASSIFIER_KNOWN_AREAS = Object.freeze(["Finance", "Infra", "Health", "Family Ops"]);
export const CLASSIFIER_CATEGORIES = Object.freeze(["Projects", "Areas", "Knowledge", "Journal", "Content", "People"]);
export const CLASSIFIER_STATUSES = Object.freeze(["idea", "draft", "final", "published", "blocked"]);
export const CLASSIFIER_PRIVACY = Object.freeze(["private", "shareable", "public"]);

export const DATA_ATTRIBUTE_RENDERED_HTML = "renderedHtml";
export const DATA_URL_PREFIX = "data:";
