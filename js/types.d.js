// @ts-check

/**
 * @typedef {Object} AttachmentRecord
 * @property {string} dataUrl
 * @property {string} altText
 */

/**
 * @typedef {Object} NoteClassification
 * @property {string} category
 * @property {string|null} project_name
 * @property {string[]} areas
 * @property {string[]} people_handles
 * @property {string} status
 * @property {string} privacy
 * @property {string[]} tags
 * @property {string} occurred_at
 */

/**
 * @typedef {Object} NoteRecord
 * @property {string} noteId
 * @property {string} markdownText
 * @property {string} createdAtIso
 * @property {string} updatedAtIso
 * @property {string} lastActivityIso
 * @property {NoteClassification=} classification
 * @property {Record<string, AttachmentRecord>=} attachments
 */

export {};
