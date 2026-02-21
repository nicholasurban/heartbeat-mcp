import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleEvents(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "events mode not yet implemented" });
}
