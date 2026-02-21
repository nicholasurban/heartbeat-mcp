#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HeartbeatAPI } from "./api.js";
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA, toolHandler, ToolParams } from "./tool.js";

const server = new McpServer({
  name: "heartbeat-mcp-server",
  version: "1.0.0",
});

async function main(): Promise<void> {
  const apiKey = process.env.HEARTBEAT_API_KEY;
  if (!apiKey) {
    console.error("ERROR: HEARTBEAT_API_KEY environment variable is required");
    process.exit(1);
  }

  const api = new HeartbeatAPI(apiKey);

  server.tool(
    TOOL_NAME,
    TOOL_DESCRIPTION,
    TOOL_SCHEMA,
    async (params) => {
      const result = await toolHandler(api, params as ToolParams);
      return { content: [{ type: "text" as const, text: result }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Heartbeat MCP server running via stdio");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
