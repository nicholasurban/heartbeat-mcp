# Heartbeat MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript MCP server providing full Heartbeat.chat API coverage via a single multi-mode tool with 10 modes (dashboard, members, threads, post, dm, events, content, analytics, search, manage).

**Architecture:** Single `heartbeat` tool registered with McpServer using `registerTool()`. Modes implemented as separate modules in `src/modes/`. Direct HTTP calls to `https://api.heartbeat.chat/v0/*` with Bearer token, 60s caching, rate-limit-aware retry. Dual transport: stdio (local) + streamable HTTP (Coolify remote).

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, zod, axios, express (HTTP transport)

**Design doc:** `docs/plans/2026-02-21-heartbeat-mcp-design.md`

---

## Project Structure

```
heartbeat-mcp/
  src/
    index.ts           # Entry point, server setup, transport selection
    tool.ts            # Tool schema (Zod) + handler (dispatches to modes)
    api.ts             # HTTP client, caching, rate limiting, retry
    helpers.ts         # Name resolution (channel/user), formatting, shared utils
    modes/
      dashboard.ts     # Compound: parallel fetch + prioritized summary
      members.ts       # List/search/filter users
      threads.ts       # Get threads from channels, single thread with comments
      post.ts          # Create threads, comments, nested replies
      dm.ts            # Send/read direct messages
      events.ts        # List/create events, attendance
      content.ts       # Courses, lessons, documents, videos
      analytics.ts     # Computed engagement metrics
      search.ts        # Cross-resource search
      manage.ts        # Admin CRUD operations
  package.json
  tsconfig.json
  .env                 # HEARTBEAT_API_KEY (exists)
  .gitignore           # (exists)
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "heartbeat-mcp-server",
  "version": "1.0.0",
  "description": "MCP server for Heartbeat.chat community management",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.11.0",
    "axios": "^1.7.9",
    "express": "^4.21.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create minimal src/index.ts**

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "heartbeat-mcp-server",
  version: "1.0.0",
});

async function main() {
  if (!process.env.HEARTBEAT_API_KEY) {
    console.error("ERROR: HEARTBEAT_API_KEY environment variable is required");
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Heartbeat MCP server running via stdio");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
```

**Step 4: Install dependencies and verify build**

Run: `npm install && npm run build`
Expected: Clean compilation, `dist/index.js` created

**Step 5: Commit**

```bash
git add package.json tsconfig.json src/index.ts
git commit -m "feat: scaffold heartbeat MCP server with TypeScript"
```

---

### Task 2: API Client with Caching & Rate Limiting

**Files:**
- Create: `src/api.ts`

**Step 1: Implement HeartbeatAPI class**

The API client must handle:
- Bearer token auth from `HEARTBEAT_API_KEY` env var
- Base URL: `https://api.heartbeat.chat/v0`
- 60-second response cache (keyed by method + path + params)
- Rate limiting: max 10 req/sec, queue excess requests
- Retry with exponential backoff on 429 (max 3 retries)
- Timeout: 30 seconds

```typescript
import axios, { AxiosInstance, AxiosError } from "axios";

interface CacheEntry {
  data: unknown;
  expires: number;
}

export class HeartbeatAPI {
  private client: AxiosInstance;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTTL: number;

  constructor(apiKey: string, cacheTTL = 60_000) {
    this.cacheTTL = cacheTTL;
    this.client = axios.create({
      baseURL: "https://api.heartbeat.chat/v0",
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  private cacheKey(method: string, path: string, params?: Record<string, unknown>): string {
    return `${method}:${path}:${JSON.stringify(params ?? {})}`;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const key = this.cacheKey("GET", path, params);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.data as T;

    const res = await this.request<T>("GET", path, undefined, params);
    this.cache.set(key, { data: res, expires: Date.now() + this.cacheTTL });
    return res;
  }

  async put<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>("PUT", path, data);
  }

  async post<T>(path: string, data?: unknown): Promise<T> {
    return this.request<T>("POST", path, data);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    data?: unknown,
    params?: Record<string, unknown>,
    retries = 3
  ): Promise<T> {
    try {
      const res = await this.client.request({ method, url: path, data, params });
      return res.data;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 429 && retries > 0) {
        const delay = Math.pow(2, 3 - retries) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        return this.request<T>(method, path, data, params, retries - 1);
      }
      throw err;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const body = error.response.data;
      const msg = typeof body === "object" && body?.message ? body.message : JSON.stringify(body);
      switch (status) {
        case 400: return `Validation error: ${msg}`;
        case 401: return "API key invalid or expired. Check HEARTBEAT_API_KEY.";
        case 404: return `Not found: ${msg}`;
        case 429: return "Rate limit exceeded after retries. Wait and try again.";
        default: return `API error ${status}: ${msg}`;
      }
    }
    if (error.code === "ECONNABORTED") return "Request timed out. Try again.";
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/api.ts
git commit -m "feat: add API client with caching, rate limiting, and retry"
```

---

### Task 3: Helpers (Name Resolution & Formatting)

**Files:**
- Create: `src/helpers.ts`

**Step 1: Implement name resolution and formatting utilities**

Helpers resolve human-readable names (channel names, user names/emails) to UUIDs. They also format responses.

