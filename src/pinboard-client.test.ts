import { describe, it, expect, vi, beforeEach } from "vitest";
import { PinboardClient } from "./pinboard-client.js";

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Creates a standard JSON success response */
function jsonResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Creates an error response with text body */
function errorResponse(status: number, body: string): any {
  return {
    ok: false,
    status,
    statusText: "Error",
    headers: new Headers(),
    json: async () => { throw new Error("not JSON"); },
    text: async () => body,
  };
}

/** Minimal bookmark ("post") fixture matching real v1 JSON response shape */
function makePost(href: string, overrides?: Record<string, unknown>) {
  return {
    href,
    description: `Title of ${href}`,
    extended: "Some notes",
    tags: "test example",          // v1 JSON field name is "tags" (plural), space-separated
    time: "2024-01-15T10:30:00Z",
    shared: "yes",
    toread: "no",
    hash: "abc123def456",
    meta: "deadbeef",
    ...overrides,
  };
}

/** Minimal note fixture for list responses */
function makeNoteItem(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    hash: "abc123",
    title: `Note ${id}`,
    created_at: "2024-01-15 10:30:00",
    updated_at: "2024-01-15 10:30:00",
    length: "100",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PinboardClient", () => {
  let client: PinboardClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new PinboardClient("testuser:DEADBEEF123");
  });

  // ── Authentication ───────────────────────────────────────────────────────

  describe("authentication", () => {
    it("should always send auth_token as a query parameter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ update_time: "2024-01-01T00:00:00Z" }));

      await client.getLastUpdate();

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("auth_token=testuser%3ADEADBEEF123");
    });

    it("should never embed auth_token in the HTTP headers", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ update_time: "2024-01-01T00:00:00Z" }));

      await client.getLastUpdate();

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      const headerValues = Object.values(headers).join(" ");
      expect(headerValues).not.toContain("DEADBEEF");
      expect(headerValues).not.toContain("testuser");
    });

    it("should always request JSON format", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ update_time: "2024-01-01T00:00:00Z" }));

      await client.getLastUpdate();

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("format=json");
    });

    it("should send User-Agent identifying the MCP server", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ update_time: "2024-01-01T00:00:00Z" }));

      await client.getLastUpdate();

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers["User-Agent"]).toBe("local-pinboard-mcp/1.0.0");
    });

    it("should use GET for all requests (including mutations)", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({ url: "http://example.com", title: "Test" });

      expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    });
  });

  // ── HTTP Error Handling ──────────────────────────────────────────────────

  describe("HTTP error handling", () => {
    it("should throw on non-200 responses", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, "Unauthorized"));

      await expect(client.getLastUpdate()).rejects.toThrow(/Pinboard HTTP Error 401/);
    });

    it("should throw on 429 Too Many Requests", async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(429, "Too Many Requests"));

      await expect(client.getLastUpdate()).rejects.toThrow(/Pinboard HTTP Error 429/);
    });

    it("should truncate long error bodies in the thrown message", async () => {
      const longError = "x".repeat(300);
      mockFetch.mockResolvedValueOnce(errorResponse(500, longError));

      await expect(client.getLastUpdate()).rejects.toThrow(/Pinboard HTTP Error 500/);

      mockFetch.mockResolvedValueOnce(errorResponse(500, longError));
      try {
        await client.getLastUpdate();
      } catch (e: unknown) {
        expect((e as Error).message.length).toBeLessThan(300);
      }
    });

    it("should throw on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

      await expect(client.getLastUpdate()).rejects.toThrow("fetch failed");
    });

    it("should redact the api token from network error messages", async () => {
      const errorMsg = "fetch failed for https://api.pinboard.in/v1/posts/update?format=json&auth_token=testuser:DEADBEEF123";
      mockFetch.mockRejectedValueOnce(new Error(errorMsg));
      await expect(client.getLastUpdate()).rejects.toThrow(/\[REDACTED\]/);

      mockFetch.mockRejectedValueOnce(new Error(errorMsg));
      await expect(client.getLastUpdate().catch(e => e.message)).resolves.not.toContain("DEADBEEF");
    });
  });

  // ── getLastUpdate ────────────────────────────────────────────────────────

  describe("getLastUpdate", () => {
    it("should call posts/update and return the timestamp", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ update_time: "2024-05-13T10:42:42Z" }),
      );

      const result = await client.getLastUpdate();

      expect(result).toBe("2024-05-13T10:42:42Z");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/update");
    });
  });

  // ── getPosts ─────────────────────────────────────────────────────────────

  describe("getPosts", () => {
    it("should return posts with no filter", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          date: "2024-01-15",
          posts: [makePost("http://example.com/"), makePost("http://other.com/")],
        }),
      );

      const posts = await client.getPosts();

      expect(posts).toHaveLength(2);
      expect(posts[0].href).toBe("http://example.com/");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/get");
    });

    it("should pass tag filter", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ posts: [makePost("http://example.com/")] }),
      );

      await client.getPosts({ tag: ["javascript", "typescript"] });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("tag=javascript+typescript");
    });

    it("should pass date filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: [] }));

      await client.getPosts({ dt: "2024-01-15" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("dt=2024-01-15");
    });

    it("should pass url filter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: [makePost("http://pinboard.in/")] }));

      await client.getPosts({ url: "http://pinboard.in/" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("url=");
    });

    it("should handle empty results", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: [] }));

      const posts = await client.getPosts({ tag: ["nonexistent"] });
      expect(posts).toHaveLength(0);
    });

    it("should transform the space-separated tags string into an array", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          posts: [
            makePost("http://example.com/", { tags: "javascript typescript react" }),
          ],
        }),
      );

      const posts = await client.getPosts();
      expect(posts[0].tags).toEqual(["javascript", "typescript", "react"]);
    });

    it("should produce an empty array when tags string is empty", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ posts: [makePost("http://example.com/", { tags: "" })] }),
      );

      const posts = await client.getPosts();
      expect(posts[0].tags).toEqual([]);
    });

    it("should transform yes/no shared field to boolean", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ posts: [makePost("http://example.com/", { shared: "yes", toread: "no" })] }),
      );

      const posts = await client.getPosts();
      expect(posts[0].shared).toBe(true);
      expect(posts[0].toread).toBe(false);
    });

    it("should reject tags containing spaces", async () => {
      await expect(
        client.getPosts({ tag: ["no spaces"] }),
      ).rejects.toThrow(/Tags cannot contain spaces/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── getRecentPosts ───────────────────────────────────────────────────────

  describe("getRecentPosts", () => {
    it("should call posts/recent", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ posts: [makePost("http://example.com/")] }),
      );

      const posts = await client.getRecentPosts();

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/recent");
      expect(posts).toHaveLength(1);
    });

    it("should pass tag and count params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: [] }));

      await client.getRecentPosts({ tag: ["news"], count: 10 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("tag=news");
      expect(calledUrl).toContain("count=10");
    });
  });

  // ── getAllPosts ──────────────────────────────────────────────────────────

  describe("getAllPosts", () => {
    it("should call posts/all and return an array", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([makePost("http://example.com/"), makePost("http://other.com/")]),
      );

      const posts = await client.getAllPosts();

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/all");
      expect(posts).toHaveLength(2);
    });

    it("should pass start, results, fromdt, todt params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));

      await client.getAllPosts({
        start: 50,
        results: 25,
        fromdt: "2024-01-01T00:00:00Z",
        todt: "2024-06-01T00:00:00Z",
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("start=50");
      expect(calledUrl).toContain("results=25");
      expect(calledUrl).toContain("fromdt=");
      expect(calledUrl).toContain("todt=");
    });
  });

  // ── addPost ──────────────────────────────────────────────────────────────

  describe("addPost", () => {
    it("should call posts/add with url and description", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({ url: "http://example.com", title: "Example" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/add");
      expect(calledUrl).toContain("url=");
      expect(calledUrl).toContain("description=Example");
    });

    it("should default replace=yes", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({ url: "http://example.com", title: "Example" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("replace=yes");
    });

    it("should send replace=no when explicitly set to false", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({ url: "http://example.com", title: "Example", replace: false });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("replace=no");
    });

    it("should encode shared and toread as yes/no", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({
        url: "http://example.com",
        title: "Example",
        shared: false,
        toread: true,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("shared=no");
      expect(calledUrl).toContain("toread=yes");
    });

    it("should send tags space-separated in query param", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({
        url: "http://example.com",
        title: "Example",
        tags: ["news", "tech"],
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("tags=news+tech");
    });

    it("should map description option to extended param", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.addPost({
        url: "http://example.com",
        title: "Example",
        description: "Some notes",
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("extended=Some+notes");
    });

    it("should reject tags containing spaces", async () => {
      await expect(
        client.addPost({ url: "http://example.com", title: "Test", tags: ["bad tag"] }),
      ).rejects.toThrow(/Tags cannot contain spaces/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should throw if API returns a failure result code", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "something went wrong" }));

      await expect(
        client.addPost({ url: "http://example.com", title: "Example" }),
      ).rejects.toThrow(/something went wrong/);
    });
  });

  // ── deletePost ───────────────────────────────────────────────────────────

  describe("deletePost", () => {
    it("should call posts/delete with the url", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.deletePost("http://example.com/");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/delete");
      expect(calledUrl).toContain("url=");
      expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    });

    it("should throw if the bookmark is not found", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "item not found" }));

      await expect(client.deletePost("http://missing.com/")).rejects.toThrow(
        /item not found/,
      );
    });
  });

  // ── suggestTags ──────────────────────────────────────────────────────────

  describe("suggestTags", () => {
    it("should return popular and recommended tags", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          { popular: ["blog", "blogs", "writing"] },
          { recommended: ["blog", "weblog"] },
        ]),
      );

      const suggestions = await client.suggestTags("http://blog.com/");

      expect(suggestions.popular).toEqual(["blog", "blogs", "writing"]);
      expect(suggestions.recommended).toEqual(["blog", "weblog"]);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/posts/suggest");
    });
  });

  // ── getTags ──────────────────────────────────────────────────────────────

  describe("getTags", () => {
    it("should return tag->count map", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ javascript: 42, typescript: 15, react: 8 }),
      );

      const tags = await client.getTags();

      expect(tags).toEqual({ javascript: 42, typescript: 15, react: 8 });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/tags/get");
    });

    it("should handle empty tag list", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const tags = await client.getTags();
      expect(tags).toEqual({});
    });
  });

  // ── deleteTag ────────────────────────────────────────────────────────────

  describe("deleteTag", () => {
    it("should call tags/delete with the tag", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.deleteTag("oldtag");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/tags/delete");
      expect(calledUrl).toContain("tag=oldtag");
    });

    it("should reject empty tag names", async () => {
      await expect(client.deleteTag("")).rejects.toThrow(/non-empty/);
      await expect(client.deleteTag("   ")).rejects.toThrow(/non-empty/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should reject tags containing spaces", async () => {
      await expect(client.deleteTag("bad tag")).rejects.toThrow(/Tags cannot contain spaces/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── renameTag ────────────────────────────────────────────────────────────

  describe("renameTag", () => {
    it("should call tags/rename with old and new params", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ result_code: "done" }));

      await client.renameTag("oldtag", "newtag");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/tags/rename");
      expect(calledUrl).toContain("old=oldtag");
      expect(calledUrl).toContain("new=newtag");
    });

    it("should reject empty tag names", async () => {
      await expect(client.renameTag("", "newtag")).rejects.toThrow(/non-empty/);
      await expect(client.renameTag("old", "  ")).rejects.toThrow(/non-empty/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── listNotes ────────────────────────────────────────────────────────────

  describe("listNotes", () => {
    it("should return note list", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          notes: [makeNoteItem("aaa111"), makeNoteItem("bbb222")],
        }),
      );

      const notes = await client.listNotes();

      expect(notes).toHaveLength(2);
      expect(notes[0].id).toBe("aaa111");
      expect(notes[1].title).toBe("Note bbb222");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/notes/list");
    });

    it("should handle empty note list", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ count: 0, notes: [] }));

      const notes = await client.listNotes();
      expect(notes).toHaveLength(0);
    });
  });

  // ── getNote ──────────────────────────────────────────────────────────────

  describe("getNote", () => {
    it("should return note with body text", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "abc123def",
          hash: "0c9c30f60cadabd31415",
          title: "Grandma's Recipe",
          created_at: "2024-01-15 10:30:00",
          updated_at: "2024-01-15 10:30:00",
          length: "42",
          text: "Cut a potato in half, salt it, eat it",
        }),
      );

      const note = await client.getNote("abc123def");

      expect(note.title).toBe("Grandma's Recipe");
      expect(note.text).toBe("Cut a potato in half, salt it, eat it");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/v1/notes/abc123def");
    });

    it("should reject non-hex IDs before making a request", async () => {
      await expect(client.getNote("bad-id!")).rejects.toThrow(/Must be a hex string/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
