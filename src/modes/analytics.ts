import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, HBChannel, HBThread } from "../helpers.js";

export async function handleAnalytics(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  if (!params.metric) {
    return JSON.stringify({
      error: "Required: 'metric'. Valid metrics: engagement_scores, channel_activity, event_metrics, course_progress, member_segments, growth, top_contributors",
    });
  }

  const metric = params.metric;

  // -- engagement_scores --
  if (metric === "engagement_scores") {
    const users = await api.get<HBUser[]>("/users");
    const scored = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      lessons_completed: u.completedLessons?.length ?? 0,
      groups: u.groupIDs?.length ?? 0,
      score: (u.completedLessons?.length ?? 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const limit = params.limit ?? 20;
    return JSON.stringify({
      metric: "engagement_scores",
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
  if (metric === "event_metrics") {
    const events = await api.get<Array<Record<string, unknown>>>("/events");
    const eventMetrics = await Promise.all(
      events.map(async (e) => {
        try {
          const attendance = await api.get<unknown[]>(`/events/${e.id}/attendance`);
          const invited = (e.invitedUsers as string[] | undefined)?.length ?? 0;
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
    return JSON.stringify({ metric: "event_metrics", events: eventMetrics });
  }

  // -- course_progress --
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
        };
      }

      let totalCompletion = 0;
      let enrolled = 0;
      for (const u of users) {
        const completed = (u.completedLessons ?? [])
          .filter((cl) => lessonIDs.includes(cl.lessonID))
          .length;
        if (completed > 0) {
          enrolled++;
          totalCompletion += (completed / totalLessons) * 100;
        }
      }

      return {
        id: course.id,
        name: course.name,
        total_lessons: totalLessons,
        avg_completion_pct: enrolled > 0 ? Math.round(totalCompletion / enrolled) : 0,
        enrolled,
      };
    });

    return JSON.stringify({ metric: "course_progress", courses: courseProgress });
  }

  // -- member_segments --
  if (metric === "member_segments") {
    const users = await api.get<HBUser[]>("/users");
    const segments = {
      new_members: [] as Array<{ id: string; name: string; email: string }>,
      active: [] as Array<{ id: string; name: string; lessons: number }>,
      at_risk: [] as Array<{ id: string; name: string; email: string }>,
    };

    for (const u of users) {
      const lessonsCount = u.completedLessons?.length ?? 0;
      const groupsCount = u.groupIDs?.length ?? 0;

      if (lessonsCount === 0 && groupsCount === 0) {
        segments.at_risk.push({ id: u.id, name: u.name, email: u.email });
      } else if (lessonsCount === 0) {
        segments.new_members.push({ id: u.id, name: u.name, email: u.email });
      } else {
        segments.active.push({ id: u.id, name: u.name, lessons: lessonsCount });
      }
    }

    return JSON.stringify({
      metric: "member_segments",
      total: users.length,
      new_members: segments.new_members.length,
      active: segments.active.length,
      at_risk: segments.at_risk.length,
      segments: {
        new_members: segments.new_members.slice(0, params.limit ?? 20),
        active: segments.active.slice(0, params.limit ?? 20),
        at_risk: segments.at_risk.slice(0, params.limit ?? 20),
      },
    });
  }

  // -- growth --
  if (metric === "growth") {
    const users = await api.get<HBUser[]>("/users");
    const groupDistribution = new Map<number, number>();
    for (const u of users) {
      const count = u.groupIDs?.length ?? 0;
      groupDistribution.set(count, (groupDistribution.get(count) ?? 0) + 1);
    }
    const distribution = [...groupDistribution.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([groups, count]) => ({ groups, members: count }));

    return JSON.stringify({
      metric: "growth",
      total_members: users.length,
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
