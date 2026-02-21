# Heartbeat MCP Server — Design Document

**Date:** 2026-02-21
**Status:** Approved

## Problem

Manage a Heartbeat.chat coaching community efficiently via Claude. Need full API coverage (the official MCP server only covers 5/30+ endpoints), computed analytics, and advisory+execution capabilities across desktop and mobile.

## Architecture

### Single-file MCP server (TypeScript-compiled JS)

```
heartbeat-mcp/
  .env                  # HEARTBEAT_API_KEY
  .gitignore
  package.json
  index.js              # Main server
  CLAUDE.md             # Project instructions
```

**Transport:** Dual stdio (local Claude Code) + HTTP with Bearer token (remote via Coolify at 46.224.152.172:8000)

**API Client:** Direct HTTP to `https://api.heartbeat.chat/v0/*` with Bearer token auth. Not using Heartbeat's official TypeScript SDK (only covers 5 resources). Built-in retry with exponential backoff for 429s (10 req/sec limit).

**Pattern:** Follows notion-affiliate server conventions — single tool, multi-mode, Zod schemas, JSON responses.

## Tool Design

**One tool:** `heartbeat`
**10 modes:**

### 1. `dashboard` (read, compound)
Parallel fetches: users, channels, threads (per channel), events, courses, notifications.
Returns prioritized summary:
- `summary`: total_members, new_members_this_week, active_channels, upcoming_events, courses_available
- `needs_attention`: unanswered_threads, new_members, at_risk_members (sorted by priority)
- `recent_activity`: latest threads/comments across channels
- `upcoming_events`: next 5 events with RSVP counts
- `notifications`: unread notifications

### 2. `members` (read)
Params: `search` (name/email), `group` (filter by group), `role` (filter by role), `fields` (field selection), `limit`, `offset`, `detail` (summary/full)
- Fetches all users, filters locally (API has no name search — only exact email via /find/users)
- Returns: id, name, email, role, groups, status, completedLessons count
- `detail="full"` adds: bio, social links, profile picture

### 3. `threads` (read)
Params: `channel` (name or ID), `thread_id` (single thread with comments)
- Without thread_id: returns 20 most recent threads in channel with comment counts
- With thread_id: returns full thread with all comments and nested replies
- Auto-resolves channel names to IDs

### 4. `post` (write)
Params: `channel` (name or ID), `text` (HTML), `thread_id` (to comment), `parent_comment_id` (nested reply), `user_id` (optional, admin impersonation)
- Creates threads or comments
- Rich text: `<p>`, `<b>`, `<h1>`-`<h3>`, `<ul>/<li>`, `<a href>`, `<br>`, `@UUID` mentions
- Auto-resolves channel names to IDs

### 5. `dm` (read/write)
Params: `action` (send/read/create_chat), `to` (user ID, name, or email), `text` (HTML for send), `chat_id` (for read)
- `send`: sends direct message, resolves names/emails to user IDs
- `read`: retrieves messages from a chat
- `create_chat`: creates a new direct chat

### 6. `events` (read/write)
Params: `action` (list/get/attendance/create), `event_id`, `group` (filter), event creation fields (name, description, startTime, duration, location, invitedUsers, invitedGroups)
- `list`: all events, optionally filtered by group
- `get`: single event with instances
- `attendance`: attendance data for last 10 instances
- `create`: create new event

### 7. `content` (read/write)
Params: `action` (courses/lesson/documents/document/create_lesson/update_lesson/videos), `lesson_id`, `document_id`, lesson creation/update fields (title, content, courseID)
- `courses`: list all courses
- `lesson`: get lesson by ID (includes embedded content cards)
- `documents`: paginated document list
- `document`: single document with full content
- `create_lesson` / `update_lesson`: CRUD on lessons
- `videos`: list all videos

### 8. `analytics` (read, compound)
Params: `metric` (engagement_scores/channel_activity/event_metrics/course_progress/member_segments/growth/top_contributors), `limit`
- All metrics computed server-side from raw API data
- `engagement_scores`: per-member composite score (threads + comments + events + courses)
- `channel_activity`: ranked channels by thread volume, top contributors per channel
- `event_metrics`: attendance rates per event, repeat attendees
- `course_progress`: completion % per course, stalled members
- `member_segments`: buckets (new <7d, active, at-risk no activity, churned)
- `growth`: total members, new members count
- `top_contributors`: leaderboard by activity type

### 9. `search` (read, compound)
Params: `query`, `resources` (array: members/threads/documents/events — default all), `limit`
- Fetches all specified resources in parallel
- Filters locally by query match (name, email, thread text, document title/content, event name)
- Returns categorized results: `{ members: [...], threads: [...], documents: [...], events: [...] }`

