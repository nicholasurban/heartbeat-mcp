import { z } from "zod";
import { HeartbeatAPI, handleApiError } from "./api.js";

// Import mode handlers
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
  mode: z
    .enum([
      "dashboard",
      "members",
      "threads",
      "post",
      "dm",
      "events",
      "content",
      "analytics",
      "search",
      "manage",
    ])
    .describe("Operation mode"),

  // Shared params
  detail: z
    .enum(["summary", "full"])
    .default("summary")
    .optional()
    .describe("Response detail level"),
  limit: z.number().int().min(1).max(100).default(20).optional().describe("Max results to return"),
  offset: z.number().int().min(0).default(0).optional().describe("Pagination offset"),

  // members params
  search: z.string().optional().describe("Search by name or email (members, search modes)"),
  group: z.string().optional().describe("Filter by group name or ID"),
  role: z.string().optional().describe("Filter by role ID"),
  fields: z.array(z.string()).optional().describe("Specific fields to return"),

  // threads params
  channel: z.string().optional().describe("Channel name or ID"),
  thread_id: z.string().optional().describe("Thread ID (get single thread with comments)"),

  // post params
  text: z
    .string()
    .optional()
    .describe(
      "Rich text content (HTML: <p>, <b>, <h1>-<h3>, <ul>/<li>, <a href>, <br>, @UUID mentions)",
    ),
  parent_comment_id: z
    .string()
    .optional()
    .describe("Parent comment ID for nested reply (post mode)"),
  user_id: z.string().optional().describe("Admin user ID to post as (optional)"),

  // dm params
  to: z.string().optional().describe("Recipient: user ID, name, or email (dm mode)"),
  from: z.string().optional().describe("Sender user ID (dm mode, admin only)"),
  chat_id: z.string().optional().describe("Chat ID for reading messages (dm mode)"),

  // events / dm / content / manage sub-action
  action: z
    .string()
    .optional()
    .describe(
      "Sub-action: list/get/attendance/create (events), send/read/create_chat (dm), courses/lesson/documents/document/create_lesson/update_lesson/videos (content), or manage actions",
    ),
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
  resources: z
    .array(z.enum(["members", "threads", "documents", "events"]))
    .optional()
    .describe("Resources to search (default: all)"),

  // manage params
  email: z.string().optional().describe("User email (manage: create_user, create_pending_user)"),
  name: z.string().optional().describe("Name (manage: create_user, create_group, etc.)"),
  group_id: z.string().optional().describe("Group ID (manage operations)"),
  channel_id: z.string().optional().describe("Channel ID (manage operations)"),
  webhook_url: z.string().optional().describe("Webhook URL (manage: create_webhook)"),
  webhook_action: z.string().optional().describe("Webhook event name (manage: create_webhook)"),
  invitation_id: z.string().optional().describe("Invitation ID (manage operations)"),
  updates: z.record(z.string(), z.unknown()).optional().describe("Key-value pairs for updates"),

  // analytics params
  metric: z
    .enum([
      "engagement_scores",
      "channel_activity",
      "event_metrics",
      "course_progress",
      "member_segments",
      "growth",
      "top_contributors",
    ])
    .optional()
    .describe("Analytics metric to compute"),
};

/** Inferred type from the tool schema */
export type ToolParams = z.infer<z.ZodObject<typeof TOOL_SCHEMA>>;

/**
 * Main tool handler — dispatches to the appropriate mode handler.
 */
export async function toolHandler(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  try {
    switch (params.mode) {
      case "dashboard":
        return await handleDashboard(api, params);
      case "members":
        return await handleMembers(api, params);
      case "threads":
        return await handleThreads(api, params);
      case "post":
        return await handlePost(api, params);
      case "dm":
        return await handleDm(api, params);
      case "events":
        return await handleEvents(api, params);
      case "content":
        return await handleContent(api, params);
      case "analytics":
        return await handleAnalytics(api, params);
      case "search":
        return await handleSearch(api, params);
      case "manage":
        return await handleManage(api, params);
      default:
        return JSON.stringify({ error: `Unknown mode: ${(params as Record<string, unknown>).mode}` });
    }
  } catch (err) {
    return JSON.stringify({ error: handleApiError(err) });
  }
}
