import { z } from "zod";
import {
  PostSchema,
  PostsResponseSchema,
  PostsAllResponseSchema,
  ResultResponseSchema,
  UpdateResponseSchema,
  TagsResponseSchema,
  NotesListResponseSchema,
  NoteDetailSchema,
  HexIdSchema,
  TagStringSchema,
  type Post,
  type NoteListItem,
  type NoteDetail,
} from "./pinboard-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AddPostOptions {
  /** The URL to bookmark. */
  url: string;
  /** Title of the bookmark (maps to v1 "description" field). */
  title: string;
  /** Free-form notes (maps to v1 "extended" field). */
  description?: string;
  /** Tags to apply (space-separated internally). */
  tags?: string[];
  /** Creation timestamp in UTC ISO 8601 format. Defaults to now. */
  dt?: string;
  /** If true, bookmark is private. Default: user account default. */
  shared?: boolean;
  /** If true, mark as unread/to-read. */
  toread?: boolean;
  /**
   * If true, replace an existing bookmark for the same URL.
   * If false, the existing bookmark is preserved. Default: true.
   */
  replace?: boolean;
}

export interface GetPostsOptions {
  /** Filter by up to three tags. */
  tag?: string[];
  /** Return posts on a specific date (YYYY-MM-DD). */
  dt?: string;
  /** Return post for a specific URL. */
  url?: string;
  /** Include change-detection metadata in results. */
  meta?: boolean;
}

export interface GetRecentOptions {
  /** Filter by up to three tags. */
  tag?: string[];
  /** Number of results to return (default 15, max 100). */
  count?: number;
}

export interface GetAllOptions {
  /** Filter by up to three tags. */
  tag?: string[];
  /** Offset for pagination. */
  start?: number;
  /** Number of results to return. Default: all. */
  results?: number;
  /** Return only posts created after this datetime (UTC). */
  fromdt?: string;
  /** Return only posts created before this datetime (UTC). */
  todt?: string;
  /** Include change-detection metadata in results. */
  meta?: boolean;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class PinboardClient {
  private apiToken: string;
  private baseUrl = "https://api.pinboard.in/v1";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  // ── Private HTTP helpers ─────────────────────────────────────────────────

  /**
   * All v1 API methods are GET requests. Auth and format are always injected.
   * The token is passed as a query parameter per the v1 spec.
   */
  private async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);

