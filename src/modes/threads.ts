import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { resolveChannel, buildUserMap, stripHtml, timeAgo, HBThread } from "../helpers.js";

export async function handleThreads(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  // Single thread with comments
  if (params.thread_id) {
    const thread = await api.get<Record<string, unknown>>(`/threads/${params.thread_id}`);
    const userMap = await buildUserMap(api);
    const comments = (thread.comments ?? []) as Array<Record<string, unknown>>;
    return JSON.stringify({
      id: thread.id,
      author: userMap.get(thread.userID as string) ?? thread.userID,
      text: thread.text,
      created: thread.createdAt,
      age: timeAgo(thread.createdAt as string),
      comments: comments.map((c) => ({
        id: c.id,
        author: userMap.get(c.userID as string) ?? c.userID,
        text: c.text,
        created: c.createdAt,
        age: timeAgo(c.createdAt as string),
        replies: ((c.replies ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          author: userMap.get(r.userID as string) ?? r.userID,
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
