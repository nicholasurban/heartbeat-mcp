import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleMembers(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "members mode not yet implemented" });
}