```typescript
import { HeartbeatAPI } from "./api.js";

// Types used across modes
export interface HBUser {
  id: string;
  email: string;
  name: string;
  roleID: string;
  groupIDs: string[];
  bio?: string;
  status?: string;
  completedLessons?: Array<{ lessonID: string; timestamp: string }>;
  profilePicture?: string;
  linkedin?: string;
  twitter?: string;
  instagram?: string;
}

export interface HBChannel {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface HBThread {
  id: string;
  text: string;
  channelID: string;
  userID: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface HBEvent {
  name: string;
  description?: string;
  startTime: string;
  duration: number;
  location?: string;
  invitedUsers?: string[];
  invitedGroups?: string[];
  [key: string]: unknown;
}

// Resolve channel name → ID (case-insensitive)
export async function resolveChannel(api: HeartbeatAPI, nameOrId: string): Promise<string> {
  // UUID check
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId)) {
    return nameOrId;
  }
  const channels = await api.get<HBChannel[]>("/channels");
  const match = channels.find((c) => c.name.toLowerCase() === nameOrId.toLowerCase());
  if (!match) {
    const similar = channels
      .filter((c) => c.name.toLowerCase().includes(nameOrId.toLowerCase()))
      .map((c) => c.name);
    throw new Error(
      `No channel named "${nameOrId}". ${similar.length ? `Did you mean: ${similar.join(", ")}?` : `Available: ${channels.map((c) => c.name).join(", ")}`}`
    );
  }
  return match.id;
}

// Resolve user name or email → user object
export async function resolveUser(api: HeartbeatAPI, nameOrEmailOrId: string): Promise<HBUser> {
  // UUID check
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrEmailOrId)) {
    return api.get<HBUser>(`/users/${nameOrEmailOrId}`);
  }
  // Email check
  if (nameOrEmailOrId.includes("@")) {
    const results = await api.get<HBUser[]>("/find/users", { email: nameOrEmailOrId });
    if (results.length === 0) throw new Error(`No user found with email "${nameOrEmailOrId}"`);
    return results[0];
  }
  // Name search: fetch all users, filter locally
  const allUsers = await api.get<HBUser[]>("/users");
  const lower = nameOrEmailOrId.toLowerCase();
  const matches = allUsers.filter((u) => u.name.toLowerCase().includes(lower));
  if (matches.length === 0) throw new Error(`No user found matching "${nameOrEmailOrId}"`);
  if (matches.length === 1) return matches[0];
  // Multiple matches — return error with options
  throw new Error(
    `Multiple users match "${nameOrEmailOrId}": ${matches.map((u) => `${u.name} (${u.email})`).join(", ")}. Be more specific or use email/ID.`
  );
}

// Build a user name lookup map (ID → name) for display
export async function buildUserMap(api: HeartbeatAPI): Promise<Map<string, string>> {
  const users = await api.get<HBUser[]>("/users");
  const map = new Map<string, string>();
  for (const u of users) map.set(u.id, u.name);
  return map;
}

// Summarize user for compact display
export function summarizeUser(user: HBUser, detail: "summary" | "full" = "summary"): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: user.id,
    name: user.name,
    email: user.email,
    groups: user.groupIDs?.length ?? 0,
    lessons_completed: user.completedLessons?.length ?? 0,
  };
  if (detail === "full") {
    base.bio = user.bio || "";
    base.status = user.status || "";
    base.roleID = user.roleID;
    base.groupIDs = user.groupIDs;
    base.linkedin = user.linkedin || "";
    base.twitter = user.twitter || "";
    base.instagram = user.instagram || "";
  }
  return base;
}

// Strip HTML for previews
export function stripHtml(html: string, maxLen = 150): string {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

// Relative time ago
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/helpers.ts
git commit -m "feat: add name resolution helpers and shared types"
```

---

### Task 4: Tool Schema & Handler Scaffold

**Files:**
- Create: `src/tool.ts`
- Create: `src/modes/` directory with empty mode stubs
- Modify: `src/index.ts` — register the tool

**Step 1: Create the Zod schema for all 10 modes**

`src/tool.ts` — Define the schema with all mode-specific params, then dispatch to mode handlers.

