import { z } from "zod";

// ─── Pinboard Data Primitives ────────────────────────────────────────────────

/**
 * Pinboard v1 API uses "yes"/"no" strings for boolean fields.
 */
export const PinboardYesNoSchema = z
  .union([z.literal("yes"), z.literal("no"), z.boolean()])
  .transform((val): boolean => val === true || val === "yes");

/** Tag string without spaces. */
export const TagStringSchema = z.string().regex(/^\S+$/, "Tags cannot contain spaces");

/** Hex bookmark/note identifier. Not case-sensitive. */
export const HexIdSchema = z.string().regex(/^[0-9a-fA-F]+$/, "Must be a hex string");

// ─── Posts (Bookmarks) ───────────────────────────────────────────────────────

/**
 * A single Pinboard bookmark ("post"). Field names match the v1 JSON response.
 *
 * - `href`        – The bookmarked URL
 * - `description` – Title of the bookmark (confusingly named in the API)
 * - `extended`    – Free-form notes / body text
 * - `tag`         – Space-separated tag string as returned by the API
 * - `time`        – ISO 8601 creation timestamp
 * - `shared`      – "yes"/"no" — whether the bookmark is public
 * - `toread`      – "yes"/"no" — whether the bookmark is unread
 * - `hash`        – MD5 hash of the URL, uniquely identifies the bookmark
 * - `meta`        – Change-detection hash; changes when the post is updated
 */
export const PostSchema = z.object({
  href: z.string(),
  description: z.string().default(""),
  extended: z.string().default(""),
  /**
   * Tags are returned as a space-separated string in the v1 JSON API (field
   * name "tags", plural — distinct from the XML attribute "tag", singular).
   * We split into an array here for cleaner downstream consumption.
   */
  tags: z
    .string()
    .default("")
    .transform((val) => (val.trim() === "" ? [] : val.trim().split(/\s+/))),
  time: z.string().optional(),
  shared: PinboardYesNoSchema.optional(),
  toread: PinboardYesNoSchema.optional(),
  hash: z.string().optional(),
  meta: z.string().optional(),
  others: z.union([z.string(), z.number()]).optional(),
});

export type Post = z.infer<typeof PostSchema>;

/** Response envelope for posts/get and posts/recent */
export const PostsResponseSchema = z.object({
  date: z.string().optional(),
  user: z.string().optional(),
  posts: z.array(PostSchema).default([]),
});

export type PostsResponse = z.infer<typeof PostsResponseSchema>;

/** Response envelope for posts/all */
export const PostsAllResponseSchema = z.array(PostSchema);
export type PostsAllResponse = z.infer<typeof PostsAllResponseSchema>;

// ─── Result / Status ─────────────────────────────────────────────────────────

/**
 * The v1 API wraps mutation responses in:
 *   { "result_code": "done" }       on success
 *   { "result_code": "..." }        on failure
 *   { "result": "done" }            alternate shape used by some endpoints
 */
export const ResultResponseSchema = z.union([
  z.object({ result_code: z.string() }),
  z.object({ result: z.string() }),
]);

export type ResultResponse = z.infer<typeof ResultResponseSchema>;

// ─── Update ──────────────────────────────────────────────────────────────────

/** posts/update — returns the time of the last change to the user's bookmarks */
export const UpdateResponseSchema = z.object({
  update_time: z.string(),
});

export type UpdateResponse = z.infer<typeof UpdateResponseSchema>;

// ─── Tags ────────────────────────────────────────────────────────────────────

/** tags/get — returns a map of tag -> count */
export const TagsResponseSchema = z.record(z.string(), z.number());

export type TagsResponse = z.infer<typeof TagsResponseSchema>;

// ─── Notes ───────────────────────────────────────────────────────────────────

/** A single note in the notes/list response */
export const NoteListItemSchema = z.object({
  id: z.string(),
  hash: z.string().optional(),
  title: z.string().default(""),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  length: z.union([z.string(), z.number()]).optional(),
});

export type NoteListItem = z.infer<typeof NoteListItemSchema>;

/** notes/list response envelope */
export const NotesListResponseSchema = z.object({
  count: z.union([z.string(), z.number()]).optional(),
  notes: z.array(NoteListItemSchema).default([]),
});

export type NotesListResponse = z.infer<typeof NotesListResponseSchema>;

/** notes/ID response — individual note with text body */
export const NoteDetailSchema = NoteListItemSchema.extend({
  text: z.string().default(""),
});

export type NoteDetail = z.infer<typeof NoteDetailSchema>;
