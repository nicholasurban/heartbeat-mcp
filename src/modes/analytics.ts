import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, HBChannel, HBThread } from "../helpers.js";

/**
 * Fetch threads from up to `cap` channels and return a flat array with channel metadata.
 * Reused by multiple metrics to avoid duplicating fetch logic.
 */
async function fetchAllThreads(
  api: HeartbeatAPI,
  cap = 10,
): Promise<{ threads: Array<HBThread & { channelName: string }>; channels: HBChannel[] }> {
  const channels = await api.get<HBChannel[]>("/channels");
  const capped = channels.slice(0, cap);
  const allThreads: Array<HBThread & { channelName: string }> = [];

  await Promise.all(
    capped.map(async (ch) => {
      try {
        const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
        for (const t of threads) {
          allThreads.push({ ...t, channelName: ch.name });
        }
      } catch {
        // skip unavailable channels
      }
    }),
  );

  return { threads: allThreads, channels };
}

export async function handleAnalytics(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  if (!params.metric) {
    return JSON.stringify({
      error:
        "Required: 'metric'. Valid metrics: engagement_scores, channel_activity, event_metrics, course_progress, member_segments, growth, top_contributors",
    });
  }

  const metric = params.metric;

  // -- engagement_scores --
  // COMPOSITE score: threads_authored * 3 + lessons_completed * 2 + events_attended * 5
  if (metric === "engagement_scores") {
    const [users, { threads: allThreads }, events] = await Promise.all([
      api.get<HBUser[]>("/users"),
      fetchAllThreads(api, 10),
      api.get<Array<Record<string, unknown>>>("/events"),
    ]);

    // Count threads authored per user
    const threadCounts = new Map<string, number>();
    for (const t of allThreads) {
      threadCounts.set(t.userID, (threadCounts.get(t.userID) ?? 0) + 1);
    }

    // Count events attended per user
    const eventAttendanceCounts = new Map<string, number>();
    await Promise.all(
      events.map(async (e) => {
        try {
          const attendance = await api.get<Array<Record<string, unknown>>>(
            `/events/${e.id}/attendance`,
          );
          for (const a of attendance) {
            const uid = (a.userID ?? a.user_id ?? a.id) as string | undefined;
            if (uid) {
              eventAttendanceCounts.set(uid, (eventAttendanceCounts.get(uid) ?? 0) + 1);
            }
          }
        } catch {
          // skip
        }
      }),
    );

    const scored = users.map((u) => {
      const threadsAuthored = threadCounts.get(u.id) ?? 0;
      const lessonsCompleted = u.completedLessons?.length ?? 0;
      const eventsAttended = eventAttendanceCounts.get(u.id) ?? 0;
      const score = threadsAuthored * 3 + lessonsCompleted * 2 + eventsAttended * 5;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        threads_authored: threadsAuthored,
        lessons_completed: lessonsCompleted,
        events_attended: eventsAttended,
        groups: u.groupIDs?.length ?? 0,
        score,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const limit = params.limit ?? 20;
    return JSON.stringify({
      metric: "engagement_scores",
      scoring_formula: "(threads_authored * 3) + (lessons_completed * 2) + (events_attended * 5)",
      total_users: users.length,
      top: scored.slice(0, limit),
    });
  }

  // -- channel_activity --
  if (metric === "channel_activity") {
    const channels = await api.get<HBChannel[]>("/channels");
    const channelStats = await Promise.all(
      channels.map(async (ch) => {
        try {
          const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
          // Count threads per user for top contributors
          const authorCounts = new Map<string, number>();
          for (const t of threads) {
            authorCounts.set(t.userID, (authorCounts.get(t.userID) ?? 0) + 1);
          }
          const topContributors = [...authorCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([userID, count]) => ({ userID, threads: count }));

          return {
            channel: ch.name,
            channel_id: ch.id,
            thread_count: threads.length,
            top_contributors: topContributors,
          };
        } catch {
          return { channel: ch.name, channel_id: ch.id, thread_count: 0, top_contributors: [] };
        }
      }),
    );
    channelStats.sort((a, b) => b.thread_count - a.thread_count);
    return JSON.stringify({ metric: "channel_activity", channels: channelStats });
  }

  // -- event_metrics --
  // FIX 3: includes repeat_attendees tracking
  if (metric === "event_metrics") {
    const events = await api.get<Array<Record<string, unknown>>>("/events");
    const userEventCounts = new Map<string, number>();

    const eventMetrics = await Promise.all(
      events.map(async (e) => {
        try {
          const attendance = await api.get<Array<Record<string, unknown>>>(
            `/events/${e.id}/attendance`,
          );
          const invited = (e.invitedUsers as string[] | undefined)?.length ?? 0;
          // Track per-user attendance across events
          for (const a of attendance) {
            const uid = (a.userID ?? a.user_id ?? a.id) as string | undefined;
            if (uid) {
              userEventCounts.set(uid, (userEventCounts.get(uid) ?? 0) + 1);
            }
          }
          return {
            id: e.id,
            name: e.name,
            startTime: e.startTime,
            attendees: attendance.length,
            invited,
            attendance_rate: invited > 0 ? Math.round((attendance.length / invited) * 100) : null,
          };
        } catch {
          return {
            id: e.id,
            name: e.name,
            startTime: e.startTime,
            attendees: 0,
            invited: 0,
            attendance_rate: null,
          };
        }
      }),
    );

    // Compute repeat attendees: users who attended more than one event
    const totalUniqueAttendees = userEventCounts.size;
    const repeatAttendeeCount = [...userEventCounts.values()].filter((c) => c > 1).length;

    return JSON.stringify({
      metric: "event_metrics",
      events: eventMetrics,
      repeat_attendees: {
        count: repeatAttendeeCount,
        total_unique_attendees: totalUniqueAttendees,
        percentage:
          totalUniqueAttendees > 0
            ? Math.round((repeatAttendeeCount / totalUniqueAttendees) * 100)
            : 0,
      },
    });
  }

  // -- course_progress --
  // FIX 4: includes stalled_members per course
  if (metric === "course_progress") {
    const [courses, users] = await Promise.all([
      api.get<Array<Record<string, unknown>>>("/courses"),
      api.get<HBUser[]>("/users"),
    ]);

    const courseProgress = courses.map((course) => {
      const lessonIDs = ((course.lessons ?? []) as Array<Record<string, unknown>>).map(
        (l) => l.id as string,
      );
      const totalLessons = lessonIDs.length;
      if (totalLessons === 0) {
        return {
          id: course.id,
          name: course.name,
          total_lessons: 0,
          avg_completion_pct: 0,
          enrolled: 0,
          stalled_members: [] as Array<{ id: string; name: string; completed: number; remaining: number }>,
        };
      }

      let totalCompletion = 0;
      let enrolled = 0;
      const stalledMembers: Array<{ id: string; name: string; completed: number; remaining: number }> = [];

      for (const u of users) {
        const completed = (u.completedLessons ?? []).filter((cl) =>
          lessonIDs.includes(cl.lessonID),
        ).length;
        if (completed > 0) {
          enrolled++;
          totalCompletion += (completed / totalLessons) * 100;
          // Stalled = started but not finished
          if (completed < totalLessons) {
            stalledMembers.push({
              id: u.id,
              name: u.name,
              completed,
              remaining: totalLessons - completed,
            });
          }
        }
      }

      return {
        id: course.id,
        name: course.name,
        total_lessons: totalLessons,
        avg_completion_pct: enrolled > 0 ? Math.round(totalCompletion / enrolled) : 0,
        enrolled,
        stalled_members: stalledMembers,
      };
    });

    return JSON.stringify({ metric: "course_progress", courses: courseProgress });
  }

  // -- member_segments --
  // FIX 2: pragmatic segments including "churned"
  if (metric === "member_segments") {
    const [users, { threads: allThreads }] = await Promise.all([
      api.get<HBUser[]>("/users"),
      fetchAllThreads(api, 5),
    ]);

    // Build set of users who authored threads recently (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentThreadAuthors = new Set<string>();
    const allThreadAuthors = new Set<string>();
    for (const t of allThreads) {
      allThreadAuthors.add(t.userID);
      if (new Date(t.createdAt).getTime() > thirtyDaysAgo) {
        recentThreadAuthors.add(t.userID);
      }
    }

    const segments = {
      new_members: [] as Array<{ id: string; name: string; email: string }>,
      active: [] as Array<{ id: string; name: string; lessons: number; recent_threads: boolean }>,
      at_risk: [] as Array<{ id: string; name: string; email: string; lessons: number }>,
      churned: [] as Array<{ id: string; name: string; email: string }>,
    };

    for (const u of users) {
      const lessonsCount = u.completedLessons?.length ?? 0;
      const groupsCount = u.groupIDs?.length ?? 0;
      const hasRecentThreads = recentThreadAuthors.has(u.id);
      const hasAnyThreads = allThreadAuthors.has(u.id);

      if (lessonsCount > 0 || hasRecentThreads) {
        // "active": has completed lessons OR has recent thread activity
        if (lessonsCount > 0 && !hasRecentThreads && !hasAnyThreads) {
          // "at_risk": completed some lessons but no thread activity at all (were active, stopped)
          segments.at_risk.push({ id: u.id, name: u.name, email: u.email, lessons: lessonsCount });
        } else {
          segments.active.push({
            id: u.id,
            name: u.name,
            lessons: lessonsCount,
            recent_threads: hasRecentThreads,
          });
        }
      } else if (lessonsCount === 0 && groupsCount > 0) {
        // "new": no lessons, but in at least one group (joined but haven't engaged)
        segments.new_members.push({ id: u.id, name: u.name, email: u.email });
      } else {
        // "churned": no lessons, no groups, no thread activity
        segments.churned.push({ id: u.id, name: u.name, email: u.email });
      }
    }

    return JSON.stringify({
      metric: "member_segments",
      total: users.length,
      counts: {
        new_members: segments.new_members.length,
        active: segments.active.length,
        at_risk: segments.at_risk.length,
        churned: segments.churned.length,
      },
      segments: {
        new_members: segments.new_members.slice(0, params.limit ?? 20),
        active: segments.active.slice(0, params.limit ?? 20),
        at_risk: segments.at_risk.slice(0, params.limit ?? 20),
        churned: segments.churned.slice(0, params.limit ?? 20),
      },
    });
  }

  // -- growth --
  // FIX 5: includes likely_new_members count
  if (metric === "growth") {
    const users = await api.get<HBUser[]>("/users");
    const groupDistribution = new Map<number, number>();
    let likelyNewMembers = 0;
    for (const u of users) {
      const count = u.groupIDs?.length ?? 0;
      groupDistribution.set(count, (groupDistribution.get(count) ?? 0) + 1);
      if ((u.completedLessons?.length ?? 0) === 0) {
        likelyNewMembers++;
      }
    }
    const distribution = [...groupDistribution.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([groups, count]) => ({ groups, members: count }));

    return JSON.stringify({
      metric: "growth",
      total_members: users.length,
      likely_new_members: likelyNewMembers,
      note: "likely_new_members = users with 0 completed lessons (join date unavailable via API)",
      group_distribution: distribution,
    });
  }

  // -- top_contributors --
  if (metric === "top_contributors") {
    const channels = await api.get<HBChannel[]>("/channels");
    const userThreadCounts = new Map<string, number>();

    await Promise.all(
      channels.map(async (ch) => {
        try {
          const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
          for (const t of threads) {
            userThreadCounts.set(t.userID, (userThreadCounts.get(t.userID) ?? 0) + 1);
          }
        } catch {
          // skip unavailable channels
        }
      }),
    );

    // Resolve names for the leaderboard
    const users = await api.get<HBUser[]>("/users");
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    const leaderboard = [...userThreadCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, params.limit ?? 20)
      .map(([userID, threads]) => ({
        user_id: userID,
        name: userMap.get(userID) ?? userID,
        threads,
      }));

    return JSON.stringify({
      metric: "top_contributors",
      leaderboard,
    });
  }

  return JSON.stringify({ error: `Unknown metric: ${metric}` });
}
