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

    const result = await api.put<Record<string, unknown>>("/comments", body);
    return JSON.stringify({
      action: "comment_created",
      comment_id: result.id,
      thread_id: params.thread_id,
      text: params.text,
    });
  }

  // Create new thread
  if (!params.channel) {
    return JSON.stringify({ error: "Required: 'channel' (name or ID) to create a thread, or 'thread_id' to comment on an existing thread" });
  }

  const channelID = await resolveChannel(api, params.channel);
  const body: Record<string, unknown> = {
    text: params.text,
    channelID,
  };
  if (params.user_id) body.userID = params.user_id;

  const result = await api.put<Record<string, unknown>>("/threads", body);
  return JSON.stringify({
    action: "thread_created",
    thread_id: result.id,
    channel: params.channel,
    channel_id: channelID,
    text: params.text,
  });
}