    // Always request JSON and inject auth token
    url.searchParams.set("format", "json");
    url.searchParams.set("auth_token", this.apiToken);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "local-pinboard-mcp/1.0.0",
          Accept: "application/json",
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Ensure we never leak the token if Node.js fetch() includes the URL in network errors
      throw new Error(`Network error: ${msg.replace(this.apiToken, "[REDACTED]")}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const safeText = errorText.length > 200 ? errorText.slice(0, 200) + "..." : errorText;
      console.error(`Pinboard HTTP Error ${response.status}: ${safeText}`);
      throw new Error(`Pinboard HTTP Error ${response.status}: ${safeText}`);
    }

    return response.json();
  }

  /**
   * Parses a v1 result response and throws a descriptive error if the API
   * did not return "done". Handles both `result_code` and `result` shapes.
   */
  private assertDone(data: unknown, context: string): void {
    const parsed = ResultResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Pinboard ${context}: unexpected response shape`);
    }
    const code = "result_code" in parsed.data ? parsed.data.result_code : parsed.data.result;
    if (code !== "done") {
      throw new Error(`Pinboard ${context} failed: ${code}`);
    }
  }

  // ── Posts (Bookmarks) ────────────────────────────────────────────────────

  /**
   * Returns the time of the most recent bookmark change.
   * Useful as a cheap poll before calling getAllPosts.
   * Rate limit: 1 call per 3 seconds.
   */
  async getLastUpdate(): Promise<string> {
    const data = await this.get("/posts/update");
    const parsed = UpdateResponseSchema.parse(data);
    return parsed.update_time;
  }

  /**
   * Returns one or more posts matching a tag, date, or URL.
   * If no filter is given, returns posts from the most recent bookmark date.
   * Rate limit: 1 call per 3 seconds.
   */
  async getPosts(opts?: GetPostsOptions): Promise<Post[]> {
    const params: Record<string, string> = {};
    if (opts?.tag?.length) {
      for (const t of opts.tag) TagStringSchema.parse(t);
      params.tag = opts.tag.join(" ");
    }
    if (opts?.dt) params.dt = opts.dt;
    if (opts?.url) params.url = opts.url;
    if (opts?.meta) params.meta = "yes";

    const data = await this.get("/posts/get", params);
    const parsed = PostsResponseSchema.parse(data);
    return parsed.posts;
  }

  /**
   * Returns the user's most recent posts, optionally filtered by tag.
   * Rate limit: once per minute.
   */
  async getRecentPosts(opts?: GetRecentOptions): Promise<Post[]> {
    const params: Record<string, string> = {};
    if (opts?.tag?.length) {
      for (const t of opts.tag) TagStringSchema.parse(t);
      params.tag = opts.tag.join(" ");
    }
    if (opts?.count !== undefined) params.count = String(opts.count);

    const data = await this.get("/posts/recent", params);
    const parsed = PostsResponseSchema.parse(data);
    return parsed.posts;
  }

  /**
   * Returns all bookmarks in the user's account.
   * Rate limit: once per 5 minutes.
   */
  async getAllPosts(opts?: GetAllOptions): Promise<Post[]> {
    const params: Record<string, string> = {};
    if (opts?.tag?.length) {
      for (const t of opts.tag) TagStringSchema.parse(t);
      params.tag = opts.tag.join(" ");
    }
    if (opts?.start !== undefined) params.start = String(opts.start);
    if (opts?.results !== undefined) params.results = String(opts.results);
    if (opts?.fromdt) params.fromdt = opts.fromdt;
    if (opts?.todt) params.todt = opts.todt;
    if (opts?.meta) params.meta = "yes";

    const data = await this.get("/posts/all", params);
    const parsed = PostsAllResponseSchema.parse(data);
    return parsed;
  }

  /**
   * Adds or replaces a bookmark. URL and title are required.
   * The `replace` flag controls whether an existing bookmark for the same URL
   * is overwritten (default: true).
   */
  async addPost(opts: AddPostOptions): Promise<void> {
    const params: Record<string, string> = {
      url: opts.url,
      description: opts.title,
    };
    if (opts.description !== undefined) params.extended = opts.description;
    if (opts.tags !== undefined && opts.tags.length > 0) {
      for (const t of opts.tags) TagStringSchema.parse(t);
      params.tags = opts.tags.join(" ");
    }
    if (opts.dt !== undefined) params.dt = opts.dt;
    if (opts.shared !== undefined) params.shared = opts.shared ? "yes" : "no";
    if (opts.toread !== undefined) params.toread = opts.toread ? "yes" : "no";
    // Default replace=yes (Pinboard default) unless caller explicitly sets false
    params.replace = opts.replace === false ? "no" : "yes";

    const data = await this.get("/posts/add", params);
    this.assertDone(data, "posts/add");
  }

  /**
   * Deletes a bookmark by URL. Throws if the URL is not in the user's bookmarks.
   */
  async deletePost(url: string): Promise<void> {
    const data = await this.get("/posts/delete", { url });
    const parsed = ResultResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("Pinboard posts/delete: unexpected response shape");
    }
    const code = "result_code" in parsed.data ? parsed.data.result_code : parsed.data.result;
    if (code !== "done") {
      throw new Error(`Pinboard posts/delete failed: ${code}`);
    }
  }

  /**
   * Returns popular and recommended tags for a given URL.
   */
  async suggestTags(url: string): Promise<{ popular: string[]; recommended: string[] }> {
    const data = await this.get("/posts/suggest", { url });
    // v1 JSON shape: [{ "popular": ["tag", ...] }, { "recommended": ["tag", ...] }]
    const SuggestSchema = z.array(
      z.union([
        z.object({ popular: z.array(z.string()) }),
        z.object({ recommended: z.array(z.string()) }),
      ])
    );
    const parsed = SuggestSchema.parse(data);
    let popular: string[] = [];
    let recommended: string[] = [];
    for (const item of parsed) {
      if ("popular" in item) popular = item.popular;
      if ("recommended" in item) recommended = item.recommended;
    }
    return { popular, recommended };
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  /**
   * Returns all of the user's tags with their usage counts.
   * Rate limit: 1 call per 3 seconds.
   */
  async getTags(): Promise<Record<string, number>> {
    const data = await this.get("/tags/get");
    const parsed = TagsResponseSchema.parse(data);
    return parsed;
  }

  /**
   * Deletes a single tag. Removes it from all bookmarks.
   */
  async deleteTag(tag: string): Promise<void> {
    if (!tag.trim()) throw new Error("Tag name must be non-empty.");
    TagStringSchema.parse(tag);
    const data = await this.get("/tags/delete", { tag });
    this.assertDone(data, "tags/delete");
  }

  /**
   * Renames a tag, or folds it into an existing tag.
   */
  async renameTag(oldTag: string, newTag: string): Promise<void> {
    if (!oldTag.trim() || !newTag.trim()) {
      throw new Error("Both old and new tag names must be non-empty.");
    }
    TagStringSchema.parse(oldTag);
    TagStringSchema.parse(newTag);
    const data = await this.get("/tags/rename", { old: oldTag, new: newTag });
    this.assertDone(data, "tags/rename");
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  /**
   * Returns a list of the user's notes (without body text).
   * Rate limit: 1 call per 3 seconds.
   */
  async listNotes(): Promise<NoteListItem[]> {
    const data = await this.get("/notes/list");
    const parsed = NotesListResponseSchema.parse(data);
    return parsed.notes;
  }

  /**
   * Retrieves a specific note by its hex ID, including the full body text.
   * Rate limit: 1 call per 3 seconds.
   */
  async getNote(id: string): Promise<NoteDetail> {
    HexIdSchema.parse(id);
    const data = await this.get(`/notes/${id}`);
    const parsed = NoteDetailSchema.parse(data);
    return parsed;
  }
}


