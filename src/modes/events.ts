import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleEvents(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  const action = params.action ?? "list";

  if (action === "get") {
    if (!params.event_id) return JSON.stringify({ error: "Required: 'event_id'" });
    const [event, instances] = await Promise.all([
      api.get<Record<string, unknown>>(`/events/${params.event_id}`),
      api.get<unknown[]>(`/events/${params.event_id}/instances`),
    ]);
    return JSON.stringify({ event, instances });
  }

  if (action === "attendance") {
    if (!params.event_id) return JSON.stringify({ error: "Required: 'event_id'" });
    const attendance = await api.get<unknown[]>(`/events/${params.event_id}/attendance`);
    return JSON.stringify({ event_id: params.event_id, attendance });
  }

  if (action === "create") {
    if (!params.event_name || !params.start_time || !params.duration) {
      return JSON.stringify({
        error: "Required: 'event_name', 'start_time' (ISO 8601), 'duration' (minutes)",
      });
    }
    const body: Record<string, unknown> = {
      name: params.event_name,
      startTime: params.start_time,
      duration: params.duration,
    };
    if (params.event_description) body.description = params.event_description;
    if (params.location) body.location = params.location;
    if (params.invited_users) body.invitedUsers = params.invited_users;
    if (params.invited_groups) body.invitedGroups = params.invited_groups;

    const result = await api.put<Record<string, unknown>>("/events", body);
    return JSON.stringify({ action: "event_created", event: result });
  }

  // Default: list
  const queryParams: Record<string, unknown> = {};
  if (params.group) queryParams.groupID = params.group;
  const events = await api.get<Array<Record<string, unknown>>>("/events", queryParams);

  return JSON.stringify({
    count: events.length,
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      startTime: e.startTime,
      duration: e.duration,
      location: e.location,
    })),
  });
}
