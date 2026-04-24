#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import { PinboardClient } from "./pinboard-client.js";
import { HexIdSchema, TagStringSchema } from "./pinboard-types.js";

dotenv.config({ override: false });

const apiToken = process.env.PINBOARD_API_TOKEN;

if (!apiToken) {
  console.error("Error: Missing required environment variable PINBOARD_API_TOKEN");
  console.error("Please set PINBOARD_API_TOKEN in your .env file (format: username:HEXTOKEN)");
  process.exit(1);
}

const pinboard = new PinboardClient(apiToken);

const server = new McpServer({
  name: "local-pinboard-mcp",
  version: "1.0.0",
});

let initPromise: Promise<void> | null = null;

/**
 * Verifies connectivity on first tool call. Resets on failure so the next
 * call will retry. Subsequent successful calls are no-ops.
 */
async function ensureInitialized() {
  if (!initPromise) {
    initPromise = pinboard
      .getLastUpdate()
      .then(() => {
        console.error("Pinboard client initialized — credentials verified.");
      })
      .catch((error) => {
        console.error("Failed to verify Pinboard credentials:", error);
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

// ─── Posts (Bookmarks) ───────────────────────────────────────────────────────

// 1. Get Recent Posts
server.registerTool(
  "get_recent_posts",
  {
    description:
      "List your most recent Pinboard bookmarks, optionally filtered by up to three tags. RATE LIMIT: once per minute.",
    inputSchema: z.object({
      tag: z
        .array(TagStringSchema)
        .max(3)
        .optional()
        .describe("Filter by up to 3 tags."),
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results (default 15, max 100)."),
    }),
  },
  async ({ tag, count }) => {
    try {
      await ensureInitialized();
      const posts = await pinboard.getRecentPosts({ tag, count });
      return {
        content: [{ type: "text", text: JSON.stringify(posts, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 2. Get Posts (by tag, date, or URL)
server.registerTool(
  "get_posts",
  {
    description:
      "Retrieve bookmarks matching a tag, a specific date (YYYY-MM-DD), or a specific URL. If no filter is given, returns posts from the most recent bookmark date. RATE LIMIT: 1 call per 3 seconds.",
    inputSchema: z.object({
      tag: z
        .array(TagStringSchema)
        .max(3)
        .optional()
        .describe("Filter by up to 3 tags."),
      dt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .optional()
        .describe("Return posts added on this date (YYYY-MM-DD)."),
      url: z.string().url().optional().describe("Return the post for this exact URL."),
      meta: z.boolean().optional().describe("Include change-detection metadata hash."),
    }),
  },
  async ({ tag, dt, url, meta }) => {
    try {
      await ensureInitialized();
      const posts = await pinboard.getPosts({ tag, dt, url, meta });
      if (posts.length === 0) {
        return { content: [{ type: "text", text: "No bookmarks matched the filter." }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(posts, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 3. Get All Posts
server.registerTool(
  "get_all_posts",
  {
    description:
      "Retrieve all bookmarks in your Pinboard account. Supports tag filtering and pagination. RATE LIMIT: once every 5 minutes — use get_recent_posts or get_posts for frequent queries.",
    inputSchema: z.object({
      tag: z
        .array(TagStringSchema)
        .max(3)
        .optional()
        .describe("Filter by up to 3 tags."),
      start: z.number().int().min(0).optional().describe("Offset for pagination."),
      results: z.number().int().min(1).optional().describe("Maximum number of posts to return."),
      fromdt: z
        .string()
        .optional()
        .describe("Return only posts created after this datetime (UTC ISO 8601)."),
      todt: z
        .string()
        .optional()
        .describe("Return only posts created before this datetime (UTC ISO 8601)."),
    }),
  },
  async ({ tag, start, results, fromdt, todt }) => {
    try {
      await ensureInitialized();
      const posts = await pinboard.getAllPosts({ tag, start, results, fromdt, todt });
      return {
        content: [{ type: "text", text: JSON.stringify(posts, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 4. Add Post
server.registerTool(
  "add_post",
  {
    description:
      "Add or replace a bookmark on Pinboard. URL and title are required. By default, replaces any existing bookmark for the same URL.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to bookmark."),
      title: z.string().min(1).describe("Title of the bookmark."),
      description: z.string().optional().describe("Extended notes or description."),
      tags: z
        .array(TagStringSchema)
        .optional()
        .describe("Tags to apply. Tags beginning with '.' are private."),
      shared: z
        .boolean()
        .optional()
        .describe("Set to false to make the bookmark private. Defaults to account setting."),
      toread: z.boolean().optional().describe("Set to true to mark as unread/to-read."),
      replace: z
        .boolean()
        .optional()
        .describe("Set to false to skip if a bookmark for this URL already exists. Default: true."),
      dt: z
        .string()
        .optional()
        .describe("Creation timestamp in UTC ISO 8601 format. Defaults to now."),
    }),
  },
  async ({ url, title, description, tags, shared, toread, replace, dt }) => {
    try {
      await ensureInitialized();
      await pinboard.addPost({ url, title, description, tags, shared, toread, replace, dt });
      return {
        content: [{ type: "text", text: `Bookmark added successfully.\nURL: ${url}` }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 5. Delete Post
server.registerTool(
  "delete_post",
  {
    description:
      "Permanently delete a bookmark by its URL. This action cannot be undone.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL of the bookmark to permanently delete."),
    }),
  },
  async ({ url }) => {
    try {
      await ensureInitialized();
      await pinboard.deletePost(url);
      return {
        content: [{ type: "text", text: `Bookmark permanently deleted.\nURL: ${url}` }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 6. Suggest Tags
server.registerTool(
  "suggest_tags",
  {
    description:
      "Return popular and recommended tags for a given URL. Popular tags are site-wide; recommended tags are drawn from your own tag history.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to get tag suggestions for."),
    }),
  },
  async ({ url }) => {
    try {
      await ensureInitialized();
      const suggestions = await pinboard.suggestTags(url);
      return {
        content: [{ type: "text", text: JSON.stringify(suggestions, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// ─── Tags ────────────────────────────────────────────────────────────────────

// 7. Get Tags
server.registerTool(
  "get_tags",
  {
    description:
      "Get all of your Pinboard tags with their usage counts. RATE LIMIT: 1 call per 3 seconds.",
  },
  async () => {
    try {
      await ensureInitialized();
      const tags = await pinboard.getTags();
      return {
        content: [{ type: "text", text: JSON.stringify(tags, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 8. Delete Tag
server.registerTool(
  "delete_tag",
  {
    description:
      "Delete a tag from your Pinboard account. This removes the tag from all bookmarks but does not delete them.",
    inputSchema: z.object({
      tag: TagStringSchema.describe("The tag name to delete."),
    }),
  },
  async ({ tag }) => {
    try {
      await ensureInitialized();
      await pinboard.deleteTag(tag);
      return {
        content: [{ type: "text", text: `Tag "${tag}" deleted.` }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 9. Rename Tag
server.registerTool(
  "rename_tag",
  {
    description:
      "Rename a tag across all bookmarks, or fold it into an existing tag. Unlike v2, this works for case-only changes.",
    inputSchema: z.object({
      old_name: TagStringSchema.describe("The current tag name."),
      new_name: TagStringSchema.describe("The new tag name."),
    }),
  },
  async ({ old_name, new_name }) => {
    try {
      await ensureInitialized();
      await pinboard.renameTag(old_name, new_name);
      return {
        content: [{ type: "text", text: `Tag "${old_name}" renamed to "${new_name}".` }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// ─── Notes ───────────────────────────────────────────────────────────────────

// 10. List Notes
server.registerTool(
  "list_notes",
  {
    description:
      "List all of your Pinboard notes (without body text). Use get_note to retrieve the full content of a specific note.",
  },
  async () => {
    try {
      await ensureInitialized();
      const notes = await pinboard.listNotes();
      return {
        content: [{ type: "text", text: JSON.stringify(notes, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// 11. Get Note
server.registerTool(
  "get_note",
  {
    description: "Fetch a specific note including its full body text.",
    inputSchema: z.object({
      id: HexIdSchema.describe("The hex ID of the note to retrieve."),
    }),
  },
  async ({ id }) => {
    try {
      await ensureInitialized();
      const note = await pinboard.getNote(id);
      return {
        content: [{ type: "text", text: JSON.stringify(note, null, 2) }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// ─── Meta ────────────────────────────────────────────────────────────────────

// 12. Get Last Update
server.registerTool(
  "get_last_update",
  {
    description:
      "Returns the time of the most recent bookmark change. Use this before get_all_posts to check if data has changed since your last fetch. RATE LIMIT: 1 call per 3 seconds.",
  },
  async () => {
    try {
      await ensureInitialized();
      const time = await pinboard.getLastUpdate();
      return {
        content: [{ type: "text", text: `Last update: ${time}` }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  },
);

// ─── Server Startup ──────────────────────────────────────────────────────────

async function main() {
  console.error("Starting Pinboard MCP Server (v1 API)...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pinboard MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