```typescript
import { z } from "zod";
import { HeartbeatAPI, handleApiError } from "./api.js";

// Import mode handlers (will be created in subsequent tasks)
import { handleDashboard } from "./modes/dashboard.js";
import { handleMembers } from "./modes/members.js";
import { handleThreads } from "./modes/threads.js";
import { handlePost } from "./modes/post.js";
import { handleDm } from "./modes/dm.js";
import { handleEvents } from "./modes/events.js";
import { handleContent } from "./modes/content.js";
import { handleAnalytics } from "./modes/analytics.js";
import { handleSearch } from "./modes/search.js";
import { handleManage } from "./modes/manage.js";

export const TOOL_NAME = "heartbeat";

export const TOOL_DESCRIPTION = `Manage a Heartbeat.chat community. 10 modes:
- dashboard: community pulse — new members, unanswered threads, upcoming events, notifications
- members: list/search/filter users by name, email, group, role
- threads: get threads from a channel, or a single thread with comments
- post: create threads, comments, nested replies (rich HTML text)
- dm: send or read direct messages
- events: list/create events, get attendance data
- content: courses, lessons, documents, videos (CRUD)
- analytics: computed engagement scores, channel rankings, member segments, course progress
- search: cross-resource search across members, threads, documents, events
- manage: admin ops — user/group/channel/invitation/webhook CRUD`;

export const TOOL_SCHEMA = {
  mode: z.enum([
    "dashboard", "members", "threads", "post", "dm",
    "events", "content", "analytics", "search", "manage",
  ]).describe("Operation mode"),

  // Shared params
  detail: z.enum(["summary", "full"]).default("summary").optional()
    .describe("Response detail level"),
  limit: z.number().int().min(1).max(100).default(20).optional()
    .describe("Max results to return"),
  offset: z.number().int().min(0).default(0).optional()
    .describe("Pagination offset"),

  // members params
  search: z.string().optional().describe("Search by name or email (members, search modes)"),
  group: z.string().optional().describe("Filter by group name or ID"),
  role: z.string().optional().describe("Filter by role ID"),
  fields: z.array(z.string()).optional().describe("Specific fields to return"),

  // threads params
  channel: z.string().optional().describe("Channel name or ID"),
  thread_id: z.string().optional().describe("Thread ID (get single thread with comments)"),

  // post params
  text: z.string().optional().describe("Rich text content (HTML: <p>, <b>, <h1>-<h3>, <ul>/<li>, <a href>, <br>, @UUID mentions)"),
  parent_comment_id: z.string().optional().describe("Parent comment ID for nested reply (post mode)"),
  user_id: z.string().optional().describe("Admin user ID to post as (optional)"),

  // dm params
  to: z.string().optional().describe("Recipient: user ID, name, or email (dm mode)"),
  from: z.string().optional().describe("Sender user ID (dm mode, admin only)"),
  chat_id: z.string().optional().describe("Chat ID for reading messages (dm mode)"),

  // events params
  action: z.string().optional().describe("Sub-action: list/get/attendance/create (events), send/read/create_chat (dm), courses/lesson/documents/document/create_lesson/update_lesson/videos (content), or manage actions"),
  event_id: z.string().optional().describe("Event ID"),
  event_name: z.string().optional().describe("Event name (create)"),
  event_description: z.string().optional().describe("Event description (create)"),
  start_time: z.string().optional().describe("ISO 8601 start time (event create)"),
  duration: z.number().optional().describe("Duration in minutes (event create)"),
  location: z.string().optional().describe("Location or URL (event create)"),
  invited_users: z.array(z.string()).optional().describe("Emails to invite (event create)"),
  invited_groups: z.array(z.string()).optional().describe("Group IDs to invite (event create)"),

  // content params
  lesson_id: z.string().optional().describe("Lesson ID"),
  document_id: z.string().optional().describe("Document ID"),
  course_id: z.string().optional().describe("Course ID (for create_lesson)"),
  title: z.string().optional().describe("Title for lesson/document"),
  content_text: z.string().optional().describe("Content body (HTML)"),

  // search params
  query: z.string().optional().describe("Search query (search mode)"),
  resources: z.array(z.enum(["members", "threads", "documents", "events"])).optional()
    .describe("Resources to search (default: all)"),

  // manage params — action field covers sub-operations
  // Manage uses: action + relevant entity params
  email: z.string().optional().describe("User email (manage: create_user, create_pending_user)"),
  name: z.string().optional().describe("Name (manage: create_user, create_group, etc.)"),
  group_id: z.string().optional().describe("Group ID (manage operations)"),
  channel_id: z.string().optional().describe("Channel ID (manage operations)"),
  webhook_url: z.string().optional().describe("Webhook URL (manage: create_webhook)"),
  webhook_action: z.string().optional().describe("Webhook event name (manage: create_webhook)"),
  invitation_id: z.string().optional().describe("Invitation ID (manage operations)"),
  updates: z.record(z.string(), z.unknown()).optional().describe("Key-value pairs for updates"),

  // analytics params
  metric: z.enum([
    "engagement_scores", "channel_activity", "event_metrics",
    "course_progress", "member_segments", "growth", "top_contributors",
  ]).optional().describe("Analytics metric to compute"),
};

export type ToolParams = z.infer<z.ZodObject<typeof TOOL_SCHEMA>>;

export async function toolHandler(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  try {
    switch (params.mode) {
      case "dashboard": return await handleDashboard(api, params);
      case "members": return await handleMembers(api, params);
      case "threads": return await handleThreads(api, params);
      case "post": return await handlePost(api, params);
      case "dm": return await handleDm(api, params);
      case "events": return await handleEvents(api, params);
      case "content": return await handleContent(api, params);
      case "analytics": return await handleAnalytics(api, params);
      case "search": return await handleSearch(api, params);
      case "manage": return await handleManage(api, params);
      default: return JSON.stringify({ error: `Unknown mode: ${params.mode}` });
    }
  } catch (err) {
    return JSON.stringify({ error: handleApiError(err) });
  }
}
```

**Step 2: Create stub mode files**

Create `src/modes/` directory and one stub file per mode. Each exports a handler that returns `JSON.stringify({ status: "not yet implemented" })`.

Example stub (`src/modes/dashboard.ts`):
```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleDashboard(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "dashboard mode not yet implemented" });
}
```

Create identical stubs for: `members.ts`, `threads.ts`, `post.ts`, `dm.ts`, `events.ts`, `content.ts`, `analytics.ts`, `search.ts`, `manage.ts`

