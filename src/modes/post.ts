import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handlePost(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "post mode not yet implemented" });
}
