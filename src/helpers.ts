import { HeartbeatAPI } from "./api.js";

// ---------- Shared types ----------

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

// ---------- Name resolution ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a channel name or ID to a channel ID.
 * If the input looks like a UUID it is returned directly.
 * Otherwise all channels are fetched and matched case-insensitively.
 */
export async function resolveChannel(api: HeartbeatAPI, nameOrId: string): Promise<string> {
  if (UUID_RE.test(nameOrId)) return nameOrId;

  const channels = await api.get<HBChannel[]>("/channels");
  const match = channels.find((c) => c.name.toLowerCase() === nameOrId.toLowerCase());
  if (match) return match.id;

  const similar = channels
    .filter((c) => c.name.toLowerCase().includes(nameOrId.toLowerCase()))
    .map((c) => c.name);

  throw new Error(
    `No channel named "${nameOrId}". ${
      similar.length
        ? `Did you mean: ${similar.join(", ")}?`
        : `Available: ${channels.map((c) => c.name).join(", ")}`
    }`,
  );
}

/**
 * Resolve a user name, email, or ID to a full HBUser object.
 * UUID -> direct fetch, email (@) -> /find/users, name -> local filter.
 */
export async function resolveUser(api: HeartbeatAPI, nameOrEmailOrId: string): Promise<HBUser> {
  if (UUID_RE.test(nameOrEmailOrId)) {
    return api.get<HBUser>(`/users/${nameOrEmailOrId}`);
  }

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

  throw new Error(
    `Multiple users match "${nameOrEmailOrId}": ${matches
      .map((u) => `${u.name} (${u.email})`)
      .join(", ")}. Be more specific or use email/ID.`,
  );
}

/**
 * Build a user-ID-to-name lookup map.
 */
export async function buildUserMap(api: HeartbeatAPI): Promise<Map<string, string>> {
  const users = await api.get<HBUser[]>("/users");
  const map = new Map<string, string>();
  for (const u of users) map.set(u.id, u.name);
  return map;
}

// ---------- Formatting ----------

/**
 * Summarize a user for compact display.
 * detail="summary" returns id, name, email, role, groups count, status, lessons_completed count.
 * detail="full" adds bio, groupIDs, social links, profilePicture.
 */
export function summarizeUser(
  user: HBUser,
  detail: "summary" | "full" = "summary",
): Record<string, unknown> {
  // FIX 8: summary now includes roleID and status per spec
  const base: Record<string, unknown> = {
    id: user.id,
    name: user.name,
    email: user.email,
    roleID: user.roleID,
    status: user.status || "",
    groups: user.groupIDs?.length ?? 0,
    lessons_completed: user.completedLessons?.length ?? 0,
  };
  if (detail === "full") {
    base.bio = user.bio || "";
    base.groupIDs = user.groupIDs;
    base.profilePicture = user.profilePicture || "";
    base.linkedin = user.linkedin || "";
    base.twitter = user.twitter || "";
    base.instagram = user.instagram || "";
  }
  return base;
}

/**
 * Strip HTML tags and truncate to maxLen characters.
 */
export function stripHtml(html: string, maxLen = 150): string {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

/**
 * Return a human-readable relative time string like "5m ago", "3h ago", "2d ago".
 */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
