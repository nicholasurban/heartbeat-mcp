import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { resolveUser } from "../helpers.js";

export async function handleDm(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action ?? "send";

  if (action === "read") {
    if (!params.chat_id) return JSON.stringify({ error: "Required: 'chat_id'" });
    const messages = await api.get<unknown[]>(`/directMessages/${params.chat_id}`);
    return JSON.stringify({ chat_id: params.chat_id, messages });
  }

  if (action === "create_chat") {
    if (!params.to) return JSON.stringify({ error: "Required: 'to' (user ID, name, or email)" });
    const user = await resolveUser(api, params.to);
    const result = await api.put<Record<string, unknown>>("/directChats", { userID: user.id });
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
