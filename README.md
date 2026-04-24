# Local Pinboard MCP Server

A locally-hosted [Model Context Protocol](https://modelcontextprotocol.io/) server that connects your Pinboard account to any MCP-compatible AI assistant (such as Claude Desktop, Cursor, or similar tools).

This integration uses the [Pinboard API](https://pinboard.in/api/) (v1) with strictly typed TypeScript/Zod schemas to allow your AI assistant to manage your bookmarks, tags, and notes — without exposing credentials externally or relying on third-party services.

You can use the packaged MCPB file to get up and running quickly, or clone the repository to build your own. The source code is open, local, and auditable.

## Capabilities

Once connected, your AI assistant can use the following tools:

### `get_recent_posts`

List your most recent Pinboard bookmarks, optionally filtered by up to three tags.

| Parameter | Type      | Description                                       |
| --------- | --------- | ------------------------------------------------- |
| `tag`     | string[]? | Filter by up to 3 tags                            |
| `count`   | number?   | Number of results to return (default 15, max 100) |

### `get_posts`

Retrieve bookmarks matching a tag, a specific date, or a specific URL.

| Parameter | Type      | Description                                  |
| --------- | --------- | -------------------------------------------- |
| `tag`     | string[]? | Filter by up to 3 tags                       |
| `dt`      | string?   | Return posts added on this date (YYYY-MM-DD) |
| `url`     | string?   | Return the post for this exact URL           |
| `meta`    | boolean?  | Include change-detection metadata hash       |

### `get_all_posts`

Retrieve all bookmarks in your Pinboard account. Rate limited to once every 5 minutes.

| Parameter | Type      | Description                                          |
| --------- | --------- | ---------------------------------------------------- |
| `tag`     | string[]? | Filter by up to 3 tags                               |
| `start`   | number?   | Offset for pagination                                |
| `results` | number?   | Maximum number of posts to return                    |
| `fromdt`  | string?   | Return only posts created after this datetime (UTC)  |
| `todt`    | string?   | Return only posts created before this datetime (UTC) |

### `add_post`

Add or replace a bookmark. URL and title are required. By default, replaces any existing bookmark for the same URL.

| Parameter     | Type      | Description                                        |
| ------------- | --------- | -------------------------------------------------- |
| `url`         | string    | The URL to bookmark (required)                     |
| `title`       | string    | Title of the bookmark (required)                   |
| `description` | string?   | Extended notes or description                      |
| `tags`        | string[]? | Tags to apply. Tags beginning with `.` are private |
| `shared`      | boolean?  | Set to `false` to make the bookmark private        |
| `toread`      | boolean?  | Set to `true` to mark as unread/to-read            |
| `replace`     | boolean?  | Set to `false` to skip if bookmark already exists  |
| `dt`          | string?   | Creation timestamp in UTC ISO 8601 format          |

### `delete_post`

Permanently delete a bookmark by its URL. This action cannot be undone.

| Parameter | Type   | Description                                   |
| --------- | ------ | --------------------------------------------- |
| `url`     | string | The URL of the bookmark to permanently delete |

### `suggest_tags`

Return popular (site-wide) and recommended (your history) tags for a given URL.

| Parameter | Type   | Description                        |
| --------- | ------ | ---------------------------------- |
| `url`     | string | The URL to get tag suggestions for |

### `get_tags`

Get all of your Pinboard tags with their usage counts. No parameters.

### `rename_tag`

Rename a tag across all bookmarks, or fold it into an existing tag.

| Parameter  | Type   | Description          |
| ---------- | ------ | -------------------- |
| `old_name` | string | The current tag name |
| `new_name` | string | The new tag name     |

### `delete_tag`

Delete a single tag from your account. Removes the tag from all bookmarks but does not delete them.

| Parameter | Type   | Description            |
| --------- | ------ | ---------------------- |
| `tag`     | string | The tag name to delete |

### `list_notes`

List all of your notes (without body text). No parameters. Note creation/editing is unsupported in v1 API.

### `get_note`

Fetch a specific note including its full body text.

| Parameter | Type   | Description            |
| --------- | ------ | ---------------------- |
| `id`      | string | The hex ID of the note |

### `get_last_update`

Returns the time of the most recent bookmark change. Use this to check if data has changed since your last fetch. No parameters.

---

## Security Approach

This server uses `stdio` transport exclusively — it never exposes an external HTTP port. Communication is strictly between your local machine and the official `api.pinboard.in` endpoints.

Your API token is passed to Pinboard via the `auth_token` query parameter as required by the v1 API. To ensure absolute privacy, the server is designed to intercept and sanitize network-level error messages to prevent your token from accidentally leaking into your local Claude Desktop or Cursor logs if a network failure occurs.

Error responses are truncated safely, and input paths like tags and hex IDs are strictly verified via Zod regex before requests are made.

---

## Installation & Setup

### 0. Download the most recent MCPB file

[Download from GitHub Releases](https://github.com/mattriffle/local-pinboard-mcp/releases)

Drag the `.mcpb` file from your downloads folder on to your AI assistant's desktop or file browser. The assistant should recognize it as an MCP server and prompt you to load it.

Or...

### 1. Requirements

Ensure you have installed [Node.js](https://nodejs.org/) (version 22+ recommended) and `npm` on your local machine.

### 2. Get your Pinboard API Token

1. Log into your [Pinboard account](https://pinboard.in/).
2. Go to [Settings → Password](https://pinboard.in/settings/password/).
3. Your API token is displayed on that page in the format `username:HEXTOKEN`.
4. Copy it securely.

### 3. Local Project Setup

Clone the repository and install the required dependencies:

```bash
npm install
```

Copy the example environment variables file:

```bash
cp .env.example .env
```

Open `.env` in your text editor and paste in your API token:

```bash
PINBOARD_API_TOKEN=username:YOURHEXTOKEN
```

### 4. Build the Project

Compile TypeScript to JavaScript:

```bash
npm run build
```

---

## Connecting to an MCP Client

This server works with any MCP-compatible client. Below is an example using Claude Desktop.

### Claude Desktop

1. Open Claude Desktop and choose Settings → Developer → Edit Config to open `claude_desktop_config.json`.

2. Add this to the `mcpServers` section, fixing the path to the compiled `index.js` file and adding your own API token:

```json
{
  "mcpServers": {
    "local-pinboard": {
      "command": "node",
      "args": ["/absolute/path/to/your/local-pinboard-mcp/dist/index.js"],
      "env": {
        "PINBOARD_API_TOKEN": "username:YOURHEXTOKEN"
      }
    }
  }
}
```

3. Restart Claude Desktop. The new tools will appear instantly and you can start asking things like "Show me my recent unread bookmarks" or "Search my bookmarks for React tutorials".

For other MCP clients, consult their documentation on how to register a local `stdio` server pointing at `dist/index.js` with the required environment variables.

---

## Development & Testing

This project is built using TypeScript, `@modelcontextprotocol/sdk`, and Zod parsing.

If you are developing new tools or making adjustments:

1. Compile: Always ensure you run `npm run build` after making modifications.
2. Testing: Run the Vitest test suite:

```bash
npm test
```

Pull requests are welcome! Please open an issue first to discuss what you'd like to change.
