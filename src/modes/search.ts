import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";
import { HBUser, HBChannel, HBThread, stripHtml } from "../helpers.js";

export async function handleSearch(api: HeartbeatAPI, params: ToolParams): Promise<string> {
  if (!params.query) return JSON.stringify({ error: "Required: 'query'" });

  const q = params.query.toLowerCase();
  const resourcesToSearch = params.resources ?? ["members", "threads", "documents", "events"];
  const limit = params.limit ?? 10;
  const results: Record<string, unknown[]> = {};

  const fetches: Array<Promise<void>> = [];

  if (resourcesToSearch.includes("members")) {
    fetches.push(
      api.get<HBUser[]>("/users").then((users) => {
        results.members = users
          .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
          .slice(0, limit)
          .map((u) => ({ id: u.id, name: u.name, email: u.email }));
      }).catch(() => {
        results.members = [];
      }),
    );
  }

  if (resourcesToSearch.includes("threads")) {
    fetches.push(
      api.get<HBChannel[]>("/channels").then(async (channels) => {
        const threadResults: unknown[] = [];
        for (const ch of channels.slice(0, 10)) {
          try {
            const threads = await api.get<HBThread[]>(`/channels/${ch.id}/threads`);
            for (const t of threads) {
              if (stripHtml(t.text, 500).toLowerCase().includes(q)) {
                threadResults.push({
                  id: t.id,
                  channel: ch.name,
                  preview: stripHtml(t.text),
                  created: t.createdAt,
                });
              }
            }
          } catch {
            /* skip unavailable channels */
          }
        }
        results.threads = threadResults.slice(0, limit);
      }).catch(() => {
        results.threads = [];
      }),
    );
  }

  if (resourcesToSearch.includes("documents")) {
    fetches.push(
      api.get<Array<Record<string, unknown>>>("/documents").then((docs) => {
        results.documents = docs
          .filter(
            (d) =>
              (d.title as string | undefined)?.toLowerCase().includes(q) ||
              (d.description as string | undefined)?.toLowerCase().includes(q),
          )
          .slice(0, limit)
          .map((d) => ({ id: d.id, title: d.title, description: d.description }));
      }).catch(() => {
        results.documents = [];
      }),
    );
  }

  if (resourcesToSearch.includes("events")) {
    fetches.push(
      api.get<Array<Record<string, unknown>>>("/events").then((events) => {
        results.events = events
          .filter((e) => (e.name as string | undefined)?.toLowerCase().includes(q))
          .slice(0, limit)
          .map((e) => ({ id: e.id, name: e.name, startTime: e.startTime }));
      }).catch(() => {
        results.events = [];
      }),
    );
  }

  await Promise.all(fetches);

  return JSON.stringify({
    query: params.query,
    results,
    total: Object.values(results).reduce((sum, arr) => sum + arr.length, 0),
  });
}
