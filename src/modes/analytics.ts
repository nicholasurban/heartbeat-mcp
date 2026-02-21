import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleAnalytics(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "analytics mode not yet implemented" });
}
