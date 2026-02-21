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
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
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