**Step 3: Update src/index.ts to register the tool**

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HeartbeatAPI } from "./api.js";
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA, toolHandler } from "./tool.js";

const server = new McpServer({
  name: "heartbeat-mcp-server",
  version: "1.0.0",
});

async function main() {
  const apiKey = process.env.HEARTBEAT_API_KEY;
  if (!apiKey) {
    console.error("ERROR: HEARTBEAT_API_KEY environment variable is required");
    process.exit(1);
  }

  const api = new HeartbeatAPI(apiKey);

  server.registerTool(
    TOOL_NAME,
    {
      title: "Heartbeat Community Manager",
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await toolHandler(api, params as any);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Heartbeat MCP server running via stdio");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation, all stubs resolve

**Step 5: Commit**

```bash
git add src/tool.ts src/index.ts src/modes/
git commit -m "feat: add tool schema with 10 modes and handler dispatch"
```

---

### Task 5: Mode — members

**Files:**
- Modify: `src/modes/members.ts`

**Step 1: Implement members mode**

Fetches all users from `/users`, filters locally by search/group/role, applies pagination and field selection.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, summarizeUser } from "../helpers.js";

export async function handleMembers(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const allUsers = await api.get<HBUser[]>("/users");
  let filtered = allUsers;

  // Filter by search (name or email)
  if (params.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  // Filter by group
  if (params.group) {
    filtered = filtered.filter((u) => u.groupIDs?.includes(params.group!));
  }

  // Filter by role
  if (params.role) {
    filtered = filtered.filter((u) => u.roleID === params.role);
  }

  const total = filtered.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 20;
  const page = filtered.slice(offset, offset + limit);
  const detail = (params.detail as "summary" | "full") ?? "summary";

  const result = {
    total,
    count: page.length,
    offset,
    has_more: total > offset + page.length,
    next_offset: total > offset + page.length ? offset + page.length : undefined,
    members: page.map((u) => {
      const summary = summarizeUser(u, detail);
      // If specific fields requested, filter
      if (params.fields && params.fields.length > 0) {
        const picked: Record<string, unknown> = {};
        for (const f of params.fields) {
          if (f in summary) picked[f] = summary[f];
        }
        return picked;
      }
      return summary;
    }),
  };

  return JSON.stringify(result);
}
```

**Step 2: Build and test live**

Run: `npm run build`
Then test with MCP Inspector or direct invocation:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"heartbeat","arguments":{"mode":"members","limit":5}}}' | HEARTBEAT_API_KEY=$(grep HEARTBEAT_API_KEY .env | cut -d= -f2) node dist/index.js
```

**Step 3: Commit**

```bash
git add src/modes/members.ts
git commit -m "feat: implement members mode with search, filter, pagination"
```

---

### Task 6: Mode — threads

**Files:**
- Modify: `src/modes/threads.ts`

**Step 1: Implement threads mode**

Two sub-operations:
1. List threads in a channel (requires `channel` param, returns 20 most recent)
2. Get single thread with comments (requires `thread_id`)

Auto-resolves channel names to IDs using `resolveChannel()`.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { resolveChannel, buildUserMap, stripHtml, timeAgo, HBThread } from "../helpers.js";

export async function handleThreads(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  // Single thread with comments
  if (params.thread_id) {
    const thread = await api.get<any>(`/threads/${params.thread_id}`);
    const userMap = await buildUserMap(api);
    return JSON.stringify({
      id: thread.id,
      author: userMap.get(thread.userID) ?? thread.userID,
      text: thread.text,
      created: thread.createdAt,
      age: timeAgo(thread.createdAt),
      comments: (thread.comments ?? []).map((c: any) => ({
        id: c.id,
        author: userMap.get(c.userID) ?? c.userID,
        text: c.text,
        created: c.createdAt,
        age: timeAgo(c.createdAt),
        replies: (c.replies ?? []).map((r: any) => ({
          id: r.id,
          author: userMap.get(r.userID) ?? r.userID,
          text: r.text,
          created: r.createdAt,
        })),
      })),
    });
  }

  // List threads in channel
  if (!params.channel) {
    return JSON.stringify({ error: "Provide 'channel' (name or ID) or 'thread_id'" });
  }

  const channelID = await resolveChannel(api, params.channel);
  const threads = await api.get<HBThread[]>(`/channels/${channelID}/threads`);
  const userMap = await buildUserMap(api);

  return JSON.stringify({
    channel: params.channel,
    channel_id: channelID,
    count: threads.length,
    threads: threads.map((t) => ({
      id: t.id,
      author: userMap.get(t.userID) ?? t.userID,
      preview: stripHtml(t.text),
      created: t.createdAt,
      age: timeAgo(t.createdAt),
    })),
  });
}
```

**Step 2: Build, test live, commit**

Run: `npm run build`
Test: Call with `mode: "threads", channel: "<channel name>"` — verify it resolves and returns threads.

```bash
git add src/modes/threads.ts
git commit -m "feat: implement threads mode with channel name resolution"
```

---

### Task 7: Mode — post

**Files:**
- Modify: `src/modes/post.ts`

**Step 1: Implement post mode**

Creates threads (`PUT /threads`) or comments (`PUT /comments`). Determines which based on whether `thread_id` is present.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { resolveChannel } from "../helpers.js";

export async function handlePost(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  if (!params.text) {
    return JSON.stringify({ error: "Required: 'text' (HTML content)" });
  }

  // Comment on existing thread
  if (params.thread_id) {
    const body: Record<string, unknown> = {
      text: params.text,
      threadID: params.thread_id,
    };
    if (params.parent_comment_id) body.parentCommentID = params.parent_comment_id;
    if (params.user_id) body.userID = params.user_id;

    const result = await api.put<any>("/comments", body);
    return JSON.stringify({
      action: "comment_created",
      comment_id: result.id,
      thread_id: params.thread_id,
      text: params.text,
    });
  }

  // Create new thread
  if (!params.channel) {
    return JSON.stringify({ error: "Required: 'channel' (name or ID) to create a thread" });
  }

  const channelID = await resolveChannel(api, params.channel);
  const body: Record<string, unknown> = {
    text: params.text,
    channelID,
  };
  if (params.user_id) body.userID = params.user_id;

  const result = await api.put<any>("/threads", body);
  return JSON.stringify({
    action: "thread_created",
    thread_id: result.id,
    channel: params.channel,
    channel_id: channelID,
    text: params.text,
  });
}
```

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/post.ts
git commit -m "feat: implement post mode for threads and comments"
```

---

### Task 8: Mode — dm

**Files:**
- Modify: `src/modes/dm.ts`

**Step 1: Implement dm mode**

Three sub-actions: `send` (default), `read`, `create_chat`. Auto-resolves user names/emails to IDs.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { resolveUser } from "../helpers.js";

export async function handleDm(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action ?? "send";

  if (action === "read") {
    if (!params.chat_id) return JSON.stringify({ error: "Required: 'chat_id'" });
    const messages = await api.get<any[]>(`/directMessages/${params.chat_id}`);
    return JSON.stringify({ chat_id: params.chat_id, messages });
  }

  if (action === "create_chat") {
    if (!params.to) return JSON.stringify({ error: "Required: 'to' (user ID, name, or email)" });
    const user = await resolveUser(api, params.to);
    const result = await api.put<any>("/directChats", { userID: user.id });
    return JSON.stringify({ action: "chat_created", chat: result, user: user.name });
  }

  // Default: send
  if (!params.to || !params.text) {
    return JSON.stringify({ error: "Required: 'to' and 'text'" });
  }
  const user = await resolveUser(api, params.to);
  const body: Record<string, unknown> = { text: params.text, to: user.id };
  if (params.from) body.from = params.from;

  await api.put("/directMessages", body);
  return JSON.stringify({
    action: "dm_sent",
    to: user.name,
    to_id: user.id,
    text: params.text,
  });
}
```

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/dm.ts
git commit -m "feat: implement dm mode with user name resolution"
```

---

### Task 9: Mode — events

**Files:**
- Modify: `src/modes/events.ts`

**Step 1: Implement events mode**

Sub-actions: `list` (default), `get`, `attendance`, `create`.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { timeAgo } from "../helpers.js";

export async function handleEvents(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action ?? "list";

  if (action === "get") {
    if (!params.event_id) return JSON.stringify({ error: "Required: 'event_id'" });
    const event = await api.get<any>(`/events/${params.event_id}`);
    const instances = await api.get<any[]>(`/events/${params.event_id}/instances`);
    return JSON.stringify({ event, instances });
  }

  if (action === "attendance") {
    if (!params.event_id) return JSON.stringify({ error: "Required: 'event_id'" });
    const attendance = await api.get<any[]>(`/events/${params.event_id}/attendance`);
    return JSON.stringify({ event_id: params.event_id, attendance });
  }

  if (action === "create") {
    if (!params.event_name || !params.start_time || !params.duration) {
      return JSON.stringify({ error: "Required: 'event_name', 'start_time' (ISO 8601), 'duration' (minutes)" });
    }
    const body: Record<string, unknown> = {
      name: params.event_name,
      startTime: params.start_time,
      duration: params.duration,
    };
    if (params.event_description) body.description = params.event_description;
    if (params.location) body.location = params.location;
    if (params.invited_users) body.invitedUsers = params.invited_users;
    if (params.invited_groups) body.invitedGroups = params.invited_groups;

    const result = await api.put<any>("/events", body);
    return JSON.stringify({ action: "event_created", event: result });
  }

  // Default: list
  const queryParams: Record<string, unknown> = {};
  if (params.group) queryParams.groupID = params.group;
  const events = await api.get<any[]>("/events", queryParams);

  return JSON.stringify({
    count: events.length,
    events: events.map((e: any) => ({
      id: e.id,
      name: e.name,
      startTime: e.startTime,
      duration: e.duration,
      location: e.location,
    })),
  });
}
```

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/events.ts
git commit -m "feat: implement events mode with list, get, attendance, create"
```

---

### Task 10: Mode — content

**Files:**
- Modify: `src/modes/content.ts`

**Step 1: Implement content mode**

Sub-actions: `courses`, `lesson`, `documents`, `document`, `create_lesson`, `update_lesson`, `videos`.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleContent(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action ?? "courses";

  if (action === "courses") {
    const courses = await api.get<any[]>("/courses");
    return JSON.stringify({ count: courses.length, courses });
  }

  if (action === "lesson") {
    if (!params.lesson_id) return JSON.stringify({ error: "Required: 'lesson_id'" });
    const lesson = await api.get<any>(`/lessons/${params.lesson_id}`);
    return JSON.stringify(lesson);
  }

  if (action === "documents") {
    const queryParams: Record<string, unknown> = {};
    if (params.limit) queryParams.limit = params.limit;
    if (params.document_id) queryParams.startingAfter = params.document_id; // cursor pagination
    const docs = await api.get<any[]>("/documents", queryParams);
    return JSON.stringify({ count: docs.length, documents: docs });
  }

  if (action === "document") {
    if (!params.document_id) return JSON.stringify({ error: "Required: 'document_id'" });
    const doc = await api.get<any>(`/documents/${params.document_id}`);
    return JSON.stringify(doc);
  }

  if (action === "create_lesson") {
    if (!params.title || !params.content_text) {
      return JSON.stringify({ error: "Required: 'title' and 'content_text'" });
    }
    const body: Record<string, unknown> = {
      title: params.title,
      content: params.content_text,
    };
    if (params.course_id) body.courseID = params.course_id;
    const result = await api.put<any>("/lessons", body);
    return JSON.stringify({ action: "lesson_created", lesson: result });
  }

  if (action === "update_lesson") {
    if (!params.lesson_id) return JSON.stringify({ error: "Required: 'lesson_id'" });
    const body: Record<string, unknown> = {};
    if (params.title) body.title = params.title;
    if (params.content_text) body.content = params.content_text;
    const result = await api.post<any>(`/lessons/${params.lesson_id}`, body);
    return JSON.stringify({ action: "lesson_updated", lesson: result });
  }

  if (action === "videos") {
    const videos = await api.get<any[]>("/videos");
    return JSON.stringify({ count: videos.length, videos });
  }

  return JSON.stringify({ error: `Unknown content action: ${action}` });
}
```

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/content.ts
git commit -m "feat: implement content mode for courses, lessons, documents, videos"
```

---

### Task 11: Mode — manage

**Files:**
- Modify: `src/modes/manage.ts`

**Step 1: Implement manage mode**

Admin CRUD operations dispatched by `action` param. This is the largest mode — covers users, groups, channels, invitations, webhooks, voice channels, channel categories, roles, offers, signup pages.

The implementation routes `action` to the appropriate API call. Each action validates its required params and calls the corresponding endpoint.

Key actions to implement:
- `create_user` → PUT /users
- `update_user` → POST /users
- `delete_user` → DELETE /users
- `reactivate_user` → POST /users/reactivate
- `create_pending_user` → PUT /pendingUser
- `create_group` / `update_group` / `delete_group` → PUT/POST/DELETE /groups
- `add_to_group` / `remove_from_group` → PUT/DELETE /groups/{id}/memberships
- `create_channel` / `update_channel` / `delete_channel` → PUT/POST/DELETE /channels
- `create_channel_category` / `update_channel_category` / `delete_channel_category`
- `create_invitation` / `update_invitation` / `list_invitations`
- `create_webhook` / `delete_webhook` / `list_webhooks`
- `create_voice_channel` / `update_voice_channel`
- `list_roles`
- `list_offers` / `list_signup_pages`

Each action follows the pattern:
```typescript
if (action === "create_user") {
  if (!params.email || !params.name) return JSON.stringify({ error: "Required: 'email' and 'name'" });
  const result = await api.put("/users", { email: params.email, name: params.name, ...params.updates });
  return JSON.stringify({ action: "user_created", user: result });
}
```

Implement all actions following this pattern.

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/manage.ts
git commit -m "feat: implement manage mode with full admin CRUD operations"
```

---

### Task 12: Mode — dashboard (compound)

**Files:**
- Modify: `src/modes/dashboard.ts`

**Step 1: Implement dashboard mode**

This is the compound mode — fetches multiple resources in parallel and synthesizes into a prioritized summary.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, HBChannel, HBThread, buildUserMap, stripHtml, timeAgo, summarizeUser } from "../helpers.js";

export async function handleDashboard(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  // Parallel fetch: users, channels, events, courses, notifications
  const [users, channels, events, courses, notifications] = await Promise.all([
    api.get<HBUser[]>("/users"),
    api.get<HBChannel[]>("/channels"),
    api.get<any[]>("/events"),
    api.get<any[]>("/courses"),
    api.get<any[]>("/notifications").catch(() => []), // notifications may fail
  ]);

  // Fetch threads from all channels in parallel (up to 10 channels)
  const channelThreads = await Promise.all(
    channels.slice(0, 10).map(async (ch) => {
      try {
        const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
        return { channel: ch.name, channelID: ch.id, threads };
      } catch {
        return { channel: ch.name, channelID: ch.id, threads: [] };
      }
    })
  );

  const userMap = new Map(users.map((u) => [u.id, u.name]));

  // Build needs_attention
  const needsAttention: Array<Record<string, unknown>> = [];

  // 1. Unanswered threads (threads in last 7 days with no comments)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const ct of channelThreads) {
    for (const t of ct.threads) {
      const threadAge = new Date(t.createdAt).getTime();
      if (threadAge > sevenDaysAgo) {
        // We can't see comment count from the list endpoint, but we flag recent threads
        needsAttention.push({
          type: "recent_thread",
          channel: ct.channel,
          author: userMap.get(t.userID) ?? t.userID,
          preview: stripHtml(t.text),
          age: timeAgo(t.createdAt),
          thread_id: t.id,
        });
      }
    }
  }

  // 2. New members (no completedLessons, indicating fresh accounts)
  const newMembers = users.filter(
    (u) => !u.completedLessons || u.completedLessons.length === 0
  );

  for (const u of newMembers.slice(0, 5)) {
    needsAttention.push({
      type: "new_member",
      name: u.name,
      email: u.email,
      groups: u.groupIDs?.length ?? 0,
      user_id: u.id,
    });
  }

  // Upcoming events (future events)
  const now = Date.now();
  const upcomingEvents = events
    .filter((e: any) => new Date(e.startTime).getTime() > now)
    .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 5);

  // Recent activity (most recent threads across all channels)
  const allThreads = channelThreads
    .flatMap((ct) => ct.threads.map((t) => ({ ...t, channelName: ct.channel })))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const result = {
    summary: {
      total_members: users.length,
      new_members: newMembers.length,
      active_channels: channels.length,
      upcoming_events: upcomingEvents.length,
      courses_available: courses.length,
      total_recent_threads: allThreads.length,
    },
    needs_attention: needsAttention.slice(0, 10),
    recent_activity: allThreads.map((t: any) => ({
      channel: t.channelName,
      author: userMap.get(t.userID) ?? t.userID,
      preview: stripHtml(t.text),
      age: timeAgo(t.createdAt),
      thread_id: t.id,
    })),
    upcoming_events: upcomingEvents.map((e: any) => ({
      name: e.name,
      start: e.startTime,
      duration: e.duration,
      location: e.location,
    })),
    notifications: (notifications as any[]).slice(0, 5),
  };

  return JSON.stringify(result);
}
```

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/dashboard.ts
git commit -m "feat: implement dashboard compound mode with parallel fetches"
```

