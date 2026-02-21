import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleDm(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "dm mode not yet implemented" });
}
