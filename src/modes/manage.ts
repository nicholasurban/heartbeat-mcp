import { HeartbeatAPI } from "../api.js";
import type { ToolParams } from "../tool.js";

export async function handleManage(_api: HeartbeatAPI, _params: ToolParams): Promise<string> {
  return JSON.stringify({ status: "manage mode not yet implemented" });
}
