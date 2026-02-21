import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, HBChannel, HBThread, stripHtml, timeAgo } from "../helpers.js";

export async function handleDashboard(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  // Parallel fetch: users, channels, events, courses, notifications
  const [users, channels, events, courses, notifications] = await Promise.all([
    api.get<HBUser[]>("/users"),
    api.get<HBChannel[]>("/channels"),
    api.get<Array<Record<string, unknown>>>("/events"),
    api.get<unknown[]>("/courses"),
    api.get<unknown[]>("/notifications").catch(() => []), // notifications endpoint may fail
  ]);

  // Fetch threads from all channels in parallel (up to 10 channels)
  const channelThreads = await Promise.all(
    channels.slice(0, 10).map(async (ch) => {
      try {
        const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
        return { channel: ch.name, channelID: ch.id, threads };
      } catch {
        return { channel: ch.name, channelID: ch.id, threads: [] as HBThread[] };
      }
    }),
  );

  const userMap = new Map(users.map((u) => [u.id, u.name]));

  // Build set of users with recent thread activity (last 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentThreadAuthors = new Set<string>();
  const allThreadAuthors = new Set<string>();
  for (const ct of channelThreads) {
    for (const t of ct.threads) {
      allThreadAuthors.add(t.userID);
      if (new Date(t.createdAt).getTime() > thirtyDaysAgo) {
        recentThreadAuthors.add(t.userID);
      }
    }
  }

  // Build needs_attention
  const needsAttention: Array<Record<string, unknown>> = [];

  // 1. Recent threads (last 7 days) that may need responses
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const ct of channelThreads) {
    for (const t of ct.threads) {
      const threadAge = new Date(t.createdAt).getTime();
      if (threadAge > sevenDaysAgo) {
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

  // 2. New members (no completed lessons, indicating fresh accounts)
  const newMembers = users.filter(
    (u) => !u.completedLessons || u.completedLessons.length === 0,
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

  // 3. FIX 7: at_risk members — had some past activity but no recent threads
  const atRiskMembers: Array<Record<string, unknown>> = [];
  for (const u of users) {
    const lessonsCount = u.completedLessons?.length ?? 0;
    const hasRecentThreads = recentThreadAuthors.has(u.id);
    const hasAnyThreads = allThreadAuthors.has(u.id);
    // At risk: completed lessons or authored threads in the past, but no recent thread activity
    if ((lessonsCount > 0 || hasAnyThreads) && !hasRecentThreads) {
      atRiskMembers.push({
        type: "at_risk",
        name: u.name,
        email: u.email,
        lessons_completed: lessonsCount,
        had_thread_activity: hasAnyThreads,
        user_id: u.id,
      });
    }
  }
  // Add top at-risk members to needs_attention
  for (const m of atRiskMembers.slice(0, 5)) {
    needsAttention.push(m);
  }

  // Upcoming events (future events sorted by start time)
  // FIX 6: include RSVP note
  const now = Date.now();
  const upcomingEvents = events
    .filter((e) => new Date(e.startTime as string).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a.startTime as string).getTime() - new Date(b.startTime as string).getTime(),
    )
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
      at_risk_members: atRiskMembers.length,
      active_channels: channels.length,
      upcoming_events: upcomingEvents.length,
      courses_available: courses.length,
      total_recent_threads: allThreads.length,
    },
    needs_attention: needsAttention.slice(0, 15),
    recent_activity: allThreads.map((t) => ({
      channel: t.channelName,
      author: userMap.get(t.userID) ?? t.userID,
      preview: stripHtml(t.text),
      age: timeAgo(t.createdAt),
      thread_id: t.id,
    })),
    upcoming_events: upcomingEvents.map((e) => ({
      name: e.name,
      start: e.startTime,
      duration: e.duration,
      location: e.location,
      invited_users_count: (e.invitedUsers as string[] | undefined)?.length ?? null,
      invited_groups_count: (e.invitedGroups as string[] | undefined)?.length ?? null,
      rsvp_note: "Full RSVP data requires per-event attendance fetch (mode: events, action: attendance)",
    })),
    notifications: (notifications as unknown[]).slice(0, 5),
  };

  return JSON.stringify(result);
}