---

### Task 13: Mode — analytics (compound)

**Files:**
- Modify: `src/modes/analytics.ts`

**Step 1: Implement analytics mode**

Computes metrics from raw API data. Each metric sub-type fetches the data it needs and computes server-side.

Key metrics:
- `engagement_scores`: Per-user score = threads authored + events attended + lessons completed
- `channel_activity`: Channels ranked by thread count + top contributors per channel
- `event_metrics`: Attendance rate per event, repeat attendees
- `course_progress`: Completion % per course based on user completedLessons
- `member_segments`: Buckets — new (0 lessons), active (1+ lessons), at-risk (no group/lessons)
- `growth`: Total members, group distribution
- `top_contributors`: Leaderboard by thread authorship per channel

Implementation: Fetch users, channels+threads, events+attendance in parallel. Compute the requested metric. Return compact JSON.

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/analytics.ts
git commit -m "feat: implement analytics mode with computed engagement metrics"
```

---

### Task 14: Mode — search (compound)

**Files:**
- Modify: `src/modes/search.ts`

**Step 1: Implement search mode**

Fetches specified resources in parallel, filters locally by query match.

```typescript
import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, HBChannel, HBThread, stripHtml } from "../helpers.js";

export async function handleSearch(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  if (!params.query) return JSON.stringify({ error: "Required: 'query'" });

  const q = params.query.toLowerCase();
  const resourcesToSearch = params.resources ?? ["members", "threads", "documents", "events"];
  const limit = params.limit ?? 10;
  const results: Record<string, unknown[]> = {};

  const fetches: Array<Promise<void>> = [];

  if (resourcesToSearch.includes("members")) {
    fetches.push(
      api.get<HBUser[]>("/users").then((users) => {
        results.members = users
          .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
          .slice(0, limit)
          .map((u) => ({ id: u.id, name: u.name, email: u.email }));
      })
    );
  }

  if (resourcesToSearch.includes("threads")) {
    fetches.push(
      api.get<HBChannel[]>("/channels").then(async (channels) => {
        const threadResults: unknown[] = [];
        for (const ch of channels.slice(0, 10)) {
          try {
            const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
            for (const t of threads) {
              if (stripHtml(t.text, 500).toLowerCase().includes(q)) {
                threadResults.push({
                  id: t.id, channel: ch.name, preview: stripHtml(t.text), created: t.createdAt,
                });
              }
            }
          } catch { /* skip unavailable channels */ }
        }
        results.threads = threadResults.slice(0, limit);
      })
    );
  }

  if (resourcesToSearch.includes("documents")) {
    fetches.push(
      api.get<any[]>("/documents").then((docs) => {
        results.documents = docs
          .filter((d: any) =>
            (d.title?.toLowerCase().includes(q)) ||
            (d.description?.toLowerCase().includes(q))
          )
          .slice(0, limit)
          .map((d: any) => ({ id: d.id, title: d.title, description: d.description }));
      })
    );
  }

  if (resourcesToSearch.includes("events")) {
    fetches.push(
      api.get<any[]>("/events").then((events) => {
        results.events = events
          .filter((e: any) => e.name?.toLowerCase().includes(q))
          .slice(0, limit)
          .map((e: any) => ({ id: e.id, name: e.name, startTime: e.startTime }));
      })
    );
  }

  await Promise.all(fetches);

  return JSON.stringify({
    query: params.query,
    results,
    total: Object.values(results).reduce((sum, arr) => sum + arr.length, 0),
  });
}
```

**Step 2: Build, test, commit**

```bash
npm run build
git add src/modes/search.ts
git commit -m "feat: implement search mode with cross-resource parallel search"
```

---

### Task 15: HTTP Transport (Remote/Coolify)

**Files:**
- Modify: `src/index.ts` — add HTTP transport option

**Step 1: Add dual transport support**

Add express-based streamable HTTP transport when `PORT` env var is set, following the notion-affiliate pattern and mcp-builder guide.

```typescript
// At the end of main(), replace the transport block:

