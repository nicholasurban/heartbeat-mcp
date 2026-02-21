import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleSearch(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "search mode not yet implemented" });
}