### 10. `manage` (write)
Params: `action`, plus action-specific params
Actions:
- `create_user` / `update_user` / `delete_user` / `reactivate_user`
- `create_group` / `update_group` / `delete_group` / `add_to_group` / `remove_from_group`
- `create_channel` / `update_channel` / `delete_channel`
- `create_channel_category` / `update_channel_category` / `delete_channel_category`
- `create_invitation` / `update_invitation` / `list_invitations`
- `create_webhook` / `delete_webhook` / `list_webhooks`
- `create_voice_channel` / `update_voice_channel`
- `create_pending_user` (invitation)
- `list_roles`

## Token Optimization

### Fixed cost: ~350-450 tokens (tool schema, loads once per session)

### Per-call optimizations:
1. **Server-side summarization**: Raw API data processed internally, only actionable summaries returned
2. **Detail levels**: `detail` param — `"summary"` (default, compact) vs `"full"` (everything)
3. **Pagination**: `limit` + `offset` on all list operations, default 20 items
4. **Field selection**: `fields` array to return only specific fields
5. **60-second cache**: Read operations cached, dashboard doesn't re-fetch within 60s
6. **Lazy loading**: Dashboard returns IDs + previews; drill into details only when needed

### Estimated per-call token cost:
- dashboard: ~700 tokens
- members (20 items): ~400 tokens
- threads: ~300 tokens
- analytics: ~500 tokens
- post/dm (response): ~150-200 tokens

## Error Handling

- **401**: "API key invalid or expired"
- **404**: "Resource not found: [ID]"
- **429**: Auto-retry with exponential backoff (transparent)
- **400**: Return Heartbeat validation details
- **Name resolution**: If ambiguous, return all matches for disambiguation. If no match, suggest alternatives.

## Write Operation Safety

All write modes return a preview of what will be sent. Claude should confirm with user before executing. MCP server validates inputs (HTML sanitization, UUID resolution) before sending.

## Deployment

- **Local**: stdio via `node index.js`, registered in `~/.claude/mcp.json`
- **Remote**: HTTP mode on Coolify (46.224.152.172:8000), Bearer token auth
- **Registration**: `claude mcp add-json heartbeat '{"command":"node","args":["/path/to/index.js"],"env":{"HEARTBEAT_API_KEY":"..."}}'`

## Skill (SKILL.md)

Lightweight technique skill (~200-300 words) that teaches Claude:
- Which mode to use for which task
- Common workflows: daily check-in, onboarding, content posting, engagement analysis
- How to chain calls: dashboard → drill into specifics → take action
- Write operation safety: always confirm before DMs/posts
- Advisory mode: accept strategy context from user, map to concrete actions via analytics + dashboard

## API Coverage

### Heartbeat REST API endpoints → MCP modes:

| Endpoint | Mode |
|---|---|
| GET /users, GET /users/{id}, GET /find/users | members |
| POST /users, PUT /users, DELETE /users, POST /users/reactivate | manage |
| PUT /pendingUser | manage |
| GET /notifications | dashboard |
| GET /channels, GET /channelCategories | members, manage |
| PUT/POST/DELETE channels, channelCategories | manage |
| GET /channels/{id}/threads, GET /threads/{id} | threads |
| PUT /threads | post |
| PUT /comments | post |
| GET /events, GET /events/{id}, GET /events/{id}/instances | events |
| PUT /events | events |
| GET /events/{id}/attendance | events, analytics |
| GET /courses, GET /lessons/{id}, PUT /lessons, POST /lessons/{id} | content |
| GET /videos | content |
| GET /documents, GET /documents/{id} | content |
| PUT /directChats, PUT /directMessages, GET /directMessages/{id} | dm |
| PUT /chatChannel/{id}/message | post (chat channels) |
| GET /invitations, PUT /invitations, POST /invitations/{id} | manage |
| GET /roles | manage, members |
| GET/PUT/DELETE groups, memberships | manage |
| PUT/POST voiceChannels | manage |
| GET/PUT/DELETE webhooks | manage |
| GET /offers, GET /signup_pages | manage |

### Webhook events (for v2 listener):
USER_JOIN, USER_UPDATE, EVENT_CREATE, EVENT_RSVP, THREAD_CREATE, MENTION, DIRECT_MESSAGE, COURSE_COMPLETED, GROUP_JOIN, ABANDONED_CART, DOCUMENT_CREATE

## Future (v2+)

1. **Snapshot system**: Cron stores community state to SQLite for trend/delta analysis
2. **Webhook listener**: Real-time activity log from 11 webhook event types
3. **Bulk operations**: Batch DMs, bulk group assignments, mass invitations
4. **Chat channel messages**: Full chat (non-forum) channel support