const PORT = process.env.PORT ? Number(process.env.PORT) : null;

if (PORT) {
  // HTTP transport for remote (Coolify)
  const express = (await import("express")).default;
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.listen(PORT, () => {
    console.error(`Heartbeat MCP server running on http://0.0.0.0:${PORT}/mcp`);
  });
} else {
  // stdio transport for local
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Heartbeat MCP server running via stdio");
}
```

**Step 2: Build, test locally**

Run: `npm run build && PORT=3456 HEARTBEAT_API_KEY=... node dist/index.js`
Expected: Server starts on port 3456 with health check at `/health`

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add HTTP transport for remote deployment via Coolify"
```

---

### Task 16: Register with Claude Code & Smoke Test

**Step 1: Register the MCP server locally**

```bash
claude mcp add-json heartbeat '{
  "command": "node",
  "args": ["/Users/urbs/Documents/Apps/heartbeat-mcp/dist/index.js"],
  "env": {
    "HEARTBEAT_API_KEY": "<key from .env>"
  }
}'
```

**Step 2: Smoke test all modes**

In a new Claude Code session, test each mode:
1. `heartbeat(mode: "dashboard")` — verify compound view
2. `heartbeat(mode: "members", limit: 3)` — verify user list
3. `heartbeat(mode: "threads", channel: "<any channel>")` — verify threads
4. `heartbeat(mode: "events")` — verify event list
5. `heartbeat(mode: "content", action: "courses")` — verify courses
6. `heartbeat(mode: "analytics", metric: "member_segments")` — verify computed analytics
7. `heartbeat(mode: "search", query: "test")` — verify cross-resource search

