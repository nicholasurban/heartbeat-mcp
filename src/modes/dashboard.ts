import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleDashboard(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "dashboard mode not yet implemented" });
}
