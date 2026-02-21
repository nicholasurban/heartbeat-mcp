import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleContent(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "content mode not yet implemented" });
}