**Step 3: Fix any issues found during smoke test**

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: smoke test fixes for MCP tool registration"
```

---

### Task 17: Skill (SKILL.md)

**Files:**
- Create: `~/.claude/skills/heartbeat/SKILL.md`

**Step 1: Write the skill**

Create a lightweight technique skill (~200-300 words) that teaches Claude:
- When to use the heartbeat tool
- Which mode for which task
- Common workflow patterns
- Write operation safety (confirm before DMs/posts)

```markdown
---
name: heartbeat
description: Use when managing a Heartbeat.chat community — checking engagement, posting content, messaging members, analyzing health, running community operations, or when the user mentions their community, coaching clients, or Heartbeat.
---

# Heartbeat Community Manager

Use the `heartbeat` MCP tool to manage a Heartbeat.chat community.

## Mode Selection

| Task | Mode | Key params |
|------|------|------------|
| Check community pulse | `dashboard` | (none) |
| Find/list members | `members` | search, group, limit |
| Read channel discussions | `threads` | channel (name or ID) |
| Post content | `post` | channel, text (HTML) |
| Message a member | `dm` | to (name/email/ID), text |
| Events & attendance | `events` | action: list/get/attendance/create |
| Courses & docs | `content` | action: courses/lesson/documents |
| Engagement metrics | `analytics` | metric: member_segments/engagement_scores/... |
| Find anything | `search` | query |
| Admin operations | `manage` | action: create_user/create_group/... |

