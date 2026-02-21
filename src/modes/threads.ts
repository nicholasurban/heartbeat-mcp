import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleThreads(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "threads mode not yet implemented" });
}