## Workflows

**Daily check-in:** `dashboard` → review needs_attention → act on top items
**Onboarding:** `members(search="name")` → `dm(to="name", text="Welcome!")` → `post(channel="introductions")`
**Advisory:** User provides context → `dashboard` + `analytics` → map strategy to concrete actions

## Safety

**Always confirm before write operations** (post, dm, manage). Show the user what will be sent before executing.
```

**Step 2: Commit skill**

```bash
cd ~/.claude/skills && mkdir -p heartbeat
# Write SKILL.md (already done above)
cd heartbeat && git add SKILL.md && git commit -m "feat: add heartbeat community management skill"
```

---

### Task 18: Deploy to Coolify (Remote)

**Step 1: Create Dockerfile**

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Step 2: Build production**

```bash
npm run build
```

**Step 3: Deploy via Coolify**

Push to GitHub → configure Coolify to deploy from the repo with:
- Port: 3000
- Env: `HEARTBEAT_API_KEY`, `PORT=3000`
- Health check: `/health`

**Step 4: Test remote endpoint**

```bash
curl http://46.224.152.172:8000/heartbeat/health
```

**Step 5: Commit Dockerfile**

```bash
git add Dockerfile
git commit -m "feat: add Dockerfile for Coolify deployment"
```

---

## Execution Order

Tasks 1-4 are sequential (foundation). Tasks 5-14 can be partially parallelized (independent mode implementations). Tasks 15-18 are sequential (integration and deployment).

**Critical path:** 1 → 2 → 3 → 4 → [5-14 in any order] → 15 → 16 → 17 → 18

**Estimated effort:** Tasks 1-4: ~30min. Tasks 5-14: ~60min. Tasks 15-18: ~30min. Total: ~2 hours.
